const path = require('path');
const packageJson = require('../../../../package.json');

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizeFrontendMode(value) {
    return value === 'react' ? 'react' : 'legacy';
}

function createServerConfig(options = {}) {
    const projectRoot = options.projectRoot || path.resolve(__dirname, '../../../../');
    const version = normalizeText(options.version ?? process.env.APP_VERSION ?? packageJson.version ?? 'dev');
    const build = normalizeText(options.build ?? process.env.APP_BUILD ?? '');

    return {
        host: normalizeText(options.host ?? process.env.HOST ?? '0.0.0.0'),
        port: options.port ?? process.env.PORT ?? 3000,
        projectRoot,
        version,
        build,
        versionLabel: build ? `${version} (${build})` : version,
        frontend: {
            mode: normalizeFrontendMode(options.frontendMode ?? process.env.POCKER_FRONTEND_MODE),
            legacyHomeFilePath: path.join(projectRoot, 'index.html'),
            legacyHistoryFilePath: path.join(projectRoot, 'history.html'),
            reactEntryFilePath: path.join(projectRoot, 'apps', 'web', 'dist', 'index.html'),
        },
        integrations: {
            youTrack: {
                baseUrl: normalizeText(options.youTrackBaseUrl ?? process.env.YOUTRACK_BASE_URL).replace(/\/+$/, ''),
                token: normalizeText(options.youTrackToken ?? process.env.YOUTRACK_TOKEN),
                storyPointsField: normalizeText(
                    options.youTrackStoryPointsField
                    ?? process.env.YOUTRACK_STORY_POINTS_FIELD
                    ?? 'Story points',
                ),
            },
        },
    };
}

module.exports = {
    createServerConfig,
};
