const {
    normalizeEstimationMode,
    normalizeTaskState,
} = require('../../../../room-registry');

function getNumericVotes(players) {
    return Object.values(players || {})
        .map(player => Number(player.vote))
        .filter(vote => Number.isFinite(vote));
}

function calcRoundedAverage(values) {
    if (!values.length) {
        return null;
    }

    const sum = values.reduce((acc, value) => acc + value, 0);
    return Math.round(sum / values.length);
}

function extractIssueIdReadableFromNote(note) {
    const match = String(note || '').match(/\b([A-Za-z][A-Za-z0-9_]*-\d+)\b/);
    return match ? match[1].toUpperCase() : null;
}

function getCurrentTaskReference(roomState) {
    const taskState = normalizeTaskState(roomState?.taskState);
    return taskState.items[taskState.selectedIndex]
        || String(roomState?.note || '').trim()
        || '';
}

function getHistoryTaskId(roomState) {
    const currentTaskReference = String(getCurrentTaskReference(roomState) || '').trim();
    return extractIssueIdReadableFromNote(currentTaskReference) || currentTaskReference;
}

function buildHistoryEntries(roomState) {
    const recordedAt = new Date().toISOString();
    const roomId = String(roomState?.room?.id || '').trim();
    const taskId = getHistoryTaskId(roomState);
    const estimateType = normalizeEstimationMode(roomState?.estimationMode);

    return Object.values(roomState?.players || {})
        .filter(player => player && player.vote !== null && typeof player.vote !== 'undefined')
        .map(player => ({
            roomId,
            taskId,
            participantName: player.name,
            estimate: String(player.vote),
            estimateType,
            recordedAt,
        }));
}

module.exports = {
    buildHistoryEntries,
    calcRoundedAverage,
    extractIssueIdReadableFromNote,
    getCurrentTaskReference,
    getNumericVotes,
};
