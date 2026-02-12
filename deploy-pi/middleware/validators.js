/**
 * Input Validation Schemas
 * Using express-validator for request validation
 */
const { body, query, param, validationResult } = require('express-validator');

// Middleware to check validation results
const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: 'Validation failed',
            details: errors.array().map(e => ({ field: e.path, message: e.msg }))
        });
    }
    next();
};

// User registration validation
const registerValidation = [
    body('email')
        .isEmail().withMessage('Valid email is required')
        .normalizeEmail(),
    body('password')
        .isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('name')
        .optional()
        .trim()
        .isLength({ max: 100 }).withMessage('Name too long'),
    body('province')
        .optional()
        .trim(),
    body('city')
        .optional()
        .trim(),
    body('monthly_spend')
        .optional()
        .isNumeric().withMessage('Monthly spend must be a number'),
    validate
];

// Login validation
const loginValidation = [
    body('email')
        .isEmail().withMessage('Valid email is required')
        .normalizeEmail(),
    body('password')
        .notEmpty().withMessage('Password is required'),
    validate
];

// Device validation
const deviceValidation = [
    body('name')
        .trim()
        .notEmpty().withMessage('Device name is required')
        .isLength({ max: 255 }).withMessage('Device name too long'),
    body('watts')
        .isInt({ min: 1, max: 50000 }).withMessage('Watts must be between 1 and 50000'),
    body('surge_watts')
        .optional()
        .isInt({ min: 0, max: 100000 }).withMessage('Invalid surge watts'),
    body('user_id')
        .isInt().withMessage('User ID is required'),
    validate
];

// Usage validation
const usageValidation = [
    body('device_id')
        .isInt().withMessage('Device ID is required'),
    body('hours_per_day')
        .isFloat({ min: 0, max: 24 }).withMessage('Hours must be between 0 and 24'),
    body('days_per_week')
        .optional()
        .isInt({ min: 1, max: 7 }).withMessage('Days must be between 1 and 7'),
    validate
];

// Query validation for userId
const userIdQuery = [
    query('userId')
        .isInt().withMessage('Valid User ID is required'),
    validate
];

module.exports = {
    registerValidation,
    loginValidation,
    deviceValidation,
    usageValidation,
    userIdQuery,
    validate
};
