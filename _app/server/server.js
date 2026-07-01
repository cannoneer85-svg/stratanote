import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { initDb, run, get, all } from './db.js';
import { initWatcher, vaultPath } from './watcher.js';

import authRouter, { authenticateJWT } from './routes/auth.js';
import notesRouter, { rawHandler } from './routes/notes.js';
import historyRouter from './routes/history.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Allow connections from Vite client dev server
    methods: ['GET', 'POST', 'PUT', 'DELETE']
  }
});

app.set('io', io);

// Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Support larger base64 image uploads
app.use(express.raw({ type: 'application/zip', limit: '1000mb' })); // Support binary ZIP uploads
app.use(express.text({ type: 'text/markdown', limit: '10mb' })); // Support raw markdown uploads

// Create Assets Folder in vault if missing
const assetsDir = join(vaultPath, 'assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

// Serve attachments statically (disabled for secure JWT-authenticated routing)
// app.use('/assets', express.static(assetsDir));

// API Routers
app.use('/api/auth', authRouter);
app.get('/api/raw/*', authenticateJWT, rawHandler);
app.use('/api/notes', notesRouter);
app.use('/api/history', historyRouter);

// System Version and Changelog Endpoint
app.get('/api/version', authenticateJWT, (req, res) => {
  try {
    const releasesPath = join(__dirname, '..', 'releases.json');
    const isProd = process.env.NODE_ENV === 'production';
    const envName = isProd ? 'Production' : 'Development';
    if (fs.existsSync(releasesPath)) {
      const releases = JSON.parse(fs.readFileSync(releasesPath, 'utf8'));
      const currentVersion = releases.length > 0 ? releases[0].version : '1.0.0';
      return res.json({ version: currentVersion, history: releases, env: envName });
    }
    return res.json({ version: '1.0.0', history: [], env: envName });
  } catch (err) {
    console.error('Error reading version metadata:', err);
    return res.status(500).json({ error: 'Failed to retrieve version info' });
  }
});


// Serve production frontend assets if built
const clientDistPath = join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get('*', (req, res) => {
    res.sendFile(join(clientDistPath, 'index.html'));
  });
}

// Active user connections tracking (socket.id -> { username, role, currentNote })
const activeUsers = new Map();

// Helper to broadcast active users list
const broadcastActiveUsers = () => {
  const usersList = Array.from(activeUsers.values());
  io.emit('active-presence', usersList);
};

// WebSocket Logic (Real-time synchronization and Locks)
io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  // User presence login
  socket.on('user-login', ({ username, role }) => {
    activeUsers.set(socket.id, { socketId: socket.id, username, role, currentNote: null });
    console.log(`[Socket] User logged in: ${username} (${role})`);
    broadcastActiveUsers();
  });

  // User changes note viewing
  socket.on('view-note', (relative_path) => {
    const user = activeUsers.get(socket.id);
    if (user) {
      user.currentNote = relative_path;
      activeUsers.set(socket.id, user);
      broadcastActiveUsers();
    }
  });

  // Lock a document for editing
  socket.on('lock-note', async ({ relative_path, username, userId }) => {
    console.log(`[Socket] Lock request for: ${relative_path} by ${username}`);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // Lock lasts 5 mins

    try {
      // Upsert lock in SQLite
      await run(
        'INSERT OR REPLACE INTO locks (relative_path, user_id, username, expires_at) VALUES (?, ?, ?, ?)',
        [relative_path, userId, username, expiresAt]
      );
      
      // Notify other clients
      socket.broadcast.emit('note-locked', { relative_path, username });
      console.log(`[Socket] Document locked: ${relative_path} by ${username}`);
    } catch (err) {
      console.error('[Socket] Failed to lock document:', err);
    }
  });

  // Unlock a document
  socket.on('unlock-note', async ({ relative_path }) => {
    console.log(`[Socket] Unlock request for: ${relative_path}`);
    try {
      await run('DELETE FROM locks WHERE relative_path = ?', [relative_path]);
      io.emit('note-unlocked', { relative_path });
      console.log(`[Socket] Document unlocked: ${relative_path}`);
    } catch (err) {
      console.error('[Socket] Failed to unlock document:', err);
    }
  });

  // Disconnect & cleanup locks and presence
  socket.on('disconnect', async () => {
    const user = activeUsers.get(socket.id);
    if (user) {
      console.log(`[Socket] User disconnected: ${user.username}`);
      
      // Clean up locks held by this user
      try {
        const locksHeld = await all('SELECT relative_path FROM locks WHERE user_id = (SELECT id FROM users WHERE username = ?)', [user.username]);
        if (locksHeld.length > 0) {
          await run('DELETE FROM locks WHERE user_id = (SELECT id FROM users WHERE username = ?)', [user.username]);
          for (const lock of locksHeld) {
            io.emit('note-unlocked', { relative_path: lock.relative_path });
            console.log(`[Socket] Auto-released lock on disconnect: ${lock.relative_path}`);
          }
        }
      } catch (err) {
        console.error('[Socket] Failed to cleanup locks on disconnect:', err);
      }

      activeUsers.delete(socket.id);
      broadcastActiveUsers();
    }
  });
});

