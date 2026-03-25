const pino = require('pino');

const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

const logger = pino({
    level: logLevel,
    transport: !isProduction
        ? {
              target: 'pino-pretty',
              options: {
                  colorize: true,
                  translateTime: 'SYS:HH:MM:ss',
                  ignore: 'pid,hostname',
              },
          }
        : undefined,
    formatters: {
        level(label) {
            return { level: label };
        },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
});

function createChildLogger(bindings) {
    return logger.child(bindings);
}

module.exports = {
    logger,
    createChildLogger,
};
