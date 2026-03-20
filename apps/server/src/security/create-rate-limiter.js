function normalizePositiveInteger(value, fallback, { min = 1 } = {}) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.max(min, parsed);
}

function createRateLimiter({
    now = () => Date.now(),
} = {}) {
    const buckets = new Map();

    function consume({
        key,
        limit,
        windowMs,
    }) {
        const safeLimit = normalizePositiveInteger(limit, 1);
        const safeWindowMs = normalizePositiveInteger(windowMs, 1000);
        const normalizedKey = String(key || '').trim();
        const currentTimestamp = now();

        if (!normalizedKey) {
            return {
                allowed: true,
                remaining: safeLimit,
                resetAt: currentTimestamp + safeWindowMs,
            };
        }

        const bucket = buckets.get(normalizedKey);
        if (!bucket || bucket.resetAt <= currentTimestamp) {
            buckets.set(normalizedKey, {
                count: 1,
                resetAt: currentTimestamp + safeWindowMs,
            });
            return {
                allowed: true,
                remaining: safeLimit - 1,
                resetAt: currentTimestamp + safeWindowMs,
            };
        }

        if (bucket.count >= safeLimit) {
            return {
                allowed: false,
                remaining: 0,
                resetAt: bucket.resetAt,
            };
        }

        bucket.count += 1;
        return {
            allowed: true,
            remaining: safeLimit - bucket.count,
            resetAt: bucket.resetAt,
        };
    }

    return {
        consume,
    };
}

module.exports = {
    createRateLimiter,
};
