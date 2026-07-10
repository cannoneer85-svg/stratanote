import fs from 'fs';
import { join, relative, dirname, resolve, extname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import axios from 'axios';
import { minimatch } from 'minimatch';
import os from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));

let sqlite3 = null;
try {
  sqlite3 = (await import('sqlite3')).default;
} catch (err) {
  console.error('[SyncEngine] sqlite3 module not found. SQLite metadata synchronization is disabled.');
}

// Helper to normalize path separators
const normalizePath = (p) => p.replace(/\\/g, '/');

// In-memory cache for file hashes to avoid re-reading files on every local scan
const fileHashCache = new Map();

// Helper to compute SHA-256 hash of a file asynchronously and stream-wise
const getFileHash = (filePath) => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', err => reject(err));
  });
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
};

// Helper for automatic retries of async operations
async function retryOperation(operation, maxAttempts = 3, delayMs = 1000) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        console.warn(`[SyncEngine] Attempt ${attempt} failed: ${err.message}. Retrying in ${delayMs * attempt}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
      }
    }
  }
  throw lastErr;
}

// Check if a path should be excluded
function isExcluded(relPath, excludePatterns) {
  const norm = normalizePath(relPath);

  // Strict system folder and dotfile check to prevent scanning/modifying project internals
  const SYSTEM_DIRS = ['_app', '_sync_mcp', 'node_modules', '.git', '.obsidian', '.agents', '.sync_backup'];
  const parts = norm.split('/');
  if (parts.some(part => SYSTEM_DIRS.includes(part) || part.startsWith('.'))) {
    return true;
  }

  return excludePatterns.some(pattern => minimatch(norm, pattern, { dot: true }));
}

// Recursively get local files and their hashes/mtimes asynchronously
async function getLocalFilesAsync(dir, rootDir, excludePatterns) {
  let results = [];
  if (!fs.existsSync(dir)) return results;

  const list = await fs.promises.readdir(dir);
  for (const file of list) {
    const filePath = join(dir, file);
    const stat = await fs.promises.stat(filePath);
    const relPath = normalizePath(relative(rootDir, filePath));

    if (isExcluded(relPath, excludePatterns)) {
      continue;
    }

    if (stat.isDirectory()) {
      results.push({ path: relPath, isDirectory: true, mtime: stat.mtimeMs });
      const subResults = await getLocalFilesAsync(filePath, rootDir, excludePatterns);
      results = results.concat(subResults);
    } else {
      try {
        const hash = await getFileHashWithCache(filePath, stat);
        results.push({ path: relPath, isDirectory: false, hash, mtime: stat.mtimeMs });
      } catch (err) {
        console.error(`[SyncEngine] Failed to hash local file ${filePath}:`, err);
      }
    }
    
    // Yield to event loop
    await new Promise(resolve => setImmediate(resolve));
  }
  return results;
}

export class SyncEngine {
  constructor(config, onProgress) {
    this.config = config;
    this.stateFilePath = join(__dirname, '.sync_state.json');
    this.backupDir = join(__dirname, '.sync_backup');
    this.onProgress = onProgress || (() => { });
  }

  // Get local DB metadata for a file
  async getLocalDbMetadata(relPath) {
    if (!sqlite3) return null;
    const dbPath = join(this.config.LOCAL_VAULT_PATH, '_app', 'server', 'database.sqlite');
    if (!fs.existsSync(dbPath)) return null;

    return new Promise((resolve) => {
      const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
        if (err) {
          console.error('[SyncEngine] Failed to connect to local DB:', err);
          return resolve(null);
        }
      });

      db.get('SELECT created_by, last_edited_by FROM notes WHERE relative_path = ?', [relPath], (err, note) => {
        if (err || !note) {
          db.close();
          return resolve(null);
        }

        db.all('SELECT content, author_name, created_at FROM versions WHERE relative_path = ? ORDER BY id ASC', [relPath], (err, versions) => {
          db.close();
          if (err) {
            return resolve({
              created_by: note.created_by,
              last_edited_by: note.last_edited_by,
              versions: []
            });
          }
          resolve({
            created_by: note.created_by,
            last_edited_by: note.last_edited_by,
            versions: versions || []
          });
        });
      });
    });
  }

  // Save DB metadata to local DB
  async saveLocalDbMetadata(relPath, dbMetadata) {
    if (!sqlite3 || !dbMetadata) return;
    const dbPath = join(this.config.LOCAL_VAULT_PATH, '_app', 'server', 'database.sqlite');
    if (!fs.existsSync(dbPath)) return;

    return new Promise((resolve) => {
      const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
        if (err) {
          console.error('[SyncEngine] Failed to connect to local DB for write:', err);
          return resolve();
        }
      });

      db.serialize(() => {
        const title = relPath.endsWith('.md') ? relPath.slice(0, -3).split('/').pop() : relPath;
        const parentPath = relPath.includes('/') ? relPath.substring(0, relPath.lastIndexOf('/')) : '';

        db.get('SELECT * FROM notes WHERE relative_path = ?', [relPath], (err, note) => {
          if (err) {
            db.close();
            return resolve();
          }

          const runQuery = (sql, params) => {
            return new Promise((res) => db.run(sql, params, () => res()));
          };

          (async () => {
            if (!note) {
              await runQuery(
                'INSERT INTO notes (relative_path, title, is_directory, parent_path, last_edited_by, created_by) VALUES (?, ?, ?, ?, ?, ?)',
                [relPath, title, 0, parentPath, dbMetadata.last_edited_by || 'Внешняя система', dbMetadata.created_by || 'Внешняя система']
              );
            } else {
              await runQuery(
                'UPDATE notes SET updated_at = CURRENT_TIMESTAMP, last_edited_by = ?, created_by = ? WHERE relative_path = ?',
                [dbMetadata.last_edited_by || note.last_edited_by, dbMetadata.created_by || note.created_by, relPath]
              );
            }

            if (Array.isArray(dbMetadata.versions)) {
              for (const ver of dbMetadata.versions) {
                const exists = await new Promise((res) => {
                  db.get(
                    'SELECT id FROM versions WHERE relative_path = ? AND content = ?',
                    [relPath, ver.content],
                    (err, row) => res(!!row)
                  );
                });

                if (!exists) {
                  await runQuery(
                    'INSERT INTO versions (relative_path, content, author_name, created_at) VALUES (?, ?, ?, ?)',
                    [relPath, ver.content, ver.author_name, ver.created_at]
                  );
                }
              }
            }

            db.close();
            resolve();
          })();
        });
      });
    });
  }

  // Load last sync state from .sync_state.json
  loadSyncState() {
    if (!fs.existsSync(this.stateFilePath)) {
      return {};
    }
    try {
      return JSON.parse(fs.readFileSync(this.stateFilePath, 'utf8'));
    } catch (err) {
      console.error('[SyncEngine] Error reading sync state file:', err);
      return {};
    }
  }

  // Save sync state
  saveSyncState(state) {
    try {
      fs.writeFileSync(this.stateFilePath, JSON.stringify(state, null, 2), 'utf8');
    } catch (err) {
      console.error('[SyncEngine] Error writing sync state file:', err);
    }
  }

  // Create API Client with Authorization headers
  getApiClient() {
    return axios.create({
      baseURL: this.config.STRATANOTE_SERVER_URL,
      headers: {
        'Authorization': `Bearer ${this.config.STRATANOTE_API_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });
  }

  async pushFileInChunks(api, log, relPath, fullLocalPath, size, mtime, lastKnownServerHash, dbMetadata, force = false) {
    const uploadId = crypto.randomUUID();
    const chunkSize = 2 * 1024 * 1024; // 2MB chunks
    const totalChunks = Math.ceil(size / chunkSize);
    
    log(`Pushing file in ${totalChunks} chunks: ${relPath} (size: ${(size / 1024 / 1024).toFixed(2)} MB)`);
    
    let lastResponse;
    const fileFd = await fs.promises.open(fullLocalPath, 'r');
    
    try {
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const buffer = Buffer.alloc(Math.min(chunkSize, size - chunkIndex * chunkSize));
        await fileFd.read(buffer, 0, buffer.length, chunkIndex * chunkSize);
        
        const headers = {
          'Content-Type': 'application/octet-stream',
          'Authorization': `Bearer ${this.config.STRATANOTE_API_TOKEN}`,
          'x-chunk-index': chunkIndex,
          'x-total-chunks': totalChunks,
          'x-upload-id': uploadId,
          'x-relative-path-b64': Buffer.from(relPath).toString('base64'),
          'x-force': force ? 'true' : 'false'
        };
        
        if (mtime) {
          headers['x-mtime'] = mtime;
        }
        if (lastKnownServerHash) {
          headers['x-last-known-server-hash'] = lastKnownServerHash;
        }
        if (dbMetadata && chunkIndex === totalChunks - 1) {
          headers['x-db-metadata-b64'] = Buffer.from(JSON.stringify(dbMetadata)).toString('base64');
        }
        
        lastResponse = await retryOperation(async () => {
          return await api.post('/api/sync/push-chunk', buffer, { headers });
        }, 3, 1000);
      }
    } finally {
      await fileFd.close();
    }
    
    return lastResponse;
  }

  async runSync(dryRun = false) {
    const logs = [];
    const log = (msg) => {
      const message = `[${new Date().toLocaleTimeString()}] ${msg}`;
      console.log(message);
      logs.push(message);
    };

    if (!this.config.LOCAL_VAULT_PATH || !fs.existsSync(this.config.LOCAL_VAULT_PATH)) {
      throw new Error(`Local vault path does not exist: "${this.config.LOCAL_VAULT_PATH}"`);
    }
    if (!this.config.STRATANOTE_API_TOKEN) {
      throw new Error('API Token is missing in configuration.');
    }

    const api = this.getApiClient();

    try {
      this.onProgress('start', 0, 0, 'Инициализация синхронизации...');
      log(`${dryRun ? '[DryRun] ' : ''}Starting synchronization with ${this.config.STRATANOTE_SERVER_URL}...`);

      // 1. Fetch server manifest with retries
      this.onProgress('manifest', 0, 0, 'Запрос манифеста сервера...');
      let serverFiles = [];
      const res = await retryOperation(() => api.get('/api/sync/manifest'), 3, 1000);
      serverFiles = res.data.files || [];
      log(`Successfully retrieved server manifest (${serverFiles.length} items)`);

      // 2. Generate local manifest asynchronously
      this.onProgress('manifest', 0, 0, 'Сканирование локальной папки...');
      const localFiles = await getLocalFilesAsync(
        this.config.LOCAL_VAULT_PATH,
        this.config.LOCAL_VAULT_PATH,
        this.config.EXCLUDE_PATTERNS
      );
      log(`Generated local manifest (${localFiles.length} items)`);

      // 3. Load last known state
      const lastSyncState = this.loadSyncState();
      const nextSyncState = {};

      // Build Maps for quick lookup
      const localMap = new Map(localFiles.map(f => [f.path, f]));
      const serverMap = new Map(serverFiles.map(f => [f.path, f]));
      const allPaths = new Set([...localMap.keys(), ...serverMap.keys()]);

      const pullQueue = [];
      const pushQueue = [];
      const deleteServerQueue = [];
      const deleteLocalQueue = [];
      const conflictQueue = [];

      for (const path of allPaths) {
        // Пропускаем исключенные пути
        if (isExcluded(path, this.config.EXCLUDE_PATTERNS)) {
          continue;
        }

        const local = localMap.get(path);
        const server = serverMap.get(path);
        const base = lastSyncState[path];

        // File exists both locally and on server
        if (local && server) {
          if (local.isDirectory && server.isDirectory) {
            nextSyncState[path] = { isDirectory: true, mtime: local.mtime };
            continue;
          }

          if (local.isDirectory !== server.isDirectory) {
            conflictQueue.push({ path, local, server, base });
            continue;
          }

          if (local.hash === server.hash) {
            nextSyncState[path] = { hash: local.hash, mtime: local.mtime, serverHash: server.hash };
            continue;
          }

          const localChanged = base ? local.hash !== base.hash : true;
          const serverChanged = base ? server.hash !== base.serverHash : true;

          if (localChanged && serverChanged) {
            conflictQueue.push({ path, local, server, base });
          } else if (localChanged) {
            pushQueue.push({ path, local, server, base });
          } else if (serverChanged) {
            pullQueue.push({ path, local, server, base });
          } else {
            nextSyncState[path] = { hash: local.hash, mtime: local.mtime, serverHash: server.hash };
          }
        }
        // File exists only locally
        else if (local) {
          if (base) {
            deleteLocalQueue.push({ path, local, base });
          } else {
            pushQueue.push({ path, local, base });
          }
        }
        // File exists only on server
        else if (server) {
          if (base) {
            deleteServerQueue.push({ path, server, base });
          } else {
            pullQueue.push({ path, server, base });
          }
        }
      }

      log(`Queued: PUSH=${pushQueue.length}, PULL=${pullQueue.length}, DELETE_SERVER=${deleteServerQueue.length}, DELETE_LOCAL=${deleteLocalQueue.length}, CONFLICTS=${conflictQueue.length}`);

      if (dryRun) {
        log('[DryRun] Sync analysis completed. No files were modified.');
        return {
          success: true,
          logs,
          summary: {
            push: pushQueue.map(i => i.path),
            pull: pullQueue.map(i => i.path),
            deleteServer: deleteServerQueue.map(i => i.path),
            deleteLocal: deleteLocalQueue.map(i => i.path),
            conflicts: conflictQueue.map(i => i.path)
          }
        };
      }

      // Calculate total work
      const totalTasks = deleteServerQueue.length + deleteLocalQueue.length + pushQueue.length + pullQueue.length + conflictQueue.length;
      let processedTasks = 0;

      // Process deletes on server
      for (const item of deleteServerQueue) {
        try {
          processedTasks++;
          this.onProgress('process', processedTasks, totalTasks, `Удаление на сервере: ${item.path}`);
          log(`Deleting server file/folder: ${item.path}`);
          await retryOperation(() => api.post('/api/sync/delete', { path: item.path }), 3, 1000);
        } catch (err) {
          log(`Failed to delete server file ${item.path}: ${err.message}`);
        }
      }

      // Process deletes locally
      for (const item of deleteLocalQueue) {
        try {
          processedTasks++;
          this.onProgress('process', processedTasks, totalTasks, `Удаление локально: ${item.path}`);
          const fullLocalPath = join(this.config.LOCAL_VAULT_PATH, item.path);
          if (fs.existsSync(fullLocalPath)) {
            log(`Deleting local file/folder: ${item.path}`);
            const stat = await fs.promises.stat(fullLocalPath);
            if (stat.isDirectory()) {
              await fs.promises.rm(fullLocalPath, { recursive: true, force: true });
            } else {
              await fs.promises.unlink(fullLocalPath);
            }
          }
        } catch (err) {
          log(`Failed to delete local file ${item.path}: ${err.message}`);
        }
      }

      // Process pushes to server
      for (const item of pushQueue) {
        try {
          processedTasks++;
          this.onProgress('process', processedTasks, totalTasks, `Отправка на сервер: ${item.path}`);
          const fullLocalPath = join(this.config.LOCAL_VAULT_PATH, item.path);
          if (item.local.isDirectory) {
            log(`Creating server directory: ${item.path}`);
            await retryOperation(() => api.post('/api/sync/push', { path: item.path, isDirectory: true }), 3, 1000);
            nextSyncState[item.path] = { isDirectory: true, mtime: item.local.mtime };
          } else {
            const isBinary = item.path.startsWith('assets/');
            const stat = await fs.promises.stat(fullLocalPath);
            const size = stat.size;
            let response;
            
            // If file is larger than 1MB, push in chunks
            if (size > 1024 * 1024) {
              let dbMetadata = null;
              if (!isBinary && item.path.endsWith('.md')) {
                dbMetadata = await this.getLocalDbMetadata(item.path);
              }
              response = await this.pushFileInChunks(
                api, log, item.path, fullLocalPath, size, item.local.mtime,
                item.base ? item.base.serverHash : undefined, dbMetadata, false
              );
            } else {
              log(`Pushing file to server: ${item.path}`);
              const content = await fs.promises.readFile(fullLocalPath);
              const contentStr = isBinary ? content.toString('base64') : content.toString('utf8');

              let dbMetadata = null;
              if (!isBinary && item.path.endsWith('.md')) {
                dbMetadata = await this.getLocalDbMetadata(item.path);
              }

              response = await retryOperation(() => api.post('/api/sync/push', {
                path: item.path,
                content: contentStr,
                mtime: item.local.mtime,
                isDirectory: false,
                lastKnownServerHash: item.base ? item.base.serverHash : undefined,
                dbMetadata
              }), 3, 1000);
            }

            nextSyncState[item.path] = {
              hash: item.local.hash,
              mtime: item.local.mtime,
              serverHash: response.data.hash
            };
          }
        } catch (err) {
          log(`Failed to push file ${item.path}: ${err.message}`);
          if (item.base) nextSyncState[item.path] = item.base;
        }
      }

      // Process pulls from server
      for (const item of pullQueue) {
        try {
          processedTasks++;
          this.onProgress('process', processedTasks, totalTasks, `Получение с сервера: ${item.path}`);
          const fullLocalPath = join(this.config.LOCAL_VAULT_PATH, item.path);
          const parentDir = dirname(fullLocalPath);
          if (!fs.existsSync(parentDir)) {
            await fs.promises.mkdir(parentDir, { recursive: true });
          }

          if (item.server.isDirectory) {
            log(`Creating local directory: ${item.path}`);
            if (!fs.existsSync(fullLocalPath)) {
              await fs.promises.mkdir(fullLocalPath, { recursive: true });
            }
            nextSyncState[item.path] = { isDirectory: true, mtime: Date.now() };
          } else {
            log(`Pulling file from server: ${item.path}`);
            const isBinary = item.path.startsWith('assets/');

            let fileContentBuffer;
            let dbMetadata = null;

            if (!isBinary && item.path.endsWith('.md')) {
              const res = await retryOperation(() => api.post('/api/sync/pull', { path: item.path, includeMetadata: true }), 3, 1000);
              fileContentBuffer = Buffer.from(res.data.content, 'utf8');
              dbMetadata = res.data.dbMetadata;
            } else {
              const res = await retryOperation(() => api.post('/api/sync/pull', { path: item.path }, { responseType: 'arraybuffer' }), 3, 1000);
              fileContentBuffer = Buffer.from(res.data);
            }

            if (dbMetadata) {
              await this.saveLocalDbMetadata(item.path, dbMetadata);
            }

            await fs.promises.writeFile(fullLocalPath, fileContentBuffer);

            if (item.server.mtime) {
              const atime = Date.now() / 1000;
              fs.utimesSync(fullLocalPath, atime, item.server.mtime / 1000);
            }

            const localStat = await fs.promises.stat(fullLocalPath);
            nextSyncState[item.path] = {
              hash: item.server.hash,
              mtime: localStat.mtimeMs,
              serverHash: item.server.hash
            };
          }
        } catch (err) {
          log(`Failed to pull file ${item.path}: ${err.message}`);
          if (item.base) nextSyncState[item.path] = item.base;
        }
      }

      // Process Conflicts
      for (const item of conflictQueue) {
        try {
          processedTasks++;
          this.onProgress('process', processedTasks, totalTasks, `Разрешение конфликта: ${item.path}`);
          const fullLocalPath = join(this.config.LOCAL_VAULT_PATH, item.path);
          log(`Conflict detected in ${item.path}. Resolution strategy: ${this.config.CONFLICT_RESOLUTION}`);

          if (this.config.CONFLICT_RESOLUTION === 'suggest') {
            log(`Sending local changes for ${item.path} as Suggestion to server...`);
            const fileContent = await fs.promises.readFile(fullLocalPath, 'utf8');

            const resPull = await retryOperation(() => api.post('/api/sync/pull', { path: item.path }), 3, 1000);
            const baseContent = resPull.data;

            await retryOperation(() => api.post('/api/notes/suggest', {
              relative_path: item.path,
              author_name: 'Локальный агент синхронизации',
              base_content: baseContent,
              suggested_content: fileContent
            }), 3, 1000);

            log(`Successfully created review suggestion for: ${item.path}`);
            nextSyncState[item.path] = {
              hash: item.local.hash,
              mtime: item.local.mtime,
              serverHash: item.server.hash
            };
          }
          else if (this.config.CONFLICT_RESOLUTION === 'local-wins') {
            log(`Forcing local version for: ${item.path}`);
            const isBinary = item.path.startsWith('assets/');
            const stat = await fs.promises.stat(fullLocalPath);
            const size = stat.size;
            let response;
            
            if (size > 1024 * 1024) {
              let dbMetadata = null;
              if (!isBinary && item.path.endsWith('.md')) {
                dbMetadata = await this.getLocalDbMetadata(item.path);
              }
              response = await this.pushFileInChunks(
                api, log, item.path, fullLocalPath, size, item.local.mtime,
                undefined, dbMetadata, true
              );
            } else {
              const content = await fs.promises.readFile(fullLocalPath);
              const contentStr = isBinary ? content.toString('base64') : content.toString('utf8');

              let dbMetadata = null;
              if (!isBinary && item.path.endsWith('.md')) {
                dbMetadata = await this.getLocalDbMetadata(item.path);
              }

              response = await retryOperation(() => api.post('/api/sync/push', {
                path: item.path,
                content: contentStr,
                mtime: item.local.mtime,
                isDirectory: false,
                force: true,
                dbMetadata
              }), 3, 1000);
            }

            nextSyncState[item.path] = {
              hash: item.local.hash,
              mtime: item.local.mtime,
              serverHash: response.data.hash
            };
          }
          else if (this.config.CONFLICT_RESOLUTION === 'server-wins') {
            log(`Forcing server version for: ${item.path}`);

            if (fs.existsSync(fullLocalPath)) {
              if (!fs.existsSync(this.backupDir)) await fs.promises.mkdir(this.backupDir, { recursive: true });
              const backupPath = join(this.backupDir, item.path);
              await fs.promises.mkdir(dirname(backupPath), { recursive: true });
              await fs.promises.copyFile(fullLocalPath, backupPath);
              log(`Backed up local file to: .sync_backup/${item.path}`);
            }

            const isBinary = item.path.startsWith('assets/');
            let fileContentBuffer;
            let dbMetadata = null;

            if (!isBinary && item.path.endsWith('.md')) {
              const res = await retryOperation(() => api.post('/api/sync/pull', { path: item.path, includeMetadata: true }), 3, 1000);
              fileContentBuffer = Buffer.from(res.data.content, 'utf8');
              dbMetadata = res.data.dbMetadata;
            } else {
              const res = await retryOperation(() => api.post('/api/sync/pull', { path: item.path }, { responseType: 'arraybuffer' }), 3, 1000);
              fileContentBuffer = Buffer.from(res.data);
            }

            if (dbMetadata) {
              await this.saveLocalDbMetadata(item.path, dbMetadata);
            }

            await fs.promises.writeFile(fullLocalPath, fileContentBuffer);

            const finalStat = await fs.promises.stat(fullLocalPath);
            nextSyncState[item.path] = {
              hash: item.server.hash,
              mtime: finalStat.mtimeMs,
              serverHash: item.server.hash
            };
          }
          else if (this.config.CONFLICT_RESOLUTION === 'interactive') {
            log(`Saving interactive conflict copy for: ${item.path}`);
            const ext = extname(item.path);
            const baseName = item.path.substring(0, item.path.length - ext.length);
            const conflictPath = `${baseName}.conflict-${Date.now()}${ext}`;
            const conflictFilePath = join(this.config.LOCAL_VAULT_PATH, conflictPath);

            const res = await retryOperation(() => api.post('/api/sync/pull', { path: item.path }), 3, 1000);
            await fs.promises.writeFile(conflictFilePath, res.data);
            log(`Saved server copy as: ${relative(this.config.LOCAL_VAULT_PATH, conflictFilePath)}. Please merge manually.`);

            if (item.base) nextSyncState[item.path] = item.base;
          }
        } catch (err) {
          log(`Failed to resolve conflict for ${item.path}: ${err.message}`);
          if (item.base) nextSyncState[item.path] = item.base;
        }
      }

      this.saveSyncState(nextSyncState);
      log('Synchronization process finished.');
      this.onProgress('done', totalTasks, totalTasks, 'Синхронизация завершена успешно!');

      if (!dryRun) {
        try {
          await retryOperation(() => api.post('/api/sync/status', {
            deviceName: os.hostname(),
            status: 'success',
            syncMode: this.config.SYNC_MODE
          }), 3, 1000);
        } catch (statusErr) {
          console.error('[SyncEngine] Failed to send success status to server:', statusErr.message);
        }
      }

      return { success: true, logs };
    } catch (err) {
      log(`Synchronization failed: ${err.message}`);
      this.onProgress('error', 0, 0, `Ошибка: ${err.message}`);
      if (!dryRun) {
        try {
          await retryOperation(() => api.post('/api/sync/status', {
            deviceName: os.hostname(),
            status: 'error',
            errorMessage: err.message,
            syncMode: this.config.SYNC_MODE
          }), 3, 1000);
        } catch (statusErr) {
          console.error('[SyncEngine] Failed to send error status to server:', statusErr.message);
        }
      }
      return { success: false, logs };
    }
  }
}
