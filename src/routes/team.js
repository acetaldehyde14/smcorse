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

module.exports = router;
