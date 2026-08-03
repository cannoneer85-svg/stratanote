const fs = require('fs');
const path = require('path');

const DOCS_ROOT = path.join(__dirname, '../../docs');
const API_REF_DIR = path.join(DOCS_ROOT, 'api-reference');

const MODULE_DESCRIPTIONS = {
  'api-reference/App/index.md': {
    title: 'App Module',
    sidebarName: 'App',
    desc: 'Root container module for the StrataNote application. Orchestrates user authentication, WebSockets, navigation routing, locks broadcast, and dialogs.'
  },
  'api-reference/main/index.md': {
    title: 'Main Entry Point Module',
    sidebarName: 'main',
    desc: 'Client application entry point module. Mounts the React component tree inside the HTML root element.'
  },
  'api-reference/components/AboutModal/index.md': {
    title: 'AboutModal Module',
    sidebarName: 'AboutModal',
    desc: 'Diagnostic about modal module showing current build tags, license info, and update history details.'
  },
  'api-reference/components/Auth/index.md': {
    title: 'Auth Module',
    sidebarName: 'Auth',
    desc: 'Authentication and signup module handling forms submission and sessions checking.'
  },
  'api-reference/components/CommentsPanel/index.md': {
    title: 'CommentsPanel Module',
    sidebarName: 'CommentsPanel',
    desc: 'Comments side popover manager module handling replies, quotes, and approvals.'
  },
  'api-reference/components/DiffViewer/index.md': {
    title: 'DiffViewer Module',
    sidebarName: 'DiffViewer',
    desc: 'Note versions diff visual comparison module highlighting added/removed lines.'
  },
  'api-reference/components/Editor/index.md': {
    title: 'Editor Module',
    sidebarName: 'Editor',
    desc: 'Markdown visual editor module powered by CodeMirror 6 with custom syntax plugins and scroll sync.'
  },
  'api-reference/components/ExportModal/index.md': {
    title: 'ExportModal Module',
    sidebarName: 'ExportModal',
    desc: 'Workspace backups exporter wizard module preparing zip archives.'
  },
  'api-reference/components/GraphView/index.md': {
    title: 'GraphView Module',
    sidebarName: 'GraphView',
    desc: 'D3.js force connections 2D canvas visualization module.'
  },
  'api-reference/components/SearchModal/index.md': {
    title: 'SearchModal Module',
    sidebarName: 'SearchModal',
    desc: 'Unified full-text FTS5, conceptual semantic AI and title search overlay component module.'
  },
  'api-reference/components/SettingsPanel/index.md': {
    title: 'SettingsPanel Module',
    sidebarName: 'SettingsPanel',
    desc: 'Bilingual administration dashboards module covering registrations, trash, and MCP local sync configurations.'
  },
  'api-reference/components/Sidebar/index.md': {
    title: 'Sidebar Module',
    sidebarName: 'Sidebar',
    desc: 'Folders navigation tree explorer sidebar module containing workspace tools.'
  },
  'api-reference/utils/date/index.md': {
    title: 'Date Utilities Module',
    sidebarName: 'date',
    desc: 'Bilingual date formatting utilities mapping standard database UTC timestamps to Moscow timezone strings.'
  },
  'api-reference/utils/translations/index.md': {
    title: 'Translations Utilities Module',
    sidebarName: 'translations',
    desc: 'Bilingual dictionaries and translations module enabling on-the-fly English/Russian switches.'
  }
};

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    if (isDirectory) {
      walkDir(dirPath, callback);
    } else {
      callback(dirPath);
    }
  });
}

console.log('[Post-Process Docs] Scanning files in:', API_REF_DIR);

let processedCount = 0;

