import express from 'express';
import fs from 'fs';
import { join, dirname, basename, relative, resolve, extname } from 'path';
import { fileURLToPath } from 'url';
import archiver from 'archiver';
import AdmZip from 'adm-zip';
import crypto from 'crypto';
import { run, get, all } from '../db.js';
import { vaultPath } from '../watcher.js';
import { authenticateJWT } from './auth.js';
import { getEmbedding, cosineSimilarity } from '../embeddings.js';
import { threeWayMerge } from '../merge.js';
import { archiveNoteBeforeDelete, restoreNoteFromTrash, purgeFromTrash, clearTrash, getTrashList } from '../trash.js';

// Helper to update note embedding in the background
export const updateNoteEmbedding = async (relPath, content) => {
  try {
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');

    // Check if the embedding is already up to date
    const existing = await get('SELECT content_hash FROM note_embeddings WHERE relative_path = ?', [relPath]);
    if (existing && existing.content_hash === contentHash) {
      return;
    }

    const embedding = await getEmbedding(content);
    await run(`
      INSERT INTO note_embeddings (relative_path, embedding, content_hash)
      VALUES (?, ?, ?)
      ON CONFLICT(relative_path) DO UPDATE SET
        embedding = excluded.embedding,
        content_hash = excluded.content_hash
    `, [relPath, JSON.stringify(embedding), contentHash]);
    console.log(`[Embeddings] Successfully updated embedding for: ${relPath}`);
  } catch (err) {
    console.error(`[Embeddings] Failed to update embedding for ${relPath}:`, err);
  }
};

const router = express.Router();

// Define and clear/create temp directory for chunked uploads
const __dirname = dirname(fileURLToPath(import.meta.url));
const tempDir = resolve(__dirname, '../temp');

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
} else {
  try {
    const files = fs.readdirSync(tempDir);
    for (const file of files) {
      fs.unlinkSync(join(tempDir, file));
    }
    console.log('[Init] Cleared temporary import directory');
  } catch (err) {
    console.error('Failed to clear temp directory:', err);
  }
}

// Initialize sharp and cache directory for image thumbnails
let sharp;
try {
  sharp = (await import('sharp')).default;
  console.log('[Init] sharp library loaded successfully for image thumbnail generation');
} catch (err) {
  console.warn('[Init] sharp library load failed, thumbnail generation will be disabled:', err.message);
}

const cacheDir = resolve(__dirname, '../cache/thumbnails');
if (!fs.existsSync(cacheDir)) {
  fs.mkdirSync(cacheDir, { recursive: true });
}

// Helper to normalize path separators to forward slashes
const normalizePath = (p) => p.replace(/\\/g, '/');

// Verify read-write permissions
const canEdit = (req, res, next) => {
  if (req.user.role === 'Viewer') {
    return res.status(403).json({ error: 'Permission denied: Read-only access' });
  }
  next();
};

// Check if note is locked by someone else
const checkLock = async (req, res, next) => {
  const relPath = req.body.relative_path || req.query.relative_path;
  if (!relPath) return next();

  try {
    const lock = await get('SELECT * FROM locks WHERE relative_path = ?', [relPath]);
    if (lock && lock.user_id !== req.user.id && new Date(lock.expires_at) > new Date()) {
      return res.status(423).json({ error: `File is locked by user: ${lock.username}` });
    }
    next();
  } catch (err) {
    console.error('Lock validation error:', err);
    res.status(500).json({ error: 'Failed to validate document lock' });
  }
};

// 1. Get all notes and directories (Metadata from SQLite)
router.get('/', authenticateJWT, async (req, res) => {
  try {
    const notesList = await all('SELECT * FROM notes ORDER BY is_directory DESC, title ASC');
    res.json(notesList);
  } catch (err) {
    console.error('Error fetching file list:', err);
    res.status(500).json({ error: 'Failed to fetch files' });
  }
});

// 2. Read specific note content
router.get('/content', authenticateJWT, async (req, res) => {
  const relPath = req.query.relative_path;
  if (!relPath) return res.status(400).json({ error: 'relative_path is required' });

  const absolutePath = join(vaultPath, relPath);
  try {
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    const content = fs.readFileSync(absolutePath, 'utf8');
    res.json({ content });
  } catch (err) {
    console.error(`Error reading file ${relPath}:`, err);
    res.status(500).json({ error: 'Failed to read note content' });
  }
});

// 3. Create a note or folder on disk
router.post('/', authenticateJWT, canEdit, async (req, res) => {
  const { relative_path, is_directory } = req.body;
  if (!relative_path) return res.status(400).json({ error: 'relative_path is required' });

  const normPath = normalizePath(relative_path);
  const absolutePath = join(vaultPath, normPath);

  try {
    if (fs.existsSync(absolutePath)) {
      return res.status(409).json({ error: 'File or directory already exists' });
    }

    const title = basename(normPath, is_directory ? '' : '.md');
    const parentPath = normalizePath(dirname(normPath)) === '.' ? '' : normalizePath(dirname(normPath));

    if (is_directory) {
      // 1. Insert directory record to DB first
      await run(
        'INSERT OR REPLACE INTO notes (relative_path, title, is_directory, parent_path, last_edited_by, created_by) VALUES (?, ?, ?, ?, ?, ?)',
        [normPath, title, 1, parentPath, req.user.username, req.user.username]
      );
      // 2. Create physical directory
      fs.mkdirSync(absolutePath, { recursive: true });
      res.status(201).json({ message: 'Directory created', relative_path: normPath });
    } else {
      // Ensure parent directory exists
      fs.mkdirSync(dirname(absolutePath), { recursive: true });
      const initialContent = `# ${title}\n\n`;

      // 1. Insert note and first version record to DB first
      await run(
        'INSERT OR REPLACE INTO notes (relative_path, title, is_directory, parent_path, last_edited_by, created_by) VALUES (?, ?, ?, ?, ?, ?)',
        [normPath, title, 0, parentPath, req.user.username, req.user.username]
      );
      await run(
        'INSERT INTO versions (relative_path, content, author_name) VALUES (?, ?, ?)',
        [normPath, initialContent, req.user.username]
      );

      // 2. Write note content to disk
      fs.writeFileSync(absolutePath, initialContent, 'utf8');

      updateNoteEmbedding(normPath, initialContent).catch(err => {
        console.error('[Embeddings] Initial note embedding calculation failed:', err);
      });

      res.status(201).json({ message: 'Note created', relative_path: normPath });
    }
  } catch (err) {
    console.error('Error creating resource:', err);
    res.status(500).json({ error: 'Failed to create resource' });
  }
});

