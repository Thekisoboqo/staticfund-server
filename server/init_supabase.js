// Script to initialize Supabase database tables
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Required for Supabase
});

async function initSupabase() {
    console.log("Connecting to Supabase...");

    try {
        // Test connection
        const testResult = await pool.query('SELECT NOW()');
        console.log("✅ Connected! Server time:", testResult.rows[0].now);

        // Create tables
        console.log("Creating tables...");

        // Users
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                name VARCHAR(255),
                province VARCHAR(50),
                city VARCHAR(100),
                monthly_budget DECIMAL(10, 2) DEFAULT 0
            );
        `);
        console.log("✅ users table ready");

        // Devices
        await pool.query(`
            CREATE TABLE IF NOT EXISTS devices (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                watts INTEGER NOT NULL,
                surge_watts INTEGER DEFAULT 0,
                image_url TEXT,
                user_id INTEGER REFERENCES users(id)
            );
        `);
        console.log("✅ devices table ready");

        // Usage logs
        await pool.query(`
            CREATE TABLE IF NOT EXISTS usage_logs (
                id SERIAL PRIMARY KEY,
                device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
                hours_per_day NUMERIC(5, 2) NOT NULL,
                days_per_week INTEGER DEFAULT 7,
                date DATE DEFAULT CURRENT_DATE
            );
        `);
        console.log("✅ usage_logs table ready");

        // Habits
        await pool.query(`
            CREATE TABLE IF NOT EXISTS habits (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                title VARCHAR(255) NOT NULL,
                description TEXT,
                impact_level VARCHAR(10) DEFAULT 'MEDIUM'
            );
        `);
        console.log("✅ habits table ready");

        // User habit logs
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_habit_logs (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                habit_id INTEGER REFERENCES habits(id),
                date_completed DATE DEFAULT CURRENT_DATE
            );
        `);
        console.log("✅ user_habit_logs table ready");

        console.log("\n🎉 All tables created successfully!");
        process.exit(0);

    } catch (err) {
        console.error("❌ Error:", err.message);
        process.exit(1);
    }
}

initSupabase();
