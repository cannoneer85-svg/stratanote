import express from 'express';
import { run, get, all } from '../db.js';
import { authenticateJWT, checkTemplateAccess } from './auth.js';

const router = express.Router();

// All comment routes require authentication
router.use(authenticateJWT);

// GET /pending/all — all comments for bell notifications
// Shows: approved comments for everyone, plus pending comments authored by the current user
router.get('/pending/all', async (req, res) => {
  try {
    const comments = await all(`
      SELECT c.*, n.title AS note_title
      FROM comments c
      JOIN notes n ON c.relative_path = n.relative_path
      WHERE c.status = 'open'
        AND (c.approved = 1 OR c.author_id = ? OR ? = 'Admin')
      ORDER BY c.created_at DESC
      LIMIT 50
    `, [req.user.id, req.user.role]);
    res.json(comments);
  } catch (err) {
    console.error('[Comments] Error fetching pending comments:', err);
    res.status(500).json({ error: 'Failed to fetch pending comments' });
  }
});

// GET /for/* — all comments for a specific document
// Visibility rules:
//   - Admin sees all
//   - Document owner sees all
//   - Others see only approved comments + their own pending comments
router.get('/for/*', async (req, res) => {
  const relativePath = req.params[0];
  if (!relativePath) {
    return res.status(400).json({ error: 'relative_path is required' });
  }

  if (!checkTemplateAccess(relativePath, req.user)) {
    return res.status(403).json({ error: "Access denied to another user's templates" });
  }

  try {
    const note = await get('SELECT created_by FROM notes WHERE relative_path = ?', [relativePath]);
    const isOwnerOrAdmin = req.user.role === 'Admin' || (note && note.created_by === req.user.username);

    let comments;
    if (isOwnerOrAdmin) {
      // Owner and Admin see ALL comments (including pending)
      comments = await all(
        'SELECT * FROM comments WHERE relative_path = ? ORDER BY created_at ASC',
        [relativePath]
      );
    } else {
      // Others see only approved comments + their own pending comments
      comments = await all(
        `SELECT * FROM comments WHERE relative_path = ? 
         AND (approved = 1 OR author_id = ?)
         ORDER BY created_at ASC`,
        [relativePath, req.user.id]
      );
    }
    res.json(comments);
  } catch (err) {
    console.error(`[Comments] Error fetching comments for ${relativePath}:`, err);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

// POST / — create a new comment
router.post('/', async (req, res) => {
  const { relative_path, content, quoted_text, parent_id } = req.body;

  if (!relative_path || !content) {
    return res.status(400).json({ error: 'relative_path and content are required' });
  }

  if (!checkTemplateAccess(relative_path, req.user)) {
    return res.status(403).json({ error: "Access denied to another user's templates" });
  }

  try {
    // Auto-approve if the author is the document owner or Admin
    const note = await get('SELECT created_by FROM notes WHERE relative_path = ?', [relative_path]);
    const autoApprove = req.user.role === 'Admin' || (note && note.created_by === req.user.username) ? 1 : 0;

    const result = await run(
      `INSERT INTO comments (relative_path, parent_id, author_id, author_name, content, quoted_text, approved)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [relative_path, parent_id || null, req.user.id, req.user.username, content, quoted_text || null, autoApprove]
    );

    // If it is a reply, automatically reopen the parent comment if it was resolved
    if (parent_id) {
      const parent = await get('SELECT status FROM comments WHERE id = ?', [parent_id]);
      if (parent && parent.status === 'resolved') {
        await run(
          `UPDATE comments SET status = 'open', resolved_by = NULL, updated_at = datetime('now') WHERE id = ?`,
          [parent_id]
        );
        await run(
          `DELETE FROM notification_reads WHERE notification_type = 'comment' AND notification_id = ?`,
          [parent_id]
        );
      }
    }

    const comment = await get('SELECT * FROM comments WHERE id = ?', [result.id]);

    const io = req.app.get('io');
    io.emit('comment:created', { relative_path, comment });

    res.status(201).json(comment);
  } catch (err) {
    console.error('[Comments] Error creating comment:', err);
    res.status(500).json({ error: 'Failed to create comment' });
  }
});

// PUT /:id/approve — approve a pending comment
router.put('/:id/approve', async (req, res) => {
  const { id } = req.params;

  try {
    const comment = await get('SELECT * FROM comments WHERE id = ?', [id]);
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    const note = await get('SELECT created_by FROM notes WHERE relative_path = ?', [comment.relative_path]);
    if (!note) {
      return res.status(404).json({ error: 'Associated note not found' });
    }

    // Only the note creator or an Admin can approve comments
    if (req.user.username !== note.created_by && req.user.role !== 'Admin') {
      return res.status(403).json({ error: 'Only the note creator or an Admin can approve comments' });
    }

    await run(
      `UPDATE comments SET approved = 1, updated_at = datetime('now') WHERE id = ?`,
      [id]
    );

    await run('DELETE FROM notification_reads WHERE notification_type = \'comment\' AND notification_id = ?', [id]);

    const io = req.app.get('io');
    io.emit('comment:approved', { relative_path: comment.relative_path, commentId: Number(id) });

    res.json({ message: 'Comment approved' });
  } catch (err) {
    console.error(`[Comments] Error approving comment ${id}:`, err);
    res.status(500).json({ error: 'Failed to approve comment' });
  }
});

// PUT /:id/resolve — resolve a comment
router.put('/:id/resolve', async (req, res) => {
  const { id } = req.params;

  try {
    const comment = await get('SELECT * FROM comments WHERE id = ?', [id]);
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    const note = await get('SELECT created_by FROM notes WHERE relative_path = ?', [comment.relative_path]);
    if (!note) {
      return res.status(404).json({ error: 'Associated note not found' });
    }

    // Only the note creator or an Admin can resolve comments
    if (req.user.username !== note.created_by && req.user.role !== 'Admin') {
      return res.status(403).json({ error: 'Only the note creator or an Admin can resolve comments' });
    }

    await run(
      `UPDATE comments SET status = 'resolved', resolved_by = ?, updated_at = datetime('now') WHERE id = ? OR parent_id = ?`,
      [req.user.username, id, id]
    );

    const io = req.app.get('io');
    io.emit('comment:resolved', { relative_path: comment.relative_path, commentId: Number(id) });

    res.json({ message: 'Comment resolved' });
  } catch (err) {
    console.error(`[Comments] Error resolving comment ${id}:`, err);
    res.status(500).json({ error: 'Failed to resolve comment' });
  }
});

// DELETE /:id — delete a comment
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const comment = await get('SELECT * FROM comments WHERE id = ?', [id]);
    if (!comment) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    // Only the comment author or an Admin can delete
    if (req.user.id !== comment.author_id && req.user.role !== 'Admin') {
      return res.status(403).json({ error: 'Only the comment author or an Admin can delete this comment' });
    }

    await run('DELETE FROM comments WHERE id = ?', [id]);

    const io = req.app.get('io');
    io.emit('comment:deleted', { relative_path: comment.relative_path, commentId: Number(id) });

    res.json({ message: 'Comment deleted' });
  } catch (err) {
    console.error(`[Comments] Error deleting comment ${id}:`, err);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

export default router;