// 4. Save note content
router.put('/', authenticateJWT, canEdit, checkLock, async (req, res) => {
  const { relative_path, content } = req.body;
  if (!relative_path) return res.status(400).json({ error: 'relative_path is required' });
  if (content === undefined) return res.status(400).json({ error: 'content is required' });

  const normPath = normalizePath(relative_path);
  const absolutePath = join(vaultPath, normPath);

  try {
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: 'File not found on disk' });
    }

    // Check owner permission for non-Admin users
    if (req.user.role !== 'Admin') {
      const note = await get('SELECT created_by FROM notes WHERE relative_path = ?', [normPath]);
      if (note && note.created_by && note.created_by !== 'Внешняя система' && note.created_by !== req.user.username) {
        return res.status(403).json({ 
          error: 'Permission denied: Прямое редактирование чужого документа запрещено. Пожалуйста, используйте Режим рецензирования (Suggest Mode).' 
        });
      }
    }

    // Create a new revision version and update note info first, so that the Chokidar watcher
    // sees that the latest database version already matches the new content and keeps the correct author name.
    await run(
      'INSERT INTO versions (relative_path, content, author_name) VALUES (?, ?, ?)',
      [normPath, content, req.user.username]
    );

    await run(
      'UPDATE notes SET updated_at = CURRENT_TIMESTAMP, last_edited_by = ? WHERE relative_path = ?',
      [req.user.username, normPath]
    );

    // Write to physical disk
    fs.writeFileSync(absolutePath, content, 'utf8');

    // Calculate embedding in the background
    updateNoteEmbedding(normPath, content).catch(err => {
      console.error('[Embeddings] Background update failed:', err);
    });

    // Broadcast file update to all clients to trigger live tree and graph refresh
    req.app.get('io').emit('file-update', { relative_path: normPath, content });

    res.json({ message: 'Note saved successfully' });
  } catch (err) {
    console.error(`Error saving note ${normPath}:`, err);
    res.status(500).json({ error: 'Failed to save note' });
  }
});

// 5. Delete note or folder from disk and database (self-healing defensive sync)
router.delete('/', authenticateJWT, canEdit, async (req, res) => {
  const relPath = req.query.relative_path;
  if (!relPath) return res.status(400).json({ error: 'relative_path is required' });

  const normPath = normalizePath(relPath);
  const absolutePath = join(vaultPath, normPath);

  try {
    if (!fs.existsSync(absolutePath)) {
      // Архивируем все Markdown-файлы, которые есть в БД для этого пути перед удалением
      const nestedNotes = await all('SELECT relative_path FROM notes WHERE (relative_path = ? OR relative_path LIKE ?) AND is_directory = 0', [normPath, normPath + '/%']);
      for (const note of nestedNotes) {
        await archiveNoteBeforeDelete(note.relative_path, req.user.username);
      }

      // Self-heal: If folder is not on disk but remains in DB, clean it up
      await run('DELETE FROM notes WHERE relative_path = ? OR relative_path LIKE ?', [normPath, normPath + '/%']);
      req.app.get('io').emit('file-delete', { relative_path: normPath });
      return res.status(404).json({ error: 'Ресурс не найден на диске, но удален из базы данных' });
    }

    const stat = fs.statSync(absolutePath);
    const isDir = stat.isDirectory();

    // Архивируем файлы в корзину перед физическим удалением
    if (isDir) {
      const nestedNotes = await all('SELECT relative_path FROM notes WHERE (relative_path = ? OR relative_path LIKE ?) AND is_directory = 0', [normPath, normPath + '/%']);
      for (const note of nestedNotes) {
        await archiveNoteBeforeDelete(note.relative_path, req.user.username);
      }
      fs.rmSync(absolutePath, { recursive: true, force: true });
    } else {
      await archiveNoteBeforeDelete(normPath, req.user.username);
      fs.unlinkSync(absolutePath);
    }

    // Synchronously update SQLite DB to ensure instant client sync without relying solely on Chokidar
    await run('DELETE FROM notes WHERE relative_path = ? OR relative_path LIKE ?', [normPath, normPath + '/%']);
    
    // Broadcast delete event instantly to all clients via WebSockets
    req.app.get('io').emit('file-delete', { relative_path: normPath });

    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    console.error(`Error deleting resource ${normPath}:`, err);
    res.status(500).json({ error: 'Failed to delete resource' });
  }
});

