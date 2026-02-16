const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

async function addColumns() {
    try {
        console.log("Connecting to database...");

        // 1. monthly_spend (Numeric/Money)
        await pool.query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS monthly_spend NUMERIC(10, 2) DEFAULT 0;
        `);
        console.log("Added monthly_spend");

        // 2. household_size (String: '1', '2', '3-4', '5+')
        await pool.query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS household_size VARCHAR(50);
        `);
        console.log("Added household_size");

        // 3. property_type (String)
        await pool.query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS property_type VARCHAR(100);
        `);
        console.log("Added property_type");

        // 4. has_pool (Boolean)
        await pool.query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS has_pool BOOLEAN DEFAULT FALSE;
        `);
        console.log("Added has_pool");

        // 5. work_from_home (String: 'Yes'/'No' or Boolean -> Chat seems to treat as string "Yes"/"No" often, but Boolean is better. 
        // Let's check Gemini service usage. It sends "Yes"/"No". 
        // But PUT /profile-field updates it. 
        // If I make it VARCHAR, it's safer for "Yes"/"No".
        await pool.query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS work_from_home VARCHAR(10);
        `);
        console.log("Added work_from_home");

        // 6. cooking_fuel (String)
        await pool.query(`
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS cooking_fuel VARCHAR(50);
        `);
        console.log("Added cooking_fuel");

        console.log("✅ Schema migration complete!");

    } catch (e) {
        console.error("Migration failed:", e);
    } finally {
        await pool.end();
    }
}

addColumns();
