const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const rootDir = path.join(__dirname, '..', '..');

// Helper to log with prefix
const log = (msg) => console.log(`[Release Manager] ${msg}`);

function loadEnvToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const paths = [
    path.join(rootDir, '.env'),
    path.join(rootDir, '_app', '.env'),
    path.join(rootDir, '_app', 'server', '.env')
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) {
      try {
        const content = fs.readFileSync(p, 'utf8');
        const lines = content.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('GITHUB_TOKEN=')) {
            return trimmed.substring('GITHUB_TOKEN='.length).trim().replace(/^["']|["']$/g, '');
          }
        }
      } catch (e) {
        // ignore
      }
    }
  }
  return null;
}

function getRepoPath() {
  let repoPath = 'cannoneer85-svg/stratanote';
  try {
    const remoteUrl = execSync('git remote get-url open', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
    const match = remoteUrl.match(/github\.com[/:]([^/]+)\/([^.]+)/);
    if (match) {
      repoPath = `${match[1]}/${match[2]}`;
    }
  } catch (e) {
    // If open remote doesn't exist
  }
  // Strip trailing slashes to prevent API double-slash 404s
  return repoPath.replace(/\/+$/, '');
}

function makeGithubRelease(repoPath, token, tag, title, body) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      tag_name: tag,
      name: title,
      body: body,
      draft: false,
      prerelease: false
    });

    const createRelease = () => {
      const options = {
        hostname: 'api.github.com',
        port: 443,
        path: `/repos/${repoPath}/releases`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'User-Agent': 'StrataNote-Release-Script',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 201) {
            resolve(JSON.parse(data));
          } else if (res.statusCode === 422) {
            // Already exists - fetch and update
            log(`Релиз для тега ${tag} уже существует. Обновляем описание через PATCH...`);
            getReleaseByTag().then(releaseId => {
              updateRelease(releaseId).then(resolve).catch(reject);
            }).catch(reject);
          } else {
            reject(new Error(`GitHub API returned status ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    };

    const getReleaseByTag = () => {
      return new Promise((resResolve, resReject) => {
        const options = {
          hostname: 'api.github.com',
          port: 443,
          path: `/repos/${repoPath}/releases/tags/${tag}`,
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${token}`,
            'User-Agent': 'StrataNote-Release-Script'
          }
        };

        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            if (res.statusCode === 200) {
              const release = JSON.parse(data);
              resResolve(release.id);
            } else {
              resReject(new Error(`Failed to get release by tag ${tag}: GitHub status ${res.statusCode}`));
            }
          });
        });

        req.on('error', resReject);
        req.end();
      });
    };

    const updateRelease = (releaseId) => {
      return new Promise((upResolve, upReject) => {
        const options = {
          hostname: 'api.github.com',
          port: 443,
          path: `/repos/${repoPath}/releases/${releaseId}`,
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'User-Agent': 'StrataNote-Release-Script',
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
          }
        };

        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            if (res.statusCode === 200) {
              upResolve(JSON.parse(data));
            } else {
              upReject(new Error(`Failed to update release ${releaseId}: GitHub status ${res.statusCode}`));
            }
          });
        });

        req.on('error', upReject);
        req.write(postData);
        req.end();
      });
    };

    createRelease();
  });
}

