import express from 'express';
import { run, get, all } from '../db.js';
import { authenticateJWT } from './auth.js';

const router = express.Router();

// 1. Get history list for a note (relative_path)
router.get('/', authenticateJWT, async (req, res) => {
  const { relative_path } = req.query;
  if (!relative_path) return res.status(400).json({ error: 'relative_path is required' });

  try {
    const historyList = await all(
      'SELECT id, relative_path, author_name, created_at FROM versions WHERE relative_path = ? ORDER BY id DESC',
      [relative_path]
    );
    res.json(historyList);
  } catch (err) {
    console.error(`Error retrieving history for ${relative_path}:`, err);
    res.status(500).json({ error: 'Failed to retrieve note history' });
  }
});

// 2. Get exact content of a specific historical version
router.get('/version', authenticateJWT, async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'version id is required' });

  try {
    const version = await get('SELECT relative_path, content FROM versions WHERE id = ?', [id]);
    if (!version) {
      return res.status(404).json({ error: 'Version not found' });
    }

    // Find the previous version content of the same file
    const prevVersion = await get(
      'SELECT content FROM versions WHERE relative_path = ? AND id < ? ORDER BY id DESC LIMIT 1',
      [version.relative_path, id]
    );

    res.json({
      content: version.content,
      previousContent: prevVersion ? prevVersion.content : ''
    });
  } catch (err) {
    console.error(`Error retrieving version content for id ${id}:`, err);
    res.status(500).json({ error: 'Failed to retrieve version content' });
  }
});

export default router;
