import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, 'config.json');

const DEFAULT_CONFIG = {
  STRATANOTE_SERVER_URL: process.env.STRATANOTE_SERVER_URL || 'http://localhost:3001',
  STRATANOTE_API_TOKEN: process.env.STRATANOTE_API_TOKEN || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MSwidXNlcm5hbWUiOiJhZG1pbiIsInJvbGUiOiJBZG1pbiIsImlhdCI6MTc4MzEyMjM1OCwiZXhwIjoxODE0NjU4MzU4fQ.07wYPZPQDjpb_A8k7OnA2EmFYl9x3dkJpO1xbJ0cO18',
  LOCAL_VAULT_PATH: process.env.LOCAL_VAULT_PATH || 'D:/YandexDisk/AWG/md_obsidian',
  SYNC_MODE: 'manual', // 'auto' or 'manual'
  CONFLICT_RESOLUTION: 'suggest', // 'suggest', 'local-wins', 'server-wins', 'interactive'
  POLL_INTERVAL_MS: 10000,
  EXCLUDE_PATTERNS: [
    '**/node_modules/**',
    '**/.git/**',
    '**/.obsidian/**',
    '**/_app/**',
    '**/_sync_mcp/**',
    '**/database.sqlite',
    '**/.sync_state.json',
    '**/.agents/**',
    '**/.sync_backup/**',
    '**/.DS_Store'
  ]
};

export function loadConfig() {
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8');
    return DEFAULT_CONFIG;
  }
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch (err) {
    console.error('Error loading config, using defaults:', err);
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(newConfig) {
  const current = loadConfig();
  const updated = { ...current, ...newConfig };
  fs.writeFileSync(configPath, JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}
