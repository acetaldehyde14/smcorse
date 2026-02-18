# Windows Deployment Guide

This guide will help you deploy your authentication app on Windows and connect it to your custom domain.

## Prerequisites

1. **Node.js** - Download and install from https://nodejs.org/ (use LTS version)
2. **Git** (optional) - For version control
3. **A Windows server or PC** - Can be your local machine or a cloud server
4. **Custom domain** - Your domain registered with a domain registrar

## Step 1: Setup the Application

1. Open Command Prompt or PowerShell as Administrator

2. Navigate to your desired directory:
```cmd
cd C:\
mkdir websites
cd websites
```

3. Copy all the project files to this directory, or clone from Git

4. Install dependencies:
```cmd
cd auth-app
npm install
```

## Step 2: Test Locally

1. Start the server:
```cmd
npm start
```

2. Open your browser and go to http://localhost:3000

3. Test the signup and login functionality

4. Press Ctrl+C to stop the server

## Step 3: Configure for Production

1. Edit the `.env` file and change the SESSION_SECRET to a random string:
```
SESSION_SECRET=your-very-secure-random-string-here-make-it-long
```

2. If using HTTPS (recommended), update `server.js`:
   - Find `secure: false` in the session config
   - Change it to `secure: true`

## Step 4: Install PM2 (Process Manager)

PM2 keeps your app running continuously and restarts it if it crashes.

```cmd
npm install -g pm2
npm install -g pm2-windows-startup
```

Configure PM2 to start on Windows boot:
```cmd
pm2-startup install
```

## Step 5: Start Your App with PM2

1. Navigate to your app directory:
```cmd
cd C:\websites\auth-app
```

2. Start the app with PM2:
```cmd
pm2 start server.js --name "max-auth-app"
```

3. Save the PM2 configuration:
```cmd
pm2 save
```

4. Check the status:
```cmd
pm2 status
```

5. View logs:
```cmd
pm2 logs max-auth-app
```

## Step 6: Configure Firewall

Allow Node.js through Windows Firewall:

1. Open Windows Defender Firewall
2. Click "Advanced settings"
3. Click "Inbound Rules" → "New Rule"
4. Select "Port" → Next
5. Select "TCP" and enter port "3000" → Next
6. Select "Allow the connection" → Next
7. Apply to all profiles → Next
8. Name it "Node.js App" → Finish

## Step 7: Setup Reverse Proxy (Optional but Recommended)

### Option A: Using IIS (Internet Information Services)

1. Install IIS:
   - Open "Turn Windows features on or off"
   - Enable "Internet Information Services"
   - Enable "Web Management Tools" and "World Wide Web Services"

2. Install IIS URL Rewrite Module:
   - Download from: https://www.iis.net/downloads/microsoft/url-rewrite

3. Install IIS Application Request Routing (ARR):
   - Download from: https://www.iis.net/downloads/microsoft/application-request-routing

4. Configure ARR:
   - Open IIS Manager
   - Click on your server name
   - Double-click "Application Request Routing Cache"
   - Click "Server Proxy Settings" on the right
   - Check "Enable proxy"
   - Click Apply

5. Create a website in IIS:
   - Right-click "Sites" → "Add Website"
   - Site name: max-auth-app
   - Physical path: C:\websites\auth-app\public
   - Binding: Port 80, Host name: yourdomain.com

6. Add URL Rewrite Rule:
   - Select your website
   - Double-click "URL Rewrite"
   - Click "Add Rule(s)" → "Reverse Proxy"
   - Enter: localhost:3000
   - Click OK

### Option B: Using Nginx on Windows

1. Download Nginx for Windows: http://nginx.org/en/download.html

2. Extract to C:\nginx

3. Edit C:\nginx\conf\nginx.conf:

```nginx
http {
    server {
        listen 80;
        server_name yourdomain.com www.yourdomain.com;

        location / {
            proxy_pass http://localhost:3000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
}
```

4. Start Nginx:
```cmd
cd C:\nginx
start nginx
```

5. To stop Nginx:
```cmd
nginx -s stop
```

