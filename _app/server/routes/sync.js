import express from 'express';
import fs from 'fs';
import { join, relative, dirname, resolve, extname, basename } from 'path';
import crypto from 'crypto';
import { run, get, all } from '../db.js';
import { vaultPath } from '../watcher.js';
import { authenticateJWT } from './auth.js';
import { updateNoteEmbedding } from './notes.js';

const router = express.Router();

const normalizePath = (p) => p.replace(/\\/g, '/');

const BINARY_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.docx', '.xlsx', '.zip', '.tar', '.gz', '.mp3', '.mp4', '.mov', '.avi', '.exe', '.dll', '.bin'];
const isBinaryFile = (filePath) => {
  const ext = extname(filePath).toLowerCase();
  return BINARY_EXTENSIONS.includes(ext) || filePath.replace(/\\/g, '/').startsWith('assets/');
};

const tempDir = join(vaultPath, '.temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Persistent cache for file hashes to avoid re-reading files on every manifest generation
const cachePath = join(tempDir, 'hash_cache.json');
let fileHashCache = new Map();
if (fs.existsSync(cachePath)) {
  try {
    const raw = fs.readFileSync(cachePath, 'utf8');
    fileHashCache = new Map(JSON.parse(raw));
  } catch (e) {
    console.error('[Sync Cache] Failed to load hash cache:', e);
  }
}

const saveHashCache = () => {
  try {
    fs.writeFileSync(cachePath, JSON.stringify(Array.from(fileHashCache.entries())), 'utf8');
  } catch (e) {
    console.error('[Sync Cache] Failed to save hash cache:', e);
  }
};

// Helper to compute SHA-256 hash of a file asynchronously
const getFileHash = async (filePath) => {
  const isBinary = isBinaryFile(filePath);
  if (isBinary) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', err => reject(err));
    });
  } else {
    const content = await fs.promises.readFile(filePath, 'utf8');
    const normalized = content.replace(/\r\n/g, '\n');
    return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
  }
};

