const { Pool } = require('pg');
require('dotenv').config();

const USE_LOCAL_DB = process.env.USE_LOCAL_DB === 'true';
let pool;

if (USE_LOCAL_DB) {
    console.log('📦 Using LOCAL SQLite Database (staticfund.db)');
    const Database = require('better-sqlite3');
    const db = new Database('staticfund.db');
    
    // Polyfill pg pool.query for SQLite
    pool = {
        query: async (text, params = []) => {
            try {
                const sql = (typeof text === 'string' ? text : text.text) || '';
                const vals = params.length ? params : (text.values || []);
                
                // Convert $1, $2 to ?, ? for SQLite
                const normalizedSql = sql.replace(/\$(\d+)/g, (_, i) => '?');
                
                const upperSql = normalizedSql.trim().toUpperCase();
                
                if (upperSql.startsWith('SELECT')) {
                    const rows = db.prepare(normalizedSql).all(vals);
                    return { rows, rowCount: rows.length };
                } else if (upperSql.startsWith('CREATE') || upperSql.startsWith('ALTER') || upperSql.startsWith('DROP')) {
                    db.exec(normalizedSql);
                    return { rows: [], rowCount: 0 };
                } else {
                    const result = db.prepare(normalizedSql).run(vals);
                    return { rows: [], rowCount: result.changes, lastInsertRowid: result.lastInsertRowid };
                }
            } catch (err) {
                console.error('SQLite Query Error:', err.message);
                throw err;
            }
        }
    };
} else {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
}

