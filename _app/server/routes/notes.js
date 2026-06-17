import express from 'express';
import fs from 'fs';
import { join, dirname, basename, relative } from 'path';
import archiver from 'archiver';
import AdmZip from 'adm-zip';
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

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const filename = `obsidian-vault-export-${year}${month}${day}-${hours}${minutes}.zip`;

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
const scanAndIndex = async (dir, baseDir = vaultPath) => {
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
          'INSERT INTO notes (relative_path, title, is_directory, parent_path, last_edited_by) VALUES (?, ?, ?, ?, ?)',
          [relPath, title, 1, parentPath, 'Внешняя система']
        );
      }
      await scanAndIndex(fullPath, baseDir);
    } else if (stat.isFile() && item.endsWith('.md')) {
      const title = item.replace(/\.md$/, '');
      const parentPath = normalizePath(dirname(relPath)) === '.' ? '' : normalizePath(dirname(relPath));
      const content = fs.readFileSync(fullPath, 'utf8');

      const existing = await get('SELECT relative_path FROM notes WHERE relative_path = ?', [relPath]);
      if (!existing) {
        await run(
          'INSERT INTO notes (relative_path, title, is_directory, parent_path, last_edited_by) VALUES (?, ?, ?, ?, ?)',
          [relPath, title, 0, parentPath, 'Внешняя система']
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
    await scanAndIndex(vaultPath);

    // 4. Notify all active sockets about the vault reload
    req.app.get('io').emit('vault-reload');

    res.json({ message: 'Vault imported and indexed successfully' });
  } catch (err) {
    console.error('Vault import error:', err);
    res.status(500).json({ error: 'Failed to import vault ZIP archive' });
  }
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
        'INSERT INTO notes (relative_path, title, is_directory, parent_path, last_edited_by) VALUES (?, ?, ?, ?, ?)',
        [relPath, title, 0, dbParentPath, req.user.username]
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

export default router;