// Retrieve file hash from cache if stats (mtime, size) match, otherwise compute and cache
const getFileHashWithCache = async (filePath, stat) => {
  const cached = fileHashCache.get(filePath);
  if (cached && cached.mtime === stat.mtimeMs && cached.size === stat.size) {
    return cached.hash;
  }
  const hash = await getFileHash(filePath);
  fileHashCache.set(filePath, { hash, mtime: stat.mtimeMs, size: stat.size });
  return hash;
// Recursive function to get all files in vaultPath asynchronously
const getFilesRecursiveAsync = async (dir, rootDir, state = { count: 0 }) => {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  
  const list = await fs.promises.readdir(dir);
  for (const file of list) {
    const filePath = join(dir, file);
    const stat = await fs.promises.stat(filePath);
    
    const rel = normalizePath(relative(rootDir, filePath));
    // Ignore hidden files/folders, backend code, node_modules, and sync configs on any level
    const SYSTEM_DIRS = ['_app', '_sync_mcp', 'node_modules', '.git', '.obsidian', '.agents', '.sync_backup'];
    const parts = rel.split('/');
    if (
      file.startsWith('.') || 
      parts.some(part => SYSTEM_DIRS.includes(part) || part.startsWith('.')) ||
      file === 'database.sqlite' ||
      file === '.sync_state.json'
    ) {
      continue;
    }

    if (stat.isDirectory()) {
      results.push({
        path: rel,
        isDirectory: true,
        mtime: stat.mtimeMs,
        size: 0,
        hash: ''
      });
      const subResults = await getFilesRecursiveAsync(filePath, rootDir, state);
      results = results.concat(subResults);
    } else {
      try {
        const hex = await getFileHashWithCache(filePath, stat);
        results.push({
          path: rel,
          isDirectory: false,
          mtime: stat.mtimeMs,
          size: stat.size,
          hash: hex
        });
      } catch (err) {
        console.error(`[Sync] Failed to hash file ${filePath}:`, err);
      }
    }
    
    // Yield control to the event loop every 200 items to avoid artificial latency while preventing event loop starvation
    state.count++;
    if (state.count % 200 === 0) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  return results;
};

// 1. GET /api/sync/manifest - Get server files manifest
router.get('/manifest', authenticateJWT, async (req, res) => {
  try {
    const files = await getFilesRecursiveAsync(vaultPath, vaultPath, { count: 0 });
    saveHashCache();
    res.json({ files });
  } catch (err) {
    console.error('[Sync] Error generating manifest:', err);
    res.status(500).json({ error: 'Failed to generate server manifest' });
  }
});

// 2. POST /api/sync/pull - Download file from server
router.post('/pull', authenticateJWT, async (req, res) => {
  const { path: relPath, includeMetadata } = req.body;
  if (!relPath) {
    return res.status(400).json({ error: 'Relative path is required' });
  }

  const safePath = resolve(vaultPath, relPath);
  if (!safePath.startsWith(resolve(vaultPath))) {
    return res.status(403).json({ error: 'Directory traversal detected' });
  }

  if (!fs.existsSync(safePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  const stat = fs.statSync(safePath);
  if (stat.isDirectory()) {
    return res.status(400).json({ error: 'Requested path is a directory' });
  }

  try {
    const content = fs.readFileSync(safePath);
    const isBinary = isBinaryFile(relPath);

    if (includeMetadata && !isBinary && relPath.endsWith('.md')) {
      let dbMetadata = null;
      try {
        const note = await get('SELECT created_by, last_edited_by FROM notes WHERE relative_path = ?', [relPath]);
        if (note) {
          const versions = await all('SELECT content, author_name, created_at FROM versions WHERE relative_path = ? ORDER BY id ASC', [relPath]);
          dbMetadata = {
            created_by: note.created_by,
            last_edited_by: note.last_edited_by,
            versions: versions || []
          };
        }
      } catch (dbErr) {
        console.error('[Sync] Failed to retrieve note metadata for pull:', dbErr);
      }

      return res.json({
        content: content.toString('utf8'),
        dbMetadata
      });
    }

    // Send file contents raw
    if (isBinary) {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.send(content);
    } else {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(content.toString('utf8'));
    }
  } catch (err) {
    console.error('[Sync] Error reading file for pull:', err);
    res.status(500).json({ error: 'Failed to read file' });
  }
});

// 3. POST /api/sync/push - Upload file to server
router.post('/push', authenticateJWT, async (req, res) => {
  const { path: relPath, content, mtime, isDirectory, lastKnownServerHash, dbMetadata } = req.body;
  if (!relPath) {
    return res.status(400).json({ error: 'Relative path is required' });
  }

  const safePath = resolve(vaultPath, relPath);
  if (!safePath.startsWith(resolve(vaultPath))) {
    return res.status(403).json({ error: 'Directory traversal detected' });
  }

  try {
    if (isDirectory) {
      if (!fs.existsSync(safePath)) {
        fs.mkdirSync(safePath, { recursive: true });
        console.log(`[Sync] Created directory: ${relPath}`);
      }
      return res.json({ success: true });
    }

    if (content === undefined) {
      return res.status(400).json({ error: 'File content is required' });
    }

    // Check if the file is locked in SQLite by someone else
    const lock = await get('SELECT * FROM locks WHERE relative_path = ?', [relPath]);
    if (lock && lock.user_id !== req.user.id && new Date(lock.expires_at) > new Date()) {
      return res.status(423).json({ error: `File is locked by user: ${lock.username}` });
    }

    // Version conflict validation
    let serverFileExists = fs.existsSync(safePath);
    let serverFileHash = '';
    if (serverFileExists) {
      const serverContent = fs.readFileSync(safePath);
      serverFileHash = crypto.createHash('sha256').update(serverContent).digest('hex');
    }

    // If file hash on server differs from the last known hash client had
    if (serverFileExists && lastKnownServerHash && serverFileHash !== lastKnownServerHash) {
      console.log(`[Sync] Conflict detected for: ${relPath}. Server: ${serverFileHash}, Client last known: ${lastKnownServerHash}`);
      return res.status(409).json({ 
        error: 'Conflict detected', 
        serverHash: serverFileHash,
        message: 'File was modified on the server since last sync.' 
      });
    }

    const parentDir = dirname(safePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const isBinary = isBinaryFile(relPath);
    const fileBuffer = isBinary ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8');

    // If it's a markdown note, update database versions first, so that the Chokidar file watcher
    // sees that the latest database version already matches the new content and keeps the correct author name.
    if (!isBinary && relPath.endsWith('.md')) {
      try {
        const contentStr = fileBuffer.toString('utf8');
        const title = basename(relPath, '.md');
        const parentPath = normalizePath(dirname(relPath)) === '.' ? '' : normalizePath(dirname(relPath));

        const createdBy = (dbMetadata && dbMetadata.created_by) ? dbMetadata.created_by : req.user.username;
        const lastEditedBy = (dbMetadata && dbMetadata.last_edited_by) ? dbMetadata.last_edited_by : req.user.username;

        const existingNote = await get('SELECT * FROM notes WHERE relative_path = ?', [relPath]);
        if (!existingNote) {
          await run(
            'INSERT INTO notes (relative_path, title, is_directory, parent_path, last_edited_by, created_by) VALUES (?, ?, ?, ?, ?, ?)',
            [relPath, title, 0, parentPath, lastEditedBy, createdBy]
          );
        } else {
          await run(
            'UPDATE notes SET updated_at = CURRENT_TIMESTAMP, last_edited_by = ?, created_by = ? WHERE relative_path = ?',
            [lastEditedBy, createdBy, relPath]
          );
        }

        // If we have versions in metadata, sync them
        if (dbMetadata && Array.isArray(dbMetadata.versions)) {
          for (const ver of dbMetadata.versions) {
            const existingVersion = await get(
              'SELECT id FROM versions WHERE relative_path = ? AND content = ?',
              [relPath, ver.content]
            );
            if (!existingVersion) {
              await run(
                'INSERT INTO versions (relative_path, content, author_name, created_at) VALUES (?, ?, ?, ?)',
                [relPath, ver.content, ver.author_name, ver.created_at]
              );
            }
          }
        } else {
          // Fallback to inserting single version
          const existingVersion = await get(
            'SELECT id FROM versions WHERE relative_path = ? AND content = ?',
            [relPath, contentStr]
          );
          if (!existingVersion) {
            await run(
              'INSERT INTO versions (relative_path, content, author_name) VALUES (?, ?, ?)',
              [relPath, contentStr, lastEditedBy]
            );
          }
        }

        // Update embedding asynchronously
        updateNoteEmbedding(relPath, contentStr).catch(err => {
          console.error('[Sync] Failed to update note embedding during push:', err);
        });
      } catch (dbErr) {
        console.error('[Sync] Database update failed during push:', dbErr);
      }
    }

    fs.writeFileSync(safePath, fileBuffer);
    
    if (mtime) {
      const atime = Date.now() / 1000;
      fs.utimesSync(safePath, atime, mtime / 1000);
    }

    const newHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    console.log(`[Sync] Successfully saved file: ${relPath}`);
    res.json({ success: true, hash: newHash });
  } catch (err) {
    console.error('[Sync] Error saving pushed file:', err);
    res.status(500).json({ error: 'Failed to save file on server' });
  }
});

// Helper function to clean up upload chunks on server
function cleanupChunks(uploadId, totalChunks) {
  for (let i = 0; i < totalChunks; i++) {
    const chunkPath = join(tempDir, `${uploadId}.part_${i}`);
    if (fs.existsSync(chunkPath)) {
      try {
        fs.unlinkSync(chunkPath);
      } catch (cleanupErr) {
        console.error(`Failed to delete chunk ${chunkPath} on failure:`, cleanupErr);
      }
    }
  }
}

// 3.5. POST /api/sync/push-chunk - Upload file chunk to server
router.post('/push-chunk', authenticateJWT, async (req, res) => {
  const chunkIndex = parseInt(req.headers['x-chunk-index'], 10);
  const totalChunks = parseInt(req.headers['x-total-chunks'], 10);
  const uploadId = req.headers['x-upload-id'];
  const relPathB64 = req.headers['x-relative-path-b64'];
  const mtime = req.headers['x-mtime'] ? parseInt(req.headers['x-mtime'], 10) : undefined;
  const lastKnownServerHash = req.headers['x-last-known-server-hash'] || undefined;
  const force = req.headers['x-force'] === 'true';
  const dbMetadataB64 = req.headers['x-db-metadata-b64'];

  if (isNaN(chunkIndex) || isNaN(totalChunks) || !uploadId || !relPathB64) {
    return res.status(400).json({ error: 'Missing required chunk headers' });
  }

  const relPath = Buffer.from(relPathB64, 'base64').toString('utf8');
  const safePath = resolve(vaultPath, relPath);
  if (!safePath.startsWith(resolve(vaultPath))) {
    return res.status(403).json({ error: 'Directory traversal detected' });
  }

  try {
    // Check if the file is locked in SQLite by someone else
    const lock = await get('SELECT * FROM locks WHERE relative_path = ?', [relPath]);
    if (lock && lock.user_id !== req.user.id && new Date(lock.expires_at) > new Date()) {
      return res.status(423).json({ error: `File is locked by user: ${lock.username}` });
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
          console.log(`[Sync Push Chunk] All ${totalChunks} chunks received for ${relPath}. Merging...`);
          
          // Version conflict validation (unless force is true)
          let serverFileExists = fs.existsSync(safePath);
          let serverFileHash = '';
          if (serverFileExists && !force) {
            const serverContent = fs.readFileSync(safePath);
            serverFileHash = crypto.createHash('sha256').update(serverContent).digest('hex');
            
            if (lastKnownServerHash && serverFileHash !== lastKnownServerHash) {
              cleanupChunks(uploadId, totalChunks);
              console.log(`[Sync Push Chunk] Conflict detected for: ${relPath}. Server: ${serverFileHash}, Client last known: ${lastKnownServerHash}`);
              return res.status(409).json({ 
                error: 'Conflict detected', 
                serverHash: serverFileHash,
                message: 'File was modified on the server since last sync.' 
              });
            }
          }

          const parentDir = dirname(safePath);
          if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
          }

          // Streaming merge function
          const mergeChunks = () => {
            return new Promise((resolvePromise, rejectPromise) => {
              const finalWriteStream = fs.createWriteStream(safePath);
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

              finalWriteStream.on('finish', () => resolvePromise());
              finalWriteStream.on('error', (err) => rejectPromise(err));
              appendNext();
            });
          };

          await mergeChunks();

          if (mtime) {
            const atime = Date.now() / 1000;
            fs.utimesSync(safePath, atime, mtime / 1000);
          }

          // Compute final file hash from merged file
          const finalContent = fs.readFileSync(safePath);
          const newHash = crypto.createHash('sha256').update(finalContent).digest('hex');

          // Metadata updates for markdown files
          const isBinary = isBinaryFile(relPath);
          if (!isBinary && relPath.endsWith('.md')) {
            try {
              const contentStr = finalContent.toString('utf8');
              const title = basename(relPath, '.md');
              const parentPath = normalizePath(dirname(relPath)) === '.' ? '' : normalizePath(dirname(relPath));

              let dbMetadata = null;
              if (dbMetadataB64) {
                try {
                  dbMetadata = JSON.parse(Buffer.from(dbMetadataB64, 'base64').toString('utf8'));
                } catch (e) {
                  console.error('[Sync Push Chunk] Failed to decode dbMetadata:', e);
                }
              }

              const createdBy = (dbMetadata && dbMetadata.created_by) ? dbMetadata.created_by : req.user.username;
              const lastEditedBy = (dbMetadata && dbMetadata.last_edited_by) ? dbMetadata.last_edited_by : req.user.username;

              const existingNote = await get('SELECT * FROM notes WHERE relative_path = ?', [relPath]);
              if (!existingNote) {
                await run(
                  'INSERT INTO notes (relative_path, title, is_directory, parent_path, last_edited_by, created_by) VALUES (?, ?, ?, ?, ?, ?)',
                  [relPath, title, 0, parentPath, lastEditedBy, createdBy]
                );
              } else {
                await run(
                  'UPDATE notes SET updated_at = CURRENT_TIMESTAMP, last_edited_by = ?, created_by = ? WHERE relative_path = ?',
                  [lastEditedBy, createdBy, relPath]
                );
              }

              if (dbMetadata && Array.isArray(dbMetadata.versions)) {
                for (const ver of dbMetadata.versions) {
                  const existingVersion = await get(
                    'SELECT id FROM versions WHERE relative_path = ? AND content = ?',
                    [relPath, ver.content]
                  );
                  if (!existingVersion) {
                    await run(
                      'INSERT INTO versions (relative_path, content, author_name, created_at) VALUES (?, ?, ?, ?)',
                      [relPath, ver.content, ver.author_name, ver.created_at]
                    );
                  }
                }
              } else {
                const existingVersion = await get(
                  'SELECT id FROM versions WHERE relative_path = ? AND content = ?',
                  [relPath, contentStr]
                );
                if (!existingVersion) {
                  await run(
                    'INSERT INTO versions (relative_path, content, author_name) VALUES (?, ?, ?)',
                    [relPath, contentStr, lastEditedBy]
                  );
                }
              }

              updateNoteEmbedding(relPath, contentStr).catch(err => {
                console.error('[Sync Push Chunk] Failed to update note embedding:', err);
              });
            } catch (dbErr) {
              console.error('[Sync Push Chunk] Database update failed:', dbErr);
            }
          }

          console.log(`[Sync Push Chunk] Successfully saved merged file: ${relPath}`);
          res.json({ success: true, hash: newHash });
        } else {
          res.json({ success: true, message: `Chunk ${chunkIndex + 1}/${totalChunks} uploaded` });
        }
      } catch (err) {
        console.error('[Sync Push Chunk] Merge process error:', err);
        cleanupChunks(uploadId, totalChunks);
        res.status(500).json({ error: 'Failed to merge chunks on server' });
      }
    });

    writeStream.on('error', (err) => {
      console.error('[Sync Push Chunk] WriteStream error:', err);
      res.status(500).json({ error: 'Failed to save chunk file' });
    });
  } catch (err) {
    console.error('[Sync Push Chunk] Error processing chunk:', err);
    res.status(500).json({ error: 'Failed to process chunk on server' });
  }
});

// 4. POST /api/sync/delete - Delete file/directory on server
router.post('/delete', authenticateJWT, async (req, res) => {
  const { path: relPath } = req.body;
  if (!relPath) {
    return res.status(400).json({ error: 'Relative path is required' });
  }

  const safePath = resolve(vaultPath, relPath);
  if (!safePath.startsWith(resolve(vaultPath))) {
    return res.status(403).json({ error: 'Directory traversal detected' });
  }

  try {
    if (!fs.existsSync(safePath)) {
      return res.json({ success: true, message: 'File already deleted' });
    }

    const stat = fs.statSync(safePath);
    if (stat.isDirectory()) {
      fs.rmSync(safePath, { recursive: true, force: true });
      console.log(`[Sync] Deleted directory on server: ${relPath}`);
    } else {
      fs.unlinkSync(safePath);
      console.log(`[Sync] Deleted file on server: ${relPath}`);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[Sync] Error deleting file on server:', err);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});

// 5. POST /api/sync/status - Update sync status for user
router.post('/status', authenticateJWT, async (req, res) => {
  const { deviceName, status, errorMessage, syncMode, conflictResolution } = req.body;
  
  try {
    await run(`
      INSERT INTO sync_status (user_id, username, device_name, last_sync_at, status, sync_mode, conflict_resolution, error_message)
      VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        username = excluded.username,
        device_name = excluded.device_name,
        last_sync_at = datetime('now'),
        status = excluded.status,
        sync_mode = COALESCE(excluded.sync_mode, sync_status.sync_mode),
        conflict_resolution = COALESCE(excluded.conflict_resolution, sync_status.conflict_resolution),
        error_message = excluded.error_message
    `, [req.user.id, req.user.username, deviceName || 'Unknown Device', status, syncMode || null, conflictResolution || null, errorMessage || null]);

    // Broadcast sync status update to all connected clients
    const io = req.app.get('io');
    if (io) {
      io.emit('sync-status-changed');
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[Sync] Error saving sync status:', err);
    res.status(500).json({ error: 'Failed to update sync status' });
  }
});

// 6. GET /api/sync/status - Get all sync statuses (For Settings UI)
router.get('/status', authenticateJWT, async (req, res) => {
  try {
    const statuses = await all('SELECT * FROM sync_status ORDER BY last_sync_at DESC');
    res.json({ statuses });
  } catch (err) {
    console.error('[Sync] Error fetching sync statuses:', err);
    res.status(500).json({ error: 'Failed to fetch sync statuses' });
  }
});

// 7. POST /api/sync/trigger - Trigger sync on the active agent for this user
router.post('/trigger', authenticateJWT, async (req, res) => {
  const activeSyncAgents = req.app.get('activeSyncAgents');
  if (!activeSyncAgents) {
    return res.status(500).json({ error: 'Sync agent system not initialized' });
  }

  const agentSocket = activeSyncAgents.get(req.user.id);
  if (!agentSocket) {
    return res.status(404).json({ error: 'Локальный агент синхронизации оффлайн. Запустите его на вашем ПК.' });
  }

  console.log(`[Sync] Triggering sync command for user ${req.user.username} via socket ${agentSocket.id}`);

  agentSocket.timeout(300000).emit('trigger-sync-request', (err, response) => {
    console.log(`[Sync] Received response from agent for user ${req.user.username}:`, { err, response });
    if (err) {
      console.error(`[Sync] Timeout or error waiting for sync response from user ${req.user.username}`);
      return res.status(504).json({ error: 'Локальный агент не ответил вовремя или произошла ошибка' });
    }
    
    let finalResponse = response;
    if (Array.isArray(response)) {
      if (response.length > 1 && (response[0] === null || response[0] === undefined)) {
        finalResponse = response[1];
      } else {
        finalResponse = response[0];
      }
    }
    res.json(finalResponse || { success: true });
  });
});

// 8. POST /api/sync/update-config - Update sync agent configuration
router.post('/update-config', authenticateJWT, async (req, res) => {
  const { syncMode, conflictResolution } = req.body;
  if (!syncMode || !conflictResolution) {
    return res.status(400).json({ error: 'syncMode and conflictResolution are required' });
  }

  const activeSyncAgents = req.app.get('activeSyncAgents');
  if (!activeSyncAgents) {
    return res.status(500).json({ error: 'Sync agent system not initialized' });
  }

  const agentSocket = activeSyncAgents.get(req.user.id);
  if (!agentSocket) {
    return res.status(404).json({ error: 'Локальный агент синхронизации оффлайн. Запустите его на вашем ПК.' });
  }

  console.log(`[Sync] Updating config for user ${req.user.username} via socket ${agentSocket.id}:`, { syncMode, conflictResolution });

  agentSocket.timeout(10000).emit('update-config-request', { syncMode, conflictResolution }, async (err, response) => {
    if (err) {
      console.error(`[Sync] Timeout or error updating config for user ${req.user.username}:`, err);
      return res.status(504).json({ error: 'Локальный агент не ответил вовремя' });
    }

    let finalResponse = response;
    if (Array.isArray(response)) {
      if (response.length > 1 && (response[0] === null || response[0] === undefined)) {
        finalResponse = response[1];
      } else {
        finalResponse = response[0];
      }
    }

    if (finalResponse && finalResponse.success) {
      try {
        await run(`
          UPDATE sync_status 
          SET sync_mode = ?, conflict_resolution = ?, last_sync_at = datetime('now') 
          WHERE user_id = ?
        `, [syncMode, conflictResolution, req.user.id]);
        
        const io = req.app.get('io');
        if (io) io.emit('sync-status-changed');
      } catch (dbErr) {
        console.error('[Sync] Failed to update sync_status table after config change:', dbErr);
      }
    }

    res.json(finalResponse || { success: true });
  });
});

export default router;
