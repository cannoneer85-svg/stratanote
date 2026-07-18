import sqlite3 from 'sqlite3';
import { dirname, join, resolve, isAbsolute } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import bcrypt from 'bcryptjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DATABASE_PATH 
  ? resolve(process.env.DATABASE_PATH) 
  : join(__dirname, 'database.sqlite');

// Connect to SQLite
const db = new sqlite3.Database(dbPath);
db.run('PRAGMA foreign_keys = ON');

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

  // 5.5. FTS5 Search Table
  try {
    await run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
        relative_path,
        title,
        content
      )
    `);
  } catch (err) {
    console.error('[DB] Failed to create notes_fts virtual table (FTS5 may be unsupported):', err);
  }


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

  try {
    await run('ALTER TABLE sync_status ADD COLUMN conflict_resolution TEXT');
    console.log('[DB] Added conflict_resolution column to sync_status table');
  } catch (err) {
    // Column already exists, ignore
  }

  // 7. Trash Table
  await run(`
    CREATE TABLE IF NOT EXISTS trash (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      relative_path TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      deleted_by TEXT NOT NULL,
      versions_json TEXT
    )
  `);

  // 8. Comments Table
  await run(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      relative_path TEXT NOT NULL,
      parent_id INTEGER,
      author_id INTEGER NOT NULL,
      author_name TEXT NOT NULL,
      content TEXT NOT NULL,
      quoted_text TEXT,
      status TEXT DEFAULT 'open' CHECK(status IN ('open', 'resolved')),
      resolved_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME,
      FOREIGN KEY (relative_path) REFERENCES notes(relative_path) ON DELETE CASCADE,
      FOREIGN KEY (author_id) REFERENCES users(id),
      FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE
    )
  `);
  await run('CREATE INDEX IF NOT EXISTS idx_comments_note ON comments(relative_path)');
  await run('CREATE INDEX IF NOT EXISTS idx_comments_status ON comments(relative_path, status)');

  // Migration: Add 'approved' column for comment moderation
  try {
    await run('ALTER TABLE comments ADD COLUMN approved BOOLEAN DEFAULT 0');
  } catch (e) {
    // Column already exists, skip
  }
  // Auto-approve only pre-existing comments (before moderation column was added)
  await run('UPDATE comments SET approved = 1 WHERE approved IS NULL');

  // 9. Notification Reads Table
  await run(`
    CREATE TABLE IF NOT EXISTS notification_reads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      notification_type TEXT NOT NULL CHECK(notification_type IN ('comment', 'suggestion')),
      notification_id INTEGER NOT NULL,
      is_read BOOLEAN DEFAULT 0,
      is_dismissed BOOLEAN DEFAULT 0,
      read_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, notification_type, notification_id)
    )
  `);
  // 10. Tags Table
  await run(`
    CREATE TABLE IF NOT EXISTS note_tags (
      relative_path TEXT NOT NULL,
      tag TEXT NOT NULL,
      PRIMARY KEY (relative_path, tag),
      FOREIGN KEY (relative_path) REFERENCES notes(relative_path) ON DELETE CASCADE
    )
  `);
  await run('CREATE INDEX IF NOT EXISTS idx_note_tags_tag ON note_tags(tag)');

  // 11. User Settings Table
  await run(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (user_id, key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Seed system default user with id = 0 to satisfy foreign key in user_settings for global defaults
  const systemUserExists = await get('SELECT id FROM users WHERE id = 0');
  if (!systemUserExists) {
    await run(
      "INSERT OR IGNORE INTO users (id, username, password_hash, role, approved) VALUES (0, 'system_default', '', 'Viewer', 1)"
    );
    console.log('[DB] Created system default user with id = 0');
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

  // Deduplicate FTS5 virtual table if duplicates exist
  try {
    const ftsCount = await get('SELECT COUNT(*) as count FROM notes_fts');
    if (ftsCount && ftsCount.count > 0) {
      const distinctCount = await get('SELECT COUNT(DISTINCT relative_path) as count FROM notes_fts');
      if (ftsCount.count !== distinctCount.count) {
        console.log('[DB] FTS index has duplicates. Cleaning up...');
        await run(`
          CREATE TEMPORARY TABLE temp_fts AS 
          SELECT relative_path, title, content 
          FROM notes_fts 
          WHERE rowid IN (SELECT max(rowid) FROM notes_fts GROUP BY relative_path)
        `);
        await run('DELETE FROM notes_fts');
        await run('INSERT INTO notes_fts SELECT * FROM temp_fts');
        await run('DROP TABLE temp_fts');
        console.log('[DB] FTS index deduplicated successfully.');
      }
    }
  } catch (err) {
    console.error('[DB] Failed to deduplicate FTS table:', err);
  }

  // Trigger background FTS indexing without blocking
  indexExistingNotesFTS().catch(err => {
    console.error('[DB] Background FTS indexing failed:', err);
  });

  console.log('[DB] SQLite database initialized successfully.');
};

// Background FTS Indexing of existing notes (if index is empty)
export const indexExistingNotesFTS = async () => {
  try {
    const ftsCount = await get('SELECT COUNT(*) as count FROM notes_fts');
    if (ftsCount && ftsCount.count === 0) {
      console.log('[DB FTS] FTS index is empty. Starting background indexing...');
      const allNotes = await all('SELECT relative_path, title FROM notes WHERE is_directory = 0');
      
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const projectRoot = join(__dirname, '..', '..');
      const rawVaultPath = process.env.VAULT_PATH;
      const vaultPath = rawVaultPath
        ? (isAbsolute(rawVaultPath) ? resolve(rawVaultPath) : resolve(projectRoot, rawVaultPath))
        : join(projectRoot, 'docs');

      let indexedCount = 0;
      await run('BEGIN TRANSACTION');
      for (const note of allNotes) {
        try {
          const absPath = join(vaultPath, note.relative_path);
          if (fs.existsSync(absPath)) {
            const content = fs.readFileSync(absPath, 'utf8');
            await run('DELETE FROM notes_fts WHERE relative_path = ?', [note.relative_path]);
            await run('INSERT INTO notes_fts (relative_path, title, content) VALUES (?, ?, ?)', [
              note.relative_path,
              note.title,
              content
            ]);
            indexedCount++;
          }
        } catch (e) {
          console.error(`[DB FTS] Failed to index note ${note.relative_path}:`, e);
        }
      }
      await run('COMMIT');
      console.log(`[DB FTS] Background indexing complete. Indexed ${indexedCount} notes.`);
    }
  } catch (err) {
    console.error('[DB FTS] Error checking/indexing FTS notes:', err);
    try {
      await run('ROLLBACK');
    } catch (e) {
      // Ignore rollback error if transaction wasn't started
    }
  }
};

export default db;
