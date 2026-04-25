const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
require('dotenv').config();

// Import routes
const authRoutes = require('./routes/auth');
const telemetryRoutes = require('./routes/telemetry');
const analysisRoutes = require('./routes/analysis');
const libraryRoutes = require('./routes/library');

// Import middleware
const { handleUploadError } = require('./middleware/upload');

// Import config
const { pool } = require('./config/database');
const llamaClient = require('./config/llama');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet()); // Security headers
app.use(compression()); // Compress responses
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check
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

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/telemetry', telemetryRoutes);
app.use('/api/analysis', analysisRoutes);
app.use('/api/library', libraryRoutes);

// Serve uploaded files (protected)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

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

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════╗
║   iRacing Telemetry Coaching System                ║
║   Server running on http://localhost:${PORT}       ║
╚════════════════════════════════════════════════════╝
  `);
  
  // Test database connection
  pool.query('SELECT NOW()', (err, res) => {
    if (err) {
      console.error('❌ Database connection failed:', err.message);
    } else {
      console.log('✓ Database connected successfully');
    }
  });
  
  // Test Llama connection
  llamaClient.isAvailable().then(available => {
    if (available) {
      console.log('✓ Llama 3.3 70B available');
    } else {
      console.log('⚠ Llama 3.3 70B not available (start Ollama)');
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
