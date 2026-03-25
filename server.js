const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL database connection
const { pool, query } = require('./src/config/database');
const llamaClient = require('./src/config/llama');

// Import routes
const telemetryRoutes = require('./src/routes/telemetry');
const analysisRoutes = require('./src/routes/analysis');
const libraryRoutes = require('./src/routes/library');
const assistantRoutes = require('./src/routes/assistant');
const teamRoutes = require('./src/routes/team');
const racesRoutes = require('./src/routes/races');
const iracingRoutes = require('./src/routes/iracing');
const { handleUploadError } = require('./src/middleware/upload');
const { authenticateToken } = require('./src/middleware/auth');
const { initTelegram, initDiscord, shutdownBots } = require('./src/services/notifications');

// Middleware
app.use(helmet({
  contentSecurityPolicy: false, // Allow inline scripts for our HTML pages
}));
app.use(compression());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Session configuration (existing auth system)
app.use(session({
  secret: process.env.SESSION_SECRET || '04gwxdq2jNvXEFb7nkryWcMl9pua3sizLV1QTZIJDmfGePohBYUCS6t85HKARO',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true if using HTTPS
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Auth middleware
const requireAuth = (req, res, next) => {
  if (req.session.userId) {
    next();
  } else {
    res.redirect('/');
  }
};

// ============================================
// AUTHENTICATION ROUTES (Session-based)
// ============================================

app.get('/', (req, res) => {
  if (req.session.userId) {
    res.redirect('/dashboard');
  } else {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

app.get('/dashboard', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/settings', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'settings.html'));
});

app.post('/api/signup', async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  // Check password strength
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    // Check if user already exists (PostgreSQL)
    const existingUser = await query('SELECT * FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert user (PostgreSQL)
    const result = await query(
      'INSERT INTO users (email, password_hash, username) VALUES ($1, $2, $3) RETURNING id, username',
      [email, hashedPassword, name]
    );

    // Create session
    req.session.userId = result.rows[0].id;
    req.session.userName = result.rows[0].username;

    res.json({ success: true, message: 'Account created successfully' });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ error: 'An error occurred during signup' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    // Find user (PostgreSQL)
    const result = await query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Update last login
    await query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);

    // Create session
    req.session.userId = user.id;
    req.session.userName = user.username;

    res.json({ success: true, message: 'Login successful' });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'An error occurred during login' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

app.get('/api/user', requireAuth, async (req, res) => {
  try {
    const result = await query(
      'SELECT id, email, username, iracing_id, iracing_rating, created_at FROM users WHERE id = $1',
      [req.session.userId]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to fetch user data' });
  }
});

// ============================================
// JWT AUTH ROUTES (Desktop Client)
// ============================================

// POST /api/auth/login — username+password login, returns JWT token
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password are required' });
  }

  try {
    const result = await query(
      'SELECT id, username, password_hash, iracing_name FROM users WHERE username = $1',
      [username]
    );
    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '90d' }
    );

    res.json({ token, user: { id: user.id, username: user.username, iracing_name: user.iracing_name } });
  } catch (error) {
    console.error('[Auth login]', error.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/validate — desktop app verifies stored token on startup
app.post('/api/auth/validate', authenticateToken, (req, res) => {
  res.json({ valid: true, user: req.user });
});

// ============================================
// TELEMETRY, ANALYSIS & RACE ROUTES
// ============================================

// Unified auth middleware for API routes — sets req.userId for legacy route compatibility
const attachUserId = (req, res, next) => {
  authenticateToken(req, res, () => {
    req.userId = req.user.id;
    next();
  });
};

app.use('/api/telemetry', attachUserId);
app.use('/api/analysis', attachUserId);
app.use('/api/library', attachUserId);
app.use('/api/assistant', attachUserId);

// Mount routes
app.use('/api/telemetry', telemetryRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/races', racesRoutes);
app.use('/api/iracing', iracingRoutes);

// Serve uploaded files (protected)
app.use('/uploads', requireAuth, express.static(path.join(__dirname, 'uploads')));

// ============================================
// ADMIN ROUTES
// ============================================

const requireAdmin = async (req, res, next) => {
  if (!req.session.userId) return res.redirect('/');
  try {
    const result = await query('SELECT is_admin FROM users WHERE id = $1', [req.session.userId]);
    if (result.rows[0]?.is_admin) return next();
    res.status(403).sendFile(path.join(__dirname, 'public', 'index.html'));
  } catch (e) {
    res.status(500).json({ error: 'Auth check failed' });
  }
};

app.get('/admin', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Stats overview
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const [users, sessions, laps, races, teamMembers] = await Promise.all([
      query('SELECT COUNT(*) FROM users'),
      query('SELECT COUNT(*) FROM sessions'),
      query('SELECT COUNT(*) FROM laps'),
      query('SELECT COUNT(*) FROM races'),
      query('SELECT COUNT(*) FROM team_members'),
    ]);
    res.json({
      users: parseInt(users.rows[0].count),
      sessions: parseInt(sessions.rows[0].count),
      laps: parseInt(laps.rows[0].count),
      races: parseInt(races.rows[0].count),
      teamMembers: parseInt(teamMembers.rows[0].count),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// User management
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const result = await query(
      'SELECT id, username, email, is_admin, created_at, last_login FROM users ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/admin/users/:id/admin', requireAdmin, async (req, res) => {
  const { is_admin } = req.body;
  if (parseInt(req.params.id) === req.session.userId) {
    return res.status(400).json({ error: 'Cannot change your own admin status' });
  }
  try {
    await query('UPDATE users SET is_admin = $1 WHERE id = $2', [!!is_admin, req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
  if (parseInt(req.params.id) === req.session.userId) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }
  try {
    await query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Race management
app.get('/api/admin/races', requireAdmin, async (req, res) => {
  try {
    const result = await query(
      `SELECT r.id, r.name, r.status, r.created_at,
              (SELECT COUNT(*) FROM race_roster WHERE race_id = r.id) AS driver_count
       FROM races r ORDER BY r.created_at DESC`
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/races/:id', requireAdmin, async (req, res) => {
  try {
    await query('DELETE FROM races WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Team members management
app.get('/api/admin/team', requireAdmin, async (req, res) => {
  try {
    const result = await query(
      'SELECT id, name, role, iracing_name, discord_id, telegram_chat_id, created_at FROM team_members ORDER BY name'
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/team/:id', requireAdmin, async (req, res) => {
  try {
    await query('DELETE FROM team_members WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================
// HEALTH CHECK & ERROR HANDLING
// ============================================

app.get('/health', async (req, res) => {
  try {
    // Check database
    await pool.query('SELECT 1');

    // Check Llama
    const llamaAvailable = await llamaClient.isAvailable();

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        database: 'connected',
        llama: llamaAvailable ? 'available' : 'unavailable'
      }
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

// Error handling for file uploads
app.use(handleUploadError);

// Global error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);

  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, '0.0.0.0', () => {
  // Get local network IP
  const os = require('os');
  const interfaces = os.networkInterfaces();
  let localIP = 'localhost';
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIP = iface.address;
        break;
      }
    }
  }

  console.log(`
╔════════════════════════════════════════════════════╗
║   SM CORSE - iRacing Team Platform                 ║
║   Local:   http://localhost:${PORT}                ║
║   Network: http://${localIP}:${PORT}        ║
╚════════════════════════════════════════════════════╝
  `);

  // Test database connection
  pool.query('SELECT NOW()', (err, res) => {
    if (err) {
      console.error('❌ Database connection failed:', err.message);
      console.log('   Make sure PostgreSQL is running and configured in .env');
    } else {
      console.log('✓ PostgreSQL connected successfully');
    }
  });

  // Test Llama connection
  llamaClient.isAvailable().then(available => {
    if (available) {
      console.log('✓ Remote Llama server available');
    } else {
      console.log('⚠ Remote Llama server not available');
      console.log('   Check connection to http://23.141.136.111:11434');
    }
  });

  // Initialize notification bots
  initTelegram();
  initDiscord();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  shutdownBots();
  pool.end(() => {
    console.log('Database connections closed');
    process.exit(0);
  });
});

module.exports = app;