if (fs.existsSync(API_REF_DIR)) {
  walkDir(API_REF_DIR, (filePath) => {
    if (filePath.endsWith('.md') || filePath.endsWith('.mdx')) {
      let content = fs.readFileSync(filePath, 'utf8');
      
      const relativeFilePath = path.relative(DOCS_ROOT, filePath);

      // 1. Инжектируем описания и frontmatter (sidebarTitle) в индексные файлы модулей
      const normalizedPath = relativeFilePath.replace(/\\/g, '/');
      if (MODULE_DESCRIPTIONS[normalizedPath]) {
        const info = MODULE_DESCRIPTIONS[normalizedPath];
        const frontmatterBlock = `---\ntitle: "${info.title}"\nsidebarTitle: "${info.sidebarName}"\n---\n\n`;
        const descriptionBlock = `# ${info.title}\n\n${info.desc}\n\n***`;
        
        if (!content.includes('sidebarTitle:')) {
          content = frontmatterBlock + content.replace('***', descriptionBlock);
        }
      }

      const relativeFileDir = path.dirname(relativeFilePath); // например: api-reference/components/Editor/variables

      // 2. Регулярное выражение для поиска всех markdown ссылок: [текст](ссылка)
      // Нам нужны только относительные ссылки (не http, не https, не начинающиеся со /)
      const updatedContent = content.replace(/\]\(((?!https?:|\/)[^)]+)\)/g, (match, url) => {
        // Разделяем путь и якорь (если есть)
        const [urlPath, anchor] = url.split('#');
        
        // Убираем .md в конце пути, если он есть
        let cleanPath = urlPath;
        if (cleanPath.endsWith('.md')) {
          cleanPath = cleanPath.slice(0, -3);
        }
        
        // Превращаем относительный путь в абсолютный от корня docs/
        let absoluteTarget = path.join(relativeFileDir, cleanPath);
        
        // Заменяем виндовые бэкслеши на форвард-слеши для веба
        absoluteTarget = absoluteTarget.replace(/\\/g, '/');
        
        // Добавляем начальный слэш, чтобы ссылка стала абсолютной для Mintlify
        let finalUrl = '/' + absoluteTarget;
        if (anchor) {
          finalUrl += '#' + anchor;
        }
        
        return `](${finalUrl})`;
      });

      let finalContent = updatedContent;

      // 3. Замена хлебных крошек stratanote-client на API Reference с добавлением родительского модуля для детальных страниц
      let parentModuleName = null;
      let parentModulePath = null;
      const parts = relativeFilePath.replace(/\\/g, '/').split('/');
      if (parts.length >= 4) {
        const typeIndex = parts.findIndex(p => ['variables', 'functions', 'interfaces', 'type-aliases', 'classes'].includes(p));
        if (typeIndex > 0) {
          const moduleParts = parts.slice(0, typeIndex);
          parentModulePath = moduleParts.join('/') + '/index.md';
          parentModuleName = moduleParts.slice(1).join('/');
        }
      }

      if (parentModulePath) {
        const info = MODULE_DESCRIPTIONS[parentModulePath];
        const displayName = info ? info.sidebarName : parentModuleName;
        const rootUrl = '/api-reference/index';
        const parentUrl = '/' + parentModulePath.replace(/\.md$/, '');
        const customBreadcrumb = `[**API Reference**](${rootUrl}) / [**${displayName}**](${parentUrl})`;
        finalContent = finalContent.replace(/\[\*\*stratanote-client\*\*\]\(\/api-reference\/index\)/g, customBreadcrumb);
      } else {
        finalContent = finalContent.replace(/\[\*\*stratanote-client\*\*\]\(\/api-reference\/index\)/g, `[**API Reference**](/api-reference/index)`);
      }
      
      if (content !== finalContent) {
        fs.writeFileSync(filePath, finalContent, 'utf8');
        processedCount++;
      }
    }
  });
  console.log(`[Post-Process Docs] Successfully converted links in ${processedCount} files to root-absolute paths.`);

  // Динамически сканируем и собираем список сгенерированных модулей
  const foundModules = [];
  
  function scanModules(dir) {
    fs.readdirSync(dir).forEach(f => {
      const fullPath = path.join(dir, f);
      if (fs.statSync(fullPath).isDirectory()) {
        const indexFile = path.join(fullPath, 'index.md');
        if (fs.existsSync(indexFile)) {
          let modName = path.relative(API_REF_DIR, fullPath).replace(/\\/g, '/');
          foundModules.push({
            name: modName,
            indexPath: '/api-reference/' + modName + '/index'
          });
        }
        scanModules(fullPath);
      }
    });
  }
  
  scanModules(API_REF_DIR);

  // Сортируем модули по категориям
  const coreModules = [];
  const reactComponents = [];
  const utilities = [];
  const otherModules = [];

  foundModules.forEach(mod => {
    const key = `api-reference/${mod.name}/index.md`;
    const info = MODULE_DESCRIPTIONS[key] || {
      title: mod.name + ' Module',
      desc: `Technical API reference for ${mod.name} module.`
    };
    
    const markdownLine = `* **[${mod.name}](/api-reference/${mod.name}/index)** — ${info.desc}`;

    if (mod.name === 'App' || mod.name === 'main') {
      coreModules.push(markdownLine);
    } else if (mod.name.startsWith('components/')) {
      reactComponents.push(markdownLine);
    } else if (mod.name.startsWith('utils/')) {
      utilities.push(markdownLine);
    } else {
      otherModules.push(markdownLine);
    }
  });

  // Формируем контент для docs/api-reference/index.md (убран дублирующий заголовок # API Reference Index)
  let indexContent = `---
title: "API Reference Index"
sidebarTitle: "API Index"
description: "Technical API reference documentation for the StrataNote client-side modules, core React components, and utility functions."
---

Welcome to the technical API reference index for the **StrataNote** client. This section contains automatically generated documentation extracted from the codebase's JSDoc/TSDoc type signatures and documentation comments.

---
`;

  if (coreModules.length > 0) {
    indexContent += `\n## Core Application Components\n\n` + coreModules.join('\n') + `\n\n---`;
  }
  if (reactComponents.length > 0) {
    indexContent += `\n## React Interface Components\n\n` + reactComponents.join('\n') + `\n\n---`;
  }
  if (utilities.length > 0) {
    indexContent += `\n## System Utilities & Core Functions\n\n` + utilities.join('\n') + `\n`;
  }
  if (otherModules.length > 0) {
    indexContent += `\n---\n\n## Other Modules\n\n` + otherModules.join('\n') + `\n`;
  }

  const indexMdPath = path.join(API_REF_DIR, 'index.md');
  fs.writeFileSync(indexMdPath, indexContent, 'utf8');
  console.log('[Post-Process Docs] Successfully dynamically regenerated api-reference/index.md.');
} else {
  console.error('[Post-Process Docs] Error: Directory does not exist:', API_REF_DIR);
  process.exit(1);
}
