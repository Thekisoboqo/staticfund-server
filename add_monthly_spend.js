// Script to add monthly_spend column to users table
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function addMonthlySpendColumn() {
    try {
        await pool.query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS monthly_spend DECIMAL(10, 2) DEFAULT 0
        `);
        console.log('✅ Added monthly_spend column to users table');

        // Verify
        const result = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'users'
        `);
        console.log('Current users table columns:', result.rows.map(r => r.column_name));

    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await pool.end();
    }
}

addMonthlySpendColumn();
