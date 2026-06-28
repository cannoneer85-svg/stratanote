import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..', '..');

// Helper to log with prefix
const log = (msg) => console.log(`[Release Manager] ${msg}`);

// Parse arguments
const newVersion = process.argv[2];
const releaseDate = process.argv[3];
const releaseTitle = process.argv[4];
const keynotes = process.argv.slice(5);

if (!newVersion || !releaseDate || !releaseTitle) {
  console.error('Usage: node prepare-release.js <version> <date> <title> [keynote1] [keynote2] ...');
  process.exit(1);
}

// 1. Update package.json files
const packageFiles = [
  join(rootDir, 'package.json'),
  join(rootDir, '_app', 'package.json'),
  join(rootDir, '_app', 'client', 'package.json'),
  join(rootDir, '_app', 'server', 'package.json')
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
const releasesPath = join(rootDir, '_app', 'releases.json');
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
const changelogPath = join(rootDir, 'CHANGELOG.md');
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
