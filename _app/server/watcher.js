import chokidar from 'chokidar';
import fs from 'fs';
import { join, relative, dirname, basename, extname } from 'path';
import { fileURLToPath } from 'url';
import { run, get, all } from './db.js';

// Resolve vault path (parent directory of _app)
const __dirname = dirname(fileURLToPath(import.meta.url));
export const vaultPath = join(__dirname, '..', '..');

// Helper to normalize path separators to forward slashes for cross-platform matching
const normalizePath = (p) => p.replace(/\\/g, '/');

// Extract note title (filename without .md)
const getTitleFromPath = (filePath) => {
  return basename(filePath, extname(filePath));
};

export const initWatcher = (io) => {
  console.log(`[Watcher] Starting file monitor on: ${vaultPath}`);

  const watcher = chokidar.watch(vaultPath, {
    ignored: [
      /(^|[\/\\])\../,                     // Ignore hidden files and folders (.git, .obsidian, etc.)
      join(vaultPath, '_app'),             // Ignore application folder
      join(vaultPath, 'node_modules'),     // Ignore node_modules if any
      '**/_app/**',
      '**/assets/**'                       // Ignore asset folder from notes indexing
    ],
    persistent: true,
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: 1000,
      pollInterval: 200
    }
  });

  // Handle Directory/File additions & edits
  watcher
    .on('add', async (filePath) => {
      const relPath = normalizePath(relative(vaultPath, filePath));
      if (!relPath.endsWith('.md')) return;

      try {
        const title = getTitleFromPath(relPath);
        const parentPath = normalizePath(dirname(relPath)) === '.' ? '' : normalizePath(dirname(relPath));
        const content = fs.readFileSync(filePath, 'utf8');

        // Check if note is already in DB
        const existingNote = await get('SELECT * FROM notes WHERE relative_path = ?', [relPath]);

        if (!existingNote) {
          // New file detected
          await run(
            'INSERT INTO notes (relative_path, title, is_directory, parent_path, last_edited_by) VALUES (?, ?, ?, ?, ?)',
            [relPath, title, 0, parentPath, 'Внешняя система']
          );
          await run(
            'INSERT INTO versions (relative_path, content, author_name) VALUES (?, ?, ?)',
            [relPath, content, 'Внешняя система']
          );
          console.log(`[Watcher] Indexed new file: ${relPath}`);
          io.emit('file-create', { relative_path: relPath, title, is_directory: false, parent_path: parentPath });
        } else {
          // File already exists in index, check if content changed
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
            console.log(`[Watcher] Updated existing file from disk: ${relPath}`);
            io.emit('file-update', { relative_path: relPath, content });
          }
        }
      } catch (err) {
        console.error(`[Watcher] Error indexing file ${relPath}:`, err);
      }
    })
    .on('addDir', async (dirPath) => {
      const relPath = normalizePath(relative(vaultPath, dirPath));
      if (!relPath || relPath === '_app' || relPath === 'assets') return;

      try {
        const title = basename(relPath);
        const parentPath = normalizePath(dirname(relPath)) === '.' ? '' : normalizePath(dirname(relPath));

        const existingDir = await get('SELECT * FROM notes WHERE relative_path = ?', [relPath]);
        if (!existingDir) {
          await run(
            'INSERT INTO notes (relative_path, title, is_directory, parent_path, last_edited_by) VALUES (?, ?, ?, ?, ?)',
            [relPath, title, 1, parentPath, 'Внешняя система']
          );
          console.log(`[Watcher] Indexed new directory: ${relPath}`);
          io.emit('file-create', { relative_path: relPath, title, is_directory: true, parent_path: parentPath });
        }
      } catch (err) {
        console.error(`[Watcher] Error indexing directory ${relPath}:`, err);
      }
    })
    .on('change', async (filePath) => {
      const relPath = normalizePath(relative(vaultPath, filePath));
      if (!relPath.endsWith('.md')) return;

      try {
        const content = fs.readFileSync(filePath, 'utf8');
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
          console.log(`[Watcher] File changed externally: ${relPath}`);
          io.emit('file-update', { relative_path: relPath, content });
        }
      } catch (err) {
        console.error(`[Watcher] Error handling change for ${relPath}:`, err);
      }
    })
    .on('unlink', async (filePath) => {
      const relPath = normalizePath(relative(vaultPath, filePath));
      if (!relPath.endsWith('.md')) return;

      try {
        await run('DELETE FROM notes WHERE relative_path = ?', [relPath]);
        // Foreign keys cascade delete versions & locks
        console.log(`[Watcher] Deleted file: ${relPath}`);
        io.emit('file-delete', { relative_path: relPath });
      } catch (err) {
        console.error(`[Watcher] Error deleting file index for ${relPath}:`, err);
      }
    })
    .on('unlinkDir', async (dirPath) => {
      const relPath = normalizePath(relative(vaultPath, dirPath));
      if (!relPath) return;

      try {
        await run('DELETE FROM notes WHERE relative_path = ?', [relPath]);
        console.log(`[Watcher] Deleted directory: ${relPath}`);
        io.emit('file-delete', { relative_path: relPath });
      } catch (err) {
        console.error(`[Watcher] Error deleting directory index for ${relPath}:`, err);
      }
    });

  return watcher;
};
