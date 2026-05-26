import express from 'express';
import fs from 'fs';
import { join, dirname, basename } from 'path';
import archiver from 'archiver';
import { run, get, all } from '../db.js';
import { vaultPath } from '../watcher.js';
import { authenticateJWT } from './auth.js';

const router = express.Router();

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
      fs.mkdirSync(absolutePath, { recursive: true });
      // Database update will be triggered automatically by Chokidar, but we return immediate response
      res.status(201).json({ message: 'Directory created', relative_path: normPath });
    } else {
      // Ensure parent directory exists
      fs.mkdirSync(dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, `# ${title}\n\n`, 'utf8');
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

    // Write to physical disk
    fs.writeFileSync(absolutePath, content, 'utf8');

    // Create a new revision version
    await run(
      'INSERT INTO versions (relative_path, content, author_name) VALUES (?, ?, ?)',
      [normPath, content, req.user.username]
    );

    // Update note info
    await run(
      'UPDATE notes SET updated_at = CURRENT_TIMESTAMP, last_edited_by = ? WHERE relative_path = ?',
      [req.user.username, normPath]
    );

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
      // Self-heal: If folder is not on disk but remains in DB, clean it up
      await run('DELETE FROM notes WHERE relative_path = ? OR relative_path LIKE ?', [normPath, normPath + '/%']);
      req.app.get('io').emit('file-delete', { relative_path: normPath });
      return res.status(404).json({ error: 'Ресурс не найден на диске, но удален из базы данных' });
    }

    const stat = fs.statSync(absolutePath);
    if (stat.isDirectory()) {
      fs.rmSync(absolutePath, { recursive: true, force: true });
    } else {
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

// 6. Upload Image Attachment (via base64)
router.post('/upload-image', authenticateJWT, canEdit, async (req, res) => {
  const { filename, base64Data } = req.body;
  if (!filename || !base64Data) {
    return res.status(400).json({ error: 'filename and base64Data are required' });
  }

  // Ensure assets folder exists in workspace
  const assetsDir = join(vaultPath, 'assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  const safeFilename = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
  const filePath = join(assetsDir, safeFilename);

  try {
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(filePath, buffer);

    const relativeUrl = `assets/${safeFilename}`;
    res.json({ url: relativeUrl, filename: safeFilename });
  } catch (err) {
    console.error('Image upload failed:', err);
    res.status(500).json({ error: 'Failed to save image file' });
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

    res.json({
      nodes: validNotes.map(n => ({ id: n.relative_path, name: n.title, val: 1 })),
      links
    });
  } catch (err) {
    console.error('Failed to generate graph data:', err);
    res.status(500).json({ error: 'Failed to generate graph data' });
  }
});

// 7. Export Entire Vault as ZIP
router.get('/export', authenticateJWT, (req, res) => {
  console.log('[Export] Generating vault ZIP archive...');

  res.attachment('obsidian-vault-export.zip');
  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.on('error', (err) => {
    console.error('[Export] Error during zipping:', err);
    res.status(500).send({ error: 'Compression error occurred' });
  });

  archive.pipe(res);

  // Read all files/folders in vaultPath and append to zip, excluding internal _app/ and system config files
  const items = fs.readdirSync(vaultPath);
  for (const item of items) {
    if (item === '_app' || item === 'package.json' || item === 'package-lock.json' || item.startsWith('.')) continue;

    const fullPath = join(vaultPath, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      archive.directory(fullPath, item);
    } else {
      archive.file(fullPath, { name: item });
    }
  }

  archive.finalize();
});

export default router;
