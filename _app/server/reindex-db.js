import fs from 'fs';
import { join } from 'path';
import { run, get, all, initDb } from './db.js';
import { getEmbedding } from './embeddings.js';
import crypto from 'crypto';
import { vaultPath } from './watcher.js';

async function reindex() {
  console.log('[Embeddings Reindex] Connecting to database...');
  // Ensure DB tables are initialized
  await initDb();

  const notesList = await all('SELECT relative_path FROM notes WHERE is_directory = 0');
  console.log(`[Embeddings Reindex] Found ${notesList.length} total notes in database.`);

  let successCount = 0;
  let skipCount = 0;
  
  for (const note of notesList) {
    const absolutePath = join(vaultPath, note.relative_path);
    if (!fs.existsSync(absolutePath)) {
      console.log(`[Embeddings Reindex] Skipping missing file on disk: ${note.relative_path}`);
      continue;
    }

    const content = fs.readFileSync(absolutePath, 'utf8');
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');

    // Check if embedding with this hash already exists
    const existing = await get('SELECT content_hash FROM note_embeddings WHERE relative_path = ?', [note.relative_path]);
    if (existing && existing.content_hash === contentHash) {
      skipCount++;
      continue;
    }

    console.log(`[Embeddings Reindex] Calculating embedding for: ${note.relative_path}...`);
    const embedding = await getEmbedding(content);
    await run(`
      INSERT INTO note_embeddings (relative_path, embedding, content_hash)
      VALUES (?, ?, ?)
      ON CONFLICT(relative_path) DO UPDATE SET
        embedding = excluded.embedding,
        content_hash = excluded.content_hash
    `, [note.relative_path, JSON.stringify(embedding), contentHash]);
    
    successCount++;
  }

  console.log(`\n[Embeddings Reindex] Completed!`);
  console.log(`- Updated/Created: ${successCount}`);
  console.log(`- Already up to date: ${skipCount}`);
  process.exit(0);
}

reindex().catch(err => {
  console.error('[Embeddings Reindex] Critical error occurred:', err);
  process.exit(1);
});