// 5.5. Rename note or folder (Self-healing DB index updates for files and nested directories)
router.post('/rename', authenticateJWT, canEdit, async (req, res) => {
  const { relative_path, new_name } = req.body;
  if (!relative_path || !new_name) {
    return res.status(400).json({ error: 'relative_path and new_name are required' });
  }

  const trimmedName = new_name.trim();
  const illegalChars = /[\\/:*?"<>|]/;
  if (illegalChars.test(trimmedName)) {
    return res.status(400).json({ error: 'Имя содержит запрещенные символы файловой системы' });
  }

  const oldNormPath = normalizePath(relative_path);
  const parentDir = normalizePath(dirname(oldNormPath)) === '.' ? '' : normalizePath(dirname(oldNormPath));
  
  // Calculate new path relative to parent directory
  let newNormPath = parentDir ? `${parentDir}/${trimmedName}` : trimmedName;
  
  const oldAbsolutePath = join(vaultPath, oldNormPath);
  let isDirectory = false;
  
  try {
    if (!fs.existsSync(oldAbsolutePath)) {
      return res.status(404).json({ error: 'File or folder not found on disk' });
    }

    isDirectory = fs.statSync(oldAbsolutePath).isDirectory();
    
    // Automatically preserve .md extension for notes
    if (!isDirectory && !newNormPath.endsWith('.md')) {
      newNormPath += '.md';
    }

    const newAbsolutePath = join(vaultPath, newNormPath);

    if (fs.existsSync(newAbsolutePath) && oldNormPath.toLowerCase() !== newNormPath.toLowerCase()) {
      return res.status(409).json({ error: 'Файл или папка с таким названием уже существует' });
    }

    // 1. Rename physically on disk
    fs.renameSync(oldAbsolutePath, newAbsolutePath);

    // 2. Query all database notes to perform a synchronous cascade rename (for directory renames)
    const allNotes = await all('SELECT * FROM notes');
    
    // Select this note/folder and all recursively nested children
    const targets = allNotes.filter(n => n.relative_path === oldNormPath || n.relative_path.startsWith(oldNormPath + '/'));

    for (const note of targets) {
      const suffix = note.relative_path.slice(oldNormPath.length);
      const childNewPath = newNormPath + suffix;
      
      const parentSuffix = note.parent_path.startsWith(oldNormPath) 
        ? note.parent_path.slice(oldNormPath.length) 
        : null;
      const childNewParent = parentSuffix !== null ? (newNormPath + parentSuffix) : note.parent_path;

      // Extract new title (either new name or nested child's original title)
      const childNewTitle = note.relative_path === oldNormPath 
        ? trimmedName.replace(/\.md$/, '') 
        : note.title;

      // Update SQLite tables
      await run('UPDATE notes SET relative_path = ?, parent_path = ?, title = ? WHERE relative_path = ?', 
        [childNewPath, childNewParent, childNewTitle, note.relative_path]);
      await run('UPDATE versions SET relative_path = ? WHERE relative_path = ?', 
        [childNewPath, note.relative_path]);
      await run('UPDATE locks SET relative_path = ? WHERE relative_path = ?', 
        [childNewPath, note.relative_path]);
      await run('UPDATE note_embeddings SET relative_path = ? WHERE relative_path = ?', 
        [childNewPath, note.relative_path]);
    }

    // 3. Broadcast rename event instantly to all clients via WebSockets
    req.app.get('io').emit('file-rename', { 
      old_path: oldNormPath, 
      new_path: newNormPath,
      new_title: trimmedName.replace(/\.md$/, ''),
      is_directory: isDirectory
    });

    res.json({ 
      message: 'Renamed successfully', 
      old_path: oldNormPath, 
      new_path: newNormPath 
    });
  } catch (err) {
    console.error(`Error renaming resource ${oldNormPath} to ${newNormPath}:`, err);
    res.status(500).json({ error: 'Failed to rename resource' });
  }
});

// 6. Upload Media/Image Attachment (via base64) with conflict-indexed filename suffix
const uploadMediaHandler = async (req, res) => {
  const { filename, base64Data } = req.body;
  if (!filename || !base64Data) {
    return res.status(400).json({ error: 'filename and base64Data are required' });
  }

  // Ensure assets folder exists in workspace
  const assetsDir = join(vaultPath, 'assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  const cleanedFilename = basename(filename).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');
  const ext = extname(cleanedFilename);
  const base = basename(cleanedFilename, ext);

  let counter = 0;
  let safeFilename = cleanedFilename;
  let filePath = join(assetsDir, safeFilename);

  while (fs.existsSync(filePath)) {
    counter++;
    safeFilename = `${base}_${counter}${ext}`;
    filePath = join(assetsDir, safeFilename);
  }

  try {
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(filePath, buffer);

    const relativeUrl = `assets/${safeFilename}`;
    res.json({ url: relativeUrl, filename: safeFilename });
  } catch (err) {
    console.error('Media upload failed:', err);
    res.status(500).json({ error: 'Failed to save media file' });
  }
};

router.post('/upload-media', authenticateJWT, canEdit, uploadMediaHandler);
router.post('/upload-image', authenticateJWT, canEdit, uploadMediaHandler);

// 6.0. Check if Media File Exists
router.get('/media-exists', authenticateJWT, (req, res) => {
  const filename = req.query.filename;
  if (!filename) return res.status(400).json({ error: 'filename query parameter is required' });
  const cleanedFilename = basename(filename).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');
  const filePath = join(vaultPath, 'assets', cleanedFilename);
  res.json({ exists: fs.existsSync(filePath) });
});

// 6.1. Upload Media Chunk
router.post('/upload-media-chunk', authenticateJWT, canEdit, (req, res) => {
  const chunkIndex = parseInt(req.headers['x-chunk-index'], 10);
  const totalChunks = parseInt(req.headers['x-total-chunks'], 10);
  const uploadId = req.headers['x-upload-id'];
  const filename = decodeURIComponent(req.headers['x-filename'] || 'upload');
  const overwrite = req.headers['x-overwrite'] === 'true';

  if (isNaN(chunkIndex) || isNaN(totalChunks) || !uploadId) {
    return res.status(400).json({ error: 'Missing required chunk headers' });
  }

  const partPath = join(tempDir, `${uploadId}.part_${chunkIndex}`);
  const writeStream = fs.createWriteStream(partPath);

  req.pipe(writeStream);

  writeStream.on('finish', async () => {
    try {
      // Check if all chunks are uploaded
      let allDone = true;
      for (let i = 0; i < totalChunks; i++) {
        if (!fs.existsSync(join(tempDir, `${uploadId}.part_${i}`))) {
          allDone = false;
          break;
        }
      }

      if (allDone) {
        console.log(`[Media Upload] All ${totalChunks} chunks received for ${filename}. Merging...`);
        
        // Ensure assets folder exists in workspace
        const assetsDir = join(vaultPath, 'assets');
        if (!fs.existsSync(assetsDir)) {
          fs.mkdirSync(assetsDir, { recursive: true });
        }

        const cleanedFilename = basename(filename).replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_');
        const ext = extname(cleanedFilename);
        const base = basename(cleanedFilename, ext);

        let counter = 0;
        let safeFilename = cleanedFilename;
        let filePath = join(assetsDir, safeFilename);

        if (!overwrite) {
          while (fs.existsSync(filePath)) {
            counter++;
            safeFilename = `${base}_${counter}${ext}`;
            filePath = join(assetsDir, safeFilename);
          }
        }

        // Streaming merge function
        const mergeChunks = () => {
          return new Promise((resolvePromise, rejectPromise) => {
            const finalWriteStream = fs.createWriteStream(filePath);
            let currentChunk = 0;

            function appendNext() {
              if (currentChunk >= totalChunks) {
                finalWriteStream.end();
                return;
              }

              const chunkPath = join(tempDir, `${uploadId}.part_${currentChunk}`);
              const readStream = fs.createReadStream(chunkPath);

              readStream.pipe(finalWriteStream, { end: false });

              readStream.on('end', () => {
                try {
                  fs.unlinkSync(chunkPath); // delete part file immediately
                } catch (e) {
                  console.error(`Failed to delete chunk file ${chunkPath}:`, e);
                }
                currentChunk++;
                appendNext();
              });

              readStream.on('error', (err) => {
                finalWriteStream.end();
                rejectPromise(err);
              });
            }

            finalWriteStream.on('finish', () => {
              resolvePromise();
            });

            finalWriteStream.on('error', (err) => {
              rejectPromise(err);
            });

            appendNext();
          });
        };

        await mergeChunks();
        console.log(`[Media Upload] Merge complete: ${safeFilename}`);

        const relativeUrl = `assets/${safeFilename}`;
        res.json({ url: relativeUrl, filename: safeFilename });
      } else {
        res.json({ success: true, message: `Chunk ${chunkIndex + 1}/${totalChunks} uploaded` });
      }
    } catch (err) {
      console.error('Media chunk merge error:', err);
      res.status(500).json({ error: 'Failed to merge media chunks' });
    }
  });

  writeStream.on('error', (err) => {
    console.error('WriteStream error on media chunk write:', err);
    res.status(500).json({ error: 'Failed to save media chunk file' });
  });
});

// 6.2. List Media Files
router.get('/media', authenticateJWT, async (req, res) => {
  try {
    const assetsDir = join(vaultPath, 'assets');
    if (!fs.existsSync(assetsDir)) {
      return res.json([]);
    }
    const files = fs.readdirSync(assetsDir);
    const mediaFiles = [];
    for (const file of files) {
      const filePath = join(assetsDir, file);
      const stats = fs.statSync(filePath);
      if (stats.isFile()) {
        const ext = extname(file).toLowerCase();
        const isMedia = /\.(gif|jpe?g|png|svg|webp|bmp|ico|mp4|webm|ogg|mov|m4v|3gp)$/i.test(ext);
        if (isMedia) {
          mediaFiles.push({
            filename: file,
            size: stats.size,
            updatedAt: stats.mtime
          });
        }
      }
    }
    res.json(mediaFiles);
  } catch (err) {
    console.error('Error fetching media files:', err);
    res.status(500).json({ error: 'Failed to fetch media files' });
  }
});

// 6.3. Delete Media File
router.delete('/media/:filename', authenticateJWT, canEdit, async (req, res) => {
  const { filename } = req.params;
  if (!filename) {
    return res.status(400).json({ error: 'Filename is required' });
  }

  const cleanedFilename = basename(filename);
  const assetsDir = join(vaultPath, 'assets');
  const filePath = join(assetsDir, cleanedFilename);

  const resolvedVaultPath = resolve(vaultPath);
  const resolvedAssetsPath = resolve(assetsDir);
  const resolvedFilePath = resolve(filePath);

  if (!resolvedFilePath.startsWith(resolvedAssetsPath) || !resolvedFilePath.startsWith(resolvedVaultPath)) {
    return res.status(403).json({ error: 'Access denied: Out of assets boundary' });
  }

  try {
    if (!fs.existsSync(resolvedFilePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    fs.unlinkSync(resolvedFilePath);
    res.json({ message: 'File deleted successfully', filename: cleanedFilename });
  } catch (err) {
    console.error('Error deleting media file:', err);
    res.status(500).json({ error: 'Failed to delete media file' });
  }
});



// 6.5. Get Graph Data (Compute relationships on server with active disk filtering & self-healing)
router.get('/graph-data', authenticateJWT, async (req, res) => {
  try {
    const notesList = await all('SELECT relative_path, title, is_directory FROM notes WHERE is_directory = 0');
    const links = [];
    const validNotes = [];

    for (const note of notesList) {
      const absolutePath = join(vaultPath, note.relative_path);
      if (fs.existsSync(absolutePath)) {
        validNotes.push(note);
        const content = fs.readFileSync(absolutePath, 'utf8');
        const wikiLinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
        let match;
        while ((match = wikiLinkRegex.exec(content)) !== null) {
          let targetPath = match[1].trim();
          if (!targetPath.endsWith('.md')) {
            targetPath += '.md';
          }
          // Try to find matching note
          let targetNote = notesList.find(n => n.relative_path.toLowerCase() === targetPath.toLowerCase());
          if (!targetNote) {
            targetNote = notesList.find(n => n.title.toLowerCase() === targetPath.replace(/\.md$/, '').toLowerCase());
          }
          // Verify both source and target physically exist on disk
          if (targetNote && targetNote.relative_path !== note.relative_path) {
            const targetAbsolutePath = join(vaultPath, targetNote.relative_path);
            if (fs.existsSync(targetAbsolutePath)) {
              links.push({
                source: note.relative_path,
                target: targetNote.relative_path
              });
            }
          }
        }
      } else {
        // Self-heal DB: If a note is in SQLite but missing from disk, delete it
        await run('DELETE FROM notes WHERE relative_path = ?', [note.relative_path]);
      }
    }

    // Load embeddings to compute semantic links
    const embeddingsList = await all('SELECT relative_path, embedding FROM note_embeddings');
    const embeddingsMap = {};
    for (const item of embeddingsList) {
      try {
        embeddingsMap[item.relative_path] = JSON.parse(item.embedding);
      } catch (e) {
        console.error(`[Embeddings] Failed to parse embedding for ${item.relative_path}`);
      }
    }

    const semanticLinks = [];
    for (let i = 0; i < validNotes.length; i++) {
      const pathA = validNotes[i].relative_path;
      const vecA = embeddingsMap[pathA];
      if (!vecA) continue;

      for (let j = i + 1; j < validNotes.length; j++) {
        const pathB = validNotes[j].relative_path;
        const vecB = embeddingsMap[pathB];
        if (!vecB) continue;

        const sim = cosineSimilarity(vecA, vecB);
        // Server-side cutoff is 0.45 to prevent transferring noisy/irrelevant links
        if (sim >= 0.45) {
          semanticLinks.push({
            source: pathA,
            target: pathB,
            isSemantic: true,
            similarity: parseFloat(sim.toFixed(4))
          });
        }
      }
    }

    res.json({
      nodes: validNotes.map(n => ({ id: n.relative_path, name: n.title, val: 1 })),
      links: [...links, ...semanticLinks]
    });
  } catch (err) {
    console.error('Failed to generate graph data:', err);
    res.status(500).json({ error: 'Failed to generate graph data' });
  }
});

// 6.6. Reindex Embeddings (Compute embeddings for all existing notes in background)
router.post('/reindex-embeddings', authenticateJWT, canEdit, async (req, res) => {
  try {
    const notesList = await all('SELECT relative_path FROM notes WHERE is_directory = 0');
    console.log(`[Embeddings] Starting manual reindexing of ${notesList.length} notes...`);

    // Run reindexing asynchronously in background to not block client response
    (async () => {
      let count = 0;
      for (const note of notesList) {
        const absolutePath = join(vaultPath, note.relative_path);
        if (fs.existsSync(absolutePath)) {
          const content = fs.readFileSync(absolutePath, 'utf8');
          await updateNoteEmbedding(note.relative_path, content);
          count++;
        }
      }
      console.log(`[Embeddings] Manual reindexing completed. Successfully processed ${count} notes.`);
    })().catch(err => {
      console.error('[Embeddings] Batch reindexing failed:', err);
    });

    res.json({ 
      message: 'Reindexing started in background', 
      total: notesList.length 
    });
  } catch (err) {
    console.error('Reindexing failed:', err);
    res.status(500).json({ error: 'Failed to start embedding reindexing' });
  }
});

// 7. Export Entire Vault as ZIP
router.get('/export', authenticateJWT, (req, res) => {
  const includeMD = req.query.includeMD !== 'false';
  const includeAssets = req.query.includeAssets !== 'false';

  console.log(`[Export] Generating vault ZIP archive (MD: ${includeMD}, Assets: ${includeAssets})...`);

  // Get date in Moscow timezone (UTC+3)
  const now = new Date();
  const moscowTime = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const year = moscowTime.getUTCFullYear();
  const month = String(moscowTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(moscowTime.getUTCDate()).padStart(2, '0');
  const hours = String(moscowTime.getUTCHours()).padStart(2, '0');
  const minutes = String(moscowTime.getUTCMinutes()).padStart(2, '0');

  let typePrefix = 'export';
  if (includeMD && !includeAssets) {
    typePrefix = 'notes';
  } else if (!includeMD && includeAssets) {
    typePrefix = 'assets';
  } else if (!includeMD && !includeAssets) {
    typePrefix = 'empty';
  }
  const filename = `stratanote-vault-${typePrefix}-${year}${month}${day}-${hours}${minutes}.zip`;

  res.attachment(filename);
  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.on('error', (err) => {
    console.error('[Export] Error during zipping:', err);
    res.status(500).send({ error: 'Compression error occurred' });
  });

  archive.pipe(res);

  // Read all files/folders in vaultPath and append to zip, excluding internal _app/ and system config files
  const items = fs.readdirSync(vaultPath);
  for (const item of items) {
    const SYSTEM_DIRS = ['_app', '_sync_mcp', 'node_modules', '.git', '.obsidian', '.agents', '.sync_backup'];
    if (SYSTEM_DIRS.includes(item) || item === 'package.json' || item === 'package-lock.json' || item.startsWith('.')) continue;

    const fullPath = join(vaultPath, item);
    const stat = fs.statSync(fullPath);

    if (item === 'assets') {
      if (includeAssets) {
        archive.directory(fullPath, item);
      }
    } else {
      if (includeMD) {
        if (stat.isDirectory()) {
          archive.directory(fullPath, item);
        } else {
          archive.file(fullPath, { name: item });
        }
      }
    }
  }

  archive.finalize();
});

// Helper to recursively clear only markdown files and empty directories (excluding system folders)
const clearVaultMarkdown = (dir) => {
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = join(dir, item);
    if (item.startsWith('.') || item === '_app' || item === 'node_modules' || item === 'assets') {
      continue;
    }
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      clearVaultMarkdown(fullPath);
      // Delete directory if it is now empty
      if (fs.readdirSync(fullPath).length === 0) {
        fs.rmdirSync(fullPath);
      }
    } else if (stat.isFile() && item.endsWith('.md')) {
      fs.unlinkSync(fullPath);
    }
  }
};

// Helper to recursively scan folder and index notes/directories into SQLite
const scanAndIndex = async (dir, baseDir = vaultPath, creatorName = 'Внешняя система') => {
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const fullPath = join(dir, item);
    const relPath = normalizePath(relative(baseDir, fullPath));

    if (
      item.startsWith('.') ||
      relPath === '_app' ||
      relPath === 'assets' ||
      relPath === 'node_modules' ||
      relPath.startsWith('_app/') ||
      relPath.startsWith('assets/') ||
      relPath.startsWith('node_modules/')
    ) {
      continue;
    }

    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const title = item;
      const parentPath = normalizePath(dirname(relPath)) === '.' ? '' : normalizePath(dirname(relPath));

      const existing = await get('SELECT relative_path FROM notes WHERE relative_path = ?', [relPath]);
      if (!existing) {
        await run(
          'INSERT INTO notes (relative_path, title, is_directory, parent_path, last_edited_by, created_by) VALUES (?, ?, ?, ?, ?, ?)',
          [relPath, title, 1, parentPath, creatorName, creatorName]
        );
      }
      await scanAndIndex(fullPath, baseDir, creatorName);
    } else if (stat.isFile() && item.endsWith('.md')) {
      const title = item.replace(/\.md$/, '');
      const parentPath = normalizePath(dirname(relPath)) === '.' ? '' : normalizePath(dirname(relPath));
      const content = fs.readFileSync(fullPath, 'utf8');

      const existing = await get('SELECT relative_path FROM notes WHERE relative_path = ?', [relPath]);
      if (!existing) {
        await run(
          'INSERT INTO notes (relative_path, title, is_directory, parent_path, last_edited_by, created_by) VALUES (?, ?, ?, ?, ?, ?)',
          [relPath, title, 0, parentPath, creatorName, creatorName]
        );
        await run(
          'INSERT INTO versions (relative_path, content, author_name) VALUES (?, ?, ?)',
          [relPath, content, 'Внешняя система']
        );
      } else {
        // Update database if file content has changed from the latest indexed version
        const lastVersion = await get('SELECT content FROM versions WHERE relative_path = ? ORDER BY id DESC LIMIT 1', [relPath]);
        if (!lastVersion || lastVersion.content !== content) {
          await run(
            'INSERT INTO versions (relative_path, content, author_name) VALUES (?, ?, ?)',
            [relPath, content, 'Внешняя система']
          );
          await run(
            'UPDATE notes SET updated_at = CURRENT_TIMESTAMP, last_edited_by = ? WHERE relative_path = ?',
            ['Внешняя система', relPath]
          );
        }
      }

      // Always trigger background embedding computation during indexing
      updateNoteEmbedding(relPath, content).catch(err => {
        console.error(`[Embeddings] Watcher index update failed for ${relPath}:`, err);
      });
    }
  }
};

