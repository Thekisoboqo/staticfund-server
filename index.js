const express = require('express');
const cors = require('cors');
const pool = require('./db');
require('dotenv').config();
const { analyzeDeviceImage, getEnergyTips, getOnboardingQuestion, getSmartSolarQuotes } = require('./services/geminiService');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 5001;

// Self-healing: Ensure DB has required columns for onboarding
async function ensureSchema() {
    try {
        console.log("Checking DB schema...");
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                name VARCHAR(255),
                province VARCHAR(100),
                city VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);

        const alterQuery = `
            ALTER TABLE users ADD COLUMN IF NOT EXISTS monthly_spend NUMERIC(10, 2) DEFAULT 0;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS household_size VARCHAR(50);
            ALTER TABLE users ADD COLUMN IF NOT EXISTS property_type VARCHAR(100);
            ALTER TABLE users ADD COLUMN IF NOT EXISTS has_pool BOOLEAN DEFAULT FALSE;
            ALTER TABLE users ADD COLUMN IF NOT EXISTS work_from_home VARCHAR(10);
            ALTER TABLE users ADD COLUMN IF NOT EXISTS cooking_fuel VARCHAR(50);
            ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE;
        `;
        await pool.query(alterQuery);
        console.log("✅ DB Schema verified (onboarding columns present)");
    } catch (err) {
        console.error("Schema Check Failed:", err);
    }
}
// function definition remains, removing the call


app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increase limit for base64 images

// Configure Multer for memory storage
const upload = multer({ storage: multer.memoryStorage() });

// Logging Middleware
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
});

// Test Endpoint
app.get('/api/test', (req, res) => {
    res.json({ message: 'API is working' });
});

