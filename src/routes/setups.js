const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { query } = require('../config/database');

const router = express.Router();

const SETUPS_DIR = path.join(__dirname, '../../uploads/setups');
if (!fs.existsSync(SETUPS_DIR)) fs.mkdirSync(SETUPS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, SETUPS_DIR),
  filename: (req, file, cb) => {
    const userId = req.user?.id ?? 'unknown';
    const ts = Date.now();
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${userId}_${ts}_${safe}`);
  },
});

const fileFilter = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.sto') return cb(null, true);
  cb(new Error('Only .sto files are allowed'));
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 5 * 1024 * 1024 } });

async function requireAdmin(req, res, next) {
  try {
    const r = await query('SELECT is_admin FROM users WHERE id = $1', [req.user.id]);
    if (r.rows[0]?.is_admin) return next();
    res.status(403).json({ error: 'Admin access required' });
  } catch (e) {
    next(e);
  }
}

// GET /api/setups — list all setups (optional ?track= ?car= filters)
router.get('/', async (req, res) => {
  try {
    const track = req.query.track || null;
    const car = req.query.car || null;
    const result = await query(
      `SELECT id, track_name, car_name, label, notes, filename, uploaded_by, created_at
       FROM car_setups
       WHERE ($1::text IS NULL OR track_name ILIKE $1)
         AND ($2::text IS NULL OR car_name  ILIKE $2)
       ORDER BY created_at DESC`,
      [track, car]
    );
    res.json(result.rows);
  } catch (e) {
    console.error('setups list error:', e);
    res.status(500).json({ error: 'Failed to fetch setups' });
  }
});

// POST /api/setups — upload a setup (admin only)
router.post('/', requireAdmin, (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { track_name, car_name, label, notes } = req.body;
    if (!track_name || !car_name || !label) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'track_name, car_name, and label are required' });
    }

    try {
      const result = await query(
        `INSERT INTO car_setups (track_name, car_name, label, notes, filename, file_path, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, track_name, car_name, label, notes, filename, uploaded_by, created_at`,
        [
          track_name.trim(),
          car_name.trim(),
          label.trim(),
          notes?.trim() || null,
          req.file.filename,
          req.file.path,
          req.user.id,
        ]
      );
      res.status(201).json(result.rows[0]);
    } catch (e) {
      fs.unlink(req.file.path, () => {});
      console.error('setups insert error:', e);
      res.status(500).json({ error: 'Failed to save setup' });
    }
  });
});

// GET /api/setups/:id/download — download a setup file (any authenticated user)
router.get('/:id/download', async (req, res) => {
  try {
    const result = await query(
      'SELECT file_path, filename FROM car_setups WHERE id = $1',
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Setup not found' });

    const { file_path, filename } = result.rows[0];
    const resolved = path.resolve(file_path);
    if (!resolved.startsWith(path.resolve(SETUPS_DIR) + path.sep)) {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    res.download(resolved, filename);
  } catch (e) {
    console.error('setups download error:', e);
    res.status(500).json({ error: 'Download failed' });
  }
});

// DELETE /api/setups/:id — delete a setup (admin only)
router.delete('/:id', requireAdmin, async (req, res) => {
  try {
    const lookup = await query(
      'SELECT file_path FROM car_setups WHERE id = $1',
      [req.params.id]
    );
    if (!lookup.rows.length) return res.status(404).json({ error: 'Setup not found' });

    const filePath = lookup.rows[0].file_path;
    try {
      fs.unlinkSync(filePath);
    } catch (unlinkErr) {
      if (unlinkErr.code !== 'ENOENT') {
        console.error('Could not delete setup file:', filePath, unlinkErr.message);
        return res.status(500).json({ error: 'Failed to delete setup file' });
      }
    }

    await query('DELETE FROM car_setups WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error('setups delete error:', e);
    res.status(500).json({ error: 'Failed to delete setup' });
  }
});

module.exports = router;