// 7.5. Import Entire Vault from ZIP (Admin only)
router.post('/import', authenticateJWT, canEdit, async (req, res) => {
  if (req.user.role !== 'Admin') {
    return res.status(403).json({ error: 'Permission denied: Admins only' });
  }

  const { overwrite } = req.query;

  try {
    if (!req.body || !(req.body instanceof Buffer)) {
      return res.status(400).json({ error: 'Valid binary ZIP file is required in request body' });
    }

    // 1. If overwrite is true, delete existing markdown files/folders on disk and clear DB tables
    if (overwrite === 'true') {
      console.log('[Import] Clearing current markdown files for overwrite...');
      clearVaultMarkdown(vaultPath);
      await run('DELETE FROM notes');
      await run('DELETE FROM versions');
      await run('DELETE FROM locks');
    }

    // 2. Extract ZIP archive in-memory using adm-zip
    console.log('[Import] Extracting ZIP archive to vault...');
    const zip = new AdmZip(req.body);
    zip.extractAllTo(vaultPath, true);

    // 3. Scan and reindex vault files into SQLite
    console.log('[Import] Scanning and reindexing vault files...');
    await scanAndIndex(vaultPath, vaultPath, req.user.username);

    // 4. Notify all active sockets about the vault reload
    req.app.get('io').emit('vault-reload');

    res.json({ message: 'Vault imported and indexed successfully' });
  } catch (err) {
    console.error('Vault import error:', err);
    res.status(500).json({ error: 'Failed to import vault ZIP archive' });
  }
});

