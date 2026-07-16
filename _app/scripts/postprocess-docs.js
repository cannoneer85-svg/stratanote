const fs = require('fs');
const path = require('path');

const DOCS_ROOT = path.join(__dirname, '../../docs');
const API_REF_DIR = path.join(DOCS_ROOT, 'api-reference');

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
      
      // Получаем относительный путь к папке текущего файла от корня docs/
      const relativeFilePath = path.relative(DOCS_ROOT, filePath);
      const relativeFileDir = path.dirname(relativeFilePath); // например: api-reference/components/Editor/variables

      // Регулярное выражение для поиска всех markdown ссылок: [текст](ссылка)
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
      
      if (content !== updatedContent) {
        fs.writeFileSync(filePath, updatedContent, 'utf8');
        processedCount++;
      }
    }
  });
  console.log(`[Post-Process Docs] Successfully converted links in ${processedCount} files to root-absolute paths.`);
} else {
  console.error('[Post-Process Docs] Error: Directory does not exist:', API_REF_DIR);
  process.exit(1);
}
