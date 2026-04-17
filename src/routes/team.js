const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const bcrypt = require('bcryptjs');
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
    res.json(result.rows);
  } catch (error) {
    console.error('Get team members error:', error);
    res.status(500).json({ error: 'Failed to fetch team members' });
  }
});

// Add a team member
router.post('/members', authenticateToken, async (req, res) => {
  try {
    const { name, role, iracing_id, irating, safety_rating, preferred_car, linked_user_id } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const result = await query(
      `INSERT INTO team_members (user_id, name, role, iracing_id, irating, safety_rating, preferred_car)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        linked_user_id || req.user.id,
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

// PATCH /api/team/profile/username — change display username
router.patch('/profile/username', authenticateToken, async (req, res) => {
  const { username } = req.body;
  if (!username || !username.trim()) return res.status(400).json({ error: 'Username is required' });
  try {
    const result = await query(
      'UPDATE users SET username = $1 WHERE id = $2 RETURNING id, username',
      [username.trim(), req.user.id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update username error:', error);
    res.status(500).json({ error: 'Failed to update username' });
  }
});

// POST /api/team/profile/password — change password
router.post('/profile/password', authenticateToken, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Both current and new password are required' });
  if (new_password.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  try {
    const result = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const user = result.rows[0];
    const valid = await bcrypt.compare(current_password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
    const hash = await bcrypt.hash(new_password, 10);
    await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('Update password error:', error);
    res.status(500).json({ error: 'Failed to update password' });
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
  const { session_id, userPrompt } = req.body;
  if (!session_id) return res.status(400).json({ error: 'session_id required' });

  const BLOCK_MINUTES = 45;
  const OLLAMA_HOST  = process.env.OLLAMA_HOST  || 'http://23.141.136.111:11434';
  const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.3:70b-instruct-q4_K_M';

  function toHHMM(startISO, offsetMins) {
    let baseH = 0, baseM = 0;
    if (startISO) {
      const d = new Date(startISO);
      if (!isNaN(d)) { baseH = d.getHours(); baseM = d.getMinutes(); }
    }
    const tot = baseH * 60 + baseM + offsetMins;
    return String(Math.floor(tot / 60) % 24).padStart(2, '0') + ':' + String(tot % 60).padStart(2, '0');
  }

  try {
    // Load session from DB
    const sessR = await query('SELECT * FROM stint_planner_sessions WHERE id = $1', [session_id]);
    if (sessR.rowCount === 0) return res.status(404).json({ error: 'Session not found' });
    const sess = sessR.rows[0];
    const config = typeof sess.config === 'string' ? JSON.parse(sess.config) : sess.config;
    const availability = typeof sess.availability === 'string' ? JSON.parse(sess.availability) : sess.availability;

    const durationHours = config.duration_hours || 6;
    const numBlocks = Math.ceil((durationHours * 60) / BLOCK_MINUTES);
    const minStintBlocks = Math.max(1, Math.ceil((config.min_stint_mins || 45) / BLOCK_MINUTES));
    const maxStintBlocks = Math.max(minStintBlocks, Math.floor((config.max_stint_mins || 180) / BLOCK_MINUTES));

    // Resolve driver names from selected_drivers user IDs
    const selectedIds = config.selected_drivers || [];
    if (selectedIds.length === 0) return res.status(400).json({ error: 'No drivers selected for this session' });

    const usersR = await query(
      'SELECT id, username, iracing_name FROM users WHERE id = ANY($1)',
      [selectedIds]
    );
    const driverMap = {}; // id -> display name
    usersR.rows.forEach(u => { driverMap[u.id] = u.iracing_name || u.username; });
    const driverNames = selectedIds.map(id => driverMap[id]).filter(Boolean);
    if (driverNames.length === 0) return res.status(400).json({ error: 'Selected drivers not found in database' });

    // Build block-level availability per driver
    const availLines = selectedIds.map(uid => {
      const name = driverMap[uid] || `User${uid}`;
      const dAvail = availability[String(uid)] || {};
      const slots = Array.from({ length: numBlocks }, (_, bi) => {
        const hourIdx = Math.floor((bi * BLOCK_MINUTES) / 60);
        const status = dAvail[String(hourIdx)] || 'unknown';
        const icon = status === 'free' ? 'FREE' : status === 'inconvenient' ? 'INCONV' : status === 'unavailable' ? 'UNAVAIL' : '?';
        return `B${bi}(${toHHMM(config.start_time, bi * BLOCK_MINUTES)}):${icon}`;
      }).join(' ');
      return `  ${name}: ${slots}`;
    }).join('\n');

    const blockRef = Array.from({ length: numBlocks }, (_, i) =>
      `B${i}=${toHHMM(config.start_time, i * BLOCK_MINUTES)}`
    ).join(', ');

    const systemPrompt = `You are an expert endurance race strategist creating optimal driver stint schedules. Respond ONLY with valid JSON — no markdown, no preamble, no explanation outside the JSON.`;

    const userMessage = [
      userPrompt ? `User notes: ${userPrompt}\n` : '',
      `Race: ${config.race_name || 'Endurance Race'}`,
      `Start: ${config.start_time || 'TBD'} | Duration: ${durationHours}h`,
      `Block size: ${BLOCK_MINUTES}min | Total blocks: ${numBlocks}`,
      `Stint length: ${minStintBlocks}–${maxStintBlocks} blocks (${minStintBlocks * BLOCK_MINUTES}–${maxStintBlocks * BLOCK_MINUTES} min)`,
      `Drivers: ${driverNames.join(', ')}`,
      ``,
      `Availability (FREE=available, INCONV=inconvenient, UNAVAIL=not available, ?=unknown):`,
      availLines,
      ``,
      `Block start times: ${blockRef}`,
      ``,
      `Rules:`,
      `1. Cover ALL ${numBlocks} blocks with NO gaps. endBlock is EXCLUSIVE (like Python slices): a 1-block stint at block 3 = startBlock:3,endBlock:4. endBlock of one stint MUST equal startBlock of next.`,
      `2. NEVER assign a driver marked UNAVAIL for any block in their stint`,
      `3. Prefer FREE slots; use INCONV only when necessary`,
      `4. Each stint must be ${minStintBlocks}–${maxStintBlocks} blocks long`,
      `5. Distribute stints fairly`,
      ``,
      `Respond ONLY with this exact JSON structure:`,
      `{"plan":[{"driver":"Name","startBlock":0,"endBlock":2,"startTime":"14:00","endTime":"15:30"},...],"explanation":"one sentence strategy summary"}`,
    ].join('\n');

    const response = await axios.post(
      `${OLLAMA_HOST}/api/chat`,
      {
        model: OLLAMA_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMessage },
        ],
        stream: false,
        options: { temperature: 0.1, top_p: 0.9 },
      },
      { timeout: 120000 }
    );

    const text = response.data.message.content;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('AI stint plan — non-JSON:', text.substring(0, 300));
      return res.status(422).json({ error: 'AI returned a non-JSON response', message: text.substring(0, 300) });
    }

    let parsed;
    try { parsed = JSON.parse(jsonMatch[0]); }
    catch (e) { return res.status(422).json({ error: 'Failed to parse AI JSON', message: jsonMatch[0].substring(0, 300) }); }

    if (!parsed.plan || !Array.isArray(parsed.plan) || parsed.plan.length === 0) {
      return res.status(422).json({ error: 'AI returned an empty plan', explanation: parsed.explanation || '' });
    }

    // Normalize plan: convert to frontend format (startBlock/endBlock + colors)
    const COLORS = ['#0066cc','#00aaff','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6'];
    const driverColorMap = {};
    let colorIdx = 0;
    const plan = parsed.plan.map(block => {
      if (!driverColorMap[block.driver]) driverColorMap[block.driver] = COLORS[colorIdx++ % COLORS.length];
      const sb = block.startBlock ?? 0;
      const eb = Math.max(sb + 1, block.endBlock ?? sb + 1); // endBlock must always be > startBlock
      return {
        driver_name: block.driver,
        startBlock: sb,
        endBlock: eb,
        startTime: block.startTime || toHHMM(config.start_time, sb * BLOCK_MINUTES),
        endTime: block.endTime || toHHMM(config.start_time, eb * BLOCK_MINUTES),
        color: driverColorMap[block.driver],
      };
    });

    // Save plan back to session
    await query('UPDATE stint_planner_sessions SET plan=$1, updated_at=NOW() WHERE id=$2', [JSON.stringify(plan), session_id]);

    res.json({ plan, explanation: parsed.explanation || '', blockMinutes: BLOCK_MINUTES, numBlocks });
  } catch (e) {
    console.error('AI stint plan error:', e.message);
    res.status(500).json({ error: 'AI planning failed: ' + e.message });
  }
});

module.exports = router;
