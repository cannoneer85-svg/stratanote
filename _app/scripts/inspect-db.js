import { all, get } from '../server/db.js';

async function main() {
  console.log('=== Данные пользователей ===');
  const users = await all('SELECT id, username, role, approved FROM users');
  console.log(users);

  console.log('\n=== Данные заметок (notes) ===');
  const notes = await all('SELECT relative_path, title, created_by FROM notes');
  console.log(notes);

  console.log('\n=== Активные предложения (suggestions) ===');
  const suggestions = await all('SELECT * FROM suggestions');
  console.log(suggestions);
}

main().catch(console.error);
