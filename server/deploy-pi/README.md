# StaticFund Pi Deployment

Lightweight energy audit backend for Raspberry Pi Zero 2W.

## Quick Start

### On Windows (Test First)

```powershell
cd deploy-pi
npm install
npm run init-db
node index.js
```

### On Raspberry Pi

1. Copy this folder to your Pi:
   ```bash
   scp -r deploy-pi pi@raspberrypi.local:~/staticfund
   ```

2. SSH into Pi and run installer:
   ```bash
   ssh pi@raspberrypi.local
   cd staticfund
   chmod +x install.sh
   ./install.sh
   ```

3. Add your Gemini API key:
   ```bash
   nano .env
   # Add: GOOGLE_API_KEY=your_key_here
   ```

4. Start the server:
   ```bash
   sudo systemctl start staticfund
   ```

5. Test it works:
   ```bash
   curl http://localhost:5001/api/health
   ```

## Remote Access

See [CLOUDFLARE_TUNNEL.md](./CLOUDFLARE_TUNNEL.md) for setting up remote access.

## Files

| File | Purpose |
|------|---------|
| `index.js` | Main Express server |
| `db.js` | SQLite database connection |
| `schema.sql` | Database schema |
| `init-db.js` | Database initializer |
| `install.sh` | Pi setup script |
| `staticfund.service` | Systemd service file |

## Differences from Main Server

- SQLite instead of PostgreSQL (no separate DB server)
- Lighter memory footprint (~50MB vs ~200MB)
- All data in single file: `staticfund.db`
