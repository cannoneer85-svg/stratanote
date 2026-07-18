import chokidar from 'chokidar';
import fs from 'fs';
import { join, relative, dirname, basename, extname, resolve, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { run, get, all } from './db.js';
import { getEmbedding } from './embeddings.js';
import { archiveNoteBeforeDelete } from './trash.js';

// Helper to update embedding in background for watcher events
const updateNoteEmbedding = async (relPath, content) => {
  try {
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');
    const existing = await get('SELECT content_hash FROM note_embeddings WHERE relative_path = ?', [relPath]);
    if (existing && existing.content_hash === contentHash) {
      return;
    }
    const embedding = await getEmbedding(content, relPath);
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

// Helper to update FTS index for watcher events
const updateNoteFTS = async (relPath, title, content) => {
  try {
    // Delete existing duplicate rows first to prevent duplication in virtual table
    await run('DELETE FROM notes_fts WHERE relative_path = ?', [relPath]);
    await run('INSERT INTO notes_fts (relative_path, title, content) VALUES (?, ?, ?)', [
      relPath,
      title,
      content
    ]);
    console.log(`[Watcher FTS] Successfully updated FTS index for: ${relPath}`);
  } catch (err) {
    console.error(`[Watcher FTS] Failed to update FTS index for ${relPath}:`, err);
  }
};

// Helper to delete FTS index for watcher events
const deleteNoteFTS = async (relPath) => {
  try {
    await run('DELETE FROM notes_fts WHERE relative_path = ?', [relPath]);
    console.log(`[Watcher FTS] Successfully deleted FTS index for: ${relPath}`);
  } catch (err) {
    console.error(`[Watcher FTS] Failed to delete FTS index for ${relPath}:`, err);
  }
};

/**
 * Extracts tags from note content (supporting both YAML Frontmatter and inline text tags).
 * @param {string} content - Markdown file content
 * @returns {string[]} Array of unique lowercase tags
 */
export const extractTags = (content) => {
  const tags = new Set();
  if (typeof content !== 'string') return [];

  // 1. Parse YAML Frontmatter for tags
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  let mainContent = content;
  if (frontmatterMatch) {
    const yaml = frontmatterMatch[1];
    mainContent = content.substring(frontmatterMatch[0].length);

    const lines = yaml.split('\n');
    let inTagsList = false;
    for (let line of lines) {
      line = line.trim();
      if (!line) continue;

      if (line.startsWith('tags:') || line.startsWith('tag:')) {
        const valuePart = line.substring(line.indexOf(':') + 1).trim();
        if (valuePart.startsWith('[')) {
          const arrayContent = valuePart.replace(/^\[|\]$/g, '');
          arrayContent.split(',').forEach(t => {
            const cleanTag = t.trim().replace(/^['"]|['"]$/g, '');
            if (cleanTag) tags.add(cleanTag.toLowerCase());
          });
          inTagsList = false;
        } else if (valuePart) {
          valuePart.split(',').forEach(t => {
            const cleanTag = t.trim().replace(/^['"]|['"]$/g, '');
            if (cleanTag) tags.add(cleanTag.toLowerCase());
          });
          inTagsList = false;
        } else {
          inTagsList = true;
        }
      } else if (inTagsList && line.startsWith('-')) {
        const cleanTag = line.substring(1).trim().replace(/^['"]|['"]$/g, '');
        if (cleanTag) tags.add(cleanTag.toLowerCase());
      } else if (inTagsList && line.includes(':')) {
        inTagsList = false;
      }
    }
  }

  // 2. Parse Inline Tags in Markdown text (ignoring code blocks)
  const cleanText = mainContent
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\r\n]+`/g, '');

  const inlineTagRegex = /(?:^|\s)#([\p{L}\p{N}_/-]+)/gu;
  let match;
  while ((match = inlineTagRegex.exec(cleanText)) !== null) {
    const rawTag = match[1];
    
    // Validations: not purely numeric, not a hex color code
    if (/^\d+$/.test(rawTag)) continue;
    if (/^[a-fA-F0-9]{3}$|^[a-fA-F0-9]{6}$/.test(rawTag)) continue;
    
    tags.add(rawTag.toLowerCase());
  }

  return Array.from(tags);
};

/**
 * Updates tags in database for a note.
 * @param {string} relPath - Relative path of the note
 * @param {string[]} tags - Array of tags
 */
const updateNoteTags = async (relPath, tags) => {
  try {
    await run('DELETE FROM note_tags WHERE relative_path = ?', [relPath]);
    for (const tag of tags) {
      await run('INSERT OR IGNORE INTO note_tags (relative_path, tag) VALUES (?, ?)', [relPath, tag]);
    }
    if (tags.length > 0) {
      console.log(`[Watcher Tags] Updated tags for ${relPath}: ${tags.join(', ')}`);
    }
  } catch (err) {
    console.error(`[Watcher Tags] Failed to update tags for ${relPath}:`, err);
  }
};



// Resolve vault path (parent directory of _app, or custom env path)
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..');

// Helper to manually parse .env file from project root
const loadEnvFile = () => {
  const dotEnvPath = join(projectRoot, '.env');
  if (fs.existsSync(dotEnvPath)) {
    try {
      const content = fs.readFileSync(dotEnvPath, 'utf8');
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
          const idx = trimmed.indexOf('=');
          const key = trimmed.substring(0, idx).trim();
          const val = trimmed.substring(idx + 1).trim().replace(/^["']|["']$/g, '');
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    } catch (e) {
      console.error('[Watcher] Failed to parse .env file:', e);
    }
  }
};
loadEnvFile();

const rawVaultPath = process.env.VAULT_PATH;
export const vaultPath = rawVaultPath
  ? (isAbsolute(rawVaultPath) ? resolve(rawVaultPath) : resolve(projectRoot, rawVaultPath))
  : join(projectRoot, 'docs');

// Helper to normalize path separators to forward slashes for cross-platform matching
const normalizePath = (p) => p.replace(/\\/g, '/');

// Helper to normalize line endings to LF for content comparison
const normalizeContent = (str) => {
  if (typeof str !== 'string') return '';
  return str.replace(/\r\n/g, '\n');
};

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
      const SYSTEM_DIRS = ['_app', '_sync_mcp', 'node_modules', '.git', '.obsidian', '.agents', '.sync_backup'];
      const parts = normPath.split('/');
      return (
        parts.some(part => SYSTEM_DIRS.includes(part) || part.startsWith('.')) ||
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
          updateNoteFTS(relPath, title, content).catch(err => {
            console.error('[Watcher] Background FTS index creation failed:', err);
          });
          const tags = extractTags(content);
          updateNoteTags(relPath, tags).catch(err => {
            console.error('[Watcher] Background tags creation failed:', err);
          });
          console.log(`[Watcher] Indexed new file: ${relPath}`);
          io.emit('file-create', { relative_path: relPath, title, is_directory: false, parent_path: parentPath });
        } else {
          // File already exists in index, check if content changed
          const lastVersion = await get('SELECT content FROM versions WHERE relative_path = ? ORDER BY id DESC LIMIT 1', [relPath]);
          if (!lastVersion || normalizeContent(lastVersion.content) !== normalizeContent(content)) {
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
            updateNoteFTS(relPath, title, content).catch(err => {
              console.error('[Watcher] Background FTS index update failed:', err);
            });
            const tags = extractTags(content);
            updateNoteTags(relPath, tags).catch(err => {
              console.error('[Watcher] Background tags update failed:', err);
            });
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

        if (!lastVersion || normalizeContent(lastVersion.content) !== normalizeContent(content)) {
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
          const title = getTitleFromPath(relPath);
          updateNoteFTS(relPath, title, content).catch(err => {
            console.error('[Watcher] Background FTS index update failed:', err);
          });
          const tags = extractTags(content);
          updateNoteTags(relPath, tags).catch(err => {
            console.error('[Watcher] Background tags update failed:', err);
          });
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
        await archiveNoteBeforeDelete(relPath, 'Внешняя система');
        await run('DELETE FROM notes WHERE relative_path = ?', [relPath]);
        // Foreign keys cascade delete versions & locks
        deleteNoteFTS(relPath).catch(err => {
          console.error('[Watcher] Background FTS index deletion failed:', err);
        });
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
        // Защитная архивация всех вложенных файлов, которые могли остаться в БД
        const nestedNotes = await all('SELECT relative_path FROM notes WHERE relative_path LIKE ? AND is_directory = 0', [relPath + '/%']);
        for (const note of nestedNotes) {
          await archiveNoteBeforeDelete(note.relative_path, 'Внешняя система');
        }

        await run('DELETE FROM notes WHERE relative_path = ? OR relative_path LIKE ?', [relPath, relPath + '/%']);
        await run('DELETE FROM notes_fts WHERE relative_path = ? OR relative_path LIKE ?', [relPath, relPath + '/%']);
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
