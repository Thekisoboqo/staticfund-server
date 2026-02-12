/**
 * SQLite Database Backup Script
 * Creates timestamped backups of staticfund.db
 */
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'staticfund.db');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
const MAX_BACKUPS = 7; // Keep last 7 backups

function backup() {
    console.log('📦 Starting database backup...');

    // Ensure backup directory exists
    if (!fs.existsSync(BACKUP_DIR)) {
        fs.mkdirSync(BACKUP_DIR, { recursive: true });
        console.log(`Created backup directory: ${BACKUP_DIR}`);
    }

    // Check if database exists
    if (!fs.existsSync(DB_PATH)) {
        console.error('❌ Database file not found:', DB_PATH);
        process.exit(1);
    }

    // Generate timestamped filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const backupName = `staticfund_${timestamp}.db`;
    const backupPath = path.join(BACKUP_DIR, backupName);

    try {
        // Copy database file
        fs.copyFileSync(DB_PATH, backupPath);
        console.log(`✅ Backup created: ${backupName}`);

        // Get backup file size
        const stats = fs.statSync(backupPath);
        console.log(`   Size: ${(stats.size / 1024).toFixed(2)} KB`);

        // Clean up old backups
        cleanOldBackups();

    } catch (err) {
        console.error('❌ Backup failed:', err.message);
        process.exit(1);
    }
}

function cleanOldBackups() {
    const files = fs.readdirSync(BACKUP_DIR)
        .filter(f => f.startsWith('staticfund_') && f.endsWith('.db'))
        .map(f => ({
            name: f,
            path: path.join(BACKUP_DIR, f),
            time: fs.statSync(path.join(BACKUP_DIR, f)).mtime.getTime()
        }))
        .sort((a, b) => b.time - a.time); // Newest first

    if (files.length > MAX_BACKUPS) {
        const toDelete = files.slice(MAX_BACKUPS);
        toDelete.forEach(f => {
            fs.unlinkSync(f.path);
            console.log(`🗑️  Deleted old backup: ${f.name}`);
        });
    }

    console.log(`📁 Total backups: ${Math.min(files.length, MAX_BACKUPS)}`);
}

// Run backup
backup();
