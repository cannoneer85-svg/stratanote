import sqlite3 from 'sqlite3';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import bcrypt from 'bcryptjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_PATH 
  ? resolve(process.env.DATABASE_PATH) 
  : join(__dirname, 'database.sqlite');

// Connect to SQLite
const db = new sqlite3.Database(dbPath);

// Helper to run query with Promise
export const run = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
};

// Helper to get single row
export const get = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

// Helper to get all rows
export const all = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// Initialize Database Schema
export const initDb = async () => {
  // 1. Users Table
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT CHECK(role IN ('Admin', 'Editor', 'Viewer')) NOT NULL,
      approved INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  try {
    await run('ALTER TABLE users ADD COLUMN approved INTEGER DEFAULT 0');
    await run('UPDATE users SET approved = 1');
    console.log('[DB] Added approved column and set it to 1 for existing users');
  } catch (err) {
    // Column already exists, ignore
  }

  // 2. Notes / Folders Table
  await run(`
    CREATE TABLE IF NOT EXISTS notes (
      relative_path TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      is_directory BOOLEAN NOT NULL,
      parent_path TEXT,
      last_edited_by TEXT,
      created_by TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  try {
    await run('ALTER TABLE notes ADD COLUMN created_by TEXT');
    await run("UPDATE notes SET created_by = 'Внешняя система'");
    console.log('[DB] Added created_by column and initialized with default value');
  } catch (err) {
    // Column already exists, ignore
  }

  // 2.5. Suggestions Table (for Suggest/Track changes mode)
  await run(`
    CREATE TABLE IF NOT EXISTS suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      relative_path TEXT NOT NULL,
      author_name TEXT NOT NULL,
      base_content TEXT NOT NULL,
      suggested_content TEXT NOT NULL,
      status TEXT CHECK(status IN ('pending', 'accepted', 'rejected')) DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (relative_path) REFERENCES notes(relative_path) ON DELETE CASCADE
    )
  `);

  await run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_suggestions_active 
    ON suggestions(relative_path, author_name) 
    WHERE status = 'pending'
  `);

  // 3. Version History Table
  await run(`
    CREATE TABLE IF NOT EXISTS versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      relative_path TEXT NOT NULL,
      content TEXT,
      author_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (relative_path) REFERENCES notes(relative_path) ON DELETE CASCADE
    )
  `);

  // 4. Document Locks Table
  await run(`
    CREATE TABLE IF NOT EXISTS locks (
      relative_path TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      expires_at DATETIME NOT NULL,
      FOREIGN KEY (relative_path) REFERENCES notes(relative_path) ON DELETE CASCADE
    )
  `);

  // 5. Note Embeddings Table
  await run(`
    CREATE TABLE IF NOT EXISTS note_embeddings (
      relative_path TEXT PRIMARY KEY,
      embedding TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      FOREIGN KEY (relative_path) REFERENCES notes(relative_path) ON DELETE CASCADE
    )
  `);

  // 6. Sync Status Table
  await run(`
    CREATE TABLE IF NOT EXISTS sync_status (
      user_id INTEGER PRIMARY KEY,
      username TEXT NOT NULL,
      device_name TEXT,
      last_sync_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT,
      sync_mode TEXT,
      error_message TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  try {
    await run('ALTER TABLE sync_status ADD COLUMN sync_mode TEXT');
    console.log('[DB] Added sync_mode column to sync_status table');
  } catch (err) {
    // Column already exists, ignore
  }

  // Seed default admin if table is empty
  const adminExists = await get('SELECT id FROM users WHERE username = ?', ['admin']);
  if (!adminExists) {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash('admin', salt);
    await run(
      'INSERT INTO users (username, password_hash, role, approved) VALUES (?, ?, ?, ?)',
      ['admin', hash, 'Admin', 1]
    );
    console.log('[DB] Created default admin user (admin / admin)');
  }

  console.log('[DB] SQLite database initialized successfully.');
};

export default db;
