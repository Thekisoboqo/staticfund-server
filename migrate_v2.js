require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function runQuery(query, description) {
    try {
        await pool.query(query);
        console.log(`✅ Success: ${description}`);
    } catch (err) {
        console.error(`❌ Failed: ${description} - ${err.message}`);
    }
}

async function migrate() {
    console.log('Starting DB migration...');

    // Homes
    await runQuery(`ALTER TABLE homes ADD COLUMN IF NOT EXISTS name VARCHAR(100) DEFAULT 'My Home'`, 'homes.name');
    await runQuery(`ALTER TABLE homes ADD COLUMN IF NOT EXISTS monthly_budget NUMERIC(10,2)`, 'homes.monthly_budget');
    await runQuery(`ALTER TABLE homes ADD COLUMN IF NOT EXISTS budget_remaining NUMERIC(10,2)`, 'homes.budget_remaining');
    await runQuery(`ALTER TABLE homes ADD COLUMN IF NOT EXISTS meter_number VARCHAR(20)`, 'homes.meter_number');

    // Devices
    await runQuery(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS room_id INTEGER REFERENCES rooms(id) ON DELETE CASCADE`, 'devices.room_id');
    await runQuery(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS brand VARCHAR(100)`, 'devices.brand');
    await runQuery(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS model VARCHAR(100)`, 'devices.model');
    await runQuery(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS days_per_week INTEGER DEFAULT 7`, 'devices.days_per_week');
    await runQuery(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS image_thumbnail TEXT`, 'devices.image_thumbnail');
    await runQuery(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS ai_confidence VARCHAR(10)`, 'devices.ai_confidence');

    // Users
    await runQuery(`ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token TEXT`, 'users.push_token');

    console.log('Migration complete!');
    process.exit(0);
}

migrate();
