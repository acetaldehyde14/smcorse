const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { verifyToken } = require('../middleware/auth');

// GET /api/users/me
router.get('/me', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, iracing_name, iracing_id,
              telegram_chat_id, discord_user_id, discord_webhook
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/users/me — update profile fields
router.patch('/me', verifyToken, async (req, res) => {
  const { iracing_name, iracing_id, discord_webhook } = req.body;
  try {
    const result = await pool.query(
      `UPDATE users
       SET iracing_name   = COALESCE($1, iracing_name),
           iracing_id     = COALESCE($2, iracing_id),
           discord_webhook = COALESCE($3, discord_webhook)
       WHERE id = $4
       RETURNING id, username, iracing_name, iracing_id, discord_webhook`,
      [iracing_name, iracing_id, discord_webhook, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/users/register-telegram
// Called automatically when user does /start with Telegram bot
// Can also be called manually from admin panel
router.post('/register-telegram', verifyToken, async (req, res) => {
  const { telegram_chat_id } = req.body;
  if (!telegram_chat_id) return res.status(400).json({ error: 'telegram_chat_id required' });
  try {
    await pool.query(
      'UPDATE users SET telegram_chat_id = $1 WHERE id = $2',
      [telegram_chat_id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/users/register-discord
// Called after user does /register slash command in Discord
router.post('/register-discord', verifyToken, async (req, res) => {
  const { discord_user_id } = req.body;
  if (!discord_user_id) return res.status(400).json({ error: 'discord_user_id required' });
  try {
    await pool.query(
      'UPDATE users SET discord_user_id = $1 WHERE id = $2',
      [discord_user_id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/users/team — list all team members (for roster management UI)
router.get('/team', verifyToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, iracing_name,
              (telegram_chat_id IS NOT NULL) AS has_telegram,
              (discord_user_id IS NOT NULL)  AS has_discord
       FROM users WHERE is_active = TRUE ORDER BY username`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
