/**
 * StaticFund Database Initializer
 * Run this once to create the SQLite database
 */
const fs = require('fs');
const path = require('path');
const db = require('./db');

console.log('🔧 Initializing StaticFund SQLite Database...\n');

// Read and execute schema
const schemaPath = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');

try {
    db.exec(schema);
    console.log('✅ Schema created successfully!');

    // Verify tables
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    console.log('\n📋 Created tables:');
    tables.forEach(t => console.log(`   - ${t.name}`));

    console.log('\n🎉 Database ready at: staticfund.db');
} catch (err) {
    console.error('❌ Error creating schema:', err.message);
    process.exit(1);
}
