# 🏎️ iRacing Telemetry Coaching System

AI-powered coaching system for iRacing using Llama 3.3 70B to analyze telemetry data and provide personalized driving improvement advice.

## Features

✅ **Telemetry Upload & Parsing** - Support for .ibt, .blap, and .olap files  
✅ **Lap Comparison** - Corner-by-corner analysis vs reference laps  
✅ **AI Coaching** - Natural language coaching with Llama 3.3 70B  
✅ **Track Learning** - Progressive learning assistance for new tracks  
✅ **Reference Lap Library** - Compare against coach and community laps  
✅ **Progress Tracking** - Track improvement over time  
✅ **Chat Interface** - Ask questions and get instant coaching advice  

## Tech Stack

### Backend
- Node.js 18+ with Express
- PostgreSQL for data storage
- Ollama + Llama 3.3 70B for AI coaching
- Binary telemetry parsing (IBT/BLAP/OLAP)
- JWT authentication

### Frontend
- React 18
- Chart.js for telemetry visualization
- TailwindCSS for styling
- Axios for API communication

### Infrastructure
- Nginx reverse proxy
- PM2 process manager
- Windows compatible

## Quick Start

See [SETUP.md](SETUP.md) for complete installation instructions.

### Prerequisites

1. **Node.js 18+**
2. **PostgreSQL 15+**
3. **Nginx**
4. **Ollama with Llama 3.3 70B** (requires 64GB+ RAM)

### Installation

```bash
# 1. Clone/extract the project
cd C:\iracing-coach

# 2. Setup database
psql -U postgres -d iracing_coach -f database\schema.sql

# 3. Install backend
cd backend
npm install
copy .env.example .env
# Edit .env with your settings

# 4. Install Llama 3.3
ollama pull llama3.3:70b

# 5. Install frontend
cd ..\frontend
npm install
npm run build

# 6. Configure Nginx
# Copy nginx\iracing-coach.conf to your Nginx conf directory

# 7. Start everything
cd ..\backend
npm start
# In another terminal:
cd C:\nginx
start nginx
```

Visit http://localhost to use the system!

## Usage

### 1. Upload Telemetry

- Create an account or login
- Upload your .ibt, .blap, or .olap file from iRacing
- System automatically parses and saves the lap

### 2. Get Coaching

- Select your lap
- Choose a reference lap to compare against
- Click "Analyze & Coach"
- Receive detailed AI-powered coaching feedback

### 3. Track Progress

- View your sessions and lap times
- See improvement over time
- Identify weak corners
- Track consistency metrics

## Project Structure

```
iracing-coach/
├── backend/               # Node.js API server
│   ├── src/
│   │   ├── config/       # Database, Llama config
│   │   ├── middleware/   # Auth, upload handling
│   │   ├── routes/       # API endpoints
│   │   ├── services/     # Core logic (parser, comparison, coaching)
│   │   └── server.js     # Express app
│   ├── uploads/          # User-uploaded files
│   └── package.json
├── frontend/             # React application
│   ├── src/
│   │   ├── components/   # React components
│   │   └── services/     # API client
│   ├── public/
│   └── package.json
├── database/             # SQL schema
├── nginx/                # Nginx config
└── SETUP.md              # Detailed setup guide
```

## API Endpoints

### Authentication
- `POST /api/auth/signup` - Create account
- `POST /api/auth/login` - Login

### Telemetry
- `POST /api/telemetry/upload` - Upload file
- `GET /api/telemetry/sessions` - Get sessions
- `GET /api/telemetry/laps/:id/telemetry` - Get lap data

### Analysis
- `POST /api/analysis/compare` - Compare laps & get coaching
- `GET /api/analysis/coaching` - Get coaching history
- `POST /api/analysis/chat` - Chat with AI coach

### Library
- `GET /api/library/reference-laps` - Browse reference laps
- `GET /api/library/leaderboard` - Track/car leaderboards

## Development

### Backend Development
```bash
cd backend
npm run dev  # Auto-reload with nodemon
```

### Frontend Development
```bash
cd frontend
npm start    # React dev server on port 3001
```

### Testing Ollama
```bash
ollama run llama3.3:70b "Analyze this corner: entry 180km/h, apex 115km/h, exit 165km/h. Reference: entry 185km/h, apex 122km/h, exit 175km/h."
```

## Troubleshooting

### "Ollama not available"
- Ensure Ollama is running: Check Task Manager
- Verify model is pulled: `ollama list`
- Test connection: `curl http://localhost:11434/api/tags`

### "Database connection failed"
- Check PostgreSQL is running
- Verify credentials in .env
- Ensure database exists: `psql -U postgres -l`

### File upload fails
- Check uploads/ directories exist
- Verify file size < 50MB
- Check disk space

## Performance Notes

- **Llama 3.3 70B** requires 64GB+ RAM for optimal performance
- First AI response may take 10-30 seconds (model loading)
- Consider **Llama 3.3 8B** for lower-end hardware:
  ```bash
  ollama pull llama3.3:8b
  # Update .env: OLLAMA_MODEL=llama3.3:8b
  ```

## Future Enhancements

- [ ] Real-time telemetry streaming during practice
- [ ] Automatic lap comparison against your personal best
- [ ] Setup advisor (correlate setup changes with lap times)
- [ ] Race craft analysis (overtaking, defending, tire management)
- [ ] Mobile app
- [ ] Community features (share laps, leagues)
- [ ] Voice coaching during practice sessions

## License

Proprietary - For personal use only

## Support

For issues or questions, check:
1. Backend logs
2. Nginx error logs: `C:\nginx\logs\error.log`
3. PM2 logs: `pm2 logs`
4. SETUP.md troubleshooting section

## Credits

Built with:
- [Llama 3.3](https://ollama.com/) by Meta
- [Node.js](https://nodejs.org/)
- [React](https://react.dev/)
- [PostgreSQL](https://www.postgresql.org/)
- [Nginx](https://nginx.org/)

Happy racing and improving those lap times! 🏁
