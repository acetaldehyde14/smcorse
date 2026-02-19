const express = require('express');
const { authenticateToken } = require('../middleware/auth');
const { query } = require('../config/database');

const router = express.Router();

// Get all team members
router.get('/members', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT * FROM team_members ORDER BY name ASC`
    );
    res.json({ members: result.rows });
  } catch (error) {
    console.error('Get team members error:', error);
    res.status(500).json({ error: 'Failed to fetch team members' });
  }
});

// Add a team member
router.post('/members', authenticateToken, async (req, res) => {
  try {
    const { name, role, iracing_id, irating, safety_rating, preferred_car } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const result = await query(
      `INSERT INTO team_members (user_id, name, role, iracing_id, irating, safety_rating, preferred_car)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        req.user.id,
        name.trim(),
        role || 'Driver',
        iracing_id || null,
        parseInt(irating) || 0,
        parseFloat(safety_rating) || 0,
        preferred_car || null
      ]
    );

    res.json({ member: result.rows[0] });
  } catch (error) {
    console.error('Add team member error:', error);
    res.status(500).json({ error: 'Failed to add team member' });
  }
});

// Update a team member
router.put('/members/:id', authenticateToken, async (req, res) => {
  try {
    const { name, role, iracing_id, irating, safety_rating, preferred_car } = req.body;

    const result = await query(
      `UPDATE team_members
       SET name = $1, role = $2, iracing_id = $3, irating = $4, safety_rating = $5, preferred_car = $6, updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [
        name,
        role || 'Driver',
        iracing_id || null,
        parseInt(irating) || 0,
        parseFloat(safety_rating) || 0,
        preferred_car || null,
        req.params.id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }

    res.json({ member: result.rows[0] });
  } catch (error) {
    console.error('Update team member error:', error);
    res.status(500).json({ error: 'Failed to update team member' });
  }
});

// Delete a team member
router.delete('/members/:id', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `DELETE FROM team_members WHERE id = $1 RETURNING id`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }

    res.json({ message: 'Member removed' });
  } catch (error) {
    console.error('Delete team member error:', error);
    res.status(500).json({ error: 'Failed to remove team member' });
  }
});

// ── Profile & Notification Settings ────────────────────────────

// GET /api/team/profile — current user's notification settings
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, username, iracing_name, iracing_id,
              telegram_chat_id, discord_user_id, discord_webhook
       FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// PATCH /api/team/profile — update iracing_name, discord_webhook, etc.
router.patch('/profile', authenticateToken, async (req, res) => {
  const { iracing_name, iracing_id, discord_webhook } = req.body;
  try {
    const result = await query(
      `UPDATE users
       SET iracing_name   = COALESCE($1, iracing_name),
           iracing_id     = COALESCE($2, iracing_id),
           discord_webhook = COALESCE($3, discord_webhook)
       WHERE id = $4
       RETURNING id, username, iracing_name, iracing_id, discord_webhook`,
      [iracing_name, iracing_id, discord_webhook, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// POST /api/team/register-telegram — link telegram chat ID
router.post('/register-telegram', authenticateToken, async (req, res) => {
  const { telegram_chat_id } = req.body;
  if (!telegram_chat_id) return res.status(400).json({ error: 'telegram_chat_id required' });
  try {
    await query(
      'UPDATE users SET telegram_chat_id = $1 WHERE id = $2',
      [telegram_chat_id, req.user.id]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('Register telegram error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/team/register-discord — link discord user ID
router.post('/register-discord', authenticateToken, async (req, res) => {
  const { discord_user_id } = req.body;
  if (!discord_user_id) return res.status(400).json({ error: 'discord_user_id required' });
  try {
    await query(
      'UPDATE users SET discord_user_id = $1 WHERE id = $2',
      [discord_user_id, req.user.id]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('Register discord error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/team/drivers — active users list (for stint roster dropdowns)
router.get('/drivers', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, username, iracing_name,
              (telegram_chat_id IS NOT NULL) AS has_telegram,
              (discord_user_id IS NOT NULL)  AS has_discord
       FROM users WHERE is_active = TRUE ORDER BY username`
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Get drivers error:', error);
    res.status(500).json({ error: 'Failed to fetch drivers' });
  }
});

module.exports = router;
