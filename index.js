const express = require('express');
const cors = require('cors');
const pool = require('./db');
require('dotenv').config();
const { analyzeDeviceImage, getEnergyTips } = require('./services/geminiService');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 5001;

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
        const result = await pool.query('SELECT NOW()');
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

        // Create user (In production, hash password!)
        const newUser = await pool.query(
            'INSERT INTO users (email, password, name, province, city, monthly_spend) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email, name, province, city, monthly_spend',
            [email, password, name, province, city, monthly_spend || 0]
        );
        res.json(newUser.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];
        // Check password (In production, compare hash!)
        if (user.password !== password) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Return user info (excluding password)
        const { password: _, ...userInfo } = user;
        res.json(userInfo);
    } catch (err) {
        console.error(err);
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

// Gemini: AI Tips
app.post('/api/gemini/tips', async (req, res) => {
    const { devices } = req.body;
    if (!devices) {
        return res.status(400).json({ error: 'No device list provided' });
    }

    try {
        const result = await getEnergyTips(devices);
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

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
