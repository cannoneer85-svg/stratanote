import chokidar from 'chokidar';
import fs from 'fs';
import { join, relative, dirname, basename, extname, resolve } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { run, get, all } from './db.js';
import { getEmbedding } from './embeddings.js';

// Helper to update embedding in background for watcher events
const updateNoteEmbedding = async (relPath, content) => {
  try {
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');
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
    console.log(`[Watcher Embeddings] Successfully updated embedding for: ${relPath}`);
  } catch (err) {
    console.error(`[Watcher Embeddings] Failed to update embedding for ${relPath}:`, err);
  }
};

// Resolve vault path (parent directory of _app, or custom env path)
const __dirname = dirname(fileURLToPath(import.meta.url));
export const vaultPath = process.env.VAULT_PATH 
  ? resolve(process.env.VAULT_PATH) 
  : join(__dirname, '..', '..');

// Helper to normalize path separators to forward slashes for cross-platform matching
const normalizePath = (p) => p.replace(/\\/g, '/');

// Extract note title (filename without .md)
const getTitleFromPath = (filePath) => {
  return basename(filePath, extname(filePath));
};

export const initWatcher = (io) => {
  console.log(`[Watcher] Starting file monitor on: ${vaultPath}`);
  let isReady = false;

  const watcher = chokidar.watch(vaultPath, {
    ignored: (path) => {
      const normPath = path.replace(/\\/g, '/');
      return (
        normPath.includes('/_app') ||
        normPath.includes('/_sync_mcp') ||
        normPath.includes('/.agents') ||
        normPath.includes('/node_modules') ||
        normPath.includes('/.git') ||
        normPath.includes('/.obsidian') ||
        normPath.includes('/assets/')
      );
    },
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
            'INSERT INTO notes (relative_path, title, is_directory, parent_path, last_edited_by, created_by) VALUES (?, ?, ?, ?, ?, ?)',
            [relPath, title, 0, parentPath, 'Внешняя система', 'Внешняя система']
          );
          await run(
            'INSERT INTO versions (relative_path, content, author_name) VALUES (?, ?, ?)',
            [relPath, content, 'Внешняя система']
          );
          if (isReady) {
            updateNoteEmbedding(relPath, content).catch(err => {
              console.error('[Watcher] Background embedding creation failed:', err);
            });
          }
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
            if (isReady) {
              updateNoteEmbedding(relPath, content).catch(err => {
                console.error('[Watcher] Background embedding update failed:', err);
              });
            }
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
            'INSERT INTO notes (relative_path, title, is_directory, parent_path, last_edited_by, created_by) VALUES (?, ?, ?, ?, ?, ?)',
            [relPath, title, 1, parentPath, 'Внешняя система', 'Внешняя система']
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
          if (isReady) {
            updateNoteEmbedding(relPath, content).catch(err => {
              console.error('[Watcher] Background embedding update failed:', err);
            });
          }
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

  watcher.on('ready', () => {
    isReady = true;
  });

  return watcher;
};
