const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { sendDiscordTeamChannel } = require('../services/notifications');

function normalizeOptionalString(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    const err = new Error(`${fieldName} must be a string`);
    err.status = 400;
    throw err;
  }
  return value.trim() || null;
}

// GET /api/teams
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT t.*, COUNT(tm.id)::int AS member_count
       FROM teams t
       LEFT JOIN team_members tm ON tm.team_id = t.id
       GROUP BY t.id ORDER BY t.created_at ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[Teams] list error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/teams
router.post('/', authenticateToken, async (req, res) => {
  const { name, description } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  try {
    const discordChannelId = normalizeOptionalString(req.body.discord_channel_id, 'discord_channel_id');
    const discordRoleId = normalizeOptionalString(req.body.discord_role_id, 'discord_role_id');
    const result = await query(
      `INSERT INTO teams (name, description, discord_channel_id, discord_role_id, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name.trim(), description || null, discordChannelId, discordRoleId, req.user.id]
    );
    res.status(201).json({ ...result.rows[0], member_count: 0 });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[Teams] create error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/teams/:id
router.put('/:id', authenticateToken, async (req, res) => {
  const { name, description } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name required' });
  }

  try {
    const discordChannelId = normalizeOptionalString(req.body.discord_channel_id, 'discord_channel_id');
    const discordRoleId = normalizeOptionalString(req.body.discord_role_id, 'discord_role_id');
    const result = await query(
      `UPDATE teams
       SET name = $1,
           description = $2,
           discord_channel_id = $3,
           discord_role_id = $4,
           updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [name.trim(), description || null, discordChannelId, discordRoleId, req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Team not found' });
    res.json(result.rows[0]);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('[Teams] update error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/teams/:id/test-discord
router.post('/:id/test-discord', authenticateToken, async (req, res) => {
  try {
    const sent = await sendDiscordTeamChannel(req.params.id, {
      content: 'Test Discord alert from SM CORSE.',
      embeds: [{
        title: 'Discord Channel Test',
        description: 'Team alerts for this SM CORSE team are configured correctly.',
        color: 0x1e90ff,
        timestamp: new Date().toISOString(),
        footer: { text: 'SM CORSE Enduro Monitor' },
      }],
    });

    if (!sent) {
      return res.status(400).json({ error: 'Discord channel is not configured or could not be reached' });
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[Teams] test discord error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/teams/:id
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    await query('DELETE FROM teams WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Teams] delete error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/teams/:id/members
router.get('/:id/members', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      'SELECT * FROM team_members WHERE team_id = $1 ORDER BY name ASC',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[Teams] members error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/teams/:id/members — add member to team
router.post('/:id/members', authenticateToken, async (req, res) => {
  const { name, role, iracing_name, irating, safety_rating, preferred_car, discord_user_id, linked_user_id } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  try {
    const result = await query(
      `INSERT INTO team_members (team_id, user_id, name, role, iracing_name, irating, safety_rating, preferred_car, discord_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        req.params.id,
        linked_user_id || req.user.id,
        name.trim(),
        role || 'Driver',
        iracing_name || null,
        parseInt(irating) || null,
        safety_rating || null,
        preferred_car || null,
        discord_user_id || null,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[Teams] add member error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/teams/:id/members/:memberId
router.put('/:id/members/:memberId', authenticateToken, async (req, res) => {
  const { name, role, iracing_name, irating, safety_rating, preferred_car, discord_user_id } = req.body;
  try {
    const result = await query(
      `UPDATE team_members SET name=$1, role=$2, iracing_name=$3, irating=$4,
       safety_rating=$5, preferred_car=$6, discord_user_id=$7
       WHERE id=$8 AND team_id=$9 RETURNING *`,
      [name, role, iracing_name||null, parseInt(irating)||null, safety_rating||null, preferred_car||null, discord_user_id||null, req.params.memberId, req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Member not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Teams] update member error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/teams/:id/members/:memberId
router.delete('/:id/members/:memberId', authenticateToken, async (req, res) => {
  try {
    await query('DELETE FROM team_members WHERE id=$1 AND team_id=$2', [req.params.memberId, req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Teams] remove member error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
