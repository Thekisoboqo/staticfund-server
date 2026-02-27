const pool = require('./db');

async function initOutages() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS power_outages (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                home_id INTEGER REFERENCES homes(id) ON DELETE SET NULL,
                city VARCHAR(100),
                province VARCHAR(100),
                status VARCHAR(20) DEFAULT 'ACTIVE',
                reported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                restored_at TIMESTAMP
            );
        `);
        console.log('power_outages table created or exists.');
        process.exit(0);
    } catch (err) {
        console.error('Error creating table:', err);
        process.exit(1);
    }
}

initOutages();
