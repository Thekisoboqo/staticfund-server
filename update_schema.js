const pool = require('./db');

async function updateSchema() {
    try {
        console.log('Adding days_per_week column to usage_logs...');
        await pool.query('ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS days_per_week INTEGER DEFAULT 7;');
        console.log('Schema updated successfully!');
    } catch (err) {
        console.error('Error updating schema:', err);
    } finally {
        process.exit();
    }
}

updateSchema();