function publishRelease(version) {
  log(`Starting publication flow for version v${version}...`);
  
  const token = loadEnvToken();
  if (!token) {
    console.log('\n========================================================================');
    console.log('[Release Publisher] Предупреждение: Переменная GITHUB_TOKEN не найдена.');
    console.log('Для автоматической публикации релиза на GitHub выполните:');
    console.log('1. Создайте Personal Access Token на GitHub: https://github.com/settings/tokens');
    console.log('   (выберите область прав: "public_repo").');
    console.log('2. Добавьте в файл настроек \'.env\' (в папке \'_app/server/.env\' или в корне проекта):');
    console.log('   GITHUB_TOKEN=ghp_ваш_токен');
    console.log('========================================================================\n');
    process.exit(0);
  }

  const releasesPath = path.join(rootDir, '_app', 'releases.json');
  if (!fs.existsSync(releasesPath)) {
    console.error(`[Release Publisher] Ошибка: Файл releases.json не найден по пути: ${releasesPath}`);
    process.exit(1);
  }

  let releasesList = [];
  try {
    releasesList = JSON.parse(fs.readFileSync(releasesPath, 'utf8'));
  } catch (err) {
    console.error(`[Release Publisher] Ошибка при чтении releases.json:`, err);
    process.exit(1);
  }

  const releaseEntry = releasesList.find(r => r.version === version);
  if (!releaseEntry) {
    console.error(`[Release Publisher] Ошибка: Версия ${version} не найдена в releases.json`);
    process.exit(1);
  }

  const repoPath = getRepoPath();
  const tag = `v${version}`;

  const title_en = releaseEntry.title_en || releaseEntry.title || '';
  const title_ru = releaseEntry.title_ru || releaseEntry.title || '';
  const keynotes_en = releaseEntry.keynotes_en || releaseEntry.keynotes || [];
  const keynotes_ru = releaseEntry.keynotes_ru || [];

  const title = `v${version}: ${title_en}`;
  
  let body = `### ${title_en}\n\n`;
  if (keynotes_en.length > 0) {
    keynotes_en.forEach(note => {
      body += `- ${note}\n`;
    });
  } else {
    body += `- Release v${version}\n`;
  }

  if (title_ru || keynotes_ru.length > 0) {
    body += `\n---\n\n<details>\n<summary>🇷🇺 Описание изменений на русском языке</summary>\n\n`;
    body += `### ${title_ru}\n\n`;
    if (keynotes_ru.length > 0) {
      keynotes_ru.forEach(note => {
        body += `- ${note}\n`;
      });
    } else {
      body += `- Релиз версии v${version}\n`;
    }
    body += `\n</details>\n`;
  }

  log(`Connecting to GitHub API for repo: ${repoPath}...`);
  
  makeGithubRelease(repoPath, token, tag, title, body)
    .then((response) => {
      log(`[Release Publisher] Релиз ${tag} успешно опубликован на GitHub! URL: ${response.html_url}`);
    })
    .catch((err) => {
      console.error(`\n[Release Publisher] Ошибка при создании релиза на GitHub:`, err.message);
      process.exit(1);
    });
}

// Parse arguments
const arg2 = process.argv[2];

