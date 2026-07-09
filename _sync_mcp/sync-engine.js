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

// Recursively get local files and their hashes/mtimes
function getLocalFiles(dir, rootDir, excludePatterns) {
  let results = [];
  if (!fs.existsSync(dir)) return results;

  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = join(dir, file);
    const stat = fs.statSync(filePath);
    const relPath = normalizePath(relative(rootDir, filePath));

    if (isExcluded(relPath, excludePatterns)) {
      continue;
    }

    if (stat.isDirectory()) {
      results.push({ path: relPath, isDirectory: true, mtime: stat.mtimeMs });
      results = results.concat(getLocalFiles(filePath, rootDir, excludePatterns));
    } else {
      const content = fs.readFileSync(filePath);
      const hash = crypto.createHash('sha256').update(content).digest('hex');
      results.push({ path: relPath, isDirectory: false, hash, mtime: stat.mtimeMs });
    }
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

      // 1. Fetch server manifest
      this.onProgress('manifest', 0, 0, 'Запрос манифеста сервера...');
      let serverFiles = [];
      const res = await api.get('/api/sync/manifest');
      serverFiles = res.data.files || [];
      log(`Successfully retrieved server manifest (${serverFiles.length} items)`);

      // 2. Generate local manifest
      this.onProgress('manifest', 0, 0, 'Сканирование локальной папки...');
      const localFiles = getLocalFiles(
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
          await api.post('/api/sync/delete', { path: item.path });
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
            const stat = fs.statSync(fullLocalPath);
            if (stat.isDirectory()) {
              fs.rmSync(fullLocalPath, { recursive: true, force: true });
            } else {
              fs.unlinkSync(fullLocalPath);
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
            await api.post('/api/sync/push', { path: item.path, isDirectory: true });
            nextSyncState[item.path] = { isDirectory: true, mtime: item.local.mtime };
          } else {
            log(`Pushing file to server: ${item.path}`);
            const isBinary = item.path.startsWith('assets/');
            const content = fs.readFileSync(fullLocalPath);
            const contentStr = isBinary ? content.toString('base64') : content.toString('utf8');

            let dbMetadata = null;
            if (!isBinary && item.path.endsWith('.md')) {
              dbMetadata = await this.getLocalDbMetadata(item.path);
            }

            const response = await api.post('/api/sync/push', {
              path: item.path,
              content: contentStr,
              mtime: item.local.mtime,
              isDirectory: false,
              lastKnownServerHash: item.base ? item.base.serverHash : undefined,
              dbMetadata
            });

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
            fs.mkdirSync(parentDir, { recursive: true });
          }

          if (item.server.isDirectory) {
            log(`Creating local directory: ${item.path}`);
            if (!fs.existsSync(fullLocalPath)) {
              fs.mkdirSync(fullLocalPath, { recursive: true });
            }
            nextSyncState[item.path] = { isDirectory: true, mtime: Date.now() };
          } else {
            log(`Pulling file from server: ${item.path}`);
            const isBinary = item.path.startsWith('assets/');

            let fileContentBuffer;
            let dbMetadata = null;

            if (!isBinary && item.path.endsWith('.md')) {
              const res = await api.post('/api/sync/pull', { path: item.path, includeMetadata: true });
              fileContentBuffer = Buffer.from(res.data.content, 'utf8');
              dbMetadata = res.data.dbMetadata;
            } else {
              const res = await api.post('/api/sync/pull', { path: item.path }, { responseType: 'arraybuffer' });
              fileContentBuffer = Buffer.from(res.data);
            }

            if (dbMetadata) {
              await this.saveLocalDbMetadata(item.path, dbMetadata);
            }

            fs.writeFileSync(fullLocalPath, fileContentBuffer);

            if (item.server.mtime) {
              const atime = Date.now() / 1000;
              fs.utimesSync(fullLocalPath, atime, item.server.mtime / 1000);
            }

            const localStat = fs.statSync(fullLocalPath);
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
            const fileContent = fs.readFileSync(fullLocalPath, 'utf8');

            const resPull = await api.post('/api/sync/pull', { path: item.path });
            const baseContent = resPull.data;

            await api.post('/api/notes/suggest', {
              relative_path: item.path,
              author_name: 'Локальный агент синхронизации',
              base_content: baseContent,
              suggested_content: fileContent
            });

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
            const content = fs.readFileSync(fullLocalPath);
            const contentStr = isBinary ? content.toString('base64') : content.toString('utf8');

            let dbMetadata = null;
            if (!isBinary && item.path.endsWith('.md')) {
              dbMetadata = await this.getLocalDbMetadata(item.path);
            }

            const response = await api.post('/api/sync/push', {
              path: item.path,
              content: contentStr,
              mtime: item.local.mtime,
              isDirectory: false,
              force: true,
              dbMetadata
            });

            nextSyncState[item.path] = {
              hash: item.local.hash,
              mtime: item.local.mtime,
              serverHash: response.data.hash
            };
          }
          else if (this.config.CONFLICT_RESOLUTION === 'server-wins') {
            log(`Forcing server version for: ${item.path}`);

            if (fs.existsSync(fullLocalPath)) {
              if (!fs.existsSync(this.backupDir)) fs.mkdirSync(this.backupDir, { recursive: true });
              const backupPath = join(this.backupDir, item.path);
              fs.mkdirSync(dirname(backupPath), { recursive: true });
              fs.copyFileSync(fullLocalPath, backupPath);
              log(`Backed up local file to: .sync_backup/${item.path}`);
            }

            const isBinary = item.path.startsWith('assets/');
            let fileContentBuffer;
            let dbMetadata = null;

            if (!isBinary && item.path.endsWith('.md')) {
              const res = await api.post('/api/sync/pull', { path: item.path, includeMetadata: true });
              fileContentBuffer = Buffer.from(res.data.content, 'utf8');
              dbMetadata = res.data.dbMetadata;
            } else {
              const res = await api.post('/api/sync/pull', { path: item.path }, { responseType: 'arraybuffer' });
              fileContentBuffer = Buffer.from(res.data);
            }

            if (dbMetadata) {
              await this.saveLocalDbMetadata(item.path, dbMetadata);
            }

            fs.writeFileSync(fullLocalPath, fileContentBuffer);

            nextSyncState[item.path] = {
              hash: item.server.hash,
              mtime: fs.statSync(fullLocalPath).mtimeMs,
              serverHash: item.server.hash
            };
          }
          else if (this.config.CONFLICT_RESOLUTION === 'interactive') {
            log(`Saving interactive conflict copy for: ${item.path}`);
            const ext = extname(item.path);
            const baseName = item.path.substring(0, item.path.length - ext.length);
            const conflictPath = `${baseName}.conflict-${Date.now()}${ext}`;
            const conflictFilePath = join(this.config.LOCAL_VAULT_PATH, conflictPath);

            const res = await api.post('/api/sync/pull', { path: item.path });
            fs.writeFileSync(conflictFilePath, res.data);
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
          await api.post('/api/sync/status', {
            deviceName: os.hostname(),
            status: 'success',
            syncMode: this.config.SYNC_MODE
          });
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
          await api.post('/api/sync/status', {
            deviceName: os.hostname(),
            status: 'error',
            errorMessage: err.message,
            syncMode: this.config.SYNC_MODE
          });
        } catch (statusErr) {
          console.error('[SyncEngine] Failed to send error status to server:', statusErr.message);
        }
      }
      return { success: false, logs };
    }
  }
}
