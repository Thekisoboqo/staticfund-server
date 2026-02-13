const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

const dbPath = path.join(__dirname, 'staticfund.db');
const db = new Database(dbPath);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Create tables if they don't exist
db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT,
        province TEXT,
        city TEXT,
        monthly_spend REAL DEFAULT 0,
        monthly_budget REAL,
        household_size TEXT,
        property_type TEXT,
        has_pool INTEGER DEFAULT 0,
        cooking_fuel TEXT,
        work_from_home TEXT,
        latitude REAL,
        longitude REAL,
        onboarding_completed INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        watts REAL NOT NULL,
        quantity INTEGER DEFAULT 1,
        hours_per_day REAL DEFAULT 0,
        category TEXT,
        surge_watts REAL,
        image_uri TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS quotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        package_tier TEXT NOT NULL,
        package_data TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
    );
`);

console.log('SQLite database initialized at:', dbPath);

// Create a PostgreSQL-compatible query wrapper
// This allows all existing server code to work without changes
const pool = {
    query: (text, params = []) => {
        return new Promise((resolve, reject) => {
            try {
                // Convert PostgreSQL $1, $2 syntax to SQLite ? syntax
                let sqliteText = text;
                let paramIndex = 1;
                while (sqliteText.includes('$' + paramIndex)) {
                    sqliteText = sqliteText.replace('$' + paramIndex, '?');
                    paramIndex++;
                }

                // Remove RETURNING clause for INSERT/UPDATE and handle it separately
                const returningMatch = sqliteText.match(/RETURNING\s+(.+?)$/i);
                const isInsert = /^\s*INSERT/i.test(sqliteText);
                const isUpdate = /^\s*UPDATE/i.test(sqliteText);
                const isDelete = /^\s*DELETE/i.test(sqliteText);

                if (returningMatch && (isInsert || isUpdate || isDelete)) {
                    const returningCols = returningMatch[1].trim();
                    const cleanSql = sqliteText.replace(/RETURNING\s+.+$/i, '').trim();

                    if (isInsert) {
                        const result = db.prepare(cleanSql).run(...params);
                        // Fetch the inserted/updated row
                        const tableName = cleanSql.match(/INSERT\s+INTO\s+(\w+)/i)?.[1];
                        if (tableName) {
                            const row = db.prepare(`SELECT ${returningCols} FROM ${tableName} WHERE id = ?`).get(result.lastInsertRowid);
                            // Convert SQLite integer booleans to JS booleans for specific fields
                            if (row) {
                                if ('has_pool' in row) row.has_pool = !!row.has_pool;
                                if ('onboarding_completed' in row) row.onboarding_completed = !!row.onboarding_completed;
                            }
                            resolve({ rows: row ? [row] : [], rowCount: 1 });
                        } else {
                            resolve({ rows: [], rowCount: result.changes });
                        }
                    } else if (isUpdate) {
                        const result = db.prepare(cleanSql).run(...params);
                        // For UPDATE with RETURNING, we need to find the updated row
                        const tableName = cleanSql.match(/UPDATE\s+(\w+)/i)?.[1];
                        const whereMatch = cleanSql.match(/WHERE\s+(.+?)$/i);
                        if (tableName && whereMatch) {
                            // Re-query using the WHERE clause params (last param is usually the id)
                            const idParam = params[params.length - 1];
                            const row = db.prepare(`SELECT ${returningCols} FROM ${tableName} WHERE id = ?`).get(idParam);
                            if (row) {
                                if ('has_pool' in row) row.has_pool = !!row.has_pool;
                                if ('onboarding_completed' in row) row.onboarding_completed = !!row.onboarding_completed;
                            }
                            resolve({ rows: row ? [row] : [], rowCount: result.changes });
                        } else {
                            resolve({ rows: [], rowCount: result.changes });
                        }
                    } else {
                        const result = db.prepare(cleanSql).run(...params);
                        resolve({ rows: [], rowCount: result.changes });
                    }
                } else if (/^\s*SELECT/i.test(sqliteText)) {
                    const rows = db.prepare(sqliteText).all(...params);
                    // Convert boolean fields
                    rows.forEach(row => {
                        if ('has_pool' in row) row.has_pool = !!row.has_pool;
                        if ('onboarding_completed' in row) row.onboarding_completed = !!row.onboarding_completed;
                    });
                    resolve({ rows, rowCount: rows.length });
                } else if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sqliteText)) {
                    const result = db.prepare(sqliteText).run(...params);
                    resolve({ rows: [], rowCount: result.changes, lastID: result.lastInsertRowid });
                } else {
                    // DDL or other statements
                    db.exec(sqliteText);
                    resolve({ rows: [], rowCount: 0 });
                }
            } catch (err) {
                reject(err);
            }
        });
    }
};

module.exports = pool;
