function createErrorMonitor({
    logger,
    onError = null,
} = {}) {
    function capture(error, context = {}) {
        logger?.captureError(context.event || 'app.error', error, context);

        if (typeof onError !== 'function') {
            return;
        }

        try {
            onError({
                error,
                context,
                capturedAt: new Date().toISOString(),
            });
        } catch (hookError) {
            logger?.captureError('monitoring.hook_failed', hookError, {
                originalEvent: context.event || 'app.error',
            });
        }
    }

    return {
        capture,
    };
}

module.exports = {
    createErrorMonitor,
};
