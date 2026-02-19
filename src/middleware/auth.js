/**
 * Dual Authentication Middleware
 * Supports session-based auth (web) and JWT Bearer tokens (desktop client).
 * Session is checked first; if absent, falls back to JWT.
 */

const jwt = require('jsonwebtoken');

/**
 * Verify user is authenticated via session OR JWT Bearer token.
 * Sets req.user = { id, username } for downstream handlers.
 */
const authenticateToken = (req, res, next) => {
  // 1. Try session first (web users)
  if (req.session && req.session.userId) {
    req.user = {
      id: req.session.userId,
      username: req.session.userName
    };
    return next();
  }

  // 2. Fall back to JWT Bearer token (desktop client)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = { id: decoded.id, username: decoded.username };
      return next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  }

  return res.status(401).json({ error: 'Authentication required' });
};

/**
 * Optional authentication (doesn't fail if not authenticated)
 */
const optionalAuth = (req, res, next) => {
  if (req.session && req.session.userId) {
    req.user = {
      id: req.session.userId,
      username: req.session.userName
    };
  } else {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const decoded = jwt.verify(authHeader.slice(7), process.env.JWT_SECRET);
        req.user = { id: decoded.id, username: decoded.username };
      } catch (err) {
        // Silent — optional auth
      }
    }
  }
  next();
};

/**
 * Generate a JWT token for a user (used by /api/auth/login)
 */
const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, username: user.username },
    process.env.JWT_SECRET,
    { expiresIn: '90d' }
  );
};

module.exports = {
  authenticateToken,
  generateToken,
  optionalAuth
};
