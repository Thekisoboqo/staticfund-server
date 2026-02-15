// Script to add onboarding columns to users table
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function addOnboardingColumns() {
    try {
        console.log('Adding onboarding columns to users table...');

        await pool.query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS household_size VARCHAR(10) DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS property_type VARCHAR(20) DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS has_pool BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS cooking_fuel VARCHAR(20) DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS work_from_home VARCHAR(20) DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 7) DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS longitude DECIMAL(10, 7) DEFAULT NULL,
            ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE
        `);

        console.log('✅ All onboarding columns added successfully!');

        // Verify
        const result = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'users' AND table_schema = 'public'
            ORDER BY ordinal_position
        `);
        console.log('Users table columns:', result.rows.map(r => r.column_name).join(', '));

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await pool.end();
    }
}

addOnboardingColumns();
