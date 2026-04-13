const isFileMode = window.location.protocol === 'file:';
const apiBaseUrl = isFileMode ? 'https://pocker.webpaul.ru' : '';
const socket = isFileMode ? io(apiBaseUrl) : io();

const ROOM_ID_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,63}$/u;
const RESERVED_ROOM_IDS = new Set(['health', 'version', 'index-html', 'robots-txt', 'socket-io']);
const SESSION_ID_STORAGE_KEY = 'pockerSessionId';
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15000;
const SOUND_EFFECT_PATHS = {
    reveal: '/public/audio/reveal.mp3',
    reset: '/public/audio/resetVotes.mp3',
    reaction: '/public/audio/emotion.mp3'
};

let roomId = '';
let currentRoomMeta = null;
let mySocketId = null;
let name = '';
let revealed = false;
let isAdmin = false;
let pendingVoteValue = null;
let latestPlayers = [];
let restoreSessionPromise = null;
const VOTE_TTL_MS = 60 * 60 * 1000; // 1 hour
const AUTO_AVERAGE_VOTE_THRESHOLD = 0.7;
const AUTO_AVERAGE_VOTE_MIN_DELAY_MS = 1000;
const AUTO_AVERAGE_VOTE_MAX_DELAY_MS = 5000;
const averageVoteAutomationState = {
    enabled: false,
    forceNext: false,
    submitting: false
};
const availableReactions = [
    {value: '👍', label: 'Нравится'},
    {value: '🔥', label: 'Огонь'},
    {value: '❤️', label: 'Сердце'},
    {value: '😂', label: 'Смешно'},
    {value: '👏', label: 'Аплодисменты'},
    {value: '👀', label: 'Смотрю'},
    {value: '🤯', label: 'Взрыв мозга'}
];
let reactionPickerOpen = false;
let currentReactionValue = null;
let heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS;
let heartbeatTimerId = null;
const soundEffectCache = new Map();
const activeSoundPlaybacks = new Set();
const participantSessionId = getOrCreateParticipantSessionId();

