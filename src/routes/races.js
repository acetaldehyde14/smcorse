const express = require('express');
const router = express.Router();
const { pool, query } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');
const { notifyDriverChange, notifyBoxedAndOut, notifyLowFuel, getTeamIdForRace } = require('../services/notifications');

const BLOCK_MINS = 45;

// ── Helpers ────────────────────────────────────────────────────

function getBlockDriverName(block) {
  return (block.driver_name || block.driver || '').trim();
}

function getBlockEndIndex(block) {
  if (block.endBlock != null) return block.endBlock;
  if (block.start_hour != null && block.duration_hours != null) {
    return Math.round((block.start_hour + block.duration_hours) * 60 / BLOCK_MINS);
  }
  return null;
}

function getBlockStartIndex(block) {
  if (block.startBlock != null) return block.startBlock;
  if (block.start_hour != null) return Math.round(block.start_hour * 60 / BLOCK_MINS);
  return 0;
}

// Advance (or extend) the stint plan on driver change.
// Returns { isSameDriver, ...stintPlanInfo } or null if no plan / error.
async function advanceStintPlan(race, newDriverName, raceId) {
  try {
    const [sessionR, stateR] = await Promise.all([
      query('SELECT * FROM stint_planner_sessions WHERE id = $1', [race.active_stint_session_id]),
      query('SELECT * FROM race_state WHERE race_id = $1', [raceId]),
    ]);
    if (!sessionR.rows[0]) return null;

    const session      = sessionR.rows[0];
    const state        = stateR.rows[0] || {};
    const plan         = Array.isArray(session.plan) ? [...session.plan].map(b => ({ ...b })) : [];
    const currentIndex = state.current_stint_index || 0;
    const now          = new Date();

    if (plan.length === 0) return null;

    const currentBlock    = plan[currentIndex];
    const currentDriver   = currentBlock ? getBlockDriverName(currentBlock) : '';
    const newNameLower    = newDriverName.toLowerCase();
    const isSameDriver    = currentDriver.toLowerCase() === newNameLower;

    if (isSameDriver) {
      // ── Same driver boxed and went back out — still advance stint ──
      // Compute deviation vs plan
      let deviationMins = null;
      if (currentBlock && race.started_at) {
        const endIdx = getBlockEndIndex(currentBlock);
        if (endIdx !== null) {
          const plannedEndMs = new Date(race.started_at).getTime() + endIdx * BLOCK_MINS * 60 * 1000;
          deviationMins = Math.round((plannedEndMs - now.getTime()) / 60000);
        }
      }

      // Mark current block as ended
      if (currentBlock) {
        plan[currentIndex].actual_end_at = now.toISOString();
      }

      // Advance to next block (always +1 for same driver)
      let nextIndex = currentIndex + 1;
      if (nextIndex >= plan.length) nextIndex = Math.max(plan.length - 1, 0);

      // Mark next block as started
      if (plan[nextIndex] && nextIndex !== currentIndex) {
        plan[nextIndex].actual_start_at = now.toISOString();
      }

      // Who is next after the new current driver?
      const nextBlock          = plan[nextIndex + 1] || null;
      const nextNextDriverName = nextBlock ? getBlockDriverName(nextBlock) : null;

      let plannedDurationMins = null;
      if (plan[nextIndex]) {
        const b = plan[nextIndex];
        if (b.endBlock != null && b.startBlock != null) {
          plannedDurationMins = (b.endBlock - b.startBlock) * BLOCK_MINS;
        } else if (b.duration_hours != null) {
          plannedDurationMins = Math.round(b.duration_hours * 60);
        }
      }

      await Promise.all([
        query(
          'UPDATE stint_planner_sessions SET plan = $1::jsonb, updated_at = NOW() WHERE id = $2',
          [JSON.stringify(plan), session.id]
        ),
        query(
          `UPDATE race_state SET current_stint_index = $1, stint_started_at = $2 WHERE race_id = $3`,
          [nextIndex, now.toISOString(), raceId]
        ),
      ]);

      return { isSameDriver: true, deviationMins, nextNextDriverName, plannedDurationMins, currentIndex: nextIndex, totalBlocks: plan.length };
    }

    // ── Normal driver change — advance to next driver ────────────

    // Compute deviation vs plan (how early/late vs planned pit time)
    let deviationMins = null;
    if (currentBlock && race.started_at) {
      const endIdx = getBlockEndIndex(currentBlock);
      if (endIdx !== null) {
        const plannedEndMs = new Date(race.started_at).getTime() + endIdx * BLOCK_MINS * 60 * 1000;
        deviationMins = Math.round((plannedEndMs - now.getTime()) / 60000); // positive = early
      }
    }

    // Mark current block as ended
    if (currentBlock) {
      plan[currentIndex].actual_end_at = now.toISOString();
    }

    // Always advance exactly one step — never skip blocks by searching for a name match
    const nextIndex = Math.min(currentIndex + 1, plan.length - 1);

    // Adjust remaining block times if the pit happened late/early
    if (race.started_at && plan[nextIndex]?.startBlock != null) {
      const plannedStartMs = new Date(race.started_at).getTime() + plan[nextIndex].startBlock * BLOCK_MINS * 60 * 1000;
      const deltaBlocks    = Math.round((now.getTime() - plannedStartMs) / (BLOCK_MINS * 60 * 1000));
      if (deltaBlocks !== 0) {
        for (let i = nextIndex; i < plan.length; i++) {
          if (!plan[i].actual_end_at) { // only shift blocks not yet completed
            const bStart = getBlockStartIndex(plan[i]);
            const bEnd   = getBlockEndIndex(plan[i]) ?? (bStart + 1);
            plan[i].startBlock = bStart + deltaBlocks;
            plan[i].endBlock   = bEnd   + deltaBlocks;
            // Recompute display times
            const toTime = (blocks) => {
              const totalMins = blocks * BLOCK_MINS;
              const h = Math.floor(totalMins / 60) % 24;
              const m = totalMins % 60;
              return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
            };
            plan[i].startTime = toTime(plan[i].startBlock);
            plan[i].endTime   = toTime(plan[i].endBlock);
          }
        }
      }
    }

    // Mark next block as started
    if (plan[nextIndex]) {
      plan[nextIndex].actual_start_at = now.toISOString();
    }

    // Who is next after the new current driver?
    const nextNextBlock      = plan[nextIndex + 1] || null;
    const nextNextDriverName = nextNextBlock ? getBlockDriverName(nextNextBlock) : null;

    // Planned duration for new current block (mins)
    let plannedDurationMins = null;
    if (plan[nextIndex]) {
      const b = plan[nextIndex];
      if (b.endBlock != null && b.startBlock != null) {
        plannedDurationMins = (b.endBlock - b.startBlock) * BLOCK_MINS;
      } else if (b.duration_hours != null) {
        plannedDurationMins = Math.round(b.duration_hours * 60);
      }
    }

    await Promise.all([
      query(
        'UPDATE stint_planner_sessions SET plan = $1::jsonb, updated_at = NOW() WHERE id = $2',
        [JSON.stringify(plan), session.id]
      ),
      query(
        `UPDATE race_state SET current_stint_index = $1, stint_started_at = $2 WHERE race_id = $3`,
        [nextIndex, now.toISOString(), raceId]
      ),
    ]);

    return { isSameDriver: false, deviationMins, nextNextDriverName, plannedDurationMins, currentIndex: nextIndex, totalBlocks: plan.length };
  } catch (e) {
    console.error('[Races] advanceStintPlan error:', e.message);
    return null;
  }
}

