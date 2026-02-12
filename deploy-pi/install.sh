#!/bin/bash
# StaticFund Pi Installation Script v2
# Run on Raspberry Pi Zero 2W
# Includes security hardening setup

set -e

echo "🔧 StaticFund Pi Installer v2 (Hardened)"
echo "========================================="

# Check if running on Pi
if ! grep -q "Raspberry Pi" /proc/cpuinfo 2>/dev/null; then
    echo "⚠️  Warning: This doesn't appear to be a Raspberry Pi"
fi

# Update system
echo ""
echo "📦 Updating system packages..."
sudo apt update

# Install Node.js 20 LTS
echo ""
echo "📦 Installing Node.js 20..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
fi

echo "   Node version: $(node -v)"
echo "   NPM version: $(npm -v)"

# Install build tools for native modules (better-sqlite3, bcrypt)
echo ""
echo "📦 Installing build tools..."
sudo apt install -y build-essential python3

# Install dependencies
echo ""
echo "📦 Installing npm packages..."
echo "   (This may take a few minutes on Pi Zero 2W)"
npm install

# Initialize database
echo ""
echo "🗄️  Initializing SQLite database..."
npm run init-db

# Create .env from example
if [ ! -f .env ]; then
    echo ""
    echo "📝 Creating .env file..."
    cp .env.example .env
    
    # Generate a random JWT secret
    JWT_SECRET=$(openssl rand -hex 32)
    sed -i "s/change_this_to_a_random_string_at_least_32_chars/$JWT_SECRET/" .env
    
    echo "⚠️  Please edit .env and add your GOOGLE_API_KEY!"
fi

# Create backups directory
echo ""
echo "📁 Creating backups directory..."
mkdir -p backups

# Setup systemd service
echo ""
echo "🔧 Setting up systemd service..."
sudo cp staticfund.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable staticfund

# Setup daily backup cron job
echo ""
echo "⏰ Setting up daily backup cron job..."
CRON_JOB="0 3 * * * cd $(pwd) && /usr/bin/node scripts/backup.js >> backups/backup.log 2>&1"
(crontab -l 2>/dev/null | grep -v "staticfund"; echo "$CRON_JOB") | crontab -

echo ""
echo "============================================="
echo "✅ Installation complete!"
echo "============================================="
echo ""
echo "📋 Next steps:"
echo ""
echo "1. Edit .env and add your GOOGLE_API_KEY:"
echo "   nano .env"
echo ""
echo "2. Start the server:"
echo "   sudo systemctl start staticfund"
echo ""
echo "3. Check logs:"
echo "   sudo journalctl -u staticfund -f"
echo ""
echo "4. Access dashboard:"
echo "   http://localhost:5001/public/dashboard.html"
echo ""
echo "5. Set up Cloudflare Tunnel for remote access:"
echo "   See CLOUDFLARE_TUNNEL.md"
echo ""
echo "🔒 Security features enabled:"
echo "   - bcrypt password hashing"
echo "   - JWT authentication"
echo "   - Rate limiting"
echo "   - Helmet security headers"
echo "   - Input validation"
echo ""
echo "📦 Daily backups scheduled at 3:00 AM"
echo ""
