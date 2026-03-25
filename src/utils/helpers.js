const fs = require('fs');
const path = require('path');

function respondJson(res, statusCode, payload) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
}

function renderHtmlTemplate(template, appVersionLabel) {
    return template.replace(/__APP_VERSION__/g, appVersionLabel);
}

function extractRoomIdFromPathname(pathname) {
    const segments = String(pathname || '/')
        .split('/')
        .filter(Boolean);
    if (segments.length !== 1) {
        return '';
    }

    try {
        return decodeURIComponent(segments[0]);
    } catch (error) {
        return segments[0];
    }
}

function serveHtmlFile(res, fileName, rootDir, appVersionLabel) {
    const filePath = path.join(rootDir, fileName);
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(`Error loading ${fileName}`);
            return;
        }

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(renderHtmlTemplate(data.toString('utf8'), appVersionLabel));
    });
}

function getNumericVotes(players) {
    return Object.values(players || {})
        .map(player => Number(player.vote))
        .filter(vote => Number.isFinite(vote));
}

function calcRoundedAverage(values) {
    if (!values.length) return null;
    const sum = values.reduce((acc, value) => acc + value, 0);
    return Math.round(sum / values.length);
}

function extractIssueIdReadableFromNote(note) {
    const match = String(note || '').match(/\b([A-Za-z][A-Za-z0-9_]*-\d+)\b/);
    return match ? match[1].toUpperCase() : null;
}

function getCurrentTaskReference(roomState) {
    const { normalizeTaskState } = require('../../room-registry');
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
    const { normalizeEstimationMode } = require('../../room-registry');
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

function getHistoryFilters(searchParams) {
    const parsedPage = Number.parseInt(String(searchParams.get('page') || ''), 10);
    const parsedPageSize = Number.parseInt(String(searchParams.get('pageSize') || ''), 10);

    return {
        roomId: String(searchParams.get('roomId') || '').trim(),
        taskId: String(searchParams.get('taskId') || '').trim(),
        participantName: String(searchParams.get('participantName') || '').trim(),
        estimate: String(searchParams.get('estimate') || '').trim(),
        estimateType: String(searchParams.get('estimateType') || '').trim(),
        recordedOn: String(searchParams.get('recordedOn') || '').trim(),
        page: Number.isFinite(parsedPage) ? parsedPage : 1,
        pageSize: Number.isFinite(parsedPageSize) ? parsedPageSize : 25,
    };
}

module.exports = {
    respondJson,
    renderHtmlTemplate,
    extractRoomIdFromPathname,
    serveHtmlFile,
    getNumericVotes,
    calcRoundedAverage,
    extractIssueIdReadableFromNote,
    getCurrentTaskReference,
    getHistoryTaskId,
    buildHistoryEntries,
    getHistoryFilters,
};