// Test database connection
app.get('/api/health', async (req, res) => {
    try {
        const result = await pool.query("SELECT NOW() as now");
        res.json({ status: 'ok', time: result.rows[0].now });
    } catch (err) {
        console.error(err);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

// --- AUTH ENDPOINTS ---

app.post('/api/register', async (req, res) => {
    const { email, password, name, province, city, monthly_spend } = req.body;
    try {
        // Check if user exists
        const userCheck = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userCheck.rows.length > 0) {
            return res.status(400).json({ error: 'User already exists' });
        }

        // Create user
        const newUser = await pool.query(
            `INSERT INTO users (email, password, name, province, city, monthly_spend, onboarding_completed) 
             VALUES ($1, $2, $3, $4, $5, $6, false) 
             RETURNING id, email, name, province, city, monthly_spend, household_size, property_type, has_pool, cooking_fuel, work_from_home, latitude, longitude, onboarding_completed`,
            [email, password, name, province || null, city || null, monthly_spend || 0]
        );
        res.json(newUser.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Get user by ID
app.get('/api/users/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(
            `SELECT id, email, name, province, city, monthly_spend, household_size, property_type, has_pool, cooking_fuel, work_from_home, latitude, longitude, onboarding_completed, monthly_budget FROM users WHERE id = $1`,
            [id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query(
            `SELECT id, email, name, password, province, city, monthly_spend, household_size, property_type, has_pool, cooking_fuel, work_from_home, latitude, longitude, onboarding_completed, monthly_budget
             FROM users WHERE email = $1`, [email]
        );
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];
        if (user.password !== password) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const { password: _, ...userInfo } = user;
        res.json(userInfo);
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Onboarding: Save household profile (handles partial updates)
app.put('/api/users/onboarding', async (req, res) => {
    const { userId, ...fields } = req.body;

    try {
        // Build dynamic SET clause from provided fields only
        const allowedFields = ['household_size', 'property_type', 'has_pool', 'cooking_fuel', 'work_from_home', 'latitude', 'longitude', 'onboarding_completed'];
        const updates = [];
        const values = [];
        let paramIndex = 1;

        for (const field of allowedFields) {
            if (fields[field] !== undefined) {
                updates.push(`${field} = $${paramIndex}`);
                values.push(fields[field]);
                paramIndex++;
            }
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        values.push(userId);
        const result = await pool.query(
            `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
            values
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const { password: _, ...userInfo } = result.rows[0];
        res.json(userInfo);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Save individual profile field (used by chat onboarding)
app.put('/api/users/profile-field', async (req, res) => {
    const { userId, field, value } = req.body;
    const allowedFields = ['household_size', 'property_type', 'has_pool', 'cooking_fuel', 'work_from_home', 'province', 'city', 'monthly_spend', 'monthly_budget', 'latitude', 'longitude'];

    if (!allowedFields.includes(field)) {
        return res.status(400).json({ error: `Field '${field}' is not allowed` });
    }

    try {
        const result = await pool.query(
            `UPDATE users SET ${field} = $1 WHERE id = $2 RETURNING *`,
            [value, userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const { password: _, ...userInfo } = result.rows[0];
        res.json(userInfo);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Gemini: AI Onboarding - get next question
app.post('/api/gemini/onboard', async (req, res) => {
    const { userId } = req.body;

    try {
        // Fetch user profile to see what fields are missing
        const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const userProfile = userResult.rows[0];
        const result = await getOnboardingQuestion(userProfile);
        res.json(result);
    } catch (err) {
        console.error('Onboarding AI error:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- DEVICE ENDPOINTS ---

// Get all devices for a specific user
app.get('/api/devices', async (req, res) => {
    const { userId } = req.query;
    if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
    }

    try {
        const result = await pool.query(`
            SELECT d.*, 
                   COALESCE((
                       SELECT hours_per_day 
                       FROM usage_logs 
                       WHERE device_id = d.id 
                       ORDER BY date DESC 
                       LIMIT 1
                   ), 0) as hours_per_day,
                   COALESCE((
                       SELECT days_per_week
                       FROM usage_logs 
                       WHERE device_id = d.id 
                       ORDER BY date DESC 
                       LIMIT 1
                   ), 7) as days_per_week
            FROM devices d
            WHERE d.user_id = $1
            ORDER BY d.id ASC
        `, [userId]);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Add a new device
app.post('/api/devices', async (req, res) => {
    console.log("[API] POST /devices request received");
    const { name, watts, image_url, surge_watts, user_id } = req.body;
    console.log(`[API] Payload: name=${name}, watts=${watts}, user_id=${user_id}, image_len=${image_url ? image_url.length : 0}`);
    if (!user_id) {
        return res.status(400).json({ error: 'User ID is required' });
    }

    try {
        const result = await pool.query(
            'INSERT INTO devices (name, watts, image_url, surge_watts, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [name, watts, image_url, surge_watts || 0, user_id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Update a device
app.put('/api/devices/:id', async (req, res) => {
    const { id } = req.params;
    const { name, watts, image_url, surge_watts } = req.body;
    try {
        const result = await pool.query(
            'UPDATE devices SET name = $1, watts = $2, image_url = $3, surge_watts = $4 WHERE id = $5 RETURNING *',
            [name, watts, image_url, surge_watts || 0, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Device not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Delete a device
app.delete('/api/devices/:id', async (req, res) => {
    const { id } = req.params;
    try {
        // First delete associated usage logs (cascade delete usually handles this but let's be safe)
        await pool.query('DELETE FROM usage_logs WHERE device_id = $1', [id]);

        const result = await pool.query('DELETE FROM devices WHERE id = $1 RETURNING *', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Device not found' });
        }
        res.json({ message: 'Device deleted successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Request Advanced Report
app.post('/api/reports/request', async (req, res) => {
    const { user_id } = req.body;
    if (!user_id) {
        return res.status(400).json({ error: 'User ID is required' });
    }

    try {
        // Fetch user email
        const userResult = await pool.query('SELECT email, name FROM users WHERE id = $1', [user_id]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        const user = userResult.rows[0];

        // Simulate Report Generation & Email Sending
        console.log(`[REPORT REQUEST] Generating report for ${user.name} (${user.email})...`);

        // Simulate delay
        setTimeout(() => {
            console.log(`[EMAIL SENT] Advanced Energy Report sent to ${user.email}`);
        }, 2000);

        res.json({ message: 'Report requested successfully' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// --- USAGE ENDPOINTS ---

// Save usage log
app.post('/api/usage', async (req, res) => {
    const { device_id, hours_per_day, days_per_week } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO usage_logs (device_id, hours_per_day, days_per_week) VALUES ($1, $2, $3) RETURNING *',
            [device_id, hours_per_day, days_per_week || 7]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Get usage analysis
app.get('/api/usage', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT d.name, u.hours_per_day, u.days_per_week, u.date 
            FROM usage_logs u
            JOIN devices d ON u.device_id = d.id
            ORDER BY u.date DESC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// --- GEMINI AI ENDPOINTS ---

// Gemini: Smart Scan (accepts base64 JSON)
app.post('/api/gemini/scan', async (req, res) => {
    console.log("[GEMINI] Scan request received");

    const { imageBase64, mimeType } = req.body;

    if (!imageBase64) {
        console.error("[GEMINI] No image data received");
        return res.status(400).json({ error: 'No image provided' });
    }

    console.log(`[GEMINI] Image received: ${mimeType}, ${imageBase64.length} chars`);

    try {
        // Convert base64 string to buffer
        const imageBuffer = Buffer.from(imageBase64, 'base64');
        const result = await analyzeDeviceImage(imageBuffer, mimeType || 'image/jpeg');
        console.log("[GEMINI] Analysis success:", result);
        res.json(result);
    } catch (err) {
        console.error("[GEMINI] Analysis failed:", err);
        res.status(500).json({ error: err.message });
    }
});

// Update a specific profile field (used during chat onboarding)
app.put('/api/users/profile-field', async (req, res) => {
    const { userId, field, value } = req.body;
    if (!userId || !field) {
        return res.status(400).json({ error: 'Missing field or userId' });
    }

    try {
        // Allow list of valid fields to prevent SQL injection or bad data
        const validFields = ['city', 'province', 'monthly_spend', 'household_size', 'property_type', 'has_pool', 'cooking_fuel', 'work_from_home', 'name'];
        if (!validFields.includes(field)) {
            return res.status(400).json({ error: `Invalid field: ${field}` });
        }

        // Construct query safely
        const query = `UPDATE users SET ${field} = $1 WHERE id = $2 RETURNING *`;
        const result = await pool.query(query, [value, userId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        console.error("Profile Update Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Gemini: AI Tips (time-aware + location-aware)
app.post('/api/gemini/tips', async (req, res) => {
    const { devices, userId } = req.body;
    if (!devices) {
        return res.status(400).json({ error: 'No device list provided' });
    }

    try {
        // Fetch user profile for context
        let userProfile = {};
        if (userId) {
            const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
            if (userResult.rows.length > 0) {
                const { password, ...profile } = userResult.rows[0];
                userProfile = profile;

                // Add rate from rates database
                const rates = require('./services/ratesDatabase');
                const rateInfo = rates.getRate(profile.city || profile.province);
                userProfile.rate_per_kwh = rateInfo.rate;
                userProfile.municipality = rateInfo.municipality;
                userProfile.distributor = rateInfo.distributor || rateInfo.municipality;
                userProfile.isIBT = rateInfo.isIBT || false;
                // Pass IBT block info if available (for Centlec etc.)
                if (rateInfo.rates.block1) {
                    userProfile.block1_rate = rateInfo.rates.block1;
                    userProfile.block1_limit = rateInfo.rates.block1_limit;
                    userProfile.block2_summer = rateInfo.rates.block2_summer;
                    userProfile.block2_winter = rateInfo.rates.block2_winter;
                }
                // Pass seasonal info
                const seasonalInfo = rates.getSeasonalRate(profile.city || profile.province);
                userProfile.season = seasonalInfo.season;
                userProfile.seasonalRate = seasonalInfo.seasonalRate;
                userProfile.peakSunHours = rates.getPeakSunHours(profile.province);
            }
        }

        const result = await getEnergyTips(devices, userProfile);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Gemini: Check Completeness
app.post('/api/gemini/completeness', async (req, res) => {
    const { devices } = req.body;
    if (!devices) {
        return res.status(400).json({ error: 'No device list provided' });
    }

    try {
        const { checkInventoryCompleteness } = require('./services/geminiService');
        const result = await checkInventoryCompleteness(devices);
        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Gemini: Smart Solar Quotes
app.post('/api/gemini/solar-quotes', async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    try {
        // Fetch user profile
        const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        const { password, ...userProfile } = userResult.rows[0];

        // Fetch devices
        const devicesResult = await pool.query(`
            SELECT d.*, COALESCE((SELECT hours_per_day FROM usage_logs WHERE device_id = d.id ORDER BY date DESC LIMIT 1), 4) as hours_per_day
            FROM devices d WHERE d.user_id = $1
        `, [userId]);
        const devices = devicesResult.rows;

        const { getSmartSolarQuotes } = require('./services/geminiService');
        const result = await getSmartSolarQuotes(devices, userProfile);
        res.json(result);
    } catch (err) {
        console.error("Solar Quotes Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Quotation Request — save to DB and notify StaticFund
app.post('/api/quotations/request', async (req, res) => {
    const { userId, package_tier, package_details, total_cost } = req.body;
    if (!userId || !package_tier) return res.status(400).json({ error: 'Missing fields' });

    try {
        // Get user info
        const userResult = await pool.query('SELECT name, email, city, province, monthly_spend FROM users WHERE id = $1', [userId]);
        const user = userResult.rows[0];

        // Get device summary
        const devicesResult = await pool.query('SELECT name, watts FROM devices WHERE user_id = $1', [userId]);
        const devicesSummary = devicesResult.rows.map(d => `${d.name} (${d.watts}W)`).join(', ');

        // Save quotation
        const result = await pool.query(`
            INSERT INTO quotations (user_id, user_name, user_email, user_city, user_province, package_tier, package_details, devices_summary, total_cost, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
            RETURNING *
        `, [userId, user.name, user.email, user.city, user.province, package_tier, JSON.stringify(package_details), devicesSummary, total_cost]);

        console.log(`📧 NEW QUOTATION REQUEST from ${user.name} (${user.email}) - ${package_tier} package - ${total_cost}`);
        console.log(`   Devices: ${devicesSummary}`);
        console.log(`   → Email should be sent to staticfund@gmail.com`);

        res.json({
            success: true,
            message: 'Quotation request submitted! StaticFund will contact you soon.',
            quotation: result.rows[0]
        });
    } catch (err) {
        console.error("Quotation Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Gemini: Conversational Onboarding
app.post('/api/gemini/onboard', async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });

    try {
        const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        if (userResult.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        const { password, ...profile } = userResult.rows[0];

        const { getOnboardingQuestion } = require('./services/geminiService');
        const result = await getOnboardingQuestion(profile);
        res.json(result);
    } catch (err) {
        console.error("Onboarding Error:", err);
        res.status(500).json({ error: err.message });
    }
});

// Onboarding: Update single field
app.put('/api/users/profile-field', async (req, res) => {
    const { userId, field, value } = req.body;
    const allowedFields = ['name', 'province', 'city', 'monthly_spend', 'household_size', 'property_type', 'has_pool', 'cooking_fuel', 'work_from_home'];

    if (!allowedFields.includes(field)) {
        return res.status(400).json({ error: 'Invalid field' });
    }

    try {
        const result = await pool.query(
            `UPDATE users SET ${field} = $1 WHERE id = $2 RETURNING id, email, name, province, city, household_size, property_type, has_pool, cooking_fuel, work_from_home, monthly_spend, onboarding_completed`,
            [value, userId]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Gamification: Update Monthly Budget
app.put('/api/users/budget', async (req, res) => {
    const { userId, budget } = req.body;
    try {
        const result = await pool.query(
            'UPDATE users SET monthly_budget = $1 WHERE id = $2 RETURNING monthly_budget',
            [budget, userId]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Gamification: Get Habits (Auto-Generate if empty)
app.get('/api/habits', async (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'User ID required' });

    try {
        // 1. Check existing habits
        const habitCheck = await pool.query('SELECT * FROM habits WHERE user_id = $1', [userId]);

        if (habitCheck.rows.length === 0) {
            // 2. Generate new habits via Gemini
            console.log("Generating habits for User", userId);
            const { generateHabits } = require('./services/geminiService');

            // Need user devices
            const devicesRes = await pool.query('SELECT * FROM devices WHERE user_id = $1', [userId]);
            const newHabits = await generateHabits(devicesRes.rows); // { habits: [] }

            // 3. Save to DB
            for (const habit of newHabits.habits) {
                await pool.query(
                    'INSERT INTO habits (user_id, title, description, impact_level) VALUES ($1, $2, $3, $4)',
                    [userId, habit.title, habit.description, habit.impact_level || 'MEDIUM']
                );
            }
        }

        // 4. Fetch habits + Today's status + Streak
        const habits = await pool.query(`
            SELECT h.*, 
                   (SELECT COUNT(*) FROM user_habit_logs WHERE habit_id = h.id AND date_completed = CURRENT_DATE) > 0 as completed_today,
                   (SELECT COUNT(*) FROM user_habit_logs WHERE habit_id = h.id) as total_completions
            FROM habits h
            WHERE h.user_id = $1
            ORDER BY h.id ASC
        `, [userId]);

        res.json(habits.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Gamification: Log Habit Completion
app.post('/api/habits/log', async (req, res) => {
    const { userId, habitId } = req.body;
    try {
        // Check if already logged today
        const check = await pool.query(
            'SELECT * FROM user_habit_logs WHERE user_id = $1 AND habit_id = $2 AND date_completed = CURRENT_DATE',
            [userId, habitId]
        );

        if (check.rows.length > 0) {
            // Already done, maybe toggle off? For now just return success
            return res.json({ message: 'Already logged today' });
        }

        await pool.query(
            'INSERT INTO user_habit_logs (user_id, habit_id) VALUES ($1, $2)',
            [userId, habitId]
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// AI Autonomy: Interview
app.post('/api/gemini/interview', async (req, res) => {
    const { devices } = req.body;
    try {
        const { interviewUser } = require('./services/geminiService');
        const result = await interviewUser(devices);
        res.json(result); // Returns { question, suggested_device } or null
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Start server only after schema check
ensureSchema().then(() => {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on port ${PORT}`);
    });
});
