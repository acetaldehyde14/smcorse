const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
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

// Import telemetry routes
const telemetryRoutes = require('./src/routes/telemetry');
const analysisRoutes = require('./src/routes/analysis');
const libraryRoutes = require('./src/routes/library');
const assistantRoutes = require('./src/routes/assistant');
const { handleUploadError } = require('./src/middleware/upload');

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
// TELEMETRY & ANALYSIS ROUTES (iRacing Coach)
// ============================================

// Middleware to attach user ID from session to req
app.use('/api/telemetry', (req, res, next) => {
  if (req.session.userId) {
    req.userId = req.session.userId;
    next();
  } else {
    res.status(401).json({ error: 'Authentication required' });
  }
});

app.use('/api/analysis', (req, res, next) => {
  if (req.session.userId) {
    req.userId = req.session.userId;
    next();
  } else {
    res.status(401).json({ error: 'Authentication required' });
  }
});

app.use('/api/library', (req, res, next) => {
  if (req.session.userId) {
    req.userId = req.session.userId;
    next();
  } else {
    res.status(401).json({ error: 'Authentication required' });
  }
});

app.use('/api/assistant', (req, res, next) => {
  if (req.session.userId) {
    req.userId = req.session.userId;
    next();
  } else {
    res.status(401).json({ error: 'Authentication required' });
  }
});

// Mount telemetry routes
app.use('/api/telemetry', telemetryRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/library', libraryRoutes);
app.use('/api/assistant', assistantRoutes);

// Serve uploaded files (protected)
app.use('/uploads', requireAuth, express.static(path.join(__dirname, 'uploads')));

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
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  pool.end(() => {
    console.log('Database connections closed');
    process.exit(0);
  });
});

module.exports = app;
