import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { initDb, run, get, all } from './db.js';
import { initWatcher, vaultPath } from './watcher.js';

import authRouter from './routes/auth.js';
import notesRouter from './routes/notes.js';
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

// Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Support larger base64 image uploads

// Create Assets Folder in vault if missing
const assetsDir = join(vaultPath, 'assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

// Serve attachments statically
app.use('/assets', express.static(assetsDir));

// API Routers
app.use('/api/auth', authRouter);
app.use('/api/notes', notesRouter);
app.use('/api/history', historyRouter);

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

// Bootstrapping
const startServer = async () => {
  try {
    // 1. Initialize SQLite
    await initDb();

    // 2. Start Chokidar watcher (watches files and handles live SQLite / Socket sync)
    initWatcher(io);

    // 3. Start Listening
    server.listen(PORT, () => {
      console.log(`==================================================`);
      console.log(`🚀 Obsidian Collaborative Server running on port ${PORT}`);
      console.log(`📁 Vault Directory: ${vaultPath}`);
      console.log(`==================================================`);
    });
  } catch (err) {
    console.error('Fatal server boot error:', err);
    process.exit(1);
  }
};

startServer();
