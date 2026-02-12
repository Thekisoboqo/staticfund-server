/**
 * Password Migration Script
 * Hashes existing plaintext passwords with bcrypt
 * Run once after upgrading to v2
 */
const bcrypt = require('bcrypt');
const db = require('../db');

const SALT_ROUNDS = 10;

async function migratePasswords() {
    console.log('🔐 Password Migration Tool');
    console.log('==========================\n');

    try {
        // Get all users
        const users = db.prepare('SELECT id, email, password FROM users').all();
        console.log(`Found ${users.length} users to check.\n`);

        let migrated = 0;
        let skipped = 0;

        for (const user of users) {
            // Check if already hashed (bcrypt hashes start with $2b$)
            if (user.password.startsWith('$2b$') || user.password.startsWith('$2a$')) {
                console.log(`⏭️  ${user.email} - Already hashed, skipping`);
                skipped++;
                continue;
            }

            // Hash the plaintext password
            const hashedPassword = await bcrypt.hash(user.password, SALT_ROUNDS);

            // Update in database
            db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, user.id);

            console.log(`✅ ${user.email} - Password hashed`);
            migrated++;
        }

        console.log('\n==========================');
        console.log(`Migration complete!`);
        console.log(`  Migrated: ${migrated}`);
        console.log(`  Skipped:  ${skipped}`);
        console.log(`  Total:    ${users.length}`);

    } catch (err) {
        console.error('❌ Migration failed:', err.message);
        process.exit(1);
    }
}

migratePasswords();
