import { run } from '../server/db.js';

async function main() {
  console.log('Создаем таблицу suggestions...');
  try {
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
    console.log('Таблица suggestions создана!');
  } catch (err) {
    console.error('Ошибка создания suggestions:', err);
  }

  console.log('Создаем индекс idx_suggestions_active...');
  try {
    await run(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_suggestions_active 
      ON suggestions(relative_path, author_name) 
      WHERE status = 'pending'
    `);
    console.log('Индекс idx_suggestions_active создан!');
  } catch (err) {
    console.error('Ошибка создания индекса:', err);
  }
}

main().catch(console.error);
