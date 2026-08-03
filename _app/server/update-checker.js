import fs from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..', '..');

// Helper to load GITHUB_TOKEN from env files
function loadEnvToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  const paths = [
    join(rootDir, '.env'),
    join(rootDir, '_app', '.env'),
    join(rootDir, '_app', 'server', '.env')
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

// Simple SemVer comparison helper
export function parseSemVer(v) {
  if (!v) return { major: 0, minor: 0, patch: 0 };
  const clean = v.replace(/^v/, '');
  const [major, minor, patch] = clean.split('.').map(x => parseInt(x, 10) || 0);
  return { major, minor, patch };
}

export function isNewerVersion(current, latest) {
  const c = parseSemVer(current);
  const l = parseSemVer(latest);
  if (l.major > c.major) return true;
  if (l.major < c.major) return false;
  if (l.minor > c.minor) return true;
  if (l.minor < c.minor) return false;
  return l.patch > c.patch;
}

// Memory cache for GitHub update checks
let updateCache = {
  checkedAt: 0,
  latestVersion: null,
  updateAvailable: false,
  latestReleaseUrl: null,
  error: null
};

// Check for updates
export function checkGitHubUpdate(currentVersion, force = false) {
  return new Promise((resolve) => {
    const CACHE_DURATION = 3600000; // 1 hour in ms
    const now = Date.now();

    if (!force && (now - updateCache.checkedAt < CACHE_DURATION) && updateCache.checkedAt > 0) {
      // Return cached version details
      return resolve({
        updateAvailable: updateCache.updateAvailable,
        latestVersion: updateCache.latestVersion,
        latestReleaseUrl: updateCache.latestReleaseUrl,
        checkedAt: updateCache.checkedAt,
        error: updateCache.error
      });
    }

    const token = loadEnvToken();
    const repoPath = 'cannoneer85-svg/stratanote';

    const options = {
      hostname: 'api.github.com',
      port: 443,
      path: `/repos/${repoPath}/releases/latest`,
      method: 'GET',
      headers: {
        'User-Agent': 'StrataNote-Update-Checker',
        'Accept': 'application/vnd.github.v3+json'
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const release = JSON.parse(data);
            const latestTag = release.tag_name; // e.g. "v1.11.2"
            const cleanLatest = latestTag.replace(/^v/, '');
            const cleanCurrent = currentVersion.replace(/^v/, '');
            
            const updateAvailable = isNewerVersion(cleanCurrent, cleanLatest);

            updateCache = {
              checkedAt: Date.now(),
              latestVersion: cleanLatest,
              updateAvailable,
              latestReleaseUrl: release.html_url || `https://github.com/cannoneer85-svg/stratanote/releases/tag/${latestTag}`,
              error: null
            };

            resolve({
              updateAvailable: updateCache.updateAvailable,
              latestVersion: updateCache.latestVersion,
              latestReleaseUrl: updateCache.latestReleaseUrl,
              checkedAt: updateCache.checkedAt,
              error: null
            });
          } catch (err) {
            console.error('[Update Checker] Failed to parse GitHub API response:', err);
            updateCache.error = 'Failed to parse update info';
            resolve({ ...updateCache, error: updateCache.error });
          }
        } else {
          console.warn(`[Update Checker] GitHub API returned status ${res.statusCode}`);
          updateCache.error = `GitHub API returned status ${res.statusCode}`;
          // If we had a successful check earlier, keep it but mark error
          resolve({ ...updateCache, error: updateCache.error });
        }
      });
    });

    req.on('error', (err) => {
      console.error('[Update Checker] Error requesting update info from GitHub:', err);
      updateCache.error = err.message || 'Network error';
      resolve({ ...updateCache, error: updateCache.error });
    });

    req.end();
  });
}