// 7.5.5. Import Vault from ZIP in chunks (Admin only)
router.post('/import-chunk', authenticateJWT, canEdit, (req, res) => {
  if (req.user.role !== 'Admin') {
    return res.status(403).json({ error: 'Permission denied: Admins only' });
  }

  const chunkIndex = parseInt(req.headers['x-chunk-index'], 10);
  const totalChunks = parseInt(req.headers['x-total-chunks'], 10);
  const uploadId = req.headers['x-upload-id'];
  const overwrite = req.headers['x-overwrite'] === 'true';

  if (isNaN(chunkIndex) || isNaN(totalChunks) || !uploadId) {
    return res.status(400).json({ error: 'Missing required chunk headers' });
  }

  const partPath = join(tempDir, `${uploadId}.part_${chunkIndex}`);
  const writeStream = fs.createWriteStream(partPath);

  req.pipe(writeStream);

  writeStream.on('finish', async () => {
    try {
      // Check if all chunks are uploaded
      let allDone = true;
      for (let i = 0; i < totalChunks; i++) {
        if (!fs.existsSync(join(tempDir, `${uploadId}.part_${i}`))) {
          allDone = false;
          break;
        }
      }

      if (allDone) {
        console.log(`[Import] All ${totalChunks} chunks received. Merging...`);
        const mergedZipPath = join(tempDir, `${uploadId}.zip`);

        // Streaming merge function
        const mergeChunks = () => {
          return new Promise((resolvePromise, rejectPromise) => {
            const finalWriteStream = fs.createWriteStream(mergedZipPath);
            let currentChunk = 0;

            function appendNext() {
              if (currentChunk >= totalChunks) {
                finalWriteStream.end();
                return;
              }

              const chunkPath = join(tempDir, `${uploadId}.part_${currentChunk}`);
              const readStream = fs.createReadStream(chunkPath);

              readStream.pipe(finalWriteStream, { end: false });

              readStream.on('end', () => {
                try {
                  fs.unlinkSync(chunkPath); // delete part file immediately
                } catch (e) {
                  console.error(`Failed to delete chunk file ${chunkPath}:`, e);
                }
                currentChunk++;
                appendNext();
              });

              readStream.on('error', (err) => {
                finalWriteStream.end();
                rejectPromise(err);
              });
            }

            finalWriteStream.on('finish', () => {
              resolvePromise();
            });

            finalWriteStream.on('error', (err) => {
              rejectPromise(err);
            });

            appendNext();
          });
        };

        await mergeChunks();
        console.log('[Import] Merge complete. Processing vault ZIP...');

        try {
          // 1. If overwrite is true, delete existing markdown files/folders on disk and clear DB tables
          if (overwrite) {
            console.log('[Import] Clearing current markdown files for overwrite...');
            clearVaultMarkdown(vaultPath);
            await run('DELETE FROM notes');
            await run('DELETE FROM versions');
            await run('DELETE FROM locks');
          }

          // 2. Extract ZIP archive using adm-zip
          console.log('[Import] Extracting ZIP archive to vault...');
          const zip = new AdmZip(mergedZipPath);
          zip.extractAllTo(vaultPath, true);

          // 3. Scan and reindex vault files into SQLite
          console.log('[Import] Scanning and reindexing vault files...');
          await scanAndIndex(vaultPath, vaultPath, req.user.username);

          // 4. Clean up merged ZIP
          if (fs.existsSync(mergedZipPath)) {
            fs.unlinkSync(mergedZipPath);
          }

          // 5. Notify all active sockets about the vault reload
          req.app.get('io').emit('vault-reload');

          res.json({ message: 'Vault imported and indexed successfully' });
        } catch (err) {
          console.error('Vault import processing error:', err);
          if (fs.existsSync(mergedZipPath)) {
            try {
              fs.unlinkSync(mergedZipPath);
            } catch (e) {}
          }
          res.status(500).json({ error: 'Failed to extract and index vault ZIP archive' });
        }
      } else {
        res.json({ success: true, message: `Chunk ${chunkIndex + 1}/${totalChunks} uploaded` });
      }
    } catch (err) {
      console.error('Chunk completion error:', err);
      res.status(500).json({ error: 'Failed to process chunk completion' });
    }
  });

  writeStream.on('error', (err) => {
    console.error('WriteStream error on chunk write:', err);
    res.status(500).json({ error: 'Failed to save chunk file' });
  });
});

