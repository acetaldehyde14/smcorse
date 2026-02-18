# Max Authentication Platform

A modern, secure authentication system with a distinctive retro-futuristic design aesthetic.

## Features

- ✅ **User Registration** - Secure signup with email validation
- ✅ **Login System** - Session-based authentication
- ✅ **Password Security** - Bcrypt hashing for passwords
- ✅ **SQLite Database** - Lightweight, serverless database
- ✅ **Responsive Design** - Works on desktop and mobile
- ✅ **Production Ready** - Built for deployment on Windows
- ✅ **Modern UI** - Retro-futuristic design with animations

## Tech Stack

- **Backend**: Node.js + Express
- **Database**: SQLite with better-sqlite3
- **Authentication**: bcryptjs + express-session
- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Fonts**: Google Fonts (Orbitron, Rajdhani)

## Project Structure

```
auth-app/
├── server.js              # Express server with all routes
├── package.json           # Dependencies
├── .env                   # Environment variables
├── users.db              # SQLite database (created on first run)
├── DEPLOYMENT.md         # Detailed Windows deployment guide
├── public/
│   ├── index.html        # Landing page with signup/login
│   └── dashboard.html    # Protected dashboard page
```

## Quick Start

### Local Development

1. **Install Node.js** (if not already installed)
   - Download from: https://nodejs.org/

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the server**
   ```bash
   npm start
   ```

4. **Open your browser**
   - Navigate to: http://localhost:3000

### First User

1. Click "Sign Up"
2. Enter your details:
   - Name
   - Email
   - Password (minimum 8 characters)
3. Click "Create Account"
4. You'll be automatically logged in and redirected to the dashboard

## API Endpoints

### Authentication

- `POST /api/signup` - Create new user account
  ```json
  {
    "name": "John Doe",
    "email": "john@example.com",
    "password": "securepass123"
  }
  ```

- `POST /api/login` - Login existing user
  ```json
  {
    "email": "john@example.com",
    "password": "securepass123"
  }
  ```

- `POST /api/logout` - Logout current user

- `GET /api/user` - Get current user info (requires authentication)

### Pages

- `GET /` - Landing page (redirects to dashboard if logged in)
- `GET /dashboard` - Protected dashboard (requires authentication)

## Environment Variables

Create a `.env` file with:

```env
PORT=3000
SESSION_SECRET=your-secure-random-secret-key
NODE_ENV=production
```

**Important**: Change the `SESSION_SECRET` to a long random string in production!

## Security Features

- **Password Hashing**: Uses bcrypt with 10 salt rounds
- **Session Management**: Secure server-side sessions
- **Input Validation**: Email format and password length checks
- **SQL Injection Prevention**: Prepared statements with better-sqlite3
- **XSS Protection**: Built-in Express security headers
- **CSRF Ready**: Can be enhanced with CSRF tokens

## Customization

### Change the Hero Image

1. Replace the Unsplash URL in `public/index.html`:
   ```html
   <img src="your-image-url.jpg" alt="Your Image">
   ```

### Modify Colors

Edit the CSS variables in `public/index.html` and `public/dashboard.html`:

```css
:root {
    --primary: #00ff41;      /* Main green */
    --secondary: #ff00ff;    /* Pink accent */
    --dark: #0a0e27;         /* Dark background */
    --surface: #1a1f3a;      /* Card background */
    --accent: #00d4ff;       /* Cyan accent */
    --text: #e0e6ff;         /* Text color */
}
```

### Change Branding

1. Update the logo text in both HTML files:
   ```html
   <div class="logo">YOUR BRAND</div>
   ```

2. Update page titles and content as needed

## Database Schema

### users table

```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

## Production Deployment

See **DEPLOYMENT.md** for comprehensive instructions on:
- Setting up on Windows Server
- Configuring IIS or Nginx
- Connecting your custom domain
- Setting up SSL certificates
- Using PM2 for process management
- Security best practices

## Troubleshooting

### Port already in use
```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <process_id> /F
```

### Database locked
- Ensure only one instance is running
- Check file permissions on `users.db`

### Session not persisting
- Verify SESSION_SECRET is set in `.env`
- Check browser cookies are enabled
- For HTTPS, set `secure: true` in session config

## Development Commands

```bash
npm start          # Start production server
npm run dev        # Start with nodemon (auto-reload)
```

## Browser Support

- Chrome/Edge: Full support
- Firefox: Full support
- Safari: Full support
- Mobile browsers: Responsive design

## Performance

- Lightweight: < 10MB total
- Fast startup: < 1 second
- Low memory: ~50MB RAM
- Database: SQLite (no separate server needed)

## License

MIT License - Feel free to use this for personal or commercial projects

## Contributing

This is a personal project, but suggestions are welcome!

## Future Enhancements

Potential features to add:
- Password reset via email
- Email verification
- OAuth integration (Google, GitHub)
- Two-factor authentication
- User profile editing
- Admin dashboard
- API rate limiting
- CSRF protection tokens
- Remember me functionality
- Session timeout warnings

---

Built with ⚡ by Max
