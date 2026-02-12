/**
 * StaticFund SQLite Database Wrapper
 * Provides a pg-like interface for minimal code changes
 */
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'staticfund.db');
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Export the raw db for direct access
module.exports = db;
