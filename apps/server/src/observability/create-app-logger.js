const REDACTED_VALUE = '[REDACTED]';
const LEVELS = Object.freeze({
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
});
const SECRET_KEY_PATTERN = /(token|authorization|cookie|secret|password)/i;

function normalizeText(value) {
    return String(value ?? '').trim();
}

function normalizeLogLevel(value) {
    const normalizedValue = normalizeText(value).toLowerCase();
    return Object.prototype.hasOwnProperty.call(LEVELS, normalizedValue)
        ? normalizedValue
        : 'info';
}

function serializeError(error) {
    if (!(error instanceof Error)) {
        return {
            message: String(error ?? 'UNKNOWN_ERROR'),
        };
    }

    return {
        name: error.name,
        message: error.message,
        code: normalizeText(error.code),
        stack: error.stack || null,
    };
}

function sanitizeValue(value, { depth = 0 } = {}) {
    if (depth > 6) {
        return '[Truncated]';
    }

    if (value instanceof Error) {
        return serializeError(value);
    }

    if (Array.isArray(value)) {
        return value.map(item => sanitizeValue(item, { depth: depth + 1 }));
    }

    if (value && typeof value === 'object') {
        const sanitizedRecord = {};
        Object.entries(value).forEach(([key, item]) => {
            sanitizedRecord[key] = SECRET_KEY_PATTERN.test(key)
                ? REDACTED_VALUE
                : sanitizeValue(item, { depth: depth + 1 });
        });
        return sanitizedRecord;
    }

    return value;
}

function createDefaultSink() {
    return (record) => {
        const serializedRecord = JSON.stringify(record);
        if (record.level === 'error' || record.level === 'warn') {
            console.error(serializedRecord);
            return;
        }

        console.log(serializedRecord);
    };
}

function createAppLogger({
    level = 'info',
    service = 'pocker',
    sink = createDefaultSink(),
    bindings = {},
} = {}) {
    const activeLevel = normalizeLogLevel(level);

    function shouldLog(nextLevel) {
        return LEVELS[nextLevel] >= LEVELS[activeLevel];
    }

    function write(nextLevel, event, fields = {}) {
        if (!shouldLog(nextLevel)) {
            return;
        }

        sink({
            ts: new Date().toISOString(),
            level: nextLevel,
            event: normalizeText(event) || 'app.event',
            service,
            pid: process.pid,
            ...sanitizeValue(bindings),
            ...sanitizeValue(fields),
        });
    }

    return {
        child(nextBindings = {}) {
            return createAppLogger({
                level: activeLevel,
                service,
                sink,
                bindings: {
                    ...bindings,
                    ...nextBindings,
                },
            });
        },
        debug(event, fields) {
            write('debug', event, fields);
        },
        info(event, fields) {
            write('info', event, fields);
        },
        warn(event, fields) {
            write('warn', event, fields);
        },
        error(event, fields) {
            write('error', event, fields);
        },
        captureError(event, error, fields = {}) {
            write('error', event, {
                ...fields,
                error,
            });
        },
    };
}

module.exports = {
    createAppLogger,
    normalizeLogLevel,
    sanitizeValue,
};
