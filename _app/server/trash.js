import fs from 'fs';
import { join, dirname, basename } from 'path';
import { run, get, all } from './db.js';
import { vaultPath } from './watcher.js';

// Normalize helper
const normalizePath = (p) => p.replace(/\\/g, '/');

/**
 * Архивация заметки в корзину перед её физическим удалением
 * @param {string} relPath - Относительный путь к файлу
 * @param {string} deletedBy - Кто удалил заметку
 */
export async function archiveNoteBeforeDelete(relPath, deletedBy = 'Система') {
  const normPath = normalizePath(relPath);
  
  // Корзина работает только для .md файлов
  if (!normPath.endsWith('.md')) return;

  try {
    // 1. Проверяем, есть ли запись в notes
    const note = await get('SELECT * FROM notes WHERE relative_path = ?', [normPath]);
    if (!note) {
      console.log(`[Trash] Note metadata not found in DB, skipping archive for: ${normPath}`);
      return;
    }

    // 2. Считываем всю историю версий из базы данных
    const versions = await all(
      'SELECT content, author_name, created_at FROM versions WHERE relative_path = ? ORDER BY id ASC',
      [normPath]
    );

    // 3. Пытаемся получить последний контент: либо из последней версии, либо с диска (если файл еще там)
    let content = '';
    if (versions && versions.length > 0) {
      content = versions[versions.length - 1].content;
    } else {
      const fullPath = join(vaultPath, normPath);
      if (fs.existsSync(fullPath)) {
        content = fs.readFileSync(fullPath, 'utf8');
      }
    }

    const title = note.title || basename(normPath, '.md');
    const versionsJson = JSON.stringify(versions || []);

    // 4. Записываем в таблицу trash
    await run(
      'INSERT INTO trash (relative_path, title, content, deleted_by, versions_json) VALUES (?, ?, ?, ?, ?)',
      [normPath, title, content, deletedBy, versionsJson]
    );

    console.log(`[Trash] Successfully archived note to trash: ${normPath} (Deleted by: ${deletedBy}, Versions: ${versions ? versions.length : 0})`);
  } catch (err) {
    console.error(`[Trash] Error archiving note ${normPath}:`, err);
  }
}

/**
 * Восстановление заметки из корзины
 * @param {number} trashId - ID записи в корзине
 */
export async function restoreNoteFromTrash(trashId) {
  try {
    // 1. Находим запись в корзине
    const trashItem = await get('SELECT * FROM trash WHERE id = ?', [trashId]);
    if (!trashItem) {
      throw new Error(`Запись в корзине с ID ${trashId} не найдена`);
    }

    const { relative_path: relPath, title, content, versions_json: versionsJson } = trashItem;
    const fullPath = join(vaultPath, relPath);
    const parentDir = dirname(fullPath);

    // 2. Создаем директории на диске, если их нет
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    // 3. Записываем файл на диск
    fs.writeFileSync(fullPath, content || '', 'utf8');
    console.log(`[Trash] Restored file on disk: ${relPath}`);

    // 4. Восстанавливаем метаданные в notes
    const parentPath = normalizePath(dirname(relPath)) === '.' ? '' : normalizePath(dirname(relPath));
    
    // Удаляем старые записи, если вдруг остались (защита от коллизий)
    await run('DELETE FROM notes WHERE relative_path = ?', [relPath]);
    
    await run(
      'INSERT INTO notes (relative_path, title, is_directory, parent_path, last_edited_by, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [relPath, title, 0, parentPath, 'Внешняя система', 'Внешняя система']
    );

    // 5. Восстанавливаем версии
    let versions = [];
    try {
      versions = JSON.parse(versionsJson);
    } catch (e) {
      console.error('[Trash] Failed to parse versions JSON:', e);
    }

    if (Array.isArray(versions) && versions.length > 0) {
      for (const ver of versions) {
        // Проверяем, существует ли уже такая версия для защиты от дубликатов
        const exists = await get('SELECT id FROM versions WHERE relative_path = ? AND content = ?', [relPath, ver.content]);
        if (!exists) {
          await run(
            'INSERT INTO versions (relative_path, content, author_name, created_at) VALUES (?, ?, ?, ?)',
            [relPath, ver.content, ver.author_name, ver.created_at]
          );
        }
      }
    } else {
      // Если версий не было, создаем начальную версию с текущим восстановленным контентом
      await run(
        'INSERT INTO versions (relative_path, content, author_name) VALUES (?, ?, ?)',
        [relPath, content || '', 'Восстановлено из корзины']
      );
    }

    // 6. Удаляем запись из корзины
    await run('DELETE FROM trash WHERE id = ?', [trashId]);
    console.log(`[Trash] Note fully restored from trash: ${relPath}`);

    return { success: true, relative_path: relPath };
  } catch (err) {
    console.error(`[Trash] Error restoring note ID ${trashId}:`, err);
    throw err;
  }
}

/**
 * Окончательное удаление из корзины
 * @param {number} trashId 
 */
export async function purgeFromTrash(trashId) {
  await run('DELETE FROM trash WHERE id = ?', [trashId]);
  console.log(`[Trash] Purged item ID ${trashId} from trash`);
}

/**
 * Очистить всю корзину
 */
export async function clearTrash() {
  await run('DELETE FROM trash');
  console.log('[Trash] Purged all items from trash');
}

/**
 * Получить список удаленных файлов
 */
export async function getTrashList() {
  return await all('SELECT id, relative_path, title, deleted_at, deleted_by FROM trash ORDER BY deleted_at DESC');
}
