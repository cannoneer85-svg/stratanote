import express from 'express';
import fs from 'fs';
import { join, relative, dirname, resolve, extname } from 'path';
import crypto from 'crypto';
import { run, get, all } from '../db.js';
import { vaultPath } from '../watcher.js';
import { authenticateJWT } from './auth.js';

const router = express.Router();

const normalizePath = (p) => p.replace(/\\/g, '/');

// Recursive function to get all files in vaultPath
const getFilesRecursive = (dir, rootDir) => {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = join(dir, file);
    const stat = fs.statSync(filePath);
    
    const rel = normalizePath(relative(rootDir, filePath));
    // Ignore hidden files/folders, backend code, node_modules, and sync configs on any level
    if (
      file.startsWith('.') || 
      file === '_app' || 
      file === '_sync_mcp' ||
      file === 'node_modules' ||
      rel.startsWith('_app/') ||
      rel.startsWith('_sync_mcp/') ||
      rel.startsWith('node_modules/') ||
      rel.includes('/_app/') ||
      rel.includes('/_sync_mcp/') ||
      rel.includes('/node_modules/') ||
      rel.includes('/.git/') ||
      rel.includes('/.obsidian/') ||
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
      results = results.concat(getFilesRecursive(filePath, rootDir));
    } else {
      const fileBuffer = fs.readFileSync(filePath);
      const hashSum = crypto.createHash('sha256');
      hashSum.update(fileBuffer);
      const hex = hashSum.digest('hex');

      results.push({
        path: rel,
        isDirectory: false,
        mtime: stat.mtimeMs,
        size: stat.size,
        hash: hex
      });
    }
  }
  return results;
};

// 1. GET /api/sync/manifest - Get server files manifest
router.get('/manifest', authenticateJWT, async (req, res) => {
  try {
    const files = getFilesRecursive(vaultPath, vaultPath);
    res.json({ files });
  } catch (err) {
    console.error('[Sync] Error generating manifest:', err);
    res.status(500).json({ error: 'Failed to generate server manifest' });
  }
});

// 2. POST /api/sync/pull - Download file from server
router.post('/pull', authenticateJWT, async (req, res) => {
  const { path: relPath } = req.body;
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
    // Send file contents
    const isBinary = relPath.startsWith('assets/');
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
  const { path: relPath, content, mtime, isDirectory, lastKnownServerHash } = req.body;
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

    const isBinary = relPath.startsWith('assets/');
    const fileBuffer = isBinary ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8');

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
  const { deviceName, status, errorMessage, syncMode } = req.body;
  
  try {
    await run(`
      INSERT INTO sync_status (user_id, username, device_name, last_sync_at, status, sync_mode, error_message)
      VALUES (?, ?, ?, datetime('now'), ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        username = excluded.username,
        device_name = excluded.device_name,
        last_sync_at = datetime('now'),
        status = excluded.status,
        sync_mode = COALESCE(excluded.sync_mode, sync_status.sync_mode),
        error_message = excluded.error_message
    `, [req.user.id, req.user.username, deviceName || 'Unknown Device', status, syncMode || null, errorMessage || null]);

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

  agentSocket.timeout(45000).emit('trigger-sync-request', (err, response) => {
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

// DEBUG ENDPOINT
router.get('/debug-file', authenticateJWT, async (req, res) => {
  const relPath = req.query.path || "assets/10934961046541_18.png";
  const safePath = resolve(vaultPath, relPath);
  try {
    const exists = fs.existsSync(safePath);
    if (!exists) {
      return res.json({ exists: false, safePath, vaultPath });
    }
    const stat = fs.statSync(safePath);
    const content = fs.readFileSync(safePath);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    return res.json({
      exists: true,
      safePath,
      vaultPath,
      statSize: stat.size,
      bufferLength: content.length,
      hash,
      first32BytesHex: content.slice(0, 32).toString('hex')
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