6. To reload configuration:
```cmd
nginx -s reload
```

## Step 8: Point Your Domain to Your Server

1. Get your server's public IP address:
   - If on local network: Use your router's public IP
   - If on cloud (AWS, Azure, etc.): Get the instance IP from console

2. Configure DNS at your domain registrar:
   - Add an A record pointing to your server IP:
     - Type: A
     - Name: @ (or www)
     - Value: Your server IP address
     - TTL: 3600

3. Wait for DNS propagation (can take up to 48 hours, usually much faster)

## Step 9: Configure Port Forwarding (If on Local Network)

If you're hosting on your local computer:

1. Access your router's admin panel (usually 192.168.1.1 or 192.168.0.1)
2. Find "Port Forwarding" settings
3. Create new rule:
   - External port: 80
   - Internal port: 80 (if using IIS/Nginx) or 3000 (if direct)
   - Internal IP: Your computer's local IP
   - Protocol: TCP

## Step 10: Setup HTTPS with SSL Certificate (Highly Recommended)

### Using Certbot (Let's Encrypt) - Free SSL

1. Download Certbot for Windows from: https://certbot.eff.org/

2. Run Certbot:
```cmd
certbot certonly --standalone -d yourdomain.com -d www.yourdomain.com
```

3. Certificates will be saved to: C:\Certbot\live\yourdomain.com\

4. Update your Nginx or IIS configuration to use SSL:

For Nginx, add to nginx.conf:
```nginx
server {
    listen 443 ssl;
    server_name yourdomain.com www.yourdomain.com;

    ssl_certificate C:/Certbot/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key C:/Certbot/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        # ... rest of proxy settings
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    return 301 https://$server_name$request_uri;
}
```

5. Restart Nginx:
```cmd
nginx -s reload
```

## Step 11: Customize Your Image

To replace the placeholder image with your own:

1. Place your image in: `C:\websites\auth-app\public\images\`
2. Edit `public/index.html`
3. Find the line with the Unsplash image URL
4. Replace with: `src="/images/your-image.jpg"`

## Useful PM2 Commands

```cmd
pm2 list                    # List all running apps
pm2 stop max-auth-app       # Stop the app
pm2 restart max-auth-app    # Restart the app
pm2 delete max-auth-app     # Remove from PM2
pm2 logs max-auth-app       # View logs
pm2 monit                   # Monitor CPU/Memory usage
```

## Troubleshooting

### Can't access from outside network
- Check Windows Firewall rules
- Verify port forwarding on router
- Confirm DNS A record is correct
- Check if ISP blocks port 80 (some do)

### App crashes on startup
```cmd
pm2 logs max-auth-app --err
```

### Database issues
- Ensure `users.db` has write permissions
- Check if SQLite is properly installed

### Session issues
- Verify SESSION_SECRET is set in `.env`
- For HTTPS, ensure `secure: true` in session config

### Port already in use
```cmd
netstat -ano | findstr :3000
taskkill /PID <process_id> /F
```

## Security Recommendations

1. **Change default port** - Edit PORT in `.env` to something other than 3000
2. **Use HTTPS** - Always use SSL certificates in production
3. **Strong session secret** - Use a long random string (32+ characters)
4. **Regular updates** - Keep Node.js and dependencies updated:
   ```cmd
   npm update
   ```
5. **Backup database** - Regularly backup `users.db`
6. **Rate limiting** - Consider adding rate limiting to prevent brute force
7. **Enable Windows Updates** - Keep your server updated

## Cloud Deployment Alternatives

If you prefer cloud hosting instead of Windows server:

- **Heroku** - Easy deployment, free tier available
- **DigitalOcean** - Windows droplets available
- **AWS EC2** - Windows instances with full control
- **Azure** - Microsoft's cloud platform
- **Google Cloud** - Windows VM instances

## Support

For issues or questions:
1. Check PM2 logs: `pm2 logs`
2. Check Node.js version: `node --version`
3. Verify all dependencies: `npm list`

Your app is now deployed and accessible at your custom domain!
