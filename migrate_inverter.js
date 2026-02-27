/**
 * Migration: Add inverter_configs and inverter_readings tables
 * Run: node migrate_inverter.js
 */
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function migrate() {
    console.log('🔌 Running inverter migration...');

    await pool.query(`
        CREATE TABLE IF NOT EXISTS inverter_configs (
            id SERIAL PRIMARY KEY,
            home_id INTEGER REFERENCES homes(id) ON DELETE CASCADE,
            brand TEXT NOT NULL,
            username TEXT,
            password_enc TEXT,
            api_token TEXT,
            plant_id TEXT,
            inverter_sn TEXT,
            is_active BOOLEAN DEFAULT true,
            last_poll_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW()
        );
    `);
    console.log('✅ inverter_configs table created');

    await pool.query(`
        CREATE TABLE IF NOT EXISTS inverter_readings (
            id SERIAL PRIMARY KEY,
            home_id INTEGER REFERENCES homes(id) ON DELETE CASCADE,
            battery_soc INTEGER,
            battery_power REAL,
            pv_power REAL,
            grid_power REAL,
            load_power REAL,
            daily_pv_kwh REAL,
            daily_grid_import_kwh REAL,
            daily_grid_export_kwh REAL,
            daily_load_kwh REAL,
            recorded_at TIMESTAMP DEFAULT NOW()
        );
    `);
    console.log('✅ inverter_readings table created');

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_readings_home 
        ON inverter_readings(home_id, recorded_at DESC);
    `);
    console.log('✅ Index created');

    await pool.query(`
        CREATE TABLE IF NOT EXISTS optimization_schedules (
            id SERIAL PRIMARY KEY,
            home_id INTEGER REFERENCES homes(id) ON DELETE CASCADE,
            schedule_type TEXT,
            parameters JSONB,
            reasoning TEXT,
            confidence REAL,
            applied_at TIMESTAMP,
            applied_by TEXT DEFAULT 'user',
            status TEXT DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT NOW()
        );
    `);
    console.log('✅ optimization_schedules table created');

    await pool.query(`
        CREATE TABLE IF NOT EXISTS household_insights (
            id SERIAL PRIMARY KEY,
            home_id INTEGER REFERENCES homes(id) ON DELETE CASCADE,
            insight_type TEXT,
            value JSONB,
            period TEXT DEFAULT 'daily',
            computed_at TIMESTAMP DEFAULT NOW()
        );
    `);
    console.log('✅ household_insights table created');

    console.log('🎉 Inverter + Optimizer migration complete!');
    process.exit(0);
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
