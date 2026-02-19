require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { initTelegram, initDiscord } = require('./services/notifications');

const app = express();
const PORT = process.env.PORT || 3001;

// ── Security Middleware ────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',  // Restrict in production to your domain
  methods: ['GET', 'POST', 'PATCH', 'DELETE'],
}));
app.use(express.json({ limit: '1mb' }));

// Rate limiting — generous for desktop clients polling every 2s
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 300,               // 300 requests/min per IP (5/sec — plenty for polling)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down' },
});
app.use('/api/', apiLimiter);

// ── Routes ─────────────────────────────────────────────────────
app.use('/api/auth',    require('./routes/auth'));
app.use('/api/users',   require('./routes/users'));
app.use('/api/races',   require('./routes/races'));
app.use('/api/iracing', require('./routes/iracing'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[Unhandled Error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ──────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🏁 iRacing Enduro Server running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health\n`);

  // Init bots
  initTelegram();
  initDiscord();
});
