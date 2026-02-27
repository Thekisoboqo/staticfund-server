const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// V2 Schema — no auth, rooms, co-living, RAG
async function initDB() {
    try {
        await pool.query(`
            -- Users: location-based, no auth
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                code VARCHAR(10) UNIQUE NOT NULL,
                city VARCHAR(100),
                province VARCHAR(100),
                latitude NUMERIC(10,7),
                longitude NUMERIC(10,7),
                push_token TEXT,
                lifestyle_context TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            );

            -- Homes: shared spaces for co-living
            CREATE TABLE IF NOT EXISTS homes (
                id SERIAL PRIMARY KEY,
                share_code VARCHAR(8) UNIQUE NOT NULL,
                name VARCHAR(100) DEFAULT 'My Home',
                created_by INTEGER REFERENCES users(id),
                monthly_budget NUMERIC(10,2),
                budget_remaining NUMERIC(10,2),
                meter_number VARCHAR(20),
                created_at TIMESTAMP DEFAULT NOW()
            );

            -- Home members
            CREATE TABLE IF NOT EXISTS home_members (
                id SERIAL PRIMARY KEY,
                home_id INTEGER REFERENCES homes(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                role VARCHAR(20) DEFAULT 'member',
                joined_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(home_id, user_id)
            );

            -- Rooms
            CREATE TABLE IF NOT EXISTS rooms (
                id SERIAL PRIMARY KEY,
                home_id INTEGER REFERENCES homes(id) ON DELETE CASCADE,
                name VARCHAR(50) NOT NULL,
                icon VARCHAR(30) DEFAULT 'cube-outline',
                created_by INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT NOW()
            );

            -- Devices (appliances)
            CREATE TABLE IF NOT EXISTS devices (
                id SERIAL PRIMARY KEY,
                room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id),
                home_id INTEGER REFERENCES homes(id) ON DELETE CASCADE,
                name VARCHAR(100) NOT NULL,
                brand VARCHAR(100),
                model VARCHAR(100),
                watts INTEGER NOT NULL,
                hours_per_day NUMERIC(4,1) DEFAULT 4,
                days_per_week INTEGER DEFAULT 7,
                image_thumbnail TEXT,
                ai_confidence VARCHAR(10),
                ai_tip TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            );

            -- Shared appliance knowledge base (RAG)
            CREATE TABLE IF NOT EXISTS appliance_knowledge (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                brand VARCHAR(100),
                model VARCHAR(100),
                watts INTEGER NOT NULL,
                category VARCHAR(50),
                times_confirmed INTEGER DEFAULT 1,
                avg_hours_per_day NUMERIC(4,1),
                region VARCHAR(100),
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            );

            -- Chat messages for AI consultant
            CREATE TABLE IF NOT EXISTS chat_messages (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                role VARCHAR(10) NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            );

            -- Electricity purchases for meter tracking
            CREATE TABLE IF NOT EXISTS electricity_purchases (
                id SERIAL PRIMARY KEY,
                home_id INTEGER REFERENCES homes(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id),
                amount_rand NUMERIC(10,2) NOT NULL,
                kwh_purchased NUMERIC(10,2) NOT NULL,
                rate_per_kwh NUMERIC(6,2) NOT NULL,
                notes TEXT,
                purchased_at TIMESTAMP DEFAULT NOW(),
                created_at TIMESTAMP DEFAULT NOW()
            );
        `);
        console.log('✅ V2 Database schemas created/verified');

        // Add missing V2 columns to V1 tables using try-catch blocks to ignore 'column already exists' errors
        const alters = [
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS code VARCHAR(10)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS city VARCHAR(100)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS province VARCHAR(100)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS latitude NUMERIC(10,7)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS longitude NUMERIC(10,7)",
            "ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token TEXT",
            "ALTER TABLE homes ADD COLUMN IF NOT EXISTS share_code VARCHAR(8)",
            "ALTER TABLE homes ADD COLUMN IF NOT EXISTS name VARCHAR(100) DEFAULT 'My Home'",
            "ALTER TABLE homes ADD COLUMN IF NOT EXISTS monthly_budget NUMERIC(10,2)",
            "ALTER TABLE homes ADD COLUMN IF NOT EXISTS budget_remaining NUMERIC(10,2)",
            "ALTER TABLE homes ADD COLUMN IF NOT EXISTS meter_number VARCHAR(20)",
            "ALTER TABLE devices ADD COLUMN IF NOT EXISTS home_id INTEGER REFERENCES homes(id) ON DELETE CASCADE",
            "ALTER TABLE devices ADD COLUMN IF NOT EXISTS room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE",
            "ALTER TABLE devices ADD COLUMN IF NOT EXISTS brand VARCHAR(100)",
            "ALTER TABLE devices ADD COLUMN IF NOT EXISTS model VARCHAR(100)",
            "ALTER TABLE devices ADD COLUMN IF NOT EXISTS days_per_week INTEGER DEFAULT 7",
            "ALTER TABLE devices ADD COLUMN IF NOT EXISTS image_thumbnail TEXT",
            "ALTER TABLE devices ADD COLUMN IF NOT EXISTS ai_confidence VARCHAR(10)",
            "ALTER TABLE devices ADD COLUMN IF NOT EXISTS ai_tip TEXT"
        ];

        for (const query of alters) {
            try { await pool.query(query); } catch (e) { /* ignore if already exists */ }
        }

        // Apply unique constraints safely
        try { await pool.query("ALTER TABLE users ADD CONSTRAINT users_code_key UNIQUE (code)"); } catch (e) { }
        try { await pool.query("ALTER TABLE homes ADD CONSTRAINT homes_share_code_key UNIQUE (share_code)"); } catch (e) { }

        // Remove legacy V1 constraints that break V2 auto-creation
        try { await pool.query("ALTER TABLE users ALTER COLUMN email DROP NOT NULL"); } catch (e) { }
        try { await pool.query("ALTER TABLE users ALTER COLUMN password DROP NOT NULL"); } catch (e) { }
        try { await pool.query("ALTER TABLE users ALTER COLUMN name DROP NOT NULL"); } catch (e) { }
        try { await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS lifestyle_context TEXT"); } catch (e) { }

        console.log('✅ V2 columns verified on legacy tables');

    } catch (err) {
        console.error('DB init error:', err.message);
    }
}

initDB();

module.exports = pool;
