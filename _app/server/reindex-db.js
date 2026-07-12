import fs from 'fs';
import { join } from 'path';
import { run, get, all, initDb } from './db.js';
import { getEmbedding } from './embeddings.js';
import crypto from 'crypto';
import { vaultPath } from './watcher.js';
import { fileURLToPath } from 'url';

export async function reindexDatabase(force = false, onProgress = null) {
  await initDb();

  const notesList = await all('SELECT relative_path FROM notes WHERE is_directory = 0');
  const total = notesList.length;

  let successCount = 0;
  let skipCount = 0;
  
  for (let i = 0; i < total; i++) {
    const note = notesList[i];
    const absolutePath = join(vaultPath, note.relative_path);
    if (!fs.existsSync(absolutePath)) {
      if (onProgress) onProgress(i + 1, total, note.relative_path, 'skip');
      continue;
    }

    const content = fs.readFileSync(absolutePath, 'utf8');
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');

    const existing = await get('SELECT content_hash FROM note_embeddings WHERE relative_path = ?', [note.relative_path]);
    if (!force && existing && existing.content_hash === contentHash) {
      skipCount++;
      if (onProgress) onProgress(i + 1, total, note.relative_path, 'up-to-date');
      continue;
    }

    const embedding = await getEmbedding(content, note.relative_path);
    await run(`
      INSERT INTO note_embeddings (relative_path, embedding, content_hash)
      VALUES (?, ?, ?)
      ON CONFLICT(relative_path) DO UPDATE SET
        embedding = excluded.embedding,
        content_hash = excluded.content_hash
    `, [note.relative_path, JSON.stringify(embedding), contentHash]);
    
    successCount++;
    if (onProgress) onProgress(i + 1, total, note.relative_path, 'updated');
  }

  return { successCount, skipCount, total };
}

// CLI entry point
const nodePath = fileURLToPath(import.meta.url);
const runDirectly = process.argv[1] && (process.argv[1].endsWith('reindex-db.js') || process.argv[1] === nodePath);

if (runDirectly) {
  console.log('[Embeddings Reindex] Starting CLI reindex...');
  const force = process.argv.includes('--force');
  reindexDatabase(force, (current, total, file, status) => {
    if (status === 'updated') {
      console.log(`[Embeddings Reindex] [${current}/${total}] Calculating embedding for: ${file}...`);
    }
  }).then(result => {
    console.log(`\n[Embeddings Reindex] Completed!`);
    console.log(`- Updated/Created: ${result.successCount}`);
    console.log(`- Already up to date: ${result.skipCount}`);
    process.exit(0);
  }).catch(err => {
    console.error('[Embeddings Reindex] Critical error occurred:', err);
    process.exit(1);
  });
}