// 7.6. Upload Single MD File
router.post('/upload-md', authenticateJWT, canEdit, async (req, res) => {
  const relPath = req.query.relative_path;
  if (!relPath) {
    return res.status(400).json({ error: 'relative_path query parameter is required' });
  }

  const illegalChars = /[\\:*?"<>|]/;
  if (illegalChars.test(relPath)) {
    return res.status(400).json({ error: 'Имя файла содержит запрещенные символы' });
  }

  const absolutePath = join(vaultPath, relPath);
  const parentDir = dirname(absolutePath);

  try {
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const content = req.body || '';
    fs.writeFileSync(absolutePath, content, 'utf8');

    const title = basename(relPath, '.md');
    const dbParentPath = normalizePath(dirname(relPath)) === '.' ? '' : normalizePath(dirname(relPath));

    const existingNote = await get('SELECT * FROM notes WHERE relative_path = ?', [relPath]);
    if (!existingNote) {
      await run(
        'INSERT INTO notes (relative_path, title, is_directory, parent_path, last_edited_by, created_by) VALUES (?, ?, ?, ?, ?, ?)',
        [relPath, title, 0, dbParentPath, req.user.username, req.user.username]
      );
      await run(
        'INSERT INTO versions (relative_path, content, author_name) VALUES (?, ?, ?)',
        [relPath, content, req.user.username]
      );
      req.app.get('io').emit('file-create', { relative_path: relPath, title, is_directory: false, parent_path: dbParentPath });
    } else {
      await run(
        'INSERT INTO versions (relative_path, content, author_name) VALUES (?, ?, ?)',
        [relPath, content, req.user.username]
      );
      await run(
        'UPDATE notes SET updated_at = CURRENT_TIMESTAMP, last_edited_by = ? WHERE relative_path = ?',
        [req.user.username, relPath]
      );
      req.app.get('io').emit('file-update', { relative_path: relPath, content });
    }

    res.json({ message: 'File uploaded successfully', relative_path: relPath });
  } catch (err) {
    console.error('Error uploading md file:', err);
    res.status(500).json({ error: 'Failed to upload md file' });
  }
});

// 7.6. Get pending suggestions for notifications (accessible to review owners/Admins)
router.get('/suggestions/pending', authenticateJWT, async (req, res) => {
  try {
    let pendingSuggestions = [];
    if (req.user.role === 'Admin') {
      pendingSuggestions = await all(`
        SELECT s.*, n.title 
        FROM suggestions s 
        JOIN notes n ON s.relative_path = n.relative_path 
        WHERE s.status = 'pending' 
        ORDER BY s.created_at DESC
      `);
    } else if (req.user.role === 'Editor') {
      pendingSuggestions = await all(`
        SELECT s.*, n.title 
        FROM suggestions s 
        JOIN notes n ON s.relative_path = n.relative_path 
        WHERE s.status = 'pending' AND n.created_by = ? 
        ORDER BY s.created_at DESC
      `, [req.user.username]);
    }
    res.json(pendingSuggestions);
  } catch (err) {
    console.error('Error fetching pending suggestions:', err);
    res.status(500).json({ error: 'Failed to fetch pending suggestions' });
  }
});

// 7.7. Get active suggestions for a note
router.get('/suggestions', authenticateJWT, async (req, res) => {
  const relPath = req.query.relative_path;
  if (!relPath) return res.status(400).json({ error: 'relative_path is required' });

  try {
    const list = await all(
      "SELECT * FROM suggestions WHERE relative_path = ? AND status = 'pending' ORDER BY created_at DESC",
      [relPath]
    );
    res.json(list);
  } catch (err) {
    console.error('Error fetching suggestions:', err);
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
});

// 7.8. Create or update a suggestion (Suggest Mode saving)
router.post('/suggest', authenticateJWT, canEdit, async (req, res) => {
  const { relative_path, suggested_content } = req.body;
  if (!relative_path || suggested_content === undefined) {
    return res.status(400).json({ error: 'relative_path and suggested_content are required' });
  }

  const absolutePath = join(vaultPath, relative_path);
  try {
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: 'Note not found on disk' });
    }

    const currentDiskContent = fs.readFileSync(absolutePath, 'utf8');

    // Check if user already has a pending suggestion for this file
    const existing = await get(
      "SELECT id FROM suggestions WHERE relative_path = ? AND author_name = ? AND status = 'pending'",
      [relative_path, req.user.username]
    );

    if (existing) {
      // Update existing suggestion
      await run(
        "UPDATE suggestions SET suggested_content = ?, created_at = CURRENT_TIMESTAMP WHERE id = ?",
        [suggested_content, existing.id]
      );
    } else {
      // Create new suggestion. The current content on disk is set as the base_content
      await run(
        "INSERT INTO suggestions (relative_path, author_name, base_content, suggested_content) VALUES (?, ?, ?, ?)",
        [relative_path, req.user.username, currentDiskContent, suggested_content]
      );
    }

    // Notify other editors/sockets
    req.app.get('io').emit('suggestion:changed', { relative_path });

    res.json({ message: 'Suggestion saved successfully' });
  } catch (err) {
    console.error('Error saving suggestion:', err);
    res.status(500).json({ error: 'Failed to save suggestion' });
  }
});

