# Cloudflare Tunnel Setup for Raspberry Pi

This guide helps you set up Cloudflare Tunnel so your mobile app can reach the StaticFund API from anywhere.

## Prerequisites

- Free Cloudflare account at [cloudflare.com](https://cloudflare.com)
- A domain (or use Cloudflare's free `.trycloudflare.com` subdomain)

## Step 1: Install cloudflared on Raspberry Pi

```bash
# Download ARM binary for Pi Zero 2W
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm -o cloudflared
chmod +x cloudflared
sudo mv cloudflared /usr/local/bin/
```

## Step 2: Authenticate with Cloudflare

```bash
cloudflared tunnel login
```

This opens a browser link. Login and authorize the domain you want to use.

## Step 3: Create a Tunnel

```bash
# Create a new tunnel
cloudflared tunnel create staticfund

# Note the Tunnel ID (UUID) printed - you'll need it
```

## Step 4: Create Config File

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: YOUR_TUNNEL_ID
credentials-file: /home/pi/.cloudflared/YOUR_TUNNEL_ID.json

ingress:
  - hostname: api.yourdomain.com
    service: http://localhost:5001
  - service: http_status:404
```

**Replace:**
- `YOUR_TUNNEL_ID` with the UUID from Step 3
- `api.yourdomain.com` with your subdomain

## Step 5: Create DNS Route

```bash
cloudflared tunnel route dns staticfund api.yourdomain.com
```

## Step 6: Test the Tunnel

```bash
cloudflared tunnel run staticfund
```

Visit `https://api.yourdomain.com/api/health` — you should see `{"status":"ok"}`.

## Step 7: Run as Systemd Service

```bash
# Install as service
sudo cloudflared service install

# Enable auto-start
sudo systemctl enable cloudflared
sudo systemctl start cloudflared

# Check status
sudo systemctl status cloudflared
```

## Alternative: Quick Tunnel (No Domain Required)

If you don't have a domain, use a temporary public URL:

```bash
cloudflared tunnel --url http://localhost:5001
```

This gives you a random `*.trycloudflare.com` URL. Note: URL changes each restart.

---

## Update Mobile App

After setting up the tunnel, update your mobile app's config:

```typescript
// mobile/src/config.ts
export const API_URL = 'https://api.yourdomain.com';
```
