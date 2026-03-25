const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { authenticateToken } = require('../middleware/auth');
const { query } = require('../config/database');

const router = express.Router();

// ── Avatar upload setup ──────────────────────────────────────────
const avatarDir = path.join(__dirname, '../../public/avatars');
if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });

const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, avatarDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `user_${req.user.id}${ext}`);
    }
  }),
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed (jpg, png, gif, webp)'));
    }
  },
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB
});

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

// GET /api/team/profile — current user's full profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, username, iracing_name, iracing_id,
              telegram_chat_id, discord_user_id, discord_username, discord_webhook, avatar_url
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

// PATCH /api/team/profile — update profile fields
router.patch('/profile', authenticateToken, async (req, res) => {
  const { iracing_name, iracing_id, discord_username, discord_webhook, telegram_chat_id, discord_user_id } = req.body;
  try {
    const result = await query(
      `UPDATE users
       SET iracing_name     = COALESCE($1, iracing_name),
           iracing_id       = COALESCE($2, iracing_id),
           discord_username = COALESCE($3, discord_username),
           discord_webhook  = COALESCE($4, discord_webhook),
           telegram_chat_id = COALESCE($5, telegram_chat_id),
           discord_user_id  = COALESCE($6, discord_user_id)
       WHERE id = $7
       RETURNING id, username, iracing_name, iracing_id, discord_username, discord_webhook, telegram_chat_id, discord_user_id, avatar_url`,
      [iracing_name || null, iracing_id || null, discord_username || null, discord_webhook || null, telegram_chat_id || null, discord_user_id || null, req.user.id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// POST /api/team/avatar — upload profile picture
router.post('/avatar', authenticateToken, (req, res) => {
  avatarUpload.single('avatar')(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const avatarUrl = `/avatars/${req.file.filename}`;
    try {
      await query(
        'UPDATE users SET avatar_url = $1 WHERE id = $2',
        [avatarUrl, req.user.id]
      );
      res.json({ avatar_url: avatarUrl });
    } catch (error) {
      console.error('Avatar update error:', error);
      res.status(500).json({ error: 'Failed to save avatar' });
    }
  });
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
      `SELECT id, username, iracing_name, avatar_url,
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

// ── Stint Planner Sessions (shared, stored in DB) ───────────────

// GET /api/team/stint-sessions — list all sessions (visible to whole team)
router.get('/stint-sessions', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT ss.id, ss.name, ss.config, ss.availability, ss.plan,
              ss.created_at, ss.updated_at,
              u.username AS created_by_name
       FROM stint_planner_sessions ss
       LEFT JOIN users u ON u.id = ss.created_by
       ORDER BY ss.updated_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('stint-sessions list error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/team/stint-sessions — create a new session
router.post('/stint-sessions', authenticateToken, async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  try {
    const result = await query(
      `INSERT INTO stint_planner_sessions (name, created_by, config, availability, plan)
       VALUES ($1, $2, '{}', '{}', '[]')
       RETURNING *`,
      [name.trim(), req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('stint-sessions create error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/team/stint-sessions/:id — get one session
router.get('/stint-sessions/:id', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT ss.*, u.username AS created_by_name
       FROM stint_planner_sessions ss
       LEFT JOIN users u ON u.id = ss.created_by
       WHERE ss.id = $1`,
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Session not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('stint-sessions get error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/team/stint-sessions/:id — update session (any user)
router.put('/stint-sessions/:id', authenticateToken, async (req, res) => {
  const { name, config, availability, plan } = req.body;
  try {
    const result = await query(
      `UPDATE stint_planner_sessions
       SET name         = COALESCE($1, name),
           config       = COALESCE($2, config),
           availability = COALESCE($3, availability),
           plan         = COALESCE($4, plan),
           updated_at   = NOW()
       WHERE id = $5
       RETURNING *`,
      [
        name         || null,
        config       ? JSON.stringify(config)       : null,
        availability ? JSON.stringify(availability) : null,
        plan         ? JSON.stringify(plan)         : null,
        req.params.id
      ]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Session not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('stint-sessions update error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/team/stint-sessions/:id — delete session (any user)
router.delete('/stint-sessions/:id', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      'DELETE FROM stint_planner_sessions WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Session not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('stint-sessions delete error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Stint Planner AI ────────────────────────────────────────────

// POST /api/team/stint-planner/ai-plan
router.post('/stint-planner/ai-plan', authenticateToken, async (req, res) => {
  const { userPrompt, config, availability, blockMinutes, numBlocks } = req.body;

  if (!config || !config.drivers || config.drivers.length === 0) {
    return res.status(400).json({ error: 'No drivers in config' });
  }

  const OLLAMA_HOST  = process.env.OLLAMA_HOST  || 'http://23.141.136.111:11434';
  const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.3:70b-instruct-q4_K_M';

  function toHHMM(startTime, offsetMins) {
    const [h, m] = (startTime || '00:00').split(':').map(Number);
    const tot = h * 60 + m + offsetMins;
    return String(Math.floor(tot / 60) % 24).padStart(2, '0') + ':' + String(tot % 60).padStart(2, '0');
  }

  // Build readable availability summary
  const availLines = Object.entries(availability || {}).map(([driver, hours]) => {
    const slots = (hours || []).map((s, i) => {
      const icon = s === 'free' ? 'FREE' : s === 'inconvenient' ? 'INCONV' : s === 'unavailable' ? 'UNAVAIL' : '?';
      return `H${i}(${toHHMM(config.raceStartTime, i * 60)}):${icon}`;
    }).join(' ');
    return `  ${driver}: ${slots}`;
  }).join('\n');

  // Block time reference
  const blockRef = Array.from({ length: numBlocks }, (_, i) =>
    `B${i}=${toHHMM(config.raceStartTime, i * blockMinutes)}`
  ).join(', ');

  const systemPrompt = `You are an expert endurance race strategist. Your job is to create optimal driver stint schedules. You must respond ONLY with valid JSON — no markdown code fences, no preamble, no explanation outside the JSON object.`;

  const userMessage = [
    userPrompt ? `User notes: ${userPrompt}\n` : '',
    `Race: ${config.raceName || 'Endurance Race'}`,
    `Date/Start: ${config.raceDate || 'TBD'} at ${config.raceStartTime}`,
    `Duration: ${config.raceDurationHours}h | Block size: ${blockMinutes}min | Total blocks: ${numBlocks}`,
    `Min stint: ${config.minStintMinutes}min (${Math.ceil(config.minStintMinutes / blockMinutes)} block${Math.ceil(config.minStintMinutes / blockMinutes) !== 1 ? 's' : ''})`,
    `Max stint: ${config.maxStintMinutes}min (${Math.floor(config.maxStintMinutes / blockMinutes)} blocks)`,
    `Drivers: ${config.drivers.join(', ')}`,
    ``,
    `Availability (FREE=available, INCONV=inconvenient, UNAVAIL=not available, ?=unknown):`,
    availLines || '  (none — assume all drivers free)',
    ``,
    `Block times: ${blockRef}`,
    ``,
    `Rules:`,
    `1. Cover ALL ${numBlocks} blocks with NO gaps`,
    `2. NEVER assign a driver marked UNAVAIL`,
    `3. Prefer FREE drivers; use INCONV only when needed`,
    `4. Each stint: ${Math.ceil(config.minStintMinutes / blockMinutes)}–${Math.floor(config.maxStintMinutes / blockMinutes)} blocks`,
    `5. Distribute stints fairly across drivers`,
    ``,
    `Respond ONLY with this JSON (no other text):`,
    `{"plan":[{"driver":"Name","startBlock":0,"endBlock":1,"startTime":"14:00","endTime":"15:30","availType":"free"},...],"explanation":"Brief strategy summary"}`
  ].join('\n');

  try {
    const response = await axios.post(
      `${OLLAMA_HOST}/api/chat`,
      {
        model: OLLAMA_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMessage }
        ],
        stream: false,
        options: { temperature: 0.15, top_p: 0.9 }
      },
      { timeout: 120000 }
    );

    const text = response.data.message.content;

    // Extract JSON object from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('AI stint plan — non-JSON response:', text.substring(0, 300));
      return res.status(422).json({ error: 'AI returned a non-JSON response. Try again or use "Generate from Grid".', message: text.substring(0, 300) });
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      return res.status(422).json({ error: 'Failed to parse AI response as JSON', message: jsonMatch[0].substring(0, 300) });
    }

    if (!parsed.plan || !Array.isArray(parsed.plan) || parsed.plan.length === 0) {
      return res.status(422).json({ error: 'AI returned an empty plan', explanation: parsed.explanation || '' });
    }

    res.json({ plan: parsed.plan, explanation: parsed.explanation || '' });
  } catch (e) {
    console.error('AI stint plan error:', e.message);
    res.status(500).json({ error: 'AI planning failed: ' + e.message });
  }
});

module.exports = router;