// ── Race CRUD ──────────────────────────────────────────────────

// GET /api/races — list all races
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT r.*,
              rs.current_driver_name,
              rs.stint_started_at,
              (SELECT COUNT(*) FROM iracing_events ie WHERE ie.race_id = r.id) AS event_count
       FROM races r
       LEFT JOIN race_state rs ON rs.race_id = r.id
       ORDER BY r.is_active DESC, r.created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[Races] list error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/races/active — get the currently active race
router.get('/active', authenticateToken, async (req, res) => {
  try {
    const result = await query('SELECT * FROM races WHERE is_active = TRUE LIMIT 1');
    if (result.rowCount === 0) return res.status(404).json({ error: 'No active race' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Races] active error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/races — create a new race
router.post('/', authenticateToken, async (req, res) => {
  const { name, track } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const result = await query(
      'INSERT INTO races (name, track) VALUES ($1, $2) RETURNING *',
      [name, track || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[Races] create error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/races/:id/start — mark race as active
router.post('/:id/start', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `UPDATE races SET is_active = TRUE, started_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Race not found' });
    const race = result.rows[0];

    // Seed current_driver_name from first block of linked stint plan (if any)
    let firstDriverName = null;
    if (race.active_stint_session_id) {
      try {
        const sR = await query(
          'SELECT plan FROM stint_planner_sessions WHERE id = $1',
          [race.active_stint_session_id]
        );
        const plan = sR.rows[0]?.plan;
        if (Array.isArray(plan) && plan.length > 0) {
          firstDriverName = getBlockDriverName(plan[0]) || null;
        }
      } catch (e) { /* non-fatal */ }
    }

    await query(
      `INSERT INTO race_state (race_id, current_driver_name, current_stint_index, stint_started_at)
       VALUES ($1, $2, 0, NOW())
       ON CONFLICT (race_id) DO UPDATE
         SET low_fuel_notified = FALSE,
             current_driver_name = $2,
             current_stint_index = 0,
             stint_started_at = NOW()`,
      [req.params.id, firstDriverName]
    );

    res.json(race);
  } catch (err) {
    console.error('[Races] start error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/races/:id/end — end the race
router.post('/:id/end', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `UPDATE races SET is_active = FALSE, ended_at = NOW()
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Race not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Races] end error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Stint Plan Link ────────────────────────────────────────────

// POST /api/races/:id/stint-plan — link a stint planner session to this race
router.post('/:id/stint-plan', authenticateToken, async (req, res) => {
  const { session_id } = req.body;
  try {
    const result = await query(
      'UPDATE races SET active_stint_session_id = $1 WHERE id = $2 RETURNING *',
      [session_id || null, req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Race not found' });

    // Reset stint progress when plan changes
    if (session_id) {
      await query(
        `UPDATE race_state
         SET current_stint_index = 0, stint_started_at = NULL
         WHERE race_id = $1`,
        [req.params.id]
      );
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Races] link stint plan error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/races/:id/stint-plan — get the linked plan with current progress
router.get('/:id/stint-plan', authenticateToken, async (req, res) => {
  try {
    const raceR = await query('SELECT * FROM races WHERE id = $1', [req.params.id]);
    if (raceR.rowCount === 0) return res.status(404).json({ error: 'Race not found' });
    const race = raceR.rows[0];

    if (!race.active_stint_session_id) {
      return res.json({ session: null, current_index: 0, stint_started_at: null, race_started_at: race.started_at });
    }

    const [sessionR, stateR] = await Promise.all([
      query('SELECT * FROM stint_planner_sessions WHERE id = $1', [race.active_stint_session_id]),
      query('SELECT current_stint_index, stint_started_at FROM race_state WHERE race_id = $1', [req.params.id]),
    ]);

    res.json({
      session:         sessionR.rows[0] || null,
      current_index:   stateR.rows[0]?.current_stint_index || 0,
      stint_started_at: stateR.rows[0]?.stint_started_at || null,
      race_started_at: race.started_at || null,
    });
  } catch (err) {
    console.error('[Races] get stint plan error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Roster ─────────────────────────────────────────────────────

// GET /api/races/:id/roster — get full stint roster with driver info
router.get('/:id/roster', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT sr.*, u.username, u.iracing_name,
              (u.telegram_chat_id IS NOT NULL) AS has_telegram,
              (u.discord_user_id IS NOT NULL)  AS has_discord
       FROM stint_roster sr
       JOIN users u ON u.id = sr.driver_user_id
       WHERE sr.race_id = $1
       ORDER BY sr.stint_order`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[Races] roster get error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/races/:id/roster — add or replace full roster
router.post('/:id/roster', authenticateToken, async (req, res) => {
  const { roster } = req.body;
  if (!Array.isArray(roster) || roster.length === 0) {
    return res.status(400).json({ error: 'roster array required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM stint_roster WHERE race_id = $1', [req.params.id]);
    for (const entry of roster) {
      await client.query(
        `INSERT INTO stint_roster (race_id, driver_user_id, stint_order, planned_duration_mins)
         VALUES ($1, $2, $3, $4)`,
        [req.params.id, entry.driver_user_id, entry.stint_order, entry.planned_duration_mins || null]
      );
    }
    await client.query('COMMIT');
    res.json({ ok: true, count: roster.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[Races] roster save error:', err.message);
    res.status(500).json({ error: 'Server error' });
  } finally {
    client.release();
  }
});

// GET /api/races/:id/state — live state snapshot for one race
router.get('/:id/state', authenticateToken, async (req, res) => {
  try {
    const [raceR, stateR, fuelR] = await Promise.all([
      query('SELECT * FROM races WHERE id = $1', [req.params.id]),
      query('SELECT * FROM race_state WHERE race_id = $1', [req.params.id]),
      query(
        `SELECT fuel_level, fuel_pct, mins_remaining, created_at
         FROM iracing_events
         WHERE race_id = $1 AND event_type = 'fuel_update'
         ORDER BY created_at DESC LIMIT 1`,
        [req.params.id]
      )
    ]);
    if (raceR.rowCount === 0) return res.status(404).json({ error: 'Race not found' });
    res.json({
      race:      raceR.rows[0],
      state:     stateR.rows[0] || null,
      last_fuel: fuelR.rows[0]  || null
    });
  } catch (err) {
    console.error('[Races] state error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/races/:id/event — manually log a driver change or fuel update
router.post('/:id/event', authenticateToken, async (req, res) => {
  const { event_type, driver_name, fuel_level, fuel_pct, mins_remaining } = req.body;
  if (!event_type) return res.status(400).json({ error: 'event_type required' });

  try {
    const raceR = await query('SELECT * FROM races WHERE id = $1', [req.params.id]);
    if (raceR.rowCount === 0) return res.status(404).json({ error: 'Race not found' });
    const race = raceR.rows[0];

    if (event_type === 'driver_change') {
      if (!driver_name || !driver_name.trim()) {
        return res.status(400).json({ error: 'driver_name required' });
      }
      const name = driver_name.trim();

      // Update race state
      await query(
        `INSERT INTO race_state (race_id, current_driver_name, low_fuel_notified)
         VALUES ($1, $2, FALSE)
         ON CONFLICT (race_id) DO UPDATE
           SET current_driver_name = $2, low_fuel_notified = FALSE, last_event_at = NOW()`,
        [race.id, name]
      );

      // Log event
      await query(
        `INSERT INTO iracing_events (event_type, race_id, driver_name, reported_by_user_id)
         VALUES ('driver_change', $1, $2, $3)`,
        [race.id, name, req.user.id]
      );

      // Auto-advance stint plan if one is linked
      let stintPlanInfo = null;
      if (race.active_stint_session_id) {
        stintPlanInfo = await advanceStintPlan(race, name, race.id);
      }

      // Resolve user records for notifications
      const [driverUserR, stateAfterR] = await Promise.all([
        query('SELECT * FROM users WHERE LOWER(iracing_name) = LOWER($1) OR LOWER(username) = LOWER($1)', [name]),
        query('SELECT * FROM race_state WHERE race_id = $1', [race.id]),
      ]);

      // Find next driver in stint roster
      const rosterR = await query(
        `SELECT sr.*, u.* FROM stint_roster sr
         JOIN users u ON u.id = sr.driver_user_id
         WHERE sr.race_id = $1 ORDER BY sr.stint_order`,
        [race.id]
      );
      const roster = rosterR.rows;
      const currentIdx = roster.findIndex(r =>
        (r.iracing_name || r.username || '').toLowerCase() === name.toLowerCase()
      );
      const nextRosterDriver = currentIdx >= 0 && currentIdx < roster.length - 1
        ? roster[currentIdx + 1]
        : null;

      const driverUser = driverUserR.rows[0] || null;
      const teamId = await getTeamIdForRace(race.id);

      if (stintPlanInfo?.isSameDriver) {
        await notifyBoxedAndOut(name, stintPlanInfo, teamId);
      } else {
        await notifyDriverChange(name, driverUser, nextRosterDriver, stintPlanInfo, teamId);
      }

      res.json({ ok: true, stintPlanInfo });

    } else if (event_type === 'fuel_update') {
      if (fuel_level === undefined || fuel_level === null) {
        return res.status(400).json({ error: 'fuel_level required' });
      }

      await query(
        `INSERT INTO iracing_events
           (event_type, race_id, fuel_level, fuel_pct, mins_remaining, reported_by_user_id)
         VALUES ('fuel_update', $1, $2, $3, $4, $5)`,
        [race.id, fuel_level, fuel_pct || null, mins_remaining || null, req.user.id]
      );

      await query(
        'UPDATE race_state SET last_fuel_level = $1, last_event_at = NOW() WHERE race_id = $2',
        [fuel_level, race.id]
      );

      // Low fuel alert (< 15 mins remaining or < 10% fuel)
      const stateR = await query('SELECT * FROM race_state WHERE race_id = $1', [race.id]);
      const state = stateR.rows[0];
      const shouldAlert = (
        (mins_remaining != null && mins_remaining < 15) ||
        (fuel_pct != null && fuel_pct < 10)
      );

      if (shouldAlert && state && !state.low_fuel_notified) {
        await query('UPDATE race_state SET low_fuel_notified = TRUE WHERE race_id = $1', [race.id]);

        // Find next driver in roster for alert
        const rosterR = await query(
          `SELECT sr.*, u.* FROM stint_roster sr
           JOIN users u ON u.id = sr.driver_user_id
           WHERE sr.race_id = $1 ORDER BY sr.stint_order`,
          [race.id]
        );
        const roster = rosterR.rows;
        const currentDriver = state.current_driver_name || '';
        const currentIdx = roster.findIndex(r =>
          (r.iracing_name || r.username || '').toLowerCase() === currentDriver.toLowerCase()
        );
        const nextDriver = currentIdx >= 0 && currentIdx < roster.length - 1
          ? roster[currentIdx + 1]
          : null;

        const teamId = await getTeamIdForRace(race.id);
        await notifyLowFuel(mins_remaining || 0, fuel_level, nextDriver, teamId);
      }

      res.json({ ok: true });

    } else {
      res.status(400).json({ error: 'event_type must be driver_change or fuel_update' });
    }
  } catch (err) {
    console.error('[Races] manual event error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/races/:id/laps — stored lap times for a race
router.get('/:id/laps', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT lap_number, driver_name, lap_time, session_time, recorded_at
       FROM race_laps
       WHERE race_id = $1
       ORDER BY recorded_at ASC`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[Races] laps error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/races/:id/events — recent telemetry events for a race
router.get('/:id/events', authenticateToken, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  try {
    const result = await query(
      `SELECT ie.*, u.username AS reporter_username
       FROM iracing_events ie
       LEFT JOIN users u ON u.id = ie.reported_by_user_id
       WHERE ie.race_id = $1
       ORDER BY ie.created_at DESC
       LIMIT $2`,
      [req.params.id, limit]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[Races] events error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Race Events (Calendar) ──────────────────────────────────────

// GET /api/races/events — list upcoming race events
router.get('/events', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT re.*, u.username AS created_by_username
       FROM race_events re
       LEFT JOIN users u ON u.id = re.created_by
       ORDER BY re.race_date ASC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[RaceEvents] list error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/races/events — create a race event
router.post('/events', authenticateToken, async (req, res) => {
  const { name, track, series, car_class, race_date, duration_hours } = req.body;
  if (!name || !race_date) return res.status(400).json({ error: 'name and race_date are required' });
  try {
    const result = await query(
      `INSERT INTO race_events (name, track, series, car_class, race_date, duration_hours, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [name, track || null, series || null, car_class || null, race_date, duration_hours || null, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[RaceEvents] create error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/races/events/:id — delete a race event
router.delete('/events/:id', authenticateToken, async (req, res) => {
  try {
    await query('DELETE FROM race_events WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('[RaceEvents] delete error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
module.exports.advanceStintPlan = advanceStintPlan;
