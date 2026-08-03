import express from 'express';
import { run, get, all } from '../db.js';
import { authenticateJWT } from './auth.js';

const router = express.Router();
router.use(authenticateJWT);

// GET /reads — get all read/dismissed notification IDs for the current user
router.get('/reads', async (req, res) => {
  try {
    const rows = await all(
      'SELECT notification_type, notification_id, is_read, is_dismissed FROM notification_reads WHERE user_id = ?',
      [req.user.id]
    );
    res.json({ reads: rows });
  } catch (err) {
    console.error('[Notifications] Error fetching reads:', err);
    res.status(500).json({ error: 'Failed to fetch notification reads' });
  }
});

// POST /read — mark a single notification as read
router.post('/read', async (req, res) => {
  try {
    const { notification_type, notification_id } = req.body;
    if (!notification_type || notification_id == null) {
      return res.status(400).json({ error: 'notification_type and notification_id are required' });
    }
    await run(
      `INSERT INTO notification_reads (user_id, notification_type, notification_id, is_read, read_at)
       VALUES (?, ?, ?, 1, datetime('now'))
       ON CONFLICT(user_id, notification_type, notification_id)
       DO UPDATE SET is_read = 1, read_at = datetime('now')`,
      [req.user.id, notification_type, notification_id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[Notifications] Error marking as read:', err);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// POST /read-all — mark multiple notifications as read
router.post('/read-all', async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'items array is required' });
    }
    for (const item of items) {
      await run(
        `INSERT INTO notification_reads (user_id, notification_type, notification_id, is_read, read_at)
         VALUES (?, ?, ?, 1, datetime('now'))
         ON CONFLICT(user_id, notification_type, notification_id)
         DO UPDATE SET is_read = 1, read_at = datetime('now')`,
        [req.user.id, item.type, item.id]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[Notifications] Error marking all as read:', err);
    res.status(500).json({ error: 'Failed to mark notifications as read' });
  }
});

// POST /dismiss — dismiss (hide) a single notification
router.post('/dismiss', async (req, res) => {
  try {
    const { notification_type, notification_id } = req.body;
    if (!notification_type || notification_id == null) {
      return res.status(400).json({ error: 'notification_type and notification_id are required' });
    }
    await run(
      `INSERT INTO notification_reads (user_id, notification_type, notification_id, is_read, is_dismissed, read_at)
       VALUES (?, ?, ?, 1, 1, datetime('now'))
       ON CONFLICT(user_id, notification_type, notification_id)
       DO UPDATE SET is_read = 1, is_dismissed = 1, read_at = datetime('now')`,
      [req.user.id, notification_type, notification_id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[Notifications] Error dismissing notification:', err);
    res.status(500).json({ error: 'Failed to dismiss notification' });
  }
});

// POST /dismiss-all — dismiss multiple notifications
router.post('/dismiss-all', async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'items array is required' });
    }
    for (const item of items) {
      await run(
        `INSERT INTO notification_reads (user_id, notification_type, notification_id, is_read, is_dismissed, read_at)
         VALUES (?, ?, ?, 1, 1, datetime('now'))
         ON CONFLICT(user_id, notification_type, notification_id)
         DO UPDATE SET is_read = 1, is_dismissed = 1, read_at = datetime('now')`,
        [req.user.id, item.type, item.id]
      );
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[Notifications] Error dismissing all:', err);
    res.status(500).json({ error: 'Failed to dismiss notifications' });
  }
});

export default router;
