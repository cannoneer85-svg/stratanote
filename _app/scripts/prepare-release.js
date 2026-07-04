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
        } else {
          reject(new Error(`GitHub API returned status ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (e) => {
      reject(e);
    });

    req.write(postData);
    req.end();
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
  const title = `v${version}: ${releaseEntry.title}`;
  
  let body = `### ${releaseEntry.title}\n\n`;
  if (releaseEntry.keynotes && releaseEntry.keynotes.length > 0) {
    releaseEntry.keynotes.forEach(note => {
      body += `- ${note}\n`;
    });
  } else {
    body += `- Релиз версии v${version}\n`;
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
  const releaseTitle = process.argv[4];
  const keynotes = process.argv.slice(5);

  if (!newVersion || !releaseDate || !releaseTitle) {
    console.error('Usage: node prepare-release.js <version> <date> <title> [keynote1] [keynote2] ...');
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
    title: releaseTitle,
    keynotes: keynotes
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

  // 3. Prepend to CHANGELOG.md in root
  const changelogPath = path.join(rootDir, 'CHANGELOG.md');
  let changelogContent = '';

  if (fs.existsSync(changelogPath)) {
    changelogContent = fs.readFileSync(changelogPath, 'utf8');
  }

  // Build the new markdown entry
  let newMarkdownEntry = `## [${newVersion}] - ${releaseDate}\n### ${releaseTitle}\n\n`;
  if (keynotes.length > 0) {
    keynotes.forEach(note => {
      newMarkdownEntry += `- ${note}\n`;
    });
  } else {
    newMarkdownEntry += `- Релиз версии v${newVersion}\n`;
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
  log(`Release ${newVersion} preparation completed successfully!`);
}
