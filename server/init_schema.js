const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

async function initSchema() {
    try {
        // Create devices table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS devices (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                watts INTEGER NOT NULL,
                image_url TEXT,
                surge_watts INTEGER DEFAULT 0,
                user_id INTEGER
            );
        `);
        console.log('Successfully created devices table');

        // Create usage_logs table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS usage_logs (
                id SERIAL PRIMARY KEY,
                device_id INTEGER REFERENCES devices(id),
                hours_per_day NUMERIC(5, 2) NOT NULL,
                days_per_week INTEGER DEFAULT 7,
                date DATE DEFAULT CURRENT_DATE
            );
        `);
        console.log('Successfully created usage_logs table');

        console.log('All tables created successfully!');
    } catch (err) {
        console.error('Error creating schema:', err);
    } finally {
        await pool.end();
    }
}

initSchema();