// Helper to verify suggestion review permission (creator or Admin)
const checkReviewPermission = async (req, res, next) => {
  const suggestionId = req.params.id;
  try {
    const suggestion = await get("SELECT * FROM suggestions WHERE id = ?", [suggestionId]);
    if (!suggestion) {
      return res.status(404).json({ error: 'Suggestion not found' });
    }

    const note = await get("SELECT created_by FROM notes WHERE relative_path = ?", [suggestion.relative_path]);
    const noteCreator = note ? note.created_by : 'Внешняя система';

    if (req.user.username !== noteCreator && req.user.role !== 'Admin') {
      return res.status(403).json({ error: 'Permission denied: Only the document creator or Admins can review suggestions' });
    }

    req.suggestion = suggestion;
    next();
  } catch (err) {
    console.error('Error verifying review permission:', err);
    res.status(500).json({ error: 'Failed to verify review permission' });
  }
};

// 7.9. Reject suggestion
router.post('/suggestions/:id/reject', authenticateJWT, canEdit, checkReviewPermission, async (req, res) => {
  const suggestionId = req.params.id;
  const relPath = req.suggestion.relative_path;

  try {
    await run("UPDATE suggestions SET status = 'rejected' WHERE id = ?", [suggestionId]);
    req.app.get('io').emit('suggestion:changed', { relative_path: relPath });
    res.json({ message: 'Suggestion rejected successfully' });
  } catch (err) {
    console.error('Error rejecting suggestion:', err);
    res.status(500).json({ error: 'Failed to reject suggestion' });
  }
});

// 7.10. Accept suggestion (Three-Way Merge)
router.post('/suggestions/:id/accept', authenticateJWT, canEdit, checkReviewPermission, async (req, res) => {
  const suggestionId = req.params.id;
  const { relative_path, author_name, base_content, suggested_content } = req.suggestion;
  const absolutePath = join(vaultPath, relative_path);

  try {
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: 'Note not found on disk' });
    }

    const currentDiskContent = fs.readFileSync(absolutePath, 'utf8');

    // Run 3-way merge
    const mergeResult = threeWayMerge(base_content, currentDiskContent, suggested_content);

    if (mergeResult.hasConflict) {
      return res.status(409).json({
        error: 'Merge conflict detected',
        hasConflict: true,
        mergedText: mergeResult.mergedText
      });
    }

    // Save merged content to disk
    fs.writeFileSync(absolutePath, mergeResult.mergedText, 'utf8');

    // Add version to SQLite history
    await run(
      'INSERT INTO versions (relative_path, content, author_name) VALUES (?, ?, ?)',
      [relative_path, mergeResult.mergedText, author_name]
    );

    // Update note meta info
    await run(
      'UPDATE notes SET updated_at = CURRENT_TIMESTAMP, last_edited_by = ? WHERE relative_path = ?',
      [author_name, relative_path]
    );

    // Accept suggestion in DB
    await run("UPDATE suggestions SET status = 'accepted' WHERE id = ?", [suggestionId]);

    // Recalculate embeddings in the background
    updateNoteEmbedding(relative_path, mergeResult.mergedText).catch(err => {
      console.error('[Embeddings] Suggest merge embedding recalculation failed:', err);
    });

    // Notify sockets
    req.app.get('io').emit('file-update', { relative_path, content: mergeResult.mergedText });
    req.app.get('io').emit('suggestion:changed', { relative_path });

    res.json({ message: 'Suggestion accepted and merged successfully', mergedText: mergeResult.mergedText });
  } catch (err) {
    console.error('Error accepting suggestion:', err);
    res.status(500).json({ error: 'Failed to accept suggestion' });
  }
});

