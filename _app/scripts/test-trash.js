import { initDb, run, get, all } from '../server/db.js';
import { archiveNoteBeforeDelete, restoreNoteFromTrash, purgeFromTrash, clearTrash, getTrashList } from '../server/trash.js';
import fs from 'fs';
import { join } from 'path';
import { vaultPath } from '../server/watcher.js';

async function test() {
  console.log('=== Запуск теста корзины ===');
  
  // Инициализируем БД
  await initDb();

  const testFile = 'test-temp-note.md';
  const fullPath = join(vaultPath, testFile);

  try {
    // 0. Очистим корзину и базу от прошлых тестов
    await clearTrash();
    await run('DELETE FROM notes WHERE relative_path = ?', [testFile]);

    // 1. Создаем тестовую заметку в БД и файл на диске
    console.log('1. Создаем тестовую заметку...');
    fs.writeFileSync(fullPath, '# Привет\nЭто тестовый контент.', 'utf8');
    
    await run(
      'INSERT INTO notes (relative_path, title, is_directory, parent_path, last_edited_by, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [testFile, 'test-temp-note', 0, '', 'admin', 'admin']
    );
    await run(
      'INSERT INTO versions (relative_path, content, author_name) VALUES (?, ?, ?)',
      [testFile, '# Привет\nЭто тестовый контент.', 'admin']
    );
    await run(
      'INSERT INTO versions (relative_path, content, author_name) VALUES (?, ?, ?)',
      [testFile, '# Привет\nЭто измененный тестовый контент.', 'admin']
    );

    // Проверяем
    const noteBefore = await get('SELECT * FROM notes WHERE relative_path = ?', [testFile]);
    const versionsBefore = await all('SELECT * FROM versions WHERE relative_path = ?', [testFile]);
    console.log('Заметка в БД:', !!noteBefore, 'Версий в БД:', versionsBefore.length);

    // 2. Архивируем перед удалением
    console.log('2. Архивируем в корзину...');
    await archiveNoteBeforeDelete(testFile, 'test-deleter');

    // Имитируем удаление из notes (каскадно удалятся версии) и с диска
    await run('DELETE FROM notes WHERE relative_path = ?', [testFile]);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }

    // Проверяем корзину
    const trashList = await getTrashList();
    console.log('Элементов в корзине:', trashList.length);
    if (trashList.length > 0) {
      console.log('Первый элемент в корзине:', trashList[0]);
    }

    // Проверяем, что в основной БД и на диске пусто
    const noteAfterDel = await get('SELECT * FROM notes WHERE relative_path = ?', [testFile]);
    const versionsAfterDel = await all('SELECT * FROM versions WHERE relative_path = ?', [testFile]);
    console.log('Заметка в БД после удаления:', !!noteAfterDel, 'Версий после удаления:', versionsAfterDel.length);

    // 3. Восстанавливаем
    console.log('3. Восстанавливаем из корзины...');
    const trashItem = trashList[0];
    await restoreNoteFromTrash(trashItem.id);

    // Проверяем, что файл вернулся на диск и в БД со всеми версиями
    const fileExists = fs.existsSync(fullPath);
    const noteRestored = await get('SELECT * FROM notes WHERE relative_path = ?', [testFile]);
    const versionsRestored = await all('SELECT * FROM versions WHERE relative_path = ?', [testFile]);
    const fileContent = fileExists ? fs.readFileSync(fullPath, 'utf8') : '';

    console.log('Файл на диске:', fileExists);
    console.log('Содержимое на диске:', fileContent.replace('\n', '\\n'));
    console.log('Заметка в БД восстановлена:', !!noteRestored);
    console.log('Версий в БД восстановлено:', versionsRestored.length);

    if (versionsRestored.length === 2 && fileExists && noteRestored) {
      console.log('=== ТЕСТ ПРОЙДЕН УСПЕШНО ===');
    } else {
      console.log('=== ТЕСТ ПРОВАЛЕН ===');
    }

  } catch (err) {
    console.error('Ошибка во время выполнения теста:', err);
  } finally {
    // Убираем за собой
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
    await run('DELETE FROM notes WHERE relative_path = ?', [testFile]);
    await clearTrash();
  }
}

test();
