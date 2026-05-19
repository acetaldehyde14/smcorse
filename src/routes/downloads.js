const express = require('express');
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const { authenticateToken } = require('../middleware/auth');
const { query } = require('../config/database');

const router = express.Router();

const downloadsDir = path.join(__dirname, '../../public/downloads');
const manifestPath = path.join(downloadsDir, 'downloads.json');

if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir, { recursive: true });

function safeFileName(name) {
  const ext = path.extname(name).toLowerCase();
  const base = path.basename(name, ext)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'download';
  return `${Date.now()}-${base}${ext}`;
}

function readManifest() {
  try {
    if (!fs.existsSync(manifestPath)) return [];
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeManifest(files) {
  fs.writeFileSync(manifestPath, JSON.stringify(files, null, 2));
}

function directFileEntries() {
  return fs.readdirSync(downloadsDir, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name !== 'downloads.json')
    .map(entry => {
      const stats = fs.statSync(path.join(downloadsDir, entry.name));
      return {
        id: entry.name,
        title: path.basename(entry.name, path.extname(entry.name)),
        description: '',
        originalName: entry.name,
        filename: entry.name,
        size: stats.size,
        uploadedAt: stats.mtime.toISOString(),
      };
    });
}

async function requireAdminApi(req, res, next) {
  try {
    const result = await query('SELECT is_admin FROM users WHERE id = $1', [req.user.id]);
    if (result.rows[0]?.is_admin) return next();
    return res.status(403).json({ error: 'Admin access required' });
  } catch (err) {
    console.error('[Downloads] admin check error:', err.message);
    return res.status(500).json({ error: 'Auth check failed' });
  }
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, downloadsDir),
    filename: (req, file, cb) => cb(null, safeFileName(file.originalname)),
  }),
  limits: { fileSize: 250 * 1024 * 1024 },
});

router.get('/', (req, res) => {
  const manifestFiles = readManifest();
  const knownNames = new Set(manifestFiles.map(file => file.filename));
  const files = [
    ...manifestFiles,
    ...directFileEntries().filter(file => !knownNames.has(file.filename)),
  ]
    .filter(file => file && file.filename)
    .map(file => ({
      id: file.id,
      title: file.title,
      description: file.description,
      originalName: file.originalName,
      size: file.size,
      uploadedAt: file.uploadedAt,
      url: `/api/downloads/${encodeURIComponent(file.filename)}`,
    }))
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

  res.json({ files });
});

router.post('/', authenticateToken, requireAdminApi, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const files = readManifest();
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: (req.body.title || req.file.originalname).trim(),
    description: (req.body.description || '').trim(),
    originalName: req.file.originalname,
    filename: req.file.filename,
    size: req.file.size,
    uploadedAt: new Date().toISOString(),
  };

  files.push(entry);
  writeManifest(files);

  res.status(201).json({
    file: {
      ...entry,
      url: `/api/downloads/${encodeURIComponent(entry.filename)}`,
    },
  });
});

router.get('/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(downloadsDir, filename);

  if (!filePath.startsWith(downloadsDir) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.download(filePath);
});

module.exports = router;