if (arg2 === '--publish') {
  const publishVersion = process.argv[3];
  if (!publishVersion) {
    console.error('Usage: node prepare-release.js --publish <version>');
    process.exit(1);
  }
  publishRelease(publishVersion);
} else {
  const newVersion = arg2;
  const releaseDate = process.argv[3];

  let title_en = '';
  let title_ru = '';
  let keynotes_en = [];
  let keynotes_ru = [];

  let currentFlag = null;

  for (let i = 4; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--title_en') {
      currentFlag = 'title_en';
    } else if (arg === '--title_ru') {
      currentFlag = 'title_ru';
    } else if (arg === '--keynotes_en') {
      currentFlag = 'keynotes_en';
    } else if (arg === '--keynotes_ru') {
      currentFlag = 'keynotes_ru';
    } else {
      if (currentFlag === 'title_en') {
        title_en = arg;
      } else if (currentFlag === 'title_ru') {
        title_ru = arg;
      } else if (currentFlag === 'keynotes_en') {
        keynotes_en.push(arg);
      } else if (currentFlag === 'keynotes_ru') {
        keynotes_ru.push(arg);
      }
    }
  }

  if (!newVersion || !releaseDate || !title_en || !title_ru) {
    console.error('Usage: node prepare-release.js <version> <date> --title_en <title_en> --title_ru <title_ru> [--keynotes_en <k1> <k2> ...] [--keynotes_ru <k1> <k2> ...]');
    console.error('Or for publishing: node prepare-release.js --publish <version>');
    process.exit(1);
  }

  // 1. Update package.json files
  const packageFiles = [
    path.join(rootDir, 'package.json'),
    path.join(rootDir, '_app', 'package.json'),
    path.join(rootDir, '_app', 'client', 'package.json'),
    path.join(rootDir, '_app', 'server', 'package.json')
  ];

  packageFiles.forEach(filePath => {
    if (fs.existsSync(filePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        data.version = newVersion;
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
        log(`Updated version in: ${filePath}`);
      } catch (err) {
        console.error(`Error updating version in ${filePath}:`, err);
      }
    } else {
      log(`File not found: ${filePath}`);
    }
  });

  // 2. Update releases.json on backend
  const releasesPath = path.join(rootDir, '_app', 'releases.json');
  let releasesList = [];

  if (fs.existsSync(releasesPath)) {
    try {
      releasesList = JSON.parse(fs.readFileSync(releasesPath, 'utf8'));
    } catch (err) {
      console.error(`Error parsing existing ${releasesPath}, starting fresh:`, err);
    }
  }

  // Prepend the new release to the list
  const newRelease = {
    version: newVersion,
    date: releaseDate,
    title_ru: title_ru,
    title_en: title_en,
    keynotes_ru: keynotes_ru,
    keynotes_en: keynotes_en
  };

  // Check if version already exists to update it, or prepend new
  const existingIndex = releasesList.findIndex(r => r.version === newVersion);
  if (existingIndex !== -1) {
    releasesList[existingIndex] = newRelease;
    log(`Updated existing release entry for version ${newVersion} in releases.json`);
  } else {
    releasesList.unshift(newRelease);
    log(`Added new release entry for version ${newVersion} to releases.json`);
  }

  fs.writeFileSync(releasesPath, JSON.stringify(releasesList, null, 2) + '\n', 'utf8');

  // 3. Prepend to CHANGELOG.md in root (English for changelog)
  const changelogPath = path.join(rootDir, 'CHANGELOG.md');
  let changelogContent = '';

  if (fs.existsSync(changelogPath)) {
    changelogContent = fs.readFileSync(changelogPath, 'utf8');
  }

  // Build the new markdown entry
  let newMarkdownEntry = `## [${newVersion}] - ${releaseDate}\n### ${title_en}\n\n`;
  if (keynotes_en.length > 0) {
    keynotes_en.forEach(note => {
      newMarkdownEntry += `- ${note}\n`;
    });
  } else {
    newMarkdownEntry += `- Release version v${newVersion}\n`;
  }
  newMarkdownEntry += `\n`;

  // Insert the entry after the main title if it exists, or at the top
  const headerTitle = '# Changelog\n\n';
  if (changelogContent.startsWith(headerTitle)) {
    changelogContent = headerTitle + newMarkdownEntry + changelogContent.substring(headerTitle.length);
  } else if (changelogContent.startsWith('# Changelog\n')) {
    changelogContent = '# Changelog\n\n' + newMarkdownEntry + changelogContent.substring('# Changelog\n'.length);
  } else {
    changelogContent = '# Changelog\n\n' + newMarkdownEntry + changelogContent;
  }

  fs.writeFileSync(changelogPath, changelogContent, 'utf8');
  log(`Updated CHANGELOG.md`);

  // Создаем копию CHANGELOG.md для Mintlify в папке docs (с расширением .mdx)
  const mintlifyChangelogPath = path.join(rootDir, 'docs', 'changelog.mdx');
  const frontmatter = `---\ntitle: "Changelog"\nsidebarTitle: "Changelog"\ndescription: "StrataNote project changelog and updates history"\n---\n\n`;
  
  // Убираем все заголовки # Changelog, чтобы избежать их дублирования на сайте (поддерживаем LF и CRLF)
  let cleanContent = changelogContent.replace(/# Changelog\r?\n/g, '');
  
  fs.writeFileSync(mintlifyChangelogPath, frontmatter + cleanContent, 'utf8');
  log(`Copied CHANGELOG.md to docs/changelog.md for Mintlify`);
  log(`Release ${newVersion} preparation completed successfully!`);
}