// V2 Schema — no auth, rooms, co-living, RAG
async function initDB() {
    try {
        let sql = `
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code VARCHAR(10) UNIQUE NOT NULL,
                city VARCHAR(100),
                province VARCHAR(100),
                latitude NUMERIC,
                longitude NUMERIC,
                push_token TEXT,
                lifestyle_context TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS homes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                share_code VARCHAR(8) UNIQUE NOT NULL,
                name VARCHAR(100) DEFAULT 'My Home',
                created_by INTEGER REFERENCES users(id),
                monthly_budget NUMERIC,
                budget_remaining NUMERIC,
                meter_number VARCHAR(20),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS home_members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                home_id INTEGER REFERENCES homes(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                role VARCHAR(20) DEFAULT 'member',
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(home_id, user_id)
            );

            CREATE TABLE IF NOT EXISTS rooms (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                home_id INTEGER REFERENCES homes(id) ON DELETE CASCADE,
                name VARCHAR(50) NOT NULL,
                icon VARCHAR(30) DEFAULT 'cube-outline',
                created_by INTEGER REFERENCES users(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS devices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id),
                home_id INTEGER REFERENCES homes(id) ON DELETE CASCADE,
                name VARCHAR(100) NOT NULL,
                brand VARCHAR(100),
                model VARCHAR(100),
                watts INTEGER NOT NULL,
                hours_per_day NUMERIC DEFAULT 4,
                days_per_week INTEGER DEFAULT 7,
                image_thumbnail TEXT,
                ai_confidence VARCHAR(10),
                ai_tip TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS appliance_knowledge (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name VARCHAR(100) NOT NULL,
                brand VARCHAR(100),
                model VARCHAR(100),
                watts INTEGER NOT NULL,
                category VARCHAR(50),
                times_confirmed INTEGER DEFAULT 1,
                avg_hours_per_day NUMERIC,
                region VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                role VARCHAR(10) NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS electricity_purchases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                home_id INTEGER REFERENCES homes(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id),
                amount_rand NUMERIC NOT NULL,
                kwh_purchased NUMERIC,
                rate_per_kwh NUMERIC,
                notes TEXT,
                purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS community_intelligence (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                topic VARCHAR(100),
                context_data TEXT, -- SQLite uses TEXT for JSON
                confidence REAL,
                discovered_by_home_id INTEGER REFERENCES homes(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS water_readings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                home_id INTEGER REFERENCES homes(id) ON DELETE CASCADE,
                reading_liters INTEGER,
                recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS garden_plots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                home_id INTEGER REFERENCES homes(id) ON DELETE CASCADE,
                plot_name VARCHAR(100),
                crop_types TEXT,
                latitude REAL,
                longitude REAL,
                soil_moisture_estimate REAL,
                last_watered TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS installers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                company_name VARCHAR(255) NOT NULL,
                city VARCHAR(100),
                province VARCHAR(100),
                latitude REAL,
                longitude REAL,
                service_radius_km INTEGER DEFAULT 50,
                rating REAL DEFAULT 4.5,
                specializations TEXT, 
                contact_email VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS market_leads (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                home_id INTEGER REFERENCES homes(id) ON DELETE CASCADE,
                installer_id INTEGER REFERENCES installers(id) ON DELETE SET NULL,
                lead_report TEXT,
                status VARCHAR(20) DEFAULT 'NEW',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS installer_hardware (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                installer_id INTEGER REFERENCES installers(id) ON DELETE CASCADE,
                type VARCHAR(50), -- 'inverter', 'battery', 'panel', 'cable'
                brand VARCHAR(100),
                model VARCHAR(100),
                specs TEXT, -- SQLite JSON
                price_rand NUMERIC,
                image_url TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS site_designs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                home_id INTEGER REFERENCES homes(id) ON DELETE CASCADE,
                installer_id INTEGER REFERENCES installers(id) ON DELETE SET NULL,
                roof_type VARCHAR(50), -- 'flat', 'slanted'
                panel_count INTEGER,
                panel_layout TEXT, -- SQLite JSON (coordinates, orientation)
                orientation_degrees INTEGER,
                shading_analysis TEXT,
                wire_sizing_json TEXT, -- Wire gauge, distance, voltage drop
                battery_placement_notes TEXT,
                is_wind_suitable BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;

        // If not SQLite, use Original PG Types
        if (!USE_LOCAL_DB) {
            sql = sql.replace(/INTEGER PRIMARY KEY AUTOINCREMENT/g, 'SERIAL PRIMARY KEY')
                     .replace(/TEXT -- SQLite/g, 'JSONB')
                     .replace(/CURRENT_TIMESTAMP/g, 'NOW()')
                     .replace(/specializations TEXT/g, 'specializations TEXT[]')
                     .replace(/lead_report TEXT/g, 'lead_report JSONB');
        }

        await pool.query(sql);
        console.log(`✅ ${USE_LOCAL_DB ? 'SQLite' : 'PostgreSQL'} Database schemas created/verified`);

        if (!USE_LOCAL_DB) {
            // Seed some installers if table is empty
            const instCount = await pool.query('SELECT COUNT(*) FROM installers');
            if (parseInt(instCount.rows[0].count) === 0) {
                console.log('🌱 Seeding installers...');
                const seedInstallers = [
                    ['Bloem Solar Tech', 'Bloemfontein', 'Free State', -29.118, 26.223, 100, 4.8, ['residential', 'off-grid'], 'sales@bloemsolar.co.za'],
                    ['Mangaung Energy Solutions', 'Bloemfontein', 'Free State', -29.155, 26.199, 50, 4.5, ['commercial', 'residential'], 'info@mangaungenergy.com']
                ];
                for (const inst of seedInstallers) {
                    await pool.query(`
                        INSERT INTO installers (company_name, city, province, latitude, longitude, service_radius_km, rating, specializations, contact_email)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    `, inst);
                }
            }

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
        } else {
            // SQLite specific seeding (since array syntax differs)
            const instCount = await pool.query('SELECT COUNT(*) FROM installers');
            if (parseInt(instCount.rows[0].count) === 0) {
                console.log('🌱 Seeding installers (SQLite)...');
                await pool.query("INSERT INTO installers (company_name, city, province, latitude, longitude, service_radius_km, rating, specializations, contact_email) VALUES ('Bloem Solar Tech', 'Bloemfontein', 'Free State', -29.118, 26.223, 100, 4.8, 'residential, off-grid', 'sales@bloemsolar.co.za')");
                await pool.query("INSERT INTO installers (company_name, city, province, latitude, longitude, service_radius_km, rating, specializations, contact_email) VALUES ('Mangaung Energy Solutions', 'Bloemfontein', 'Free State', -29.155, 26.199, 50, 4.5, 'commercial, residential', 'info@mangaungenergy.com')");
            }
        }

    } catch (err) {
        console.error('DB init error:', err.message);
    }
}

// Only auto-initialize if it's the main entry point or explicitly requested
// (In production, we often call initDB manually during startup)
if (require.main === module) {
    initDB();
}

module.exports = Object.assign(pool, { initDB });
