/**
 * @module templates
 * Utility functions for user template generation and metadata initialization.
 */

import fs from 'fs';
import { join } from 'path';
import { run, get } from './db.js';
import { vaultPath } from './watcher.js';

/**
 * Automatically creates Templates/<username>/ folder and pre-populates it
 * with default markdown templates based on default system language if they do not exist.
 *
 * @param username - The username of the user.
 * @returns A promise that resolves when initialization is complete.
 */
export async function initializeUserTemplates(username) {
  console.log(`[Templates Init] initializeUserTemplates called for user: "${username}"`);
  if (!username) {
    console.log(`[Templates Init] Username is empty, skipping`);
    return;
  }
  try {
    // 1. Ensure global Templates directory exists on disk and in DB
    const globalTemplatesDir = join(vaultPath, 'Templates');
    if (!fs.existsSync(globalTemplatesDir)) {
      fs.mkdirSync(globalTemplatesDir, { recursive: true });
    }
    // Check and insert Templates dir into DB
    const existingTemplatesDir = await get('SELECT relative_path FROM notes WHERE relative_path = ?', ['Templates']);
    if (!existingTemplatesDir) {
      await run(
        'INSERT OR IGNORE INTO notes (relative_path, title, is_directory, parent_path, last_edited_by, created_by) VALUES (?, ?, ?, ?, ?, ?)',
        ['Templates', 'Templates', 1, '', 'Внешняя система', 'Внешняя система']
      );
    }

    // 2. Ensure user-specific Templates directory exists on disk and in DB
    const userTemplatesDir = join(vaultPath, 'Templates', username);
    const userTemplatesRelPath = `Templates/${username}`;
    if (!fs.existsSync(userTemplatesDir)) {
      fs.mkdirSync(userTemplatesDir, { recursive: true });
    }

    // Always ensure user-specific Templates folder exists in DB
    const existingUserTemplatesDir = await get('SELECT relative_path FROM notes WHERE relative_path = ?', [userTemplatesRelPath]);
    if (!existingUserTemplatesDir) {
      await run(
        'INSERT OR IGNORE INTO notes (relative_path, title, is_directory, parent_path, last_edited_by, created_by) VALUES (?, ?, ?, ?, ?, ?)',
        [userTemplatesRelPath, username, 1, 'Templates', 'Внешняя система', 'Внешняя система']
      );
    }

    // 3. Fetch default system language (user_id = 0)
    let lang = 'ru';
    const langSetting = await get("SELECT value FROM user_settings WHERE user_id = 0 AND key = 'language'");
    if (langSetting && langSetting.value) {
      lang = langSetting.value;
    }
    console.log(`[Templates Init] System language is: "${lang}". Generating templates...`);

    const defaultTemplatesRu = [
      {
        name: 'Ежедневная заметка.md',
        content: `# Ежедневная заметка: {{date}}\n\n## 🎯 Главные цели на сегодня\n- [ ] Первая цель на сегодня (замените на свою цель)\n- [x] Пример выполненной сегодня цели\n\n## 📝 Заметки и мысли\n\n\n## 📅 События и задачи\n- \n\n## ☕ Итоги дня\n- `
      },
      {
        name: 'Протокол встречи.md',
        content: `# Встреча: {{title}} ({{date}})\n\n**Дата:** {{date}} {{time}}\n**Автор встречи:** {{author}}\n**Папка встречи:** {{folder}}\n\n## 👥 Участники\n- \n\n## 🎯 Повестка встречи\n- \n\n## 📝 Основное обсуждение\n- \n\n## ⚡ Задачи к исполнению (Action Items)\n- [ ] Предстоящая задача (замените или добавьте свою задачу)\n- [x] Пример выполненной задачи`
      },
      {
        name: 'Конспект книги.md',
        content: `# Саммари книги: {{title}}\n\n**Автор книги:** \n**Дата прочтения:** {{date}}\n**Моя оценка:** ⭐⭐⭐⭐⭐\n\n## 📌 Краткое описание книги\n- \n\n## 🔑 Ключевые идеи и инсайты\n- \n\n## 🚀 Практическое применение и шаги\n- [ ] Новое действие к внедрению\n- [x] Пример успешно внедренного инсайта`
      },
      {
        name: 'План проекта.md',
        content: `# Проект: {{title}}\n\n**Дата начала:** {{date}}\n**Руководитель проекта:** {{author}}\n\n## 📌 Описание и концепция проекта\n\n\n## 🎯 Ключевые цели и результаты (OKR)\n- [ ] Сформулировать ключевые метрики\n- [x] Пример закрытого ключевого результата\n\n## 📅 Основные вехи и этапы (Milestones)\n- [x] Этап 1: Подготовка и ТЗ\n- [ ] Этап 2: Разработка и тестирование\n- [ ] Этап 3: Запуск и релиз`
      }
    ];

    const defaultTemplatesEn = [
      {
        name: 'Daily Note.md',
        content: `# Daily Note: {{date}}\n\n## 🎯 Main Goals for Today\n- [ ] First goal for today (replace with your goal)\n- [x] Example of completed goal today\n\n## 📝 Notes and Thoughts\n\n\n## 📅 Events and Tasks\n- \n\n## ☕ Summary of the Day\n- `
      },
      {
        name: 'Meeting Notes.md',
        content: `# Meeting: {{title}} ({{date}})\n\n**Date:** {{date}} {{time}}\n**Organizer:** {{author}}\n**Folder:** {{folder}}\n\n## 👥 Attendees\n- \n\n## 🎯 Agenda\n- \n\n## 📝 Discussion\n- \n\n## ⚡ Action Items\n- [ ] Pending task (replace or add your task)\n- [x] Example of completed task`
      },
      {
        name: 'Book Summary.md',
        content: `# Book Summary: {{title}}\n\n**Book Author:** \n**Date Read:** {{date}}\n**My Rating:** ⭐⭐⭐⭐⭐\n\n## 📌 Brief Description\n- \n\n## 🔑 Key Ideas and Insights\n- \n\n## 🚀 Actionable Takeaways and Steps\n- [ ] New action item to implement\n- [x] Example of successfully implemented insight`
      },
      {
        name: 'Project Plan.md',
        content: `# Project: {{title}}\n\n**Start Date:** {{date}}\n**Project Lead:** {{author}}\n\n## 📌 Project Description and Concept\n\n\n## 🎯 Objectives and Key Results (OKRs)\n- [ ] Define key project metrics\n- [x] Example of closed key result\n\n## 📅 Milestones and Stages\n- [x] Stage 1: Preparation and Specs\n- [ ] Stage 2: Development and Testing\n- [ ] Stage 3: Launch and Release`
      }
    ];

    const defaultTemplates = lang === 'en' ? defaultTemplatesEn : defaultTemplatesRu;

    for (const t of defaultTemplates) {
      const filePath = join(userTemplatesDir, t.name);
      const fileRelPath = `${userTemplatesRelPath}/${t.name}`;
      const title = t.name.replace(/\.md$/, '');

      // Check if file exists on disk
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, t.content, 'utf8');
        console.log(`[Templates Init] Wrote file: "${filePath}"`);
      }

      // Check and insert file metadata into DB
      const existingFile = await get('SELECT relative_path FROM notes WHERE relative_path = ?', [fileRelPath]);
      if (!existingFile) {
        await run(
          'INSERT OR IGNORE INTO notes (relative_path, title, is_directory, parent_path, last_edited_by, created_by) VALUES (?, ?, ?, ?, ?, ?)',
          [fileRelPath, title, 0, userTemplatesRelPath, 'Внешняя система', 'Внешняя система']
        );
        await run(
          'INSERT OR IGNORE INTO versions (relative_path, content, author_name) VALUES (?, ?, ?)',
          [fileRelPath, t.content, 'Внешняя система']
        );
        console.log(`[Templates Init] Inserted template file metadata to DB: ${fileRelPath}`);
      }
    }
    console.log(`[Templates Init] Initialized default templates for user ${username}`);
  } catch (err) {
    console.error(`[Templates Init] Failed to initialize templates for user ${username}:`, err);
  }
}
