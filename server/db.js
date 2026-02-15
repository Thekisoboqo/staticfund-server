const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Initialize tables
async function initDB() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                name TEXT,
                province TEXT,
                city TEXT,
                monthly_spend REAL DEFAULT 0,
                monthly_budget REAL,
                household_size TEXT,
                property_type TEXT,
                has_pool BOOLEAN DEFAULT false,
                cooking_fuel TEXT,
                work_from_home TEXT,
                latitude REAL,
                longitude REAL,
                onboarding_completed BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS devices (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                name TEXT NOT NULL,
                watts REAL NOT NULL,
                quantity INTEGER DEFAULT 1,
                hours_per_day REAL DEFAULT 0,
                category TEXT,
                surge_watts REAL,
                image_uri TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            );

            CREATE TABLE IF NOT EXISTS quotations (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                package_tier TEXT NOT NULL,
                package_data TEXT,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        console.log('PostgreSQL tables initialized');
    } catch (err) {
        console.error('DB init error:', err.message);
    }
}

initDB();

module.exports = pool;
