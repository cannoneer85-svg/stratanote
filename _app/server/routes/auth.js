import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { run, get, all } from '../db.js';

const router = express.Router();
export const JWT_SECRET = 'stratanote-collaborative-secret-key-2026';

// Middleware to authenticate JWT
export const authenticateJWT = (req, res, next) => {
  let token = req.query.token;

  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader) {
      token = authHeader.split(' ')[1];
    }
  }

  if (!token) {
    return res.status(401).json({ error: 'Authorization token or header required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
};

// Register route
router.post('/register', async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password || !role) {
    return res.status(400).json({ error: 'Username, password and role are required' });
  }

  if (!['Admin', 'Editor', 'Viewer'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Must be Admin, Editor, or Viewer' });
  }

  // Check if request is authorized by an Admin
  let approved = 0;
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded && decoded.role === 'Admin') {
          approved = 1;
        }
      } catch (e) {
        // Invalid token, treat as self-registration
      }
    }
  }

  // Prevent registering as Admin unless it's an Admin creating the user
  if (role === 'Admin' && approved !== 1) {
    return res.status(400).json({ error: 'Регистрация в роли Администратора запрещена' });
  }

  try {
    const existingUser = await get('SELECT id FROM users WHERE username = ?', [username]);
    if (existingUser) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    const result = await run(
      'INSERT INTO users (username, password_hash, role, approved) VALUES (?, ?, ?, ?)',
      [username, passwordHash, role, approved]
    );

    res.status(201).json({ message: 'User registered successfully', userId: result.id });
  } catch (err) {
    console.error('Error during registration:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login route
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const user = await get('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (!user.approved) {
      return res.status(403).json({ error: 'Ваш аккаунт ожидает подтверждения администратором' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Error during login:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Validate token route
router.get('/me', authenticateJWT, (req, res) => {
  res.json({ user: req.user });
});

// Generate custom lifetime token route
router.post('/generate-custom-token', authenticateJWT, async (req, res) => {
  const { expiresIn } = req.body;
  if (!expiresIn || !['1d', '7d', '30d', '90d', '3650d'].includes(expiresIn)) {
    return res.status(400).json({ error: 'Неверный период действия токена' });
  }

  try {
    const token = jwt.sign(
      { id: req.user.id, username: req.user.username, role: req.user.role },
      JWT_SECRET,
      { expiresIn }
    );
    res.json({ token });
  } catch (err) {
    console.error('Failed to generate custom token:', err);
    res.status(500).json({ error: 'Не удалось сгенерировать токен' });
  }
});

// Admin Route: Get all users
router.get('/users', authenticateJWT, async (req, res) => {
  if (req.user.role !== 'Admin') {
    return res.status(403).json({ error: 'Permission denied: Admins only' });
  }
  try {
    const users = await all('SELECT id, username, role, approved, created_at FROM users ORDER BY username ASC');
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Admin Route: Update user (username, role, password, approved status)
router.put('/users/:id', authenticateJWT, async (req, res) => {
  if (req.user.role !== 'Admin') {
    return res.status(403).json({ error: 'Permission denied: Admins only' });
  }
  const { username, role, password, approved } = req.body;
  const userId = req.params.id;

  try {
    // 1. Fetch current user state
    const targetUser = await get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    const isSelf = parseInt(userId) === req.user.id;

    // 2. Validate role
    let finalRole = targetUser.role;
    if (role !== undefined) {
      if (!['Admin', 'Editor', 'Viewer'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role. Must be Admin, Editor, or Viewer' });
      }
      if (isSelf && role !== targetUser.role) {
        return res.status(400).json({ error: 'You cannot change your own role to prevent lockout' });
      }
      finalRole = role;
    }

    // 3. Validate username
    let finalUsername = targetUser.username;
    if (username !== undefined && username.trim() !== '') {
      const trimmedUsername = username.trim();
      if (isSelf && trimmedUsername !== targetUser.username) {
        return res.status(400).json({ error: 'You cannot change your own username to prevent lockout' });
      }
      // Check duplicate username if changed
      if (trimmedUsername !== targetUser.username) {
        const duplicate = await get('SELECT id FROM users WHERE username = ?', [trimmedUsername]);
        if (duplicate) {
          return res.status(409).json({ error: 'Username already taken' });
        }
      }
      finalUsername = trimmedUsername;
    }

    // 4. Validate approved
    let finalApproved = targetUser.approved;
    if (approved !== undefined) {
      if (isSelf && !approved) {
        return res.status(400).json({ error: 'You cannot deactivate your own account' });
      }
      finalApproved = approved ? 1 : 0;
    }

    // 5. Handle password update if provided
    let finalPasswordHash = targetUser.password_hash;
    if (password !== undefined && password.trim() !== '') {
      const salt = await bcrypt.genSalt(10);
      finalPasswordHash = await bcrypt.hash(password, salt);
    }

    // 6. Update database
    await run(
      'UPDATE users SET username = ?, role = ?, password_hash = ?, approved = ? WHERE id = ?',
      [finalUsername, finalRole, finalPasswordHash, finalApproved, userId]
    );

    res.json({ message: 'User updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Admin Route: Delete user
router.delete('/users/:id', authenticateJWT, async (req, res) => {
  if (req.user.role !== 'Admin') {
    return res.status(403).json({ error: 'Permission denied: Admins only' });
  }
  const userId = req.params.id;

  if (parseInt(userId) === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own admin account' });
  }

  try {
    await run('DELETE FROM users WHERE id = ?', [userId]);
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;