// Auto-reindex embeddings on startup if the embeddings table is empty (plug-and-play for Railway/production)
const autoReindexEmbeddings = async () => {
  try {
    const existingCount = await get('SELECT COUNT(*) as count FROM note_embeddings');
    if (!existingCount || existingCount.count === 0) {
      console.log('[Embeddings] No note embeddings found in database. Starting background auto-reindex...');
      
      // Run the reindexing process asynchronously in the background so it doesn't block server startup
      (async () => {
        try {
          const { getEmbedding } = await import('./embeddings.js');
          const crypto = await import('crypto');
          const notesList = await all('SELECT relative_path FROM notes WHERE is_directory = 0');
          console.log(`[Embeddings Auto-Reindex] Found ${notesList.length} notes to index.`);
          
          let successCount = 0;
          for (const note of notesList) {
            const absolutePath = join(vaultPath, note.relative_path);
            if (!fs.existsSync(absolutePath)) continue;
            
            const content = fs.readFileSync(absolutePath, 'utf8');
            const contentHash = crypto.createHash('sha256').update(content).digest('hex');
            
            const embedding = await getEmbedding(content);
            await run(`
              INSERT INTO note_embeddings (relative_path, embedding, content_hash)
              VALUES (?, ?, ?)
              ON CONFLICT(relative_path) DO UPDATE SET
                embedding = excluded.embedding,
                content_hash = excluded.content_hash
            `, [note.relative_path, JSON.stringify(embedding), contentHash]);
            
            successCount++;
          }
          console.log(`[Embeddings Auto-Reindex] Completed! Successfully indexed ${successCount} notes.`);
        } catch (e) {
          console.error('[Embeddings Auto-Reindex] Failed:', e);
        }
      })();
    } else {
      console.log(`[Embeddings] Verified note embeddings database: ${existingCount.count} entries present.`);
    }
  } catch (err) {
    console.error('[Embeddings] Verification error during startup:', err);
  }
};

// Bootstrapping
const startServer = async () => {
  try {
    // 1. Initialize SQLite
    await initDb();

    // Prune node_modules if they accidentally slipped into notes database
    await run("DELETE FROM notes WHERE relative_path = 'node_modules' OR relative_path LIKE 'node_modules/%'");

    // 2. Start Chokidar watcher (watches files and handles live SQLite / Socket sync)
    const watcher = initWatcher(io);

    // 3. Auto-reindex embeddings in the background once the initial filesystem scan is complete
    watcher.on('ready', () => {
      console.log('[Watcher] Initial scan complete. Verifying note embeddings...');
      autoReindexEmbeddings();
    });

    // 4. Start Listening
    server.listen(PORT, () => {
      console.log(`==================================================`);
      console.log(`🚀 StrataNote Collaborative Server running on port ${PORT}`);
      console.log(`📁 Vault Directory: ${vaultPath}`);
      console.log(`==================================================`);
    });
  } catch (err) {
    console.error('Fatal server boot error:', err);
    process.exit(1);
  }
};

startServer();
