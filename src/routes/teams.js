const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

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
    const result = await query(
      'INSERT INTO teams (name, description, created_by) VALUES ($1, $2, $3) RETURNING *',
      [name.trim(), description || null, req.user.id]
    );
    res.status(201).json({ ...result.rows[0], member_count: 0 });
  } catch (err) {
    console.error('[Teams] create error:', err.message);
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
