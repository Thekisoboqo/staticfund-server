/**
 * LRU Cache Service
 * Caches Gemini AI responses to reduce API calls
 */

class LRUCache {
    constructor(maxSize = 100, ttlMs = 3600000) { // Default: 100 items, 1 hour TTL
        this.maxSize = maxSize;
        this.ttlMs = ttlMs;
        this.cache = new Map();
    }

    /**
     * Generate a hash key from device list for caching
     */
    static hashDevices(devices) {
        // Sort and stringify for consistent hashing
        const normalized = devices
            .map(d => `${d.name}:${d.watts}:${d.hours_per_day || 0}`)
            .sort()
            .join('|');

        // Simple hash function
        let hash = 0;
        for (let i = 0; i < normalized.length; i++) {
            const char = normalized.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return `devices_${hash}`;
    }

    get(key) {
        const item = this.cache.get(key);
        if (!item) return null;

        // Check TTL
        if (Date.now() > item.expiry) {
            this.cache.delete(key);
            return null;
        }

        // Move to end (most recently used)
        this.cache.delete(key);
        this.cache.set(key, item);

        return item.value;
    }

    set(key, value) {
        // Remove oldest if at capacity
        if (this.cache.size >= this.maxSize) {
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
        }

        this.cache.set(key, {
            value,
            expiry: Date.now() + this.ttlMs
        });
    }

    clear() {
        this.cache.clear();
    }

    size() {
        return this.cache.size;
    }

    /**
     * Get cache stats for monitoring
     */
    stats() {
        let valid = 0;
        let expired = 0;
        const now = Date.now();

        for (const [, item] of this.cache) {
            if (now > item.expiry) {
                expired++;
            } else {
                valid++;
            }
        }

        return { valid, expired, total: this.cache.size };
    }
}

// Singleton instances
const tipsCache = new LRUCache(50, 3600000);     // 50 items, 1 hour
const habitsCache = new LRUCache(50, 86400000);  // 50 items, 24 hours
const completenessCache = new LRUCache(30, 1800000); // 30 items, 30 min

module.exports = {
    LRUCache,
    tipsCache,
    habitsCache,
    completenessCache
};
