/**
 * Session-based Authentication Middleware
 * Replaces JWT auth to match the main authentication system
 */

/**
 * Verify user is authenticated via session
 */
const authenticateToken = (req, res, next) => {
  if (req.session && req.session.userId) {
    // Attach user info to req for compatibility with route handlers
    req.user = {
      id: req.session.userId,
      username: req.session.userName
    };
    next();
  } else {
    return res.status(401).json({ error: 'Authentication required' });
  }
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
  }
  next();
};

/**
 * Compatibility - not used in session-based auth
 * but kept for code that might reference it
 */
const generateToken = (user) => {
  // In session-based auth, we don't generate tokens
  // Just return null or a placeholder
  return null;
};

module.exports = {
  authenticateToken,
  generateToken,
  optionalAuth
};
