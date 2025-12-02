
import { initState, addParticipant, removeParticipant, setViewMode, setScreenSize, setParticipantState, setSpotlight, setGridSize, state } from './state.js';
import { createViewControls } from './ui.js';
import { applyLayout }s from './layout.js';

const VIEW_CONTAINER_ID = 'video-grid-container';

let container = null;

function init() {
    container = document.getElementById(VIEW_CONTAINER_ID);
    if (!container) {
        return;
    }

    // 1. Load initial state from localStorage
    initState();

    // 2. Create UI Controls
    createViewControls(document.getElementById('bottom-controls'));

    // 3. Set initial screen size
    setScreenSize(window.innerWidth, window.innerHeight);

    // 4. Initial render
    render();

    // 5. Subscribe to events
    subscribeToEvents();
}

function render() {
    if (!container) return;
    applyLayout(container, state);
}

function subscribeToEvents() {
    // Listen for state changes
    window.addEventListener('viewstatechanged', render);

    // Listen for window resize
    window.addEventListener('resize', () => {
        setScreenSize(window.innerWidth, window.innerHeight);
    });

    // Listen for application events (from script.js)
    document.addEventListener('participantJoined', (e) => {
        addParticipant(e.detail);
    });

    document.addEventListener('participantLeft', (e) => {
        removeParticipant(e.detail.id);
    });

    document.addEventListener('participantSpeaking', (e) => {
        setParticipantState(e.detail.id, { isSpeaking: true });
    });

    document.addEventListener('participantStoppedSpeaking', (e) => {
        setParticipantState(e.detail.id, { isSpeaking: false });
    });

    document.addEventListener('screenShareStarted', (e) => {
        setParticipantState(e.detail.id, { isSharingScreen: true });
    });

    document-addEventListener('screenShareStopped', (e) => {
        setParticipantState(e.detail.id, { isSharingScreen: false });
    });

    document.addEventListener('localUserSharing', (e) => {
        setParticipantState(e.detail.id, { isLocal: true, isSharingScreen: true });
    });
}

// Initialize on DOMContentLoaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