function createFallbackSessionId() {
    return `session-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getStorage(storageName) {
    try {
        return window[storageName];
    } catch (error) {
        return null;
    }
}

function readStoredSessionId(storage) {
    try {
        const currentSessionId = storage && storage.getItem(SESSION_ID_STORAGE_KEY);
        return currentSessionId && currentSessionId.trim() ? currentSessionId.trim() : null;
    } catch (error) {
        return null;
    }
}

function writeStoredSessionId(storage, sessionId) {
    try {
        if (storage) {
            storage.setItem(SESSION_ID_STORAGE_KEY, sessionId);
        }
    } catch (error) {
    }
}

function getOrCreateParticipantSessionId() {
    const persistentStorage = getStorage('localStorage');
    const tabStorage = getStorage('sessionStorage');
    const currentSessionId = readStoredSessionId(persistentStorage);
    if (currentSessionId) {
        writeStoredSessionId(tabStorage, currentSessionId);
        return currentSessionId;
    }

    const legacySessionId = readStoredSessionId(tabStorage);
    if (legacySessionId) {
        writeStoredSessionId(persistentStorage, legacySessionId);
        return legacySessionId;
    }

    const generatedSessionId = window.crypto && typeof window.crypto.randomUUID === 'function'
        ? window.crypto.randomUUID()
        : createFallbackSessionId();
    writeStoredSessionId(persistentStorage, generatedSessionId);
    writeStoredSessionId(tabStorage, generatedSessionId);
    return generatedSessionId;
}

function getSoundEffect(name) {
    if (soundEffectCache.has(name)) {
        return soundEffectCache.get(name);
    }

    const src = SOUND_EFFECT_PATHS[name];
    if (!src) {
        return null;
    }

    const audio = new Audio(src);
    audio.preload = 'auto';
    audio.load();
    soundEffectCache.set(name, audio);
    return audio;
}

function playSoundEffect(name) {
    const baseAudio = getSoundEffect(name);
    if (!baseAudio) {
        return;
    }

    const playback = baseAudio.cloneNode(true);
    playback.currentTime = 0;
    activeSoundPlaybacks.add(playback);

    const cleanup = () => {
        activeSoundPlaybacks.delete(playback);
        playback.onended = null;
        playback.onerror = null;
    };

    playback.onended = cleanup;
    playback.onerror = cleanup;

    const playPromise = playback.play();
    if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(cleanup);
    }
}

Object.keys(SOUND_EFFECT_PATHS).forEach(getSoundEffect);

socket.on('connect', () => {
    mySocketId = socket.id;

    if (!name || !roomId) {
        return;
    }

    restoreSessionAfterReconnect({silent: true})
        .then(restored => {
            if (!restored) {
                return;
            }

            const savedVote = getStoredValueWithTTL(getVoteKey());
            if (savedVote) {
                return submitVote(savedVote, {
                    silent: true,
                    retryOnForbidden: false
                });
            }

            return null;
        })
        .catch(() => {
        });
});

function stopHeartbeat() {
    if (heartbeatTimerId) {
        clearInterval(heartbeatTimerId);
        heartbeatTimerId = null;
    }
}

function startHeartbeat() {
    stopHeartbeat();
    if (!name || !roomId) {
        return;
    }

    heartbeatTimerId = setInterval(() => {
        if (!socket.connected || !name || !roomId) {
            return;
        }
        socket.emit('heartbeat', {roomId});
    }, heartbeatIntervalMs);
}

$('#iAmAdmin').on('click', function () {
    const next = $('#isAdmin').val() === '0' ? '1' : '0';
    $('#isAdmin').val(next);
    $(this).toggleClass('green');
});

const originalPoints = ["1", "2", "3", "5", "8", "13", "20", "40", "?"];
const allEstimateValues = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "20", "24", "32", "40", "?"];

function getInitials(name) {
    return name.trim().split(' ').map(w => w.charAt(0).toUpperCase()).join('').slice(0, 2);
}

function getVoteKey() {
    const nm = name || localStorage.getItem('pokerName') || '';
    return `pokerVote:${roomId}:${nm}`;
}

function setStoredValueWithTTL(key, value) {
    const payload = {
        value,
        expires: Date.now() + VOTE_TTL_MS
    };
    localStorage.setItem(key, JSON.stringify(payload));
}

function getStoredValueWithTTL(key) {
    const raw = localStorage.getItem(key);
    if (!raw) return null;

    try {
        const payload = JSON.parse(raw);
        if (!payload.expires || Date.now() > payload.expires) {
            localStorage.removeItem(key);
            return null;
        }
        return payload.value;
    } catch (e) {
        localStorage.removeItem(key);
        return null;
    }
}

function getAdminStorageKey(targetRoomId = roomId) {
    return `pokerAdmin:${normalizeRoomId(targetRoomId) || 'default'}`;
}

function normalizeRoomId(value) {
    return String(value || '')
        .normalize('NFKC')
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_-]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64)
        .replace(/^-+|-+$/g, '');
}

function normalizeRoomSuffix(value) {
    return normalizeRoomId(value);
}

function buildRoomMeta(targetRoomId) {
    const normalizedRoomId = normalizeRoomId(targetRoomId);
    if (!normalizedRoomId || RESERVED_ROOM_IDS.has(normalizedRoomId) || !ROOM_ID_PATTERN.test(normalizedRoomId)) {
        return null;
    }

    return {
        id: normalizedRoomId,
        suffix: normalizedRoomId,
        label: normalizedRoomId
    };
}

function getRoomIdFromLocation() {
    if (window.location.pathname === '/' || window.location.pathname === '/index.html') {
        return '';
    }

    const segments = window.location.pathname.split('/').filter(Boolean);
    if (segments.length !== 1) {
        return '';
    }

    try {
        return normalizeRoomId(decodeURIComponent(segments[0]));
    } catch (error) {
        return normalizeRoomId(segments[0]);
    }
}

function buildRoomLink(targetRoomId = roomId) {
    const normalizedRoomId = normalizeRoomId(targetRoomId);
    if (!normalizedRoomId) {
        return '';
    }

    const url = new URL(window.location.href);
    url.pathname = `/${encodeURIComponent(normalizedRoomId)}/`;
    url.search = '';
    return url.toString();
}

function updateRoomUrl(nextRoomId) {
    const url = new URL(window.location.href);
    const normalizedRoomId = normalizeRoomId(nextRoomId);

    if (normalizedRoomId) {
        url.pathname = `/${encodeURIComponent(normalizedRoomId)}/`;
        url.search = '';
    } else {
        url.pathname = '/';
        url.search = '';
    }

    const nextUrl = `${url.pathname}${url.hash}`;
    window.history.replaceState({}, '', nextUrl);
}

function renderRoomSelectionMeta() {
    const hasRoom = Boolean(roomId);
    const shareLink = buildRoomLink(roomId);

    $('#roomBuilderField').toggle(!hasRoom);
    $('#roomLinkField').toggleClass('hidden', !hasRoom).toggle(hasRoom);
    $('#createRoomBtn').toggle(!hasRoom);
    $('#joinBtn').toggle(hasRoom);
    $('#iAmAdmin').toggle(hasRoom);
    $('#roomLinkInput').val(shareLink);
    $('#currentRoomName')
        .text(hasRoom ? roomId : '---')
        .attr('title', hasRoom ? shareLink : '');
    $('#copyRoomLinkBtn').prop('disabled', !hasRoom);
    $('#copyRoomLinkTopBtn').toggle(Boolean(name) && hasRoom);
    $('#historyTopBtn').toggle(Boolean(name) && hasRoom);

    if (!hasRoom) {
        $('#roomHelpText').text('Введите slug комнаты. Он и станет адресом вида /slug/.');
        $('#roomStatusText').text('Сначала создайте комнату или откройте готовую ссылку.');
        return;
    }

    $('#roomLinkHelpText').text('Скопируйте ссылку и отправьте её команде.');
    $('#roomStatusText').text('Комната готова. Можно входить самому и приглашать участников по ссылке.');
}

function setActiveRoom(nextRoomId, roomMeta = null) {
    const normalizedRoomId = normalizeRoomId(nextRoomId);
    roomId = normalizedRoomId;
    currentRoomMeta = roomMeta || buildRoomMeta(normalizedRoomId);
    renderRoomSelectionMeta();
}

async function copyRoomLink() {
    const shareLink = buildRoomLink();
    if (!shareLink) {
        return;
    }

    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(shareLink);
        } else {
            const tempInput = document.createElement('textarea');
            tempInput.value = shareLink;
            tempInput.setAttribute('readonly', '');
            tempInput.style.position = 'absolute';
            tempInput.style.left = '-9999px';
            document.body.appendChild(tempInput);
            tempInput.select();
            document.execCommand('copy');
            document.body.removeChild(tempInput);
        }

        $.toast({
            position: 'top center',
            class: 'success',
            message: 'Ссылка комнаты скопирована'
        });
    } catch (error) {
        $.toast({
            position: 'top center',
            class: 'error',
            message: 'Не удалось скопировать ссылку'
        });
    }
}

function getHistoryPageUrl() {
    if (apiBaseUrl) {
        return `${apiBaseUrl}/history/`;
    }

    return `${window.location.origin}/history/`;
}

function openHistoryPage() {
    window.open(getHistoryPageUrl(), '_blank', 'noopener');
}

const TASK_WHEEL_ITEM_HEIGHT = 40;
let taskState = {
    items: [],
    selectedIndex: 0
};
let estimationMode = 'points';

function normalizeEstimationMode(mode) {
    return mode === 'hours' ? 'hours' : 'points';
}

function normalizeTaskState(nextState = {}) {
    const items = Array.from(new Set((Array.isArray(nextState.items) ? nextState.items : [])
        .map(item => String(item || '').trim())
        .filter(Boolean)));
    const rawIndex = Number(nextState.selectedIndex);
    const safeIndex = Number.isFinite(rawIndex) ? Math.trunc(rawIndex) : 0;
    const maxIndex = items.length ? items.length - 1 : 0;

    return {
        items,
        selectedIndex: items.length ? Math.max(0, Math.min(safeIndex, maxIndex)) : 0
    };
}

function parseTaskListInput(raw) {
    return Array.from(new Set(String(raw || '')
        .split(/[\s,]+/)
        .map(item => item.trim())
        .filter(Boolean)));
}

function getIssueIdFromText(text) {
    const match = String(text || '').match(/\b([A-Za-z][A-Za-z0-9_]*-\d+)\b/);
    return match ? match[1].toUpperCase() : '';
}

function getTaskLabel(task) {
    const issueId = getIssueIdFromText(task);
    if (issueId) return issueId;

    try {
        const parsed = new URL(task);
        const parts = parsed.pathname.split('/').filter(Boolean);
        const lastSegment = parts.pop();
        return decodeURIComponent(lastSegment || parsed.hostname);
    } catch (error) {
        return task.length > 42 ? `${task.slice(0, 39)}...` : task;
    }
}

function syncTaskSidebarOffset() {
    const $sidebar = $('#taskSidebar');
    const $layout = $('.app-layout');
    const $controls = $('#topControls');

    if (!$sidebar.length || !$layout.length || !$controls.length || !name || !isAdmin) {
        $sidebar.css('padding-top', '');
        return;
    }

    window.requestAnimationFrame(() => {
        const layoutRect = $layout[0].getBoundingClientRect();
        const controlsRect = $controls[0].getBoundingClientRect();
        const offset = Math.max(0, Math.round(controlsRect.top - layoutRect.top));
        $sidebar.css('padding-top', `${offset}px`);
    });
}

function renderEstimationMode() {
    estimationMode = normalizeEstimationMode(estimationMode);
    const isJoined = Boolean(name);

    $('#topControls')
        .css('display', isJoined ? 'flex' : 'none')
        .toggleClass('admin-mode', isAdmin)
        .toggleClass('viewer-mode', !isAdmin);
    $('#adminControls').css('display', isJoined && isAdmin ? 'inline-flex' : 'none');
    const modeLabel = estimationMode === 'hours' ? 'Часы' : 'Поинты';

    $('#estimationModePanel')
        .toggle(isJoined)
        .toggleClass('admin-mode', isAdmin)
        .toggleClass('viewer-mode', !isAdmin);
    $('#estimationModeLabel').html(`Оцениваем: <span class="estimation-mode-value" id="estimationModeValue">${modeLabel}</span>`);
    $('#estimationModeButtons').css('display', isAdmin ? 'inline-flex' : 'none');
    $('#modePointsBtn').toggleClass('blue active', estimationMode === 'points');
    $('#modeHoursBtn').toggleClass('blue active', estimationMode === 'hours');
    $('#averageVote .label').text(estimationMode === 'hours' ? 'Средняя оценка в часах' : 'Средняя оценка в поинтах');
}

function setAverageVoteDisplay(value = '0', {updateVisible = true} = {}) {
    const safeValue = String(value ?? '0');
    const $hidden = $('#averageVote1');
    const $value = $('#averageVote .value');
    const hiddenChanged = $hidden.val() !== safeValue;
    const visibleChanged = $value.text() !== safeValue;

    $hidden.val(safeValue);
    if (updateVisible) {
        $value.text(safeValue);
    }
    if (isAdmin) {
        $('#revealBtn').removeClass('disabled loading');
    }
    return hiddenChanged || (updateVisible && visibleChanged);
}

function animateAverageVoteDisplay() {
    $('#averageVote').transition({
        animation: 'flash',
        duration: 200,
        queue: false
    });
}

function renderViewerTaskPanel() {
    const shouldShow = Boolean(name) && !isAdmin && taskState.items.length > 0;
    const $panel = $('#viewerTaskPanel');
    const $link = $('#viewerTaskLink');

    if (!shouldShow) {
        $panel.removeClass('visible');
        $link.removeAttr('href').removeAttr('title');
        $('#viewerTaskValue').text('-');
        return;
    }

    const selectedTask = taskState.items[taskState.selectedIndex];
    $link.attr('href', selectedTask).attr('title', selectedTask);
    $('#viewerTaskValue').text(getTaskLabel(selectedTask));
    $panel.addClass('visible');
}

function renderTaskControls() {
    const hasTasks = taskState.items.length > 0;
    $('#taskSidebar').toggle(Boolean(name) && isAdmin);
    $('#taskListActions').toggle(isAdmin);
    $('#loadTaskListBtn').text('Загрузить список');
    $('#taskPickerSection')
        .toggleClass('viewer-mode', !isAdmin)
        .toggleClass('admin-mode', isAdmin);
    renderViewerTaskPanel();
    $('.task-wheel-title').text(isAdmin ? 'Список задач' : 'Текущая задача');

    const canNavigate = isAdmin && taskState.items.length > 0;
    $('#taskPrevBtn, #taskNextBtn').toggle(canNavigate);
    $('#taskPrevBtn').toggleClass('disabled', !canNavigate || taskState.selectedIndex <= 0);
    $('#taskNextBtn').toggleClass('disabled', !canNavigate || taskState.selectedIndex >= taskState.items.length - 1);
    renderEstimationMode();
    syncTaskSidebarOffset();
}

function renderTaskWheel() {
    taskState = normalizeTaskState(taskState);
    const hasTasks = taskState.items.length > 0;
    const $track = $('#taskWheelTrack');

    renderTaskControls();
    $('#taskPickerSection').toggle(isAdmin && hasTasks);
    $track.empty();

    if (!hasTasks || !isAdmin) {
        $track.css('transform', 'translateY(0)');
        return;
    }

    $('<div class="task-wheel-spacer"></div>').appendTo($track);
    taskState.items.forEach((task, index) => {
        const distance = Math.abs(index - taskState.selectedIndex);
        const distanceClass = distance === 0
            ? 'distance-0'
            : distance === 1
                ? 'distance-1'
                : distance === 2
                    ? 'distance-2'
                    : 'distance-far';
        const $item = $('<a></a>')
            .addClass(`task-wheel-item ${distanceClass}${index === taskState.selectedIndex ? ' active' : ''}`)
            .attr('href', task)
            .attr('target', '_blank')
            .attr('rel', 'noopener noreferrer')
            .attr('title', task);

        $('<span></span>')
            .addClass('task-wheel-label')
            .text(getTaskLabel(task))
            .appendTo($item);
        $track.append($item);
    });
    $('<div class="task-wheel-spacer"></div>').appendTo($track);
    $track.css('transform', `translateY(${-taskState.selectedIndex * TASK_WHEEL_ITEM_HEIGHT}px)`);
}

function mapTaskStateError(errorCode) {
    if (errorCode === 'ACK_TIMEOUT') return 'Сервер не ответил. Похоже, страница подключена к старой версии сервера без списка задач';
    if (errorCode === 'SOCKET_DISCONNECTED') return 'Нет подключения к серверу';
    if (errorCode === 'FORBIDDEN') return 'Только администратор может менять список задач';
    if (errorCode === 'TASK_LIST_EMPTY') return 'Список задач пуст';
    return `Ошибка списка задач: ${errorCode || 'UNKNOWN_ERROR'}`;
}

function emitWithAck(eventName, payload, timeoutMs = 4000) {
    return new Promise(resolve => {
        let settled = false;
        let timer = null;
        let connectHandler = null;

        const finish = result => {
            if (settled) return;
            settled = true;
            if (timer) {
                clearTimeout(timer);
            }
            if (connectHandler) {
                socket.off('connect', connectHandler);
            }
            resolve(result);
        };

        const emitRequest = () => {
            socket.emit(eventName, payload, result => {
                finish(result || {ok: false, error: 'UNKNOWN_ERROR'});
            });
        };

        timer = setTimeout(() => {
            finish({ok: false, error: socket.connected ? 'ACK_TIMEOUT' : 'SOCKET_DISCONNECTED'});
        }, timeoutMs);

        if (socket.connected) {
            emitRequest();
            return;
        }

        connectHandler = emitRequest;
        socket.once('connect', connectHandler);
    });
}

function getAvailableVoteValues() {
    return estimationMode === 'hours' ? allEstimateValues : originalPoints;
}

function hasVoteValue(value) {
    return value !== null && typeof value !== 'undefined' && String(value).trim() !== '';
}

function toNumericVote(value) {
    const numericValue = Number.parseFloat(value);
    return Number.isFinite(numericValue) ? numericValue : null;
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomAverageVoteDelayMs() {
    const range = AUTO_AVERAGE_VOTE_MAX_DELAY_MS - AUTO_AVERAGE_VOTE_MIN_DELAY_MS + 1;
    return AUTO_AVERAGE_VOTE_MIN_DELAY_MS + Math.floor(Math.random() * range);
}

function getClosestAvailableVoteValue(targetAverage) {
    return getAvailableVoteValues()
        .map(value => ({
            value: String(value),
            numericValue: toNumericVote(value)
        }))
        .filter(item => item.numericValue !== null)
        .reduce((closest, item) => {
            const distance = Math.abs(item.numericValue - targetAverage);
            if (!closest
                || distance < closest.distance
                || (distance === closest.distance && item.numericValue > closest.numericValue)) {
                return {
                    ...item,
                    distance
                };
            }

            return closest;
        }, null)?.value || null;
}

function createAverageVotePlan(players, {force = false} = {}) {
    if (!roomId || !name || !mySocketId) {
        return {ok: true, status: 'waiting_join'};
    }
    if (revealed) {
        return {ok: true, status: 'paused_revealed'};
    }

    const currentPlayer = players.find(player => player.id === mySocketId);
    if (!currentPlayer) {
        return {ok: true, status: 'waiting_join'};
    }
    if (!force && hasVoteValue(currentPlayer.vote)) {
        return {ok: true, status: 'current_voted', value: String(currentPlayer.vote)};
    }

    const peerPlayers = players.filter(player => player.id !== mySocketId);
    if (!peerPlayers.length) {
        return {ok: true, status: 'waiting_peers'};
    }

    const votedPeers = peerPlayers.filter(player => hasVoteValue(player.vote));
    const requiredVotes = Math.max(1, Math.ceil(peerPlayers.length * AUTO_AVERAGE_VOTE_THRESHOLD));
    const progress = {
        voted: votedPeers.length,
        total: peerPlayers.length,
        required: requiredVotes
    };

    if (votedPeers.length < requiredVotes) {
        return {
            ok: true,
            status: 'waiting',
            progress
        };
    }

    const numericVotes = votedPeers
        .map(player => toNumericVote(player.vote))
        .filter(value => value !== null);
    if (!numericVotes.length) {
        return {ok: true, status: 'waiting_numeric_votes', progress};
    }

    const average = numericVotes.reduce((sum, value) => sum + value, 0) / numericVotes.length;
    const value = getClosestAvailableVoteValue(average);
    if (!value) {
        return {ok: false, error: 'NO_AVAILABLE_VOTES', progress, average};
    }

    return {
        ok: true,
        status: 'ready',
        value,
        average,
        progress
    };
}

async function evaluateAverageVoteAutomation({manual = false} = {}) {
    if (!averageVoteAutomationState.enabled && !manual) {
        return null;
    }
    if (averageVoteAutomationState.submitting) {
        return {ok: true, status: 'submitting'};
    }

    const plan = createAverageVotePlan(latestPlayers, {
        force: averageVoteAutomationState.forceNext
    });
    if (!plan.ok) {
        return plan;
    }
    if (plan.status !== 'ready') {
        return plan;
    }

    const forceNext = averageVoteAutomationState.forceNext;
    const delayMs = getRandomAverageVoteDelayMs();
    averageVoteAutomationState.forceNext = false;
    averageVoteAutomationState.submitting = true;
    let latestPlan = plan;
    let submitted = false;
    try {
        await wait(delayMs);
        latestPlan = createAverageVotePlan(latestPlayers, {force: forceNext});
        if (!latestPlan.ok || latestPlan.status !== 'ready') {
            return {
                ...latestPlan,
                delayMs
            };
        }

        submitted = await submitVote(latestPlan.value, {silent: true});
    } finally {
        averageVoteAutomationState.submitting = false;
    }

    return {
        ...latestPlan,
        delayMs,
        ok: submitted,
        status: submitted ? 'submitted' : 'submit_failed'
    };
}

function pockerVoteNearAverage(options = {}) {
    const normalizedOptions = typeof options === 'boolean'
        ? {enabled: options, force: options}
        : options;
    if (normalizedOptions && normalizedOptions.enabled === false) {
        averageVoteAutomationState.enabled = false;
        averageVoteAutomationState.forceNext = false;
        return Promise.resolve({ok: true, status: 'disabled'});
    }

    averageVoteAutomationState.enabled = true;
    averageVoteAutomationState.forceNext = Boolean(normalizedOptions && normalizedOptions.force);
    return evaluateAverageVoteAutomation({manual: true});
}

function pockerStopAutoVote() {
    return pockerVoteNearAverage(false);
}

function toggleAverageVoteAutomation() {
    if (averageVoteAutomationState.enabled) {
        return pockerStopAutoVote();
    }

    return pockerVoteNearAverage();
}

function isEditableShortcutTarget(target) {
    const tagName = target && target.tagName ? target.tagName.toLowerCase() : '';
    return tagName === 'input' || tagName === 'textarea' || tagName === 'select' || Boolean(target?.isContentEditable);
}

function isAverageVoteShortcut(event) {
    return event.ctrlKey && event.altKey && event.shiftKey && String(event.key || '').toLowerCase() === 'v';
}

window.pockerVoteNearAverage = pockerVoteNearAverage;
window.pockerAutoVote = pockerVoteNearAverage;
window.pockerStopAutoVote = pockerStopAutoVote;

function ensureVoteButtons(values) {
    const $voteButtons = $('#voteButtons');
    // Keep vote buttons stable across room updates so an in-flight click is not lost on DOM rebuild.
    const existingValues = $voteButtons.children('button').map(function () {
        return $(this).attr('data-value') || $(this).text().trim();
    }).get();
    const needsRebuild = existingValues.length !== values.length
        || existingValues.some((value, index) => value !== values[index]);

    if (!needsRebuild) {
        return;
    }

    $voteButtons.empty();
    values.forEach(value => {
        // const isOriginal = originalPoints.includes(value);
        const btn = $(`<button type="button" class="ui big button basic">${value}</button>`)
            .attr('data-value', value);

        btn.click(() => {
            submitVote(value);
        });

        $voteButtons.append(btn);
    });
}

function updateVoteButtonsSelectionState(currentVote) {
    const normalizedCurrentVote = currentVote === null || typeof currentVote === 'undefined'
        ? null
        : String(currentVote);

    $('#voteButtons button').each(function () {
        const buttonValue = $(this).attr('data-value') || $(this).text().trim();
        $(this).toggleClass('basic', buttonValue !== normalizedCurrentVote);
        $(this).toggleClass('blue', buttonValue === normalizedCurrentVote);
    });
}

function updateVoteButtonsPendingState() {
    const hasPendingVote = pendingVoteValue !== null;

    $('#voteButtons button').each(function () {
        const buttonValue = $(this).attr('data-value') || $(this).text().trim();
        const isPendingButton = hasPendingVote && buttonValue === pendingVoteValue;
        $(this)
            .prop('disabled', hasPendingVote)
            .toggleClass('disabled', hasPendingVote)
            .toggleClass('loading', isPendingButton);
    });
}

function mapVoteError(errorCode) {
    if (errorCode === 'FORBIDDEN') return 'Соединение с комнатой устарело. Попробуйте ещё раз';
    if (errorCode === 'ACK_TIMEOUT') return 'Сервер не подтвердил установку оценки';
    if (errorCode === 'SOCKET_DISCONNECTED') return 'Нет подключения к серверу';
    return `Ошибка установки оценки: ${errorCode || 'UNKNOWN_ERROR'}`;
}

async function restoreSessionAfterReconnect({silent = false} = {}) {
    if (!name || !roomId) {
        return false;
    }

    if (restoreSessionPromise) {
        return restoreSessionPromise;
    }

    restoreSessionPromise = (async () => {
        const result = await emitWithAck('join', {
            roomId,
            name,
            isAdmin,
            sessionId: participantSessionId
        });
        if (!result || !result.ok) {
            if (!silent) {
                $.toast({
                    position: 'top center',
                    class: 'error',
                    message: mapJoinError(result && result.error)
                });
            }
            return false;
        }

        applyRoomState(result);
        return true;
    })();

    try {
        return await restoreSessionPromise;
    } finally {
        restoreSessionPromise = null;
    }
}

async function submitVote(value, {silent = false, retryOnForbidden = true} = {}) {
    if (!roomId || !name) {
        return false;
    }

    pendingVoteValue = String(value);
    updateVoteButtonsPendingState();

    let result = await emitWithAck('vote', {roomId, value: pendingVoteValue});

    if ((!result || !result.ok) && retryOnForbidden && result && result.error === 'FORBIDDEN') {
        const restored = await restoreSessionAfterReconnect({silent});
        if (restored) {
            result = await emitWithAck('vote', {roomId, value: pendingVoteValue});
        }
    }

    pendingVoteValue = null;
    updateVoteButtonsPendingState();

    if (!result || !result.ok) {
        if (!silent) {
            $.toast({
                position: 'top center',
                class: 'error',
                message: mapVoteError(result && result.error)
            });
        }
        socket.emit('get_players', roomId);
        return false;
    }

    try {
        setStoredValueWithTTL(getVoteKey(), String(value));
    } catch (e) {
    }

    return true;
}

function mapJoinError(errorCode) {
    if (errorCode === 'ACK_TIMEOUT') return 'Сервер не ответил на запрос входа';
    if (errorCode === 'SOCKET_DISCONNECTED') return 'Нет подключения к серверу';
    if (errorCode === 'ROOM_NOT_FOUND') return 'Комната не найдена. Возможно, ссылка устарела или повреждена';
    if (errorCode === 'ADMIN_ALREADY_EXISTS') return 'В этой комнате уже есть администратор';
    if (errorCode === 'NAME_REQUIRED') return 'Введите имя перед входом';
    return `Ошибка входа: ${errorCode || 'UNKNOWN_ERROR'}`;
}

function mapCreateRoomError(errorCode) {
    if (errorCode === 'ACK_TIMEOUT') return 'Сервер не ответил на запрос создания комнаты';
    if (errorCode === 'SOCKET_DISCONNECTED') return 'Нет подключения к серверу';
    if (errorCode === 'ROOM_SUFFIX_REQUIRED') return 'Введите постфикс для новой комнаты';
    if (errorCode === 'ROOM_SUFFIX_INVALID') return 'Используйте только буквы, цифры, дефис или underscore';
    if (errorCode === 'ROOM_ALREADY_EXISTS') return 'Комната с таким адресом уже существует';
    return `Ошибка создания комнаты: ${errorCode || 'UNKNOWN_ERROR'}`;
}

async function emitTaskSelection(direction) {
    if (!isAdmin || !taskState.items.length) return;

    const result = await emitWithAck('task_select', {roomId, direction});
    if (!result || !result.ok) {
        $.toast({
            position: 'top center',
            class: 'error',
            message: mapTaskStateError(result && result.error)
        });
    }
}

$('.ui.sticky').sticky({
    context: 'body',
    pushing: true,
    bottomOffset: 0
});

$('#taskListModal').modal({
    autofocus: false,
    observeChanges: true
});

$(window).on('resize', syncTaskSidebarOffset);

async function createRoom() {
    const roomSuffix = normalizeRoomSuffix($('#roomSuffix').val());
    if (!roomSuffix) {
        $.toast({
            position: 'top center',
            class: 'warning',
            message: 'Введите постфикс для новой комнаты'
        });
        return null;
    }

    $('#createRoomBtn').addClass('disabled loading');
    const result = await emitWithAck('create_room', {roomSuffix});
    $('#createRoomBtn').removeClass('disabled loading');

    if (!result || !result.ok || !result.room || !result.room.id) {
        $.toast({
            position: 'top center',
            class: 'error',
            message: mapCreateRoomError(result && result.error)
        });
        return null;
    }

    setActiveRoom(result.room.id, result.room);
    updateRoomUrl(result.room.id);
    $('#roomSuffix').val(result.room.suffix || roomSuffix);
    return result.room;
}

async function joinSession(newName, newIsAdmin) {
    if (!roomId) {
        $.toast({
            position: 'top center',
            class: 'error',
            message: 'Сначала создайте комнату или откройте ссылку'
        });
        return false;
    }

    $('#joinBtn').addClass('disabled loading');
    const result = await emitWithAck('join', {
        roomId,
        name: newName,
        isAdmin: newIsAdmin,
        sessionId: participantSessionId
    });
    $('#joinBtn').removeClass('disabled loading');

    if (!result || !result.ok) {
        $.toast({
            position: 'top center',
            class: 'error',
            message: mapJoinError(result && result.error)
        });
        return false;
    }

    name = newName;
    isAdmin = newIsAdmin;
    localStorage.setItem('pokerName', name);
    localStorage.setItem(getAdminStorageKey(roomId), String(isAdmin));

    if (result.room) {
        setActiveRoom(result.room.id, result.room);
    }

    setAverageVoteDisplay('0');
    applyRoomState(result);

    const savedVote = getStoredValueWithTTL(getVoteKey());
    if (savedVote) {
        await submitVote(savedVote, {
            silent: true,
            retryOnForbidden: false
        });
    }
    $('#playerName').val(name);
    $('#playerName').addClass('disabled');
    $('#roomSuffix').prop('disabled', true);
    $('#roomLinkInput').prop('disabled', true);
    $('#isAdmin').prop('disabled', true);
    $('#joinBtn').prop('disabled', true);
    $('#createRoomBtn').prop('disabled', true);
    $('.onlyAuth').hide();
    $('#joinPanel').hide();
    $('#sessionUserName').text(name);
    $('#sessionTopbar').css('display', 'flex');
    $('#roomWrapper').show();
    $('#copyRoomLinkTopBtn').show();
    $('#changeNameBtn, #averageVote').show();
    $('#adminWrapper').css('visibility', 'visible');
    if (isAdmin) {
        $('#adminNoteForm').show();
        $('#noteDisplay').hide();
    } else {
        $('#adminNoteForm').hide();
    }
    renderTaskControls();
    return true;
}

$(document).ready(async () => {
    const savedName = localStorage.getItem('pokerName') || '';
    const roomFromUrl = getRoomIdFromLocation();
    const savedAdmin = roomFromUrl
        ? localStorage.getItem(getAdminStorageKey(roomFromUrl)) === 'true'
        : false;

    $('#playerName').val(savedName);
    $('#isAdmin').val(savedAdmin ? '1' : '0');
    $('#iAmAdmin').toggleClass('green', savedAdmin);
    renderTaskWheel();

    renderRoomSelectionMeta();
    $('#copyRoomLinkBtn, #copyRoomLinkTopBtn').click(copyRoomLink);
    $('#historyTopBtn').click(openHistoryPage);

    if (roomFromUrl) {
        const roomMeta = buildRoomMeta(roomFromUrl);
        if (roomMeta) {
            setActiveRoom(roomFromUrl, roomMeta);
        } else {
            $.toast({
                position: 'top center',
                class: 'warning',
                message: 'Ссылка комнаты выглядит некорректной'
            });
        }
    }

    if (savedName && roomId) {
        await joinSession(savedName, savedAdmin);
    }
});

$('#createRoomBtn').click(async () => {
    const newName = $('#playerName').val().trim();
    if (!newName) {
        $.toast({
            position: 'top center',
            class: 'warning',
            message: 'Введите имя перед созданием комнаты'
        });
        return;
    }

    const room = await createRoom();
    if (!room) {
        return;
    }

    $('#isAdmin').val('1');
    $('#iAmAdmin').addClass('green');
    await joinSession(newName, true);
});

$('#joinBtn').click(async () => {
    const newName = $('#playerName').val().trim();
    const newIsAdmin = $('#isAdmin').val() === '1';
    if (!newName) {
        $.toast({
            position: 'top center',
            class: 'warning',
            message: 'Введите имя перед входом'
        });
        return;
    }

    await joinSession(newName, newIsAdmin);
});

$('#changeNameBtn').click(() => {
    stopHeartbeat();
    try {
        localStorage.removeItem(getVoteKey());
    } catch (e) {
    }
    localStorage.removeItem('pokerName');
    localStorage.removeItem(getAdminStorageKey(roomId));
    localStorage.removeItem('pokerAdmin');
    location.reload();
});

$('#revealBtn').click(() => {
    $('#revealBtn').addClass('disabled loading');
    if (isAdmin) socket.emit('reveal', roomId);
});

$('#resetBtn').click(() => {
    if (isAdmin) socket.emit('reset', roomId);
});

$('#loadTaskListBtn').click(() => {
    $('#taskListInput').val(taskState.items.join('\n'));
    $('#taskListModal').modal('show');
});

$('#saveTaskListBtn').click(async function () {
    if (!isAdmin) return;

    const items = parseTaskListInput($('#taskListInput').val());
    const $btn = $(this);
    $btn.addClass('loading disabled');

    const result = await emitWithAck('task_list_update', {roomId, items});
    $btn.removeClass('loading disabled');
    if (!result || !result.ok) {
        $.toast({
            position: 'top center',
            class: 'error',
            message: mapTaskStateError(result && result.error)
        });
        return;
    }

    $('#taskListModal').modal('hide');
    $.toast({
        position: 'top center',
        class: 'success',
        message: items.length ? 'Список задач сохранен' : 'Список задач очищен'
    });
});

$('#taskPrevBtn').click(() => {
    emitTaskSelection(-1);
});

$('#taskNextBtn').click(() => {
    emitTaskSelection(1);
});

$('#modePointsBtn').click(async () => {
    if (!isAdmin) return;
    const result = await emitWithAck('set_estimation_mode', {roomId, mode: 'points'});
    if (!result || !result.ok) {
        $.toast({
            position: 'top center',
            class: 'error',
            message: mapTaskStateError(result && result.error)
        });
    }
});

$('#modeHoursBtn').click(async () => {
    if (!isAdmin) return;
    const result = await emitWithAck('set_estimation_mode', {roomId, mode: 'hours'});
    if (!result || !result.ok) {
        $.toast({
            position: 'top center',
            class: 'error',
            message: mapTaskStateError(result && result.error)
        });
    }
});

function mapStoryPointsError(errorCode) {
    if (errorCode === 'FORBIDDEN') return 'Только админ может проставлять Story points';
    if (errorCode === 'NO_VOTES') return 'Нет голосов для расчета среднего';
    if (errorCode === 'YOUTRACK_NOT_CONFIGURED') return 'YouTrack не настроен на сервере';
    if (errorCode === 'ISSUE_NOT_FOUND_IN_NOTE') return 'В поле сообщения укажите задачу, например ABC-123';
    return `Ошибка YouTrack: ${errorCode || 'UNKNOWN_ERROR'}`;
}

$('#setStoryPointsBtn').click(function () {
    if (!isAdmin) return;
    if (!revealed) {
        $.toast({
            position: 'top center',
            class: 'warning',
            message: 'Сначала нажмите "Показать", затем проставляйте Story points'
        });
        return;
    }

    const $btn = $(this);
    $btn.addClass('loading disabled');
    socket.emit('set_story_points', {roomId}, (result) => {
        $btn.removeClass('loading disabled');
        if (!result || !result.ok) {
            $.toast({
                position: 'top center',
                class: 'error',
                message: mapStoryPointsError(result && result.error)
            });
            return;
        }

        const summarySuffix = result.issueSummary ? ` - ${result.issueSummary}` : '';
        $.toast({
            position: 'top center',
            class: 'success',
            message: `${result.issueIdReadable}: Story points = ${result.average}${summarySuffix}`
        });
    });
});

$('#adminNote').on('input keydown change', function () {
    const note = $(this).val();
    socket.emit('note_update', {roomId, note});
});

function applyNote(note) {
    const nextNote = String(note || '');

    if (isAdmin) {
        if ($('#adminNote').val() !== nextNote) {
            $('#adminNote').val(nextNote);
        }
        $('#noteDisplay').hide().empty();
        return;
    }

    if (nextNote.trim().length > 0) {
        $('#noteDisplay').html(parseLinks(nextNote)).show();
        return;
    }

    $('#noteDisplay').hide().empty();
}

function applyRoomState(roomState = {}) {
    if (roomState.room) {
        setActiveRoom(roomState.room.id, roomState.room);
    }

    if (typeof roomState.revealed === 'boolean') {
        revealed = roomState.revealed;
    }

    if (typeof roomState.estimationMode === 'string') {
        estimationMode = normalizeEstimationMode(roomState.estimationMode);
    }

    if (Number.isFinite(roomState.heartbeatIntervalMs) && roomState.heartbeatIntervalMs >= 5000) {
        heartbeatIntervalMs = roomState.heartbeatIntervalMs;
    }

    if (roomState.taskState) {
        taskState = normalizeTaskState(roomState.taskState);
        renderTaskWheel();
    }

    if (Array.isArray(roomState.players)) {
        renderPlayers(roomState.players);
    }

    if (typeof roomState.note === 'string') {
        applyNote(roomState.note);
    }

    if (name && roomId) {
        startHeartbeat();
    }
}

function calcAvg(numericVotes) {
    if (!numericVotes.length) return '0';
    return (numericVotes.reduce((a, b) => a + b, 0) / numericVotes.length).toFixed(0);
}

const gradientClasses = ['gradient-1', 'gradient-2', 'gradient-3', 'gradient-4', 'gradient-5'];

function mapReactionError(errorCode) {
    if (errorCode === 'FORBIDDEN') return 'Сначала подключитесь к комнате';
    if (errorCode === 'REACTION_INVALID') return 'Такая реакция недоступна';
    if (errorCode === 'ACK_TIMEOUT') return 'Сервер не ответил на обновление реакции';
    if (errorCode === 'SOCKET_DISCONNECTED') return 'Нет подключения к серверу';
    return `Ошибка реакции: ${errorCode || 'UNKNOWN_ERROR'}`;
}

function ensureReactionPickerButtons() {
    const $picker = $('#reactionPicker');
    if ($picker.children().length > 0) {
        return;
    }

    availableReactions.forEach(reaction => {
        const $button = $('<button type="button" class="reaction-option"></button>')
            .attr('data-reaction', reaction.value)
            .attr('aria-label', reaction.label)
            .attr('title', reaction.label)
            .text(reaction.value);

        $button.on('click', async function (event) {
            event.preventDefault();
            event.stopPropagation();
            const nextReaction = $(this).attr('data-reaction');
            await submitReaction(nextReaction === currentReactionValue ? null : nextReaction);
        });

        $picker.append($button);
    });
}

function setReactionPickerOpen(nextOpen) {
    const canShow = Boolean(name && roomId);
    reactionPickerOpen = canShow && Boolean(nextOpen);

    $('#reactionDock').toggle(canShow);
    $('#reactionPicker').toggleClass('open', reactionPickerOpen);
    $('#reactionTrigger')
        .toggleClass('open', reactionPickerOpen)
        .attr('aria-expanded', reactionPickerOpen ? 'true' : 'false');
}

async function submitReaction(value) {
    const $trigger = $('#reactionTrigger');
    const $options = $('#reactionPicker .reaction-option');
    $trigger.prop('disabled', true);
    $options.prop('disabled', true);

    const result = await emitWithAck('set_reaction', {roomId, value});

    $trigger.prop('disabled', false);
    $options.prop('disabled', false);

    if (!result || !result.ok) {
        $.toast({
            position: 'top center',
            class: 'error',
            message: mapReactionError(result && result.error)
        });
        socket.emit('get_players', roomId);
        return;
    }

    setReactionPickerOpen(false);
}

function renderReactionPicker(currentPlayer) {
    if (!currentPlayer) {
        currentReactionValue = null;
        setReactionPickerOpen(false);
        $('#reactionDock').hide();
        return;
    }

    ensureReactionPickerButtons();
    currentReactionValue = currentPlayer.reaction || null;
    $('#reactionTriggerEmoji').text(currentReactionValue || '😊');
    $('#reactionTrigger').toggleClass('has-reaction', Boolean(currentReactionValue));
    $('#reactionPicker .reaction-option').each(function () {
        const isActive = $(this).attr('data-reaction') === currentReactionValue;
        $(this)
            .toggleClass('active', isActive)
            .attr('aria-pressed', isActive ? 'true' : 'false');
    });
    setReactionPickerOpen(reactionPickerOpen);
}

function triggerReactionAnimation($card) {
    const $reaction = $card.find('.player-reaction');
    $reaction.removeClass('is-animating');
    void $reaction[0].offsetWidth;
    $reaction.addClass('is-animating');
}

function getGradientIndex(id, count) {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
        hash = (hash << 5) - hash + id.charCodeAt(i);
    }
    return Math.abs(hash) % count;
}

function renderPlayers(players) {
    const $players = $('#players');
    latestPlayers = Array.isArray(players) ? players.map(player => ({...player})) : [];
    $('#participantCount').text(String(players.length));
    const current = players.find(p => p.id === mySocketId);
    const existingIds = new Set();
    const numericVotes = [];

    if (current && (current.vote === null || typeof current.vote === 'undefined')) {
        try {
            localStorage.removeItem(getVoteKey());
        } catch (e) {
        }
    }
    if (current) {
        const availableValues = getAvailableVoteValues();
        ensureVoteButtons(availableValues);
        updateVoteButtonsSelectionState(current.vote);
        $('#voteButtons').show();
        updateVoteButtonsPendingState();
    } else {
        $('#voteButtons').hide();
    }
    renderReactionPicker(current);

    const admin = players.find(p => p.isAdmin);
    $('#currentAdmin').text(admin ? `${admin.name}` : '---');

    if (revealed) {
        players.sort((a, b) => {
            if (a.vote === null) return 1;
            if (b.vote === null) return -1;
            return parseFloat(a.vote) - parseFloat(b.vote);
        });
    }

    players.forEach(player => {
        const voted = Boolean(player.vote);
        const hasReaction = Boolean(player.reaction);
        const gradientIndex = getGradientIndex(player.id, gradientClasses.length);
        const gradient = voted ? gradientClasses[gradientIndex] : null;
        const existing = $players.find(`[data-id="${player.id}"]`);

        const showVote = revealed || player.id === mySocketId;
        const point = showVote && voted ? player.vote : '?';

        let card;
        if (existing.length) {
            card = existing;
            const previousReaction = card.attr('data-reaction') || '';
            const reactionChanged = previousReaction !== (player.reaction || '');
            card.find('.selectedPoint').text(point);
            card.find('.player-name').text(player.name);
            card.find('.player-reaction').text(player.reaction || '');
            card
                .removeClass()
                .addClass(`ui raised link card player-card ${voted ? gradient : 'default-card'}`)
                .toggleClass('has-reaction', hasReaction)
                .attr('data-reaction', player.reaction || '')
                .attr('data-id', player.id);
            if (reactionChanged && player.reaction) {
                triggerReactionAnimation(card);
                playSoundEffect('reaction');
            }
            $players.append(card);
        } else {
            const item = $(`<div class="ui raised link card player-card ${voted ? gradient : 'default-card'}" data-id="${player.id}"></div>`);
            const body = $('<div class="player-card-body"></div>');
            const reactionEl = $(`<div class="player-reaction">${player.reaction || ''}</div>`);
            const content = $('<div class="content flex-center player-card-content"></div>');
            const pointEl = $(`<div class="selectedPoint">${point}</div>`);
            const header = $(`<div class="mini header player-name">${player.name}</div>`);
            item
                .toggleClass('has-reaction', hasReaction)
                .attr('data-reaction', player.reaction || '');
            body.append(pointEl).append(reactionEl);
            content.append(body).append(header);
            item.append(content);
            $players.append(item);
        }

        if (player.vote && !isNaN(player.vote)) {
            numericVotes.push(parseFloat(player.vote));
        }

        existingIds.add(player.id);
    });

    $players.children().each(function () {
        const id = $(this).data('id');
        if (!existingIds.has(id)) {
            $(this).remove();
        }
    });

    const roundedAvg = calcAvg(numericVotes);
    if (numericVotes.length > 0) {
        if (revealed) {
            const averageChanged = setAverageVoteDisplay(roundedAvg);
            if (averageChanged) {
                animateAverageVoteDisplay();
            }
        } else {
            setAverageVoteDisplay(roundedAvg, {updateVisible: false});
        }
    } else {
        setAverageVoteDisplay('0');
    }

    evaluateAverageVoteAutomation().catch(() => {
    });
}


socket.on('players_update', renderPlayers);
socket.on('votes_update', renderPlayers);
socket.on('reactions_update', renderPlayers);
socket.on('reveal_update', state => {
    revealed = state;
    socket.emit('get_players', roomId);
    if (state) {
        playSoundEffect('reveal');
    }
    if (!state) {
        playSoundEffect('reset');
        setAverageVoteDisplay('0');
        try {
            localStorage.removeItem(getVoteKey());
        } catch (e) {
        }
        $.toast({
            position: 'top center',
            class: 'warning',
            message: `Оценки сброшены`
        });
    }
});
socket.on('note_update', note => {
    applyNote(note);
});
socket.on('task_state_update', nextTaskState => {
    taskState = normalizeTaskState(nextTaskState);
    renderTaskWheel();
});
socket.on('estimation_mode_update', nextMode => {
    estimationMode = normalizeEstimationMode(nextMode);
    renderEstimationMode();
    if (name) {
        socket.emit('get_players', roomId);
    }
});
socket.on('user_event', ({message, type}) => {
    $.toast({
        position: 'top center',
        class: type,
        message
    });
});

$('#reactionTrigger').on('click', function (event) {
    event.preventDefault();
    event.stopPropagation();
    if (!roomId || !name) {
        return;
    }
    ensureReactionPickerButtons();
    setReactionPickerOpen(!reactionPickerOpen);
});

$(document).on('click', function (event) {
    if (!$(event.target).closest('#reactionDock').length) {
        setReactionPickerOpen(false);
    }
});

$(document).on('keydown', function (event) {
    if (event.key === 'Escape') {
        setReactionPickerOpen(false);
        return;
    }

    if (isAverageVoteShortcut(event) && !isEditableShortcutTarget(event.target)) {
        event.preventDefault();
        toggleAverageVoteAutomation().catch(() => {
        });
    }
});

function parseLinks(text) {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, url => {
        const display = url.length > 50 ? url.slice(0, 47) + '...' : url;
        return `<a href="${url}" target="_blank" rel="noopener noreferrer">${display}</a>`;
    });
}