// 7.11. Resolve conflicts and accept suggestion
router.post('/suggestions/:id/resolve', authenticateJWT, canEdit, checkReviewPermission, async (req, res) => {
  const suggestionId = req.params.id;
  const { relative_path, author_name } = req.suggestion;
  const { resolved_content } = req.body;

  if (resolved_content === undefined) {
    return res.status(400).json({ error: 'resolved_content is required' });
  }

  const absolutePath = join(vaultPath, relative_path);

  try {
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ error: 'Note not found on disk' });
    }

    // Save resolved content to disk
    fs.writeFileSync(absolutePath, resolved_content, 'utf8');

    // Add version to SQLite history
    await run(
      'INSERT INTO versions (relative_path, content, author_name) VALUES (?, ?, ?)',
      [relative_path, resolved_content, author_name]
    );

    // Update note meta info
    await run(
      'UPDATE notes SET updated_at = CURRENT_TIMESTAMP, last_edited_by = ? WHERE relative_path = ?',
      [author_name, relative_path]
    );

    // Accept suggestion in DB
    await run("UPDATE suggestions SET status = 'accepted' WHERE id = ?", [suggestionId]);

    // Recalculate embeddings in the background
    updateNoteEmbedding(relative_path, resolved_content).catch(err => {
      console.error('[Embeddings] Suggest resolve embedding recalculation failed:', err);
    });

    // Notify sockets
    req.app.get('io').emit('file-update', { relative_path, content: resolved_content });
    req.app.get('io').emit('suggestion:changed', { relative_path });

    res.json({ message: 'Suggestion resolved and accepted successfully', mergedText: resolved_content });
  } catch (err) {
    console.error('Error resolving suggestion conflict:', err);
    res.status(500).json({ error: 'Failed to resolve suggestion conflict' });
  }
});

export const rawHandler = async (req, res) => {
  const relPath = req.params[0];
  if (!relPath) return res.status(400).json({ error: 'relative_path is required' });

  const normPath = normalizePath(relPath);
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(normPath);
  } catch (err) {
    decodedPath = normPath;
  }

  const absolutePath = join(vaultPath, decodedPath);
  const resolvedVaultPath = resolve(vaultPath);
  const resolvedSafePath = resolve(absolutePath);

  if (!resolvedSafePath.startsWith(resolvedVaultPath)) {
    return res.status(403).json({ error: 'Access denied: Out of vault boundary' });
  }

  try {
    if (!fs.existsSync(resolvedSafePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    const stats = fs.statSync(resolvedSafePath);
    if (stats.isDirectory()) {
      return res.status(404).json({ error: 'File not found' });
    }

    // Check if thumbnail generation is requested and sharp is available
    const ext = extname(resolvedSafePath).toLowerCase();
    const resizableExtensions = ['.png', '.jpg', '.jpeg', '.webp'];
    const widthStr = req.query.width;

    if (sharp && resizableExtensions.includes(ext) && widthStr) {
      const width = parseInt(widthStr, 10);
      if (!isNaN(width) && width > 0 && width < 2000) {
        const mtime = stats.mtimeMs;
        const hash = crypto.createHash('md5')
          .update(`${resolvedSafePath}_${width}_${mtime}`)
          .digest('hex');
        const thumbnailPath = join(cacheDir, `${hash}${ext}`);

        if (fs.existsSync(thumbnailPath)) {
          return res.sendFile(thumbnailPath);
        }

        // Generate thumbnail
        try {
          await sharp(resolvedSafePath)
            .resize({ width })
            .toFile(thumbnailPath);
          return res.sendFile(thumbnailPath);
        } catch (sharpErr) {
          console.error(`[Thumbnail] Failed to generate thumbnail for ${decodedPath}:`, sharpErr);
          // Fallback to sending original file if resizing fails
        }
      }
    }

    res.sendFile(resolvedSafePath);
  } catch (err) {
    console.error(`Error sending raw file ${decodedPath}:`, err);
    res.status(500).json({ error: 'Failed to send file' });
  }
};

// ==========================================
// 8. Trash Bin Endpoints (Admin only)
// ==========================================

const checkAdmin = (req, res, next) => {
  if (req.user.role !== 'Admin') {
    return res.status(403).json({ error: 'Permission denied: Admins only' });
  }
  next();
};

// 8.1. GET /trash - Get all deleted notes in trash bin
router.get('/trash', authenticateJWT, checkAdmin, async (req, res) => {
  try {
    const list = await getTrashList();
    res.json({ trash: list });
  } catch (err) {
    console.error('[API Trash] Failed to fetch trash list:', err);
    res.status(500).json({ error: 'Failed to fetch trash list' });
  }
});

// 8.2. POST /trash/restore - Restore note from trash bin
router.post('/trash/restore', authenticateJWT, checkAdmin, async (req, res) => {
  const { id } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'ID is required' });
  }

  try {
    const result = await restoreNoteFromTrash(id);
    
    // Broadcast file-create event to all clients to refresh UI tree instantly
    const relPath = result.relative_path;
    const title = basename(relPath, '.md');
    const parentPath = normalizePath(dirname(relPath)) === '.' ? '' : normalizePath(dirname(relPath));
    req.app.get('io').emit('file-create', { 
      relative_path: relPath, 
      title, 
      is_directory: false, 
      parent_path: parentPath 
    });

    res.json({ message: 'Note restored successfully', relative_path: relPath });
  } catch (err) {
    console.error(`[API Trash] Failed to restore note ID ${id}:`, err);
    res.status(500).json({ error: err.message || 'Failed to restore note' });
  }
});

// 8.3. DELETE /trash/purge/:id - Purge single item from trash
router.delete('/trash/purge/:id', authenticateJWT, checkAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({ error: 'Valid ID is required' });
  }

  try {
    await purgeFromTrash(id);
    res.json({ message: 'Item permanently deleted from trash' });
  } catch (err) {
    console.error(`[API Trash] Failed to purge item ID ${id}:`, err);
    res.status(500).json({ error: 'Failed to delete item from trash' });
  }
});

// 8.4. DELETE /trash/clear - Clear all items in trash
router.delete('/trash/clear', authenticateJWT, checkAdmin, async (req, res) => {
  try {
    await clearTrash();
    res.json({ message: 'Trash bin cleared successfully' });
  } catch (err) {
    console.error('[API Trash] Failed to clear trash bin:', err);
    res.status(500).json({ error: 'Failed to clear trash bin' });
  }
});

export default router;
