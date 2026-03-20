const { ERROR_CODES } = require('../../../../packages/contracts');

function normalizeText(value) {
    return String(value || '').trim();
}

function createYouTrackClient(config = {}) {
    const baseUrl = normalizeText(config.baseUrl).replace(/\/+$/, '');
    const token = normalizeText(config.token);
    const storyPointsField = normalizeText(config.storyPointsField) || 'Story points';

    function assertConfigured() {
        if (!baseUrl || !token) {
            throw new Error(ERROR_CODES.youTrackNotConfigured);
        }
    }

    function getHeaders() {
        return {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
        };
    }

    async function setStoryPoints(issueIdReadable, storyPoints) {
        assertConfigured();

        const response = await fetch(`${baseUrl}/api/commands`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({
                query: `${storyPointsField} ${storyPoints}`,
                issues: [{ idReadable: issueIdReadable }],
            }),
        });

        if (!response.ok) {
            throw new Error(`YOUTRACK_UPDATE_FAILED_${response.status}`);
        }
    }

    return {
        assertConfigured,
        setStoryPoints,
    };
}

module.exports = {
    createYouTrackClient,
};
