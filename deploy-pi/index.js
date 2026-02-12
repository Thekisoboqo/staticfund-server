/**
 * StaticFund Energy Audit API
 * Raspberry Pi Zero 2W Edition - Production Hardened v2
 * 
 * Features:
 * - SQLite database
 * - bcrypt password hashing
 * - JWT authentication
 * - Rate limiting
 * - Input validation
 * - Response caching
 * - Offline fallback
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcrypt');
const db = require('./db');
require('dotenv').config();

// Middleware imports
const { generateToken, authenticateToken } = require('./middleware/auth');
const { apiLimiter, loginLimiter, registerLimiter, geminiLimiter } = require('./middleware/rateLimiter');
const { registerValidation, loginValidation, deviceValidation, usageValidation, userIdQuery } = require('./middleware/validators');

// Services
const { analyzeDeviceImage, getEnergyTips, checkInventoryCompleteness, generateHabits, interviewUser } = require('./services/geminiService');
const { tipsCache, habitsCache, LRUCache } = require('./services/cacheService');
const { getOfflineTips } = require('./services/offlineTips');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 5001;
const SALT_ROUNDS = 10;

// Track server stats
const serverStats = {
    startTime: Date.now(),
    requests: 0,
    errors: 0
};

// --- SECURITY MIDDLEWARE ---
app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://localhost:3000', 'http://localhost:8081'];

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, Postman)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
            return callback(null, true);
        }
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(apiLimiter); // Apply general rate limit to all routes

// Configure Multer for memory storage
const upload = multer({ storage: multer.memoryStorage() });

// Request tracking middleware
app.use((req, res, next) => {
    serverStats.requests++;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Serve static files (dashboard)
app.use('/public', express.static('public'));

// --- HEALTH & STATS ENDPOINTS ---

app.get('/api/test', (req, res) => {
    res.json({ message: 'API is working (Pi Edition v2 - Hardened)' });
});

app.get('/api/health', (req, res) => {
    try {
        const result = db.prepare("SELECT datetime('now') as now").get();
        const memUsage = process.memoryUsage();
        res.json({
            status: 'ok',
            time: result.now,
            platform: 'Raspberry Pi',
            version: '2.0.0',
            uptime: Math.floor((Date.now() - serverStats.startTime) / 1000),
            memory: {
                heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + 'MB',
                rss: Math.round(memUsage.rss / 1024 / 1024) + 'MB'
            }
        });
    } catch (err) {
        serverStats.errors++;
        console.error(err);
        res.status(500).json({ status: 'error', message: err.message });
    }
});

app.get('/api/stats', authenticateToken, (req, res) => {
    const memUsage = process.memoryUsage();
    res.json({
        uptime: Math.floor((Date.now() - serverStats.startTime) / 1000),
        requests: serverStats.requests,
        errors: serverStats.errors,
        memory: {
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
            rss: Math.round(memUsage.rss / 1024 / 1024)
        },
        cache: {
            tips: tipsCache.stats(),
            habits: habitsCache.stats()
        }
    });
});

// --- AUTH ENDPOINTS ---

app.post('/api/register', registerLimiter, registerValidation, async (req, res) => {
    const { email, password, name, province, city, monthly_spend } = req.body;
    try {
        // Check if user exists
        const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
        if (existing) {
            return res.status(400).json({ error: 'User already exists' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

        // Create user
        const stmt = db.prepare(
            'INSERT INTO users (email, password, name, province, city, monthly_spend) VALUES (?, ?, ?, ?, ?, ?)'
        );
        const result = stmt.run(email, hashedPassword, name, province, city, monthly_spend || 0);

        // Fetch the created user
        const newUser = db.prepare('SELECT id, email, name, province, city, monthly_spend FROM users WHERE id = ?').get(result.lastInsertRowid);

        // Generate token
        const token = generateToken(newUser);

        res.json({ ...newUser, token });
    } catch (err) {
        serverStats.errors++;
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/login', loginLimiter, loginValidation, async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Verify password with bcrypt
        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate token
        const { password: _, ...userInfo } = user;
        const token = generateToken(userInfo);

        res.json({ ...userInfo, token });
    } catch (err) {
        serverStats.errors++;
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Onboarding: Save household profile
app.put('/api/users/onboarding', authenticateToken, (req, res) => {
    const { userId, household_size, property_type, has_pool, cooking_fuel, work_from_home, latitude, longitude, onboarding_completed } = req.body;

    try {
        const stmt = db.prepare(`
            UPDATE users SET 
                household_size = ?,
                property_type = ?,
                has_pool = ?,
                cooking_fuel = ?,
                work_from_home = ?,
                latitude = ?,
                longitude = ?,
                onboarding_completed = ?
            WHERE id = ?
        `);
        stmt.run(household_size, property_type, has_pool ? 1 : 0, cooking_fuel, work_from_home ? 1 : 0, latitude, longitude, onboarding_completed ? 1 : 0, userId);

        const updated = db.prepare('SELECT id, email, name, province, city, household_size, property_type, has_pool, cooking_fuel, work_from_home, latitude, longitude, onboarding_completed, monthly_spend FROM users WHERE id = ?').get(userId);

        if (!updated) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(updated);
    } catch (err) {
        serverStats.errors++;
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// --- DEVICE ENDPOINTS ---

app.get('/api/devices', userIdQuery, (req, res) => {
    const { userId } = req.query;

    try {
        const devices = db.prepare(`
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
            WHERE d.user_id = ?
            ORDER BY d.id ASC
        `).all(userId);
        res.json(devices);
    } catch (err) {
        serverStats.errors++;
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/devices', deviceValidation, (req, res) => {
    console.log("[API] POST /devices request received");
    const { name, watts, image_url, surge_watts, user_id } = req.body;
    console.log(`[API] Payload: name=${name}, watts=${watts}, user_id=${user_id}`);

    try {
        const stmt = db.prepare(
            'INSERT INTO devices (name, watts, image_url, surge_watts, user_id) VALUES (?, ?, ?, ?, ?)'
        );
        const result = stmt.run(name, watts, image_url, surge_watts || 0, user_id);
        const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(result.lastInsertRowid);
        res.json(device);
    } catch (err) {
        serverStats.errors++;
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/devices/:id', (req, res) => {
    const { id } = req.params;
    const { name, watts, image_url, surge_watts } = req.body;
    try {
        const stmt = db.prepare(
            'UPDATE devices SET name = ?, watts = ?, image_url = ?, surge_watts = ? WHERE id = ?'
        );
        const result = stmt.run(name, watts, image_url, surge_watts || 0, id);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Device not found' });
        }

        const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(id);
        res.json(device);
    } catch (err) {
        serverStats.errors++;
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/devices/:id', (req, res) => {
    const { id } = req.params;
    try {
        db.prepare('DELETE FROM usage_logs WHERE device_id = ?').run(id);
        const result = db.prepare('DELETE FROM devices WHERE id = ?').run(id);
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Device not found' });
        }
        res.json({ message: 'Device deleted successfully' });
    } catch (err) {
        serverStats.errors++;
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// --- USAGE ENDPOINTS ---

app.post('/api/usage', usageValidation, (req, res) => {
    const { device_id, hours_per_day, days_per_week } = req.body;
    try {
        const stmt = db.prepare(
            'INSERT INTO usage_logs (device_id, hours_per_day, days_per_week) VALUES (?, ?, ?)'
        );
        const result = stmt.run(device_id, hours_per_day, days_per_week || 7);
        const log = db.prepare('SELECT * FROM usage_logs WHERE id = ?').get(result.lastInsertRowid);
        res.json(log);
    } catch (err) {
        serverStats.errors++;
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/usage', (req, res) => {
    try {
        const result = db.prepare(`
            SELECT d.name, u.hours_per_day, u.days_per_week, u.date 
            FROM usage_logs u
            JOIN devices d ON u.device_id = d.id
            ORDER BY u.date DESC
        `).all();
        res.json(result);
    } catch (err) {
        serverStats.errors++;
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// --- GEMINI AI ENDPOINTS ---

app.post('/api/gemini/scan', geminiLimiter, async (req, res) => {
    console.log("[GEMINI] Scan request received");
    const { imageBase64, mimeType } = req.body;

    if (!imageBase64) {
        console.error("[GEMINI] No image data received");
        return res.status(400).json({ error: 'No image provided' });
    }

    console.log(`[GEMINI] Image received: ${mimeType}, ${imageBase64.length} chars`);

    try {
        const imageBuffer = Buffer.from(imageBase64, 'base64');
        const result = await analyzeDeviceImage(imageBuffer, mimeType || 'image/jpeg');
        console.log("[GEMINI] Analysis success:", result);
        res.json(result);
    } catch (err) {
        serverStats.errors++;
        console.error("[GEMINI] Analysis failed:", err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/gemini/tips', geminiLimiter, async (req, res) => {
    const { devices } = req.body;
    if (!devices || !Array.isArray(devices)) {
        return res.status(400).json({ error: 'No device list provided' });
    }

    try {
        // Check cache first
        const cacheKey = LRUCache.hashDevices(devices);
        const cached = tipsCache.get(cacheKey);
        if (cached) {
            console.log("[GEMINI] Tips served from cache");
            return res.json({ ...cached, cached: true });
        }

        const result = await getEnergyTips(devices);
        tipsCache.set(cacheKey, result);
        res.json(result);
    } catch (err) {
        serverStats.errors++;
        console.error("[GEMINI] Tips failed, using offline fallback:", err.message);
        // Return offline tips as fallback
        res.json(getOfflineTips(devices));
    }
});

app.post('/api/gemini/completeness', geminiLimiter, async (req, res) => {
    const { devices } = req.body;
    if (!devices) {
        return res.status(400).json({ error: 'No device list provided' });
    }

    try {
        const result = await checkInventoryCompleteness(devices);
        res.json(result);
    } catch (err) {
        serverStats.errors++;
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Gamification: Update Monthly Budget
app.put('/api/users/budget', authenticateToken, (req, res) => {
    const { userId, budget } = req.body;
    try {
        db.prepare('UPDATE users SET monthly_budget = ? WHERE id = ?').run(budget, userId);
        const result = db.prepare('SELECT monthly_budget FROM users WHERE id = ?').get(userId);
        res.json(result);
    } catch (err) {
        serverStats.errors++;
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Gamification: Get Habits (Auto-Generate if empty)
app.get('/api/habits', async (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'User ID required' });

    try {
        const existingHabits = db.prepare('SELECT * FROM habits WHERE user_id = ?').all(userId);

        if (existingHabits.length === 0) {
            console.log("Generating habits for User", userId);

            const devices = db.prepare('SELECT * FROM devices WHERE user_id = ?').all(userId);

            // Check cache
            const cacheKey = `habits_${LRUCache.hashDevices(devices)}`;
            let newHabits = habitsCache.get(cacheKey);

            if (!newHabits) {
                newHabits = await generateHabits(devices);
                habitsCache.set(cacheKey, newHabits);
            }

            const insertStmt = db.prepare(
                'INSERT INTO habits (user_id, title, description, impact_level) VALUES (?, ?, ?, ?)'
            );
            for (const habit of newHabits.habits) {
                insertStmt.run(userId, habit.title, habit.description, habit.impact_level || 'MEDIUM');
            }
        }

        const habits = db.prepare(`
            SELECT h.*, 
                   (SELECT COUNT(*) FROM user_habit_logs WHERE habit_id = h.id AND date_completed = DATE('now')) > 0 as completed_today,
                   (SELECT COUNT(*) FROM user_habit_logs WHERE habit_id = h.id) as total_completions
            FROM habits h
            WHERE h.user_id = ?
            ORDER BY h.id ASC
        `).all(userId);

        res.json(habits);
    } catch (err) {
        serverStats.errors++;
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Gamification: Log Habit Completion
app.post('/api/habits/log', (req, res) => {
    const { userId, habitId } = req.body;
    try {
        const existing = db.prepare(
            "SELECT * FROM user_habit_logs WHERE user_id = ? AND habit_id = ? AND date_completed = DATE('now')"
        ).get(userId, habitId);

        if (existing) {
            return res.json({ message: 'Already logged today' });
        }

        db.prepare('INSERT INTO user_habit_logs (user_id, habit_id) VALUES (?, ?)').run(userId, habitId);
        res.json({ success: true });
    } catch (err) {
        serverStats.errors++;
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// AI Autonomy: Interview
app.post('/api/gemini/interview', geminiLimiter, async (req, res) => {
    const { devices } = req.body;
    try {
        const result = await interviewUser(devices);
        res.json(result);
    } catch (err) {
        serverStats.errors++;
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Report Request
app.post('/api/reports/request', authenticateToken, (req, res) => {
    const { user_id } = req.body;
    if (!user_id) {
        return res.status(400).json({ error: 'User ID is required' });
    }

    try {
        const user = db.prepare('SELECT email, name FROM users WHERE id = ?').get(user_id);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        console.log(`[REPORT REQUEST] Generating report for ${user.name} (${user.email})...`);
        res.json({ message: 'Report requested successfully' });
    } catch (err) {
        serverStats.errors++;
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// --- GRACEFUL SHUTDOWN ---
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    db.close();
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully...');
    db.close();
    process.exit(0);
});

// --- START SERVER ---
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 StaticFund Pi Server v2 (Hardened) running on port ${PORT}`);
    console.log(`📊 Database: SQLite (staticfund.db)`);
    console.log(`🔒 Security: bcrypt, JWT, rate limiting, helmet`);
    console.log(`⚡ Caching: LRU cache for Gemini responses`);
});
