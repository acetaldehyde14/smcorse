const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const { verifyToken } = require('../middleware/auth');

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { username, password, iracing_name } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rowCount > 0) {
      return res.status(409).json({ error: 'Username already taken' });
    }

    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, iracing_name)
       VALUES ($1, $2, $3)
       RETURNING id, username, iracing_name`,
      [username, hash, iracing_name || null]
    );

    const user = result.rows[0];
    const token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '90d' }
    );

    res.status(201).json({ token, user: { id: user.id, username: user.username } });
  } catch (err) {
    console.error('[Auth register]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  try {
    const result = await pool.query(
      'SELECT id, username, password_hash, iracing_name FROM users WHERE username = $1',
      [username]
    );
    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '90d' }
    );

    res.json({ token, user: { id: user.id, username: user.username, iracing_name: user.iracing_name } });
  } catch (err) {
    console.error('[Auth login]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/validate — desktop app calls this on startup to verify stored token
router.post('/validate', verifyToken, (req, res) => {
  res.json({ valid: true, user: req.user });
});

module.exports = router;
