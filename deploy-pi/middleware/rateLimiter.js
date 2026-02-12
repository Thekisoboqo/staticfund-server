/**
 * Rate Limiting Middleware
 * Protects against brute-force and DoS attacks
 */
const rateLimit = require('express-rate-limit');

// General API rate limit: 100 requests per minute
const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100,
    message: { error: 'Too many requests, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Strict limit for login attempts: 5 per 15 minutes
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    message: { error: 'Too many login attempts, please try again in 15 minutes' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true, // Only count failed attempts
});

// Strict limit for registration: 3 per hour
const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3,
    message: { error: 'Too many registration attempts, please try again later' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Gemini AI rate limit: 10 per minute (expensive API calls)
const geminiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10,
    message: { error: 'AI request limit reached, please wait a moment' },
    standardHeaders: true,
    legacyHeaders: false,
});

module.exports = { apiLimiter, loginLimiter, registerLimiter, geminiLimiter };
