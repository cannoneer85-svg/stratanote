import sqlite3 from 'sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import bcrypt from 'bcryptjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, 'database.sqlite');

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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. Notes / Folders Table
  await run(`
    CREATE TABLE IF NOT EXISTS notes (
      relative_path TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      is_directory BOOLEAN NOT NULL,
      parent_path TEXT,
      last_edited_by TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
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

  // Seed default admin if table is empty
  const adminExists = await get('SELECT id FROM users WHERE username = ?', ['admin']);
  if (!adminExists) {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash('admin', salt);
    await run(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
      ['admin', hash, 'Admin']
    );
    console.log('[DB] Created default admin user (admin / admin)');
  }

  // Seed default editor and viewer for testing
  const editorExists = await get('SELECT id FROM users WHERE username = ?', ['editor']);
  if (!editorExists) {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash('editor', salt);
    await run(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
      ['editor', hash, 'Editor']
    );
    console.log('[DB] Created default editor user (editor / editor)');
  }

  const viewerExists = await get('SELECT id FROM users WHERE username = ?', ['viewer']);
  if (!viewerExists) {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash('viewer', salt);
    await run(
      'INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)',
      ['viewer', hash, 'Viewer']
    );
    console.log('[DB] Created default viewer user (viewer / viewer)');
  }

  console.log('[DB] SQLite database initialized successfully.');
};

export default db;
