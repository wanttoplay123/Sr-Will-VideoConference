// Bypass ngrok warning page - CORREGIDO
(function () {
    const originalFetch = window.fetch;
    window.fetch = function (resource, options = {}) {
        if (!options.headers) {
            options.headers = {};
        }
        options.headers['ngrok-skip-browser-warning'] = 'true';
        return originalFetch(resource, options);
    };

    // Para XMLHttpRequest solo interceptamos open y guardamos referencia
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, async, user, password) {
        this._method = method;
        this._url = url;
        return originalXHROpen.call(this, method, url, async, user, password);
    };

    XMLHttpRequest.prototype.send = function (body) {
        // Solo agregamos el header si no es una petición misma-origen simple
        try {
            this.setRequestHeader('ngrok-skip-browser-warning', 'true');
        } catch (e) {
            // Ignorar si no se puede establecer el header
        }
        return originalXHRSend.call(this, body);
    };
})();

// ============= CONFIGURACIÓN DE LOGGING =============
// Poner en false para producción (mejora rendimiento)
const DEBUG_MODE = false;

// Wrapper para console.log que respeta DEBUG_MODE
const devLog = DEBUG_MODE ? console.log.bind(console) : () => {};
const devWarn = DEBUG_MODE ? console.warn.bind(console) : () => {};

// Solo errores críticos se muestran siempre
const criticalLog = console.error.bind(console);
// ====================================================

const iceServers = [
    // Servidores STUN de Google (para NAT traversal)
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },

    // Servidores STUN adicionales públicos
    { urls: 'stun:stun.stunprotocol.org:3478' },
    { urls: 'stun:stun.voip.blackberry.com:3478' },
    { urls: 'stun:stun.services.mozilla.com' },
    
    // ===== SERVIDORES TURN GRATUITOS =====
    // Estos son esenciales para conectar usuarios en diferentes redes/NAT
    
    // OpenRelay TURN (gratuito y público)
    {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
    },
    {
        urls: 'turn:openrelay.metered.ca:80?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject'
    },
    {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject'
    },
    {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject'
    },
    {
        urls: 'turns:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject'
    },
    
    // Relay gratuito de Xirsys (alternativa)
    {
        urls: 'turn:global.relay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
    },
    {
        urls: 'turn:global.relay.metered.ca:80?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject'
    },
    {
        urls: 'turn:global.relay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject'
    },
    {
        urls: 'turn:global.relay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject'
    },
    {
        urls: 'turns:global.relay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject'
    }
];

// ============= FUNCIÓN DE DIAGNÓSTICO DE CONECTIVIDAD =============
// Llamar desde la consola: diagnosticarConexion()
async function diagnosticarConexion() {
    // 1. Verificar servidores TURN
    for (const server of iceServers) {
        if (server.urls && server.urls.includes('turn')) {
            try {
                const testPc = new RTCPeerConnection({ iceServers: [server] });
                testPc.createDataChannel('test');
                const offer = await testPc.createOffer();
                await testPc.setLocalDescription(offer);
                
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject('Timeout'), 5000);
                    testPc.onicecandidate = (e) => {
                        if (e.candidate && e.candidate.candidate.includes('relay')) {
                            clearTimeout(timeout);
                            resolve(true);
                        }
                    };
                });
                testPc.close();
            } catch (err) {
            }
        }
    }
    
    // 2. Verificar conexiones peer activas
    for (const [userId, pc] of Object.entries(peerConnections)) {
        // Verificar tipo de conexión
        const stats = await pc.getStats();
        let connectionType = 'DESCONOCIDO';
        stats.forEach(report => {
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                stats.forEach(r => {
                    if (r.id === report.localCandidateId) {
                        connectionType = r.candidateType === 'relay' ? 'TURN/RELAY ⭐' : 
                                        r.candidateType === 'srflx' ? 'STUN' : 
                                        r.candidateType === 'host' ? 'LOCAL/HOST' : r.candidateType;
                    }
                });
            }
        });
        // Verificar tracks
        const senders = pc.getSenders();
        const receivers = pc.getReceivers();
    }
    
    // 3. Estado del localStream
    if (localStream) {
        localStream.getTracks().forEach(t => {
        });
    } else {
    }
    
    // 4. Estado del WebSocket
    if (ws) {
        const states = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
    } else {
    }
    return 'Diagnóstico completado. Revisa la consola para más detalles.';
}

// Hacer la función accesible globalmente
window.diagnosticarConexion = diagnosticarConexion;
// ==================================================================

// ============= SISTEMA DE AUDIO ROBUSTO =============
// Manejar la política de autoplay del navegador
let audioUnlocked = false;

function unlockAudio() {
    if (audioUnlocked) return;
    
    // Crear un contexto de audio temporal para desbloquear
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    
    // Crear un buffer vacío
    const buffer = audioContext.createBuffer(1, 1, 22050);
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start(0);
    
    audioContext.resume().then(() => {
        audioUnlocked = true;
        if (DEBUG_MODE) console.log('[🔊] Audio desbloqueado correctamente');
        
        // Intentar reproducir todos los videos que estén pausados
        document.querySelectorAll('video').forEach(video => {
            if (video.paused && video.srcObject) {
                video.play().catch(e => {
                    if (DEBUG_MODE) console.log('Video aún no puede reproducirse:', e);
                });
            }
        });
    });
}

// Desbloquear audio en el primer clic/touch del usuario
document.addEventListener('click', unlockAudio, { once: true });
document.addEventListener('touchstart', unlockAudio, { once: true });
document.addEventListener('keydown', unlockAudio, { once: true });

// Función para asegurar que un video reproduce audio
async function ensureVideoPlaying(videoElement, userId) {
    if (!videoElement || !videoElement.srcObject) return;
    
    videoElement.muted = false;
    videoElement.volume = 1.0;
    
    try {
        await videoElement.play();
        if (DEBUG_MODE) console.log(`[🔊] Video de ${userId} reproduciendo correctamente`);
    } catch (e) {
        if (DEBUG_MODE) console.warn(`[⚠️] Autoplay bloqueado para ${userId}, intentando con muted primero...`);
        
        // Estrategia: reproducir muted, luego unmute después de interacción
        videoElement.muted = true;
        try {
            await videoElement.play();
            if (DEBUG_MODE) console.log(`[🔊] Video de ${userId} reproduciendo (muted temporalmente)`);
            
            // Intentar unmute después de un breve delay
            setTimeout(async () => {
                try {
                    videoElement.muted = false;
                    if (DEBUG_MODE) console.log(`[🔊] Audio de ${userId} activado`);
                } catch (e2) {
                    if (DEBUG_MODE) console.warn(`[⚠️] No se pudo activar audio de ${userId}`);
                }
            }, 100);
        } catch (e2) {
        }
    }
}
// =====================================================

async function forceSpeakerOutput(mediaEl) {
    if (typeof mediaEl.setSinkId !== 'function') return;

    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
        const speaker = audioOutputs.find(d => /speaker/i.test(d.label)) || audioOutputs[0];

        if (speaker) {
            await mediaEl.setSinkId(speaker.deviceId);
            if (DEBUG_MODE) console.log('[🔊] Audio forzado al altavoz:', speaker.label);
        }
    } catch (err) {
        if (DEBUG_MODE) console.warn('[⚠️] No se pudo forzar el altavoz:', err);
    }
}


function debugLog(...messages) {
    if (DEBUG_MODE) {
    }
}

function showError(message, duration = 5000) {
    const errorPanel = document.getElementById('errorPanel');
    if (!errorPanel) {
        return;
    }
    errorPanel.textContent = message;
    errorPanel.style.display = 'block';
    errorPanel.style.cursor = 'default';
    errorPanel.onclick = null;
    debugLog('ERROR UI:', message);

    if (duration > 0) {
        setTimeout(() => {
            errorPanel.style.display = 'none';
        }, duration);
    }
}

// ✅ Función especial para notificaciones de chat (clickeables para abrir chat)
function showChatNotification(author, messagePreview, duration = 4000) {
    const errorPanel = document.getElementById('errorPanel');
    if (!errorPanel) return;
    
    const message = `💬 ${author}: ${messagePreview}`;
    errorPanel.textContent = message;
    errorPanel.style.display = 'block';
    errorPanel.style.cursor = 'pointer';
    
    // Al hacer click, abrir el chat
    errorPanel.onclick = function() {
        errorPanel.style.display = 'none';
        openChatPanel();
    };
    
    if (duration > 0) {
        setTimeout(() => {
            errorPanel.style.display = 'none';
            errorPanel.onclick = null;
            errorPanel.style.cursor = 'default';
        }, duration);
    }
}

// ✅ Función para abrir el panel de chat
function openChatPanel() {
    const sidebar = document.getElementById('sidebar');
    const chatTab = document.querySelector('.sidebar-tab[data-tab="chat"]');
    const chatToggleBtn = document.getElementById('chatToggle');
    const participantsToggleBtn = document.getElementById('participantsToggle');
    
    if (sidebar && chatTab) {
        // Abrir sidebar
        sidebar.classList.remove('sidebar-collapsed');
        
        // Activar tab de chat
        document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.sidebar-content').forEach(c => c.classList.remove('active'));
        
        chatTab.classList.add('active');
        const chatContent = document.getElementById('chatContent');
        if (chatContent) chatContent.classList.add('active');
        
        if (chatToggleBtn) {
            chatToggleBtn.classList.add('active');
            chatToggleBtn.classList.remove('has-notification');
        }
        if (participantsToggleBtn) participantsToggleBtn.classList.remove('active');
        
        // Remover badge
        const chatBadge = document.getElementById('sidebarChatBadge');
        if (chatBadge) {
            chatBadge.style.display = 'none';
            chatBadge.textContent = '0';
        }
        
        // Scroll al final del chat al abrir
        const chatMessages = document.getElementById('chatMessages');
        if (chatMessages) {
            requestAnimationFrame(() => {
                chatMessages.scrollTop = chatMessages.scrollHeight;
            });
        }
        
        // Enfocar el input del chat después de abrir
        setTimeout(() => {
            const chatInput = document.getElementById('chatInput');
            if (chatInput) chatInput.focus();
        }, 100);
    }
}

function updateConnectionStatus(status) {
    const statusEl = document.getElementById('connectionStatus');
    if (!statusEl) {
        debugLog('Advertencia: #connectionStatus no encontrado en el DOM.');
        return;
    }
    const indicator = statusEl.querySelector('.status-indicator');
    const text = statusEl.querySelector('span');

    if (indicator) {
        indicator.className = 'status-indicator';
        indicator.classList.add(status);
    }
    if (text) {
        if (status === 'connecting') text.textContent = 'Conectando...';
        else if (status === 'connected') text.textContent = 'Conectado';
        else if (status === 'disconnected') text.textContent = 'Desconectado';
        else text.textContent = `Estado: ${status}`;
    }
    debugLog('Estado de conexión:', status);
}

const urlParams = new URLSearchParams(window.location.search);
const roomCode = urlParams.get('room');
let userName = urlParams.get('name') || 'Invitado';
// ✅ ASEGURAR que userName nunca esté vacío
if (!userName || userName.trim() === '') {
    userName = 'Usuario-' + Math.random().toString(36).substr(2, 6);
}
let isModerator = urlParams.has('moderator');
let isRoomAdmin = false; // ✅ Flag para identificar al admin de la sala

if (DEBUG_MODE) {
}

let isMicActive = true;
let isCamActive = true;
let localStream = null;
let peerConnections = {};
// ============ SISTEMA DE COMPARTIR PANTALLA ============
let isScreenSharing = false;
let localScreenStream = null;
let remoteScreenStreams = {}; // Map<userId, streamId>
let pendingStreams = {}; // Map<streamId, {userId, stream}>
// =======================================================

const raisedHands = new Set();
const userRoles = {
    [userName]: isModerator ? 'Organizador de la Reunión' : 'Participante',
};

// Objeto para rastrear los estados de micrófono y cámara de los participantes
const participantStates = {
    [userName]: { micActive: true, camActive: true }
};

let currentPoll = null;
let hasVoted = false;
let pollChart = null;

// ======================= FUNCIÓN CENTRALIZADA PARA LIMPIAR TIMERS DE ENCUESTAS =======================
/**
 * Limpia TODOS los temporizadores de encuestas para evitar que sigan corriendo
 * @param {boolean} markAsEnded - Si true, marca currentPoll.ended = true (default: true)
 * Debe llamarse en: end-poll, poll-ended (WS), hidePollForParticipant, closePollResultsPanel
 */
function stopAllPollTimers(markAsEnded = true) {
    if (DEBUG_MODE) console.log('[POLL-TIMER] 🛑 Limpiando TODOS los temporizadores de encuesta...');
    
    if (currentPoll) {
        // Limpiar timer principal
        if (currentPoll.timerInterval) {
            clearInterval(currentPoll.timerInterval);
            currentPoll.timerInterval = null;
            if (DEBUG_MODE) console.log('[POLL-TIMER] ✅ Timer principal limpiado');
        }
        
        // Limpiar timer de resultados
        if (currentPoll.resultsTimerInterval) {
            clearInterval(currentPoll.resultsTimerInterval);
            currentPoll.resultsTimerInterval = null;
            if (DEBUG_MODE) console.log('[POLL-TIMER] ✅ Timer de resultados limpiado');
        }
        
        // Marcar como finalizada solo si se solicita
        if (markAsEnded) {
            currentPoll.ended = true;
            if (DEBUG_MODE) console.log('[POLL-TIMER] 📌 Encuesta marcada como terminada');
        }
    }
    
    // Limpiar cualquier referencia huérfana de interval
    // Actualizar UI
    const pollTimerDisplay = document.getElementById('pollTimerDisplay');
    if (pollTimerDisplay) {
        pollTimerDisplay.textContent = '¡Votación terminada!';
    }
    
    const pollResultsTimer = document.getElementById('pollResultsTimer');
    if (pollResultsTimer) {
        pollResultsTimer.textContent = '¡Votación terminada!';
    }
    
    if (DEBUG_MODE) console.log('[POLL-TIMER] ✅ Todos los temporizadores limpiados');
}

// ======================= SISTEMA DE SALA DE ESPERA =======================
/**
 * Muestra la sala de espera visual mientras se espera aprobación del moderador
 */
function showWaitingRoom() {
    const waitingRoomScreen = document.getElementById('waitingRoomScreen');
    const lobbyScreen = document.getElementById('lobbyScreen');
    
    if (waitingRoomScreen) {
        // Ocultar lobby
        if (lobbyScreen) {
            lobbyScreen.style.display = 'none';
        }
        
        // Mostrar sala de espera
        waitingRoomScreen.style.display = 'flex';
        
        // Actualizar información
        const waitingRoomCode = document.getElementById('waitingRoomCode');
        const waitingUserName = document.getElementById('waitingUserName');
        
        if (waitingRoomCode) waitingRoomCode.textContent = roomCode || '---';
        if (waitingUserName) waitingUserName.textContent = userName || '---';
        
        if (DEBUG_MODE) console.log('[WAITING-ROOM] 🚪 Sala de espera mostrada');
    }
}

/**
 * Oculta la sala de espera
 */
function hideWaitingRoom() {
    const waitingRoomScreen = document.getElementById('waitingRoomScreen');
    if (waitingRoomScreen) {
        waitingRoomScreen.style.display = 'none';
        if (DEBUG_MODE) console.log('[WAITING-ROOM] ✅ Sala de espera ocultada');
    }
}

// ======================= SISTEMA DE "DAR LA PALABRA" =======================
let currentSpeaker = null; // { name: string, timeLeft: number (segundos), totalTime: number }
let speakingTimerInterval = null;

// ======================= SISTEMA DE DETECCIÓN DE HABLANTE ACTIVO =======================
let audioContext = null;
let audioAnalysers = {}; // Map<peerId, {analyser, source, stream}>
let activeSpeakerInterval = null;
const AUDIO_LEVEL_THRESHOLD = 15; // Umbral mínimo para considerar "hablando"
// ✅ OPTIMIZACIÓN: Intervalo más largo en móviles para ahorrar batería
const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth <= 900;
const ACTIVE_SPEAKER_CHECK_INTERVAL = isMobileDevice ? 2000 : 1000; // 2s en móvil, 1s en desktop
let lastActiveSpeaker = null; // Cache para evitar notificaciones repetidas
let audioDataBuffer = null; // ✅ Buffer reutilizable para análisis de audio

/**
 * Inicializa el AudioContext para análisis de audio
 */
function initAudioContext() {
    if (audioContext) return;
    
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        if (DEBUG_MODE) console.log('[AUDIO-DETECT] 🎤 AudioContext inicializado');
    } catch (err) {
    }
}

/**
 * Agrega un stream de audio para análisis de actividad
 * @param {string} peerId - ID del peer (o 'local' para el usuario local)
 * @param {MediaStream} stream - Stream de audio a analizar
 */
function addAudioStreamForAnalysis(peerId, stream) {
    if (!audioContext) {
        initAudioContext();
    }
    
    // Verificar que el contexto esté activo
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
        if (DEBUG_MODE) console.log(`[AUDIO-DETECT] ⚠️ ${peerId} no tiene tracks de audio`);
        return;
    }
    
    // Limpiar analyser anterior si existe
    if (audioAnalysers[peerId]) {
        removeAudioStreamFromAnalysis(peerId);
    }
    
    try {
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.5;
        
        source.connect(analyser);
        // NO conectar al destino (no queremos reproducir el audio aquí, solo analizar)
        
        audioAnalysers[peerId] = { analyser, source, stream };
        if (DEBUG_MODE) console.log(`[AUDIO-DETECT] ✅ Analyser agregado para ${peerId}`);
        
        // Iniciar el intervalo de detección si no está corriendo
        startActiveSpeakerDetection();
    } catch (err) {
    }
}

/**
 * Remueve un stream de audio del análisis
 * @param {string} peerId - ID del peer a remover
 */
function removeAudioStreamFromAnalysis(peerId) {
    const analyserData = audioAnalysers[peerId];
    if (analyserData) {
        try {
            analyserData.source.disconnect();
        } catch (e) {}
        delete audioAnalysers[peerId];
        if (DEBUG_MODE) console.log(`[AUDIO-DETECT] 🗑️ Analyser removido para ${peerId}`);
    }
}

/**
 * Inicia la detección periódica de hablante activo
 */
function startActiveSpeakerDetection() {
    if (activeSpeakerInterval) return; // Ya está corriendo
    
    if (DEBUG_MODE) console.log('[AUDIO-DETECT] 🎯 Iniciando detección de hablante activo');
    
    activeSpeakerInterval = setInterval(() => {
        // ✅ OPTIMIZACIÓN: No ejecutar si la pestaña está oculta
        if (document.hidden) return;
        detectActiveSpeaker();
    }, ACTIVE_SPEAKER_CHECK_INTERVAL);
}

/**
 * Detiene la detección de hablante activo
 */
function stopActiveSpeakerDetection() {
    if (activeSpeakerInterval) {
        clearInterval(activeSpeakerInterval);
        activeSpeakerInterval = null;
        if (DEBUG_MODE) console.log('[AUDIO-DETECT] ⏹️ Detección de hablante activo detenida');
    }
}

/**
 * Detecta quién está hablando basándose en niveles de audio
 * ✅ OPTIMIZADO: Cache de speaker, salida temprana, buffer reutilizable
 */
function detectActiveSpeaker() {
    const analysersEntries = Object.entries(audioAnalysers);
    
    // ✅ Salida temprana si no hay analysers
    if (analysersEntries.length === 0) return;
    
    let maxLevel = 0;
    let activePeerId = null;
    
    for (const [peerId, data] of analysersEntries) {
        const level = getAudioLevel(data.analyser);
        
        if (level > AUDIO_LEVEL_THRESHOLD && level > maxLevel) {
            maxLevel = level;
            activePeerId = peerId;
        }
    }
    
    // ✅ OPTIMIZACIÓN: Solo notificar si cambió el speaker activo
    if (activePeerId !== lastActiveSpeaker) {
        lastActiveSpeaker = activePeerId;
        if (activePeerId && window.ViewControl && typeof window.ViewControl.markActiveSpeaker === 'function') {
            window.ViewControl.markActiveSpeaker(activePeerId);
        }
    }
}

/**
 * Obtiene el nivel de audio actual de un analyser
 * @param {AnalyserNode} analyser - El nodo analyser
 * @returns {number} - Nivel de audio (0-255)
 * ✅ OPTIMIZADO: Reutiliza buffer, solo analiza frecuencias de voz (85-255 = 300Hz-3400Hz aprox)
 */
function getAudioLevel(analyser) {
    // ✅ Reutilizar buffer si ya existe y es del tamaño correcto
    if (!audioDataBuffer || audioDataBuffer.length !== analyser.frequencyBinCount) {
        audioDataBuffer = new Uint8Array(analyser.frequencyBinCount);
    }
    analyser.getByteFrequencyData(audioDataBuffer);
    
    // ✅ OPTIMIZACIÓN: Solo analizar rango de voz humana (bins 10-100 aprox = 300Hz-3400Hz)
    // Esto reduce significativamente el procesamiento
    const startBin = Math.floor(analyser.frequencyBinCount * 0.02); // ~300Hz
    const endBin = Math.floor(analyser.frequencyBinCount * 0.25);   // ~3400Hz
    
    let sum = 0;
    const binCount = endBin - startBin;
    for (let i = startBin; i < endBin; i++) {
        sum += audioDataBuffer[i];
    }
    return binCount > 0 ? sum / binCount : 0;
}
// ===========================================================================

// Variables para hacer el panel arrastrable
let isDragging = false;
let currentX;
let currentY;
let initialX;
let initialY;
let xOffset = 0;
let yOffset = 0;

// Función para inicializar el panel como arrastrable
function initDraggableSpeakingPanel() {
    const speakingPanel = document.getElementById('speakingPanel');
    if (!speakingPanel) return;

    const header = speakingPanel.querySelector('.speaking-header');
    if (!header) return;

    // Hacer que el cursor indique que se puede arrastrar
    header.style.cursor = 'move';

    header.addEventListener('mousedown', dragStart);
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', dragEnd);

    // Soporte táctil para móviles
    header.addEventListener('touchstart', dragStart);
    document.addEventListener('touchmove', drag);
    document.addEventListener('touchend', dragEnd);
}

function dragStart(e) {
    const speakingPanel = document.getElementById('speakingPanel');
    if (!speakingPanel || !speakingPanel.classList.contains('visible')) return;

    if (e.type === 'touchstart') {
        initialX = e.touches[0].clientX - xOffset;
        initialY = e.touches[0].clientY - yOffset;
    } else {
        initialX = e.clientX - xOffset;
        initialY = e.clientY - yOffset;
    }

    if (e.target.closest('.speaking-header')) {
        isDragging = true;
    }
}

function drag(e) {
    if (!isDragging) return;

    e.preventDefault();

    if (e.type === 'touchmove') {
        currentX = e.touches[0].clientX - initialX;
        currentY = e.touches[0].clientY - initialY;
    } else {
        currentX = e.clientX - initialX;
        currentY = e.clientY - initialY;
    }

    xOffset = currentX;
    yOffset = currentY;

    const speakingPanel = document.getElementById('speakingPanel');
    if (speakingPanel) {
        setTranslate(currentX, currentY, speakingPanel);
    }
}

function dragEnd(e) {
    initialX = currentX;
    initialY = currentY;
    isDragging = false;
}

function setTranslate(xPos, yPos, el) {
    el.style.transform = `translate(${xPos}px, ${yPos}px)`;
}

function giveWordToParticipant(participantName, duration = 60) {
    if (DEBUG_MODE) {
    }

    // Si ya hay alguien con la palabra, quitársela primero
    if (currentSpeaker) {
        if (DEBUG_MODE) {
        }
        takeWordFromParticipant();
    }

    currentSpeaker = {
        name: participantName,
        timeLeft: duration,
        totalTime: duration
    };
    if (DEBUG_MODE) console.log('[GIVE-WORD-FUNC] ✅ currentSpeaker actualizado:', currentSpeaker);

    // Mostrar panel
    const speakingPanel = document.getElementById('speakingPanel');
    const speakingPersonName = document.getElementById('speakingPersonName');
    const timerDisplay = document.getElementById('timerDisplay');
    const timerProgressBar = document.getElementById('timerProgressBar');
    const speakingActions = document.getElementById('speakingActions');

    if (DEBUG_MODE) {
    }

    if (speakingPanel && speakingPersonName && timerDisplay) {
        // ✅ ASEGURAR que el panel esté en el body
        if (speakingPanel.parentNode !== document.body) {
            document.body.appendChild(speakingPanel);
            if (DEBUG_MODE) console.log('[GIVE-WORD-FUNC] Panel movido al body');
        }

        speakingPersonName.textContent = participantName;
        updateTimerDisplay();
        speakingPanel.classList.remove('closing');
        speakingPanel.classList.add('visible');

        // ✅ FORZAR VISIBILIDAD TOTAL con estilos inline importantes
        speakingPanel.style.cssText = 'display: block !important; opacity: 1 !important; visibility: visible !important; z-index: 10000 !important;';
        if (DEBUG_MODE) console.log('[GIVE-WORD-FUNC] ✅ Panel mostrado localmente');

        // Mostrar botón de quitar palabra solo si eres moderador
        if (speakingActions) {
            speakingActions.style.display = isModerator ? 'flex' : 'none';
            if (DEBUG_MODE) console.log('[GIVE-WORD-FUNC] Botones de acción:', isModerator ? 'VISIBLES' : 'OCULTOS');
        }
    }

    // ❌ NO iniciar temporizador LOCAL aquí para evitar duplicados
    // El temporizador se iniciará cuando llegue el mensaje 'give-word' del servidor
    // Así todos los clientes están sincronizados
    if (DEBUG_MODE) console.log('[GIVE-WORD-FUNC] ⏰ Temporizador se iniciará al recibir confirmación del servidor');

    // Notificar al servidor que se dio la palabra
    if (ws && ws.readyState === WebSocket.OPEN) {
        const message = {
            type: 'give-word',
            room: roomCode,
            target: participantName,
            duration: duration
        };
        if (DEBUG_MODE) {
        }
        ws.send(JSON.stringify(message));
        if (DEBUG_MODE) console.log('[GIVE-WORD-FUNC] ✅ Mensaje enviado al servidor');

        // También activar el micrófono del participante
        ws.send(JSON.stringify({
            type: 'mute-participant',
            room: roomCode,
            target: participantName,
            micActive: true
        }));
        if (DEBUG_MODE) console.log('[GIVE-WORD-FUNC] ✅ Solicitud de activación de micrófono enviada');
    } else {
        if (DEBUG_MODE) {
        }
    }

    showError(`${participantName} tiene la palabra (${duration}s)`, 3000);
    if (DEBUG_MODE) console.log(`[GIVE-WORD-FUNC] ✅ Función completada. ${participantName} tiene la palabra por ${duration} segundos`);
}

function handleTimeExpired(participantName) {
    if (DEBUG_MODE) console.log('[TIME-EXPIRED] ⏰ Tiempo expirado para:', participantName);

    // 🔇 PASO 1: Silenciar inmediatamente al participante
    if (ws && ws.readyState === WebSocket.OPEN) {
        if (DEBUG_MODE) console.log('[TIME-EXPIRED] 📤 Enviando mute-participant (micActive: false)');
        ws.send(JSON.stringify({
            type: 'mute-participant',
            room: roomCode,
            target: participantName,
            micActive: false
        }));
    }

    // 📢 PASO 2: Quitar la palabra
    if (ws && ws.readyState === WebSocket.OPEN) {
        if (DEBUG_MODE) console.log('[TIME-EXPIRED] 📤 Enviando take-word');
        ws.send(JSON.stringify({
            type: 'take-word',
            room: roomCode,
            target: participantName
        }));
    }

    // PASO 3: Limpiar estado local
    if (speakingTimerInterval) {
        clearInterval(speakingTimerInterval);
        speakingTimerInterval = null;
    }

    currentSpeaker = null;

    // PASO 4: Ocultar panel
    const speakingPanel = document.getElementById('speakingPanel');
    if (speakingPanel) {
        speakingPanel.classList.add('closing');
        setTimeout(() => {
            speakingPanel.classList.remove('visible', 'closing');
            speakingPanel.style.cssText = 'display: none !important; opacity: 0 !important; visibility: hidden !important;';
            speakingPanel.style.transform = 'translate(0px, 0px)';
            xOffset = 0;
            yOffset = 0;
        }, 400);
    }

    showError(`⏰ Tiempo agotado: ${participantName} fue silenciado`, 3000);
    if (DEBUG_MODE) console.log('[TIME-EXPIRED] ✅ Proceso completado');
}

function takeWordFromParticipant() {
    if (DEBUG_MODE) {
    }

    if (!currentSpeaker) {
        if (DEBUG_MODE) console.log('[TAKE-WORD-FUNC] ❌ No hay nadie con la palabra, abortando');
        return;
    }

    const participantName = currentSpeaker.name;
    if (DEBUG_MODE) console.log('[TAKE-WORD-FUNC] 🎯 Quitando palabra a:', participantName);

    // Detener temporizador
    if (speakingTimerInterval) {
        clearInterval(speakingTimerInterval);
        speakingTimerInterval = null;
        if (DEBUG_MODE) console.log('[TAKE-WORD-FUNC] ⏰ Temporizador detenido');
    }

    // ✅ Ocultar panel con animación para TODOS
    const speakingPanel = document.getElementById('speakingPanel');
    if (speakingPanel) {
        speakingPanel.classList.add('closing');
        setTimeout(() => {
            speakingPanel.classList.remove('visible', 'closing');
            speakingPanel.style.cssText = 'display: none !important; opacity: 0 !important; visibility: hidden !important;';
            // Resetear posición del panel
            speakingPanel.style.transform = 'translate(0px, 0px)';
            xOffset = 0;
            yOffset = 0;
        }, 400);
        if (DEBUG_MODE) console.log('[TAKE-WORD-FUNC] ✅ Panel ocultado localmente');
    }

    // 📢 Notificar al servidor que se quitó la palabra
    // El servidor se encargará de silenciar al participante automáticamente
    if (ws && ws.readyState === WebSocket.OPEN) {
        const message = {
            type: 'take-word',
            room: roomCode,
            target: participantName
        };
        if (DEBUG_MODE) console.log('[TAKE-WORD-FUNC] 📤 Enviando mensaje al servidor:', message);
        ws.send(JSON.stringify(message));
        if (DEBUG_MODE) console.log('[TAKE-WORD-FUNC] ✅ Mensaje enviado al servidor');
    } else {
        if (DEBUG_MODE) {
        }
    }

    currentSpeaker = null;
    showError(`Se quitó la palabra a ${participantName}`, 2000);
    if (DEBUG_MODE) console.log(`[TAKE-WORD-FUNC] ✅ Función completada. Palabra quitada a ${participantName}`);
}

function updateTimerDisplay() {
    if (!currentSpeaker) return;

    const timerDisplay = document.getElementById('timerDisplay');
    const timerProgressBar = document.getElementById('timerProgressBar');

    if (timerDisplay) {
        const minutes = Math.floor(currentSpeaker.timeLeft / 60);
        const seconds = currentSpeaker.timeLeft % 60;
        timerDisplay.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    if (timerProgressBar) {
        const percentage = (currentSpeaker.timeLeft / currentSpeaker.totalTime) * 100;
        timerProgressBar.style.width = percentage + '%';

        // Cambiar color según el tiempo restante
        timerProgressBar.classList.remove('warning', 'danger');
        if (percentage <= 20) {
            timerProgressBar.classList.add('danger');
        } else if (percentage <= 50) {
            timerProgressBar.classList.add('warning');
        }
    }
}

// ======================= WORD CHANGE CONFIRMATION =======================
let pendingWordChange = null; // { fromName: string, toName: string }

function showWordChangeConfirmation(currentSpeakerName, newSpeakerName) {
    console.log('[CONFIRM-WORD] 🔄 Iniciando modal de confirmación:', { from: currentSpeakerName, to: newSpeakerName });
    
    const modal = document.getElementById('confirmWordChangeModal');
    const message = document.getElementById('confirmWordMessage');
    const yesBtn = document.getElementById('confirmWordYes');
    const noBtn = document.getElementById('confirmWordNo');
    const closeBtn = document.getElementById('closeConfirmWordModal');
    
    console.log('[CONFIRM-WORD] Elementos encontrados:', { modal: !!modal, message: !!message, yesBtn: !!yesBtn, noBtn: !!noBtn });
    
    if (!modal || !message) {
        console.error('[CONFIRM-WORD] ❌ Modal o mensaje no encontrado!');
        // Fallback: Si no hay modal, dar la palabra directamente
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'give-word', room: roomCode, target: newSpeakerName, duration: 60 }));
        }
        return;
    }
    
    // Guardar datos pendientes
    pendingWordChange = {
        fromName: currentSpeakerName,
        toName: newSpeakerName
    };
    
    // Configurar mensaje
    message.innerHTML = `¿Estás seguro de que quieres <strong>quitarle la palabra</strong> a <strong style="color: #ef4444;">${currentSpeakerName}</strong> para dársela a <strong style="color: #10b981;">${newSpeakerName}</strong>?`;
    
    // Mostrar modal con display flex
    modal.style.display = 'flex';
    console.log('[CONFIRM-WORD] ✅ Modal mostrado');
    
    // Handlers para los botones
    const handleYes = () => {
        console.log('[CONFIRM-WORD] ✅ Usuario confirmó el cambio');
        if (pendingWordChange && ws && ws.readyState === WebSocket.OPEN) {
            const fromName = pendingWordChange.fromName;
            const toName = pendingWordChange.toName;
            
            // 1. PRIMERO: Enviar take-word al anterior (esto silencia automáticamente en el servidor)
            console.log('[CONFIRM-WORD] 🔇 Enviando take-word para quitar palabra a:', fromName);
            ws.send(JSON.stringify({
                type: 'take-word',
                room: roomCode,
                target: fromName
            }));
            
            // 2. SEGUNDO: Esperar a que el panel se oculte (animación de 400ms) y luego dar la palabra al nuevo
            setTimeout(() => {
                console.log('[CONFIRM-WORD] 🎤 Dando palabra a:', toName);
                ws.send(JSON.stringify({ 
                    type: 'give-word', 
                    room: roomCode, 
                    target: toName, 
                    duration: 60 
                }));
                showError(`Palabra transferida de ${fromName} a ${toName}`, 3000);
            }, 500); // Esperar más que la animación de cierre (400ms)
        }
        closeWordChangeModal();
    };
    
    const handleNo = () => {
        console.log('[CONFIRM-WORD] ❌ Usuario canceló el cambio');
        closeWordChangeModal();
    };
    
    // Limpiar y agregar event listeners
    yesBtn.onclick = handleYes;
    noBtn.onclick = handleNo;
    if (closeBtn) closeBtn.onclick = handleNo;
    
    // Cerrar al hacer clic fuera del modal
    modal.onclick = (e) => {
        if (e.target === modal) {
            closeWordChangeModal();
        }
    };
}

function closeWordChangeModal() {
    const modal = document.getElementById('confirmWordChangeModal');
    if (modal) {
        modal.style.display = 'none';
    }
    pendingWordChange = null;
}

// ======================= CHAT FUNCTIONS =======================
const MAX_CHAT_MESSAGES = 100; // Límite de mensajes para evitar memory leaks

function addChatMessage(authorName, message, timestamp, isOwn = false) {
    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message' + (isOwn ? ' own' : '');

    const time = new Date(timestamp);
    const timeString = time.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

    messageDiv.innerHTML = `
        <div class="chat-message-header">
            <span class="chat-message-author">${authorName}</span>
            <span class="chat-message-time">${timeString}</span>
        </div>
        <div class="chat-message-text">${escapeHtml(message)}</div>
    `;

    chatMessages.appendChild(messageDiv);
    
    // Limitar número de mensajes para evitar memory leaks y congelamiento
    while (chatMessages.children.length > MAX_CHAT_MESSAGES) {
        chatMessages.removeChild(chatMessages.firstChild);
    }
    
    // Usar requestAnimationFrame para scroll suave sin bloquear el render
    requestAnimationFrame(() => {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function sendChatMessage() {
    const chatInput = document.getElementById('chatInput');
    if (!chatInput) return;

    const message = chatInput.value.trim();
    if (message && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'chat',
            room: roomCode,
            message: message,
            timestamp: new Date().toISOString()
        }));
        chatInput.value = '';
        chatInput.style.height = 'auto';
        
        // ✅ FIX MOBILE: Mantener focus y prevenir freeze
        // Usar requestAnimationFrame para evitar bloqueos de render
        requestAnimationFrame(() => {
            // En móvil, no hacer blur para evitar el cierre/apertura del teclado
            if (window.innerWidth > 768) {
                chatInput.blur();
            }
        });
    }
}
// ======================= END CHAT FUNCTIONS =======================

function updateModeratorUI() {
    const createPollBtn = document.getElementById('createPollBtn');
    const mobileCreatePollBtn = document.getElementById('mobileCreatePollBtn');
    const handPanel = document.getElementById('handPanel');
    const joinRequestsPanel = document.getElementById('joinRequestsPanel');

    if (createPollBtn) {
        createPollBtn.style.display = isModerator ? 'flex' : 'none';
        // Agregar clase para que se muestre en móvil si es moderador
        if (isModerator) {
            createPollBtn.classList.add('moderator-visible');
        } else {
            createPollBtn.classList.remove('moderator-visible');
        }
    }
    if (mobileCreatePollBtn) {
        mobileCreatePollBtn.style.display = isModerator ? 'flex' : 'none';
    }
    if (handPanel) {
        handPanel.style.display = isModerator ? 'block' : 'none';
    }
    if (joinRequestsPanel) {
        joinRequestsPanel.style.display = isModerator ? 'block' : 'none';
    }
    updateParticipantList();
}

function toggleHandPanel() {
    const handPanel = document.getElementById('handPanel');
    if (handPanel && isModerator) {
        handPanel.classList.toggle('visible');
    }
}

function updateHandList() {
    const handList = document.getElementById('handList');
    if (!handList) return;
    handList.innerHTML = '';

    const arr = Array.from(raisedHands);
    if (arr.length === 0) {
        const emptyState = document.createElement('li');
        emptyState.className = 'empty-state';
        emptyState.innerHTML = `
            <div class="empty-icon">✋</div>
            <div class="empty-message">No hay manos levantadas</div>
        `;
        handList.appendChild(emptyState);
        updateHandNotification();
        return;
    }

    arr.forEach(name => {
        const li = document.createElement('li');
        li.className = 'hand-item';
        // Guardar el nombre en dataset para handlers posteriores
        li.dataset.name = name;

        // Avatar con inicial
        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        avatar.textContent = name.charAt(0).toUpperCase();

        // Info del usuario
        const userInfo = document.createElement('div');
        userInfo.className = 'user-info';

        const userName = document.createElement('div');
        userName.className = 'user-name';
        userName.textContent = name;

        const handTime = document.createElement('div');
        handTime.className = 'hand-time';
        handTime.textContent = 'Hace un momento';

        userInfo.appendChild(userName);
        userInfo.appendChild(handTime);

        // Icono de mano
        const handIcon = document.createElement('div');
        handIcon.className = 'hand-icon';
        handIcon.textContent = '✋';

        li.appendChild(avatar);
        li.appendChild(userInfo);
        li.appendChild(handIcon);

        if (isModerator) {
            const personActions = document.createElement('div');
            personActions.className = 'person-actions';

            const grantBtn = document.createElement('button');
            grantBtn.className = 'grant-btn';
            grantBtn.textContent = 'Dar palabra';
            grantBtn.addEventListener('click', () => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    // Verificar si ya hay alguien con la palabra (panel visible o currentSpeaker activo)
                    const speakingPanel = document.getElementById('speakingPanel');
                    const panelVisible = speakingPanel && (speakingPanel.classList.contains('visible') || speakingPanel.style.display === 'block');
                    const hasActiveSpeaker = currentSpeaker && currentSpeaker.name;
                    
                    console.log('[DAR-PALABRA] Verificando:', { currentSpeaker, panelVisible, hasActiveSpeaker, targetName: name });
                    
                    if (hasActiveSpeaker && (panelVisible || currentSpeaker.timeLeft > 0)) {
                        // Ya hay alguien con la palabra - mostrar modal de confirmación
                        console.log('[DAR-PALABRA] ⚠️ Ya hay speaker activo, mostrando confirmación');
                        showWordChangeConfirmation(currentSpeaker.name, name);
                    } else {
                        // No hay nadie con la palabra, dar directamente
                        console.log('[DAR-PALABRA] ✅ No hay speaker, dando palabra directamente');
                        ws.send(JSON.stringify({ type: 'give-word', room: roomCode, target: name, duration: 60 }));
                    }
                }
            });

            const lowerBtn = document.createElement('button');
            lowerBtn.className = 'lower-btn';
            lowerBtn.textContent = 'Bajar mano';
            lowerBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const targetName = li.dataset.name || name;
                if (ws && ws.readyState === WebSocket.OPEN && isModerator) {
                    ws.send(JSON.stringify({ type: 'hand-lowered', name: targetName }));
                    // Optimistic UI update for moderator action
                    try {
                        handleHandLowered(targetName);
                    } catch (e) {
                    }
                }
            });

            personActions.appendChild(grantBtn);
            personActions.appendChild(lowerBtn);
            li.appendChild(personActions);
        }

        handList.appendChild(li);
    });

    updateHandNotification();
}

function updateHandNotification() {
    const raiseBtn = document.getElementById('raiseHand');
    const count = raisedHands.size;
    
    if (raiseBtn) {
        // ✅ Solo mostrar notificación al moderador/admin
        if (isModerator) {
            // Usar clase has-hands para mostrar el badge numérico
            raiseBtn.classList.toggle('has-hands', count > 0);
            raiseBtn.classList.remove('has-notification'); // Remover punto rojo
        } else {
            raiseBtn.classList.remove('has-hands');
            raiseBtn.classList.remove('has-notification');
        }
    }
    
    // ✅ Actualizar badge numérico (solo visible para admin)
    const badge = document.getElementById('handCountBadge');
    if (badge) {
        if (isModerator && count > 0) {
            badge.textContent = String(count);
            badge.style.display = 'block';
        } else {
            badge.textContent = '';
            badge.style.display = 'none';
        }
    }
    
    // Actualizar contador en el header del panel de manos
    const handCount = document.getElementById('handCount');
    if (handCount) {
        handCount.textContent = String(count);
    }
    // Habilitar/deshabilitar botón "Bajar Todas"
    const lowerAllBtn = document.getElementById('lowerAllBtn');
    if (lowerAllBtn) {
        lowerAllBtn.disabled = count === 0;
    }
}
document.getElementById('raiseHand')?.addEventListener('click', () => {
    if (isModerator) {
        toggleHandPanel();
    } else {
        const isHandRaised = raisedHands.has(userName);

        if (ws && ws.readyState === WebSocket.OPEN) {
            if (!isHandRaised) {
                // Levantar mano
                ws.send(JSON.stringify({ type: 'raise-hand', name: userName }));
                raisedHands.add(userName);
                updateHandList();
                updateHandNotification();
                showError('Has levantado la mano ✋', 3000);
                debugLog('Levantando mano.');
                document.getElementById('raiseHand')?.classList.add('active');
            } else {
                // Bajar mano (el usuario puede bajar su propia mano)
                ws.send(JSON.stringify({ type: 'hand-lowered', name: userName }));
                // No hacer optimistic update aquí, esperar respuesta del servidor
                debugLog('Solicitando bajar mano.');
            }
        }
    }
});

document.getElementById('closeHandPanel')?.addEventListener('click', () => {
    toggleHandPanel();
});

document.getElementById('lowerAllBtn')?.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN && isModerator) {
        // Bajar todas las manos
        const handsToLower = Array.from(raisedHands);
        handsToLower.forEach(name => {
            ws.send(JSON.stringify({ type: 'hand-lowered', name: name }));
        });
        if (DEBUG_MODE) console.log('[LOWER-ALL] Bajando todas las manos:', handsToLower);
        // Optimistic update: limpiar localmente la lista de manos levantadas
        try {
            raisedHands.clear();
            updateHandList();
            updateHandNotification();
        } catch (e) {
        }
    }
});


function handleHandLowered(name) {
    if (DEBUG_MODE) {
    }

    raisedHands.delete(name);

    if (DEBUG_MODE) console.log(`[HAND-LOWERED] raisedHands después:`, Array.from(raisedHands));

    updateHandList();
    updateHandNotification();

    if (name === userName) {
        showError('Tu mano ha sido bajada.', 3000);
        const raiseHandBtn = document.getElementById('raiseHand');
        if (DEBUG_MODE) {
            if (raiseHandBtn) {
            }
        }
        if (raiseHandBtn) {
            raiseHandBtn.classList.remove('active');
            if (DEBUG_MODE) {
            }
        } else {
        }
    }

    debugLog(`Mano bajada para ${name}.`);
}

function handleFloorGranted(target) {
    if (target !== userName) {
        showError(`${target} ha recibido la palabra.`, 3000);
        return;
    }
    showError('Tienes la palabra por 1 minuto 🔊', 3000);
    debugLog('Palabra concedida a este usuario.');

    isMicActive = true;
    document.getElementById('toggleMic')?.classList.add('active');
    localStream?.getAudioTracks().forEach(t => t.enabled = true);

    const localVideoContainer = document.querySelector('.video-container.local .video-info');
    if (localVideoContainer) {
        let timerSpan = localVideoContainer.querySelector('#floorTimer');
        if (!timerSpan) {
            timerSpan = document.createElement('span');
            timerSpan.id = 'floorTimer';
            timerSpan.style.marginLeft = '8px';
            timerSpan.style.color = 'var(--warning)';
            timerSpan.style.fontWeight = 'bold';
            localVideoContainer.appendChild(timerSpan);
        }

        let seconds = 60;
        timerSpan.textContent = `(1:00)`;
        const interval = setInterval(() => {
            seconds--;
            const m = Math.floor(seconds / 60);
            const s = seconds % 60;
            timerSpan.textContent = `(${m}:${s.toString().padStart(2, '0')})`;
            if (seconds <= 0) {
                clearInterval(interval);
                timerSpan.remove();
                isMicActive = false;
                document.getElementById('toggleMic')?.classList.remove('active');
                localStream?.getAudioTracks().forEach(t => t.enabled = false);
                showError('Tu tiempo ha terminado. Micrófono silenciado.', 3000);
                debugLog('Tiempo de palabra finalizado.');
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'floor-ended', name: userName }));
                }
            }
        }, 1000);
    }

    if (raisedHands.has(userName)) {
        raisedHands.delete(userName);
        updateHandList();
        updateHandNotification();
        showError('Tu mano fue bajada al recibir la palabra.', 3000);
        document.getElementById('raiseHand')?.classList.remove('active');
    }
}

function handleFloorEnded(name) {
    if (name === userName) {
        showError('Tu tiempo de palabra ha terminado. Mano bajada.', 3000);
        isMicActive = false;
        document.getElementById('toggleMic')?.classList.remove('active');
        localStream?.getAudioTracks().forEach(t => t.enabled = false);
        const timerSpan = document.querySelector('#floorTimer');
        if (timerSpan) timerSpan.remove();
        debugLog('Tiempo de palabra finalizado para este usuario.');
        document.getElementById('raiseHand')?.classList.remove('active');
    }
}

// Función para actualizar el contador de participantes
function updateParticipantCount() {
    const count = document.querySelectorAll('.participant-item').length;

    // Actualizar contador en el navbar
    const navbarCount = document.getElementById('participantCount');
    if (navbarCount) {
        navbarCount.textContent = count;
    }

    // Actualizar contador en el sidebar (texto)
    const sidebarCount = document.getElementById('sidebarParticipantCountText');
    if (sidebarCount) {
        sidebarCount.textContent = count;
    }
    
    // Actualizar badge del sidebar
    const sidebarBadge = document.getElementById('sidebarParticipantCount');
    if (sidebarBadge) {
        sidebarBadge.textContent = count;
    }

    debugLog(`📊 Contador actualizado: ${count} participantes`);
}

function addParticipant(name, isLocal) {
    // ✅ Verificación más estricta para evitar duplicados
    const existingParticipant = document.getElementById(`participant-${name}`);
    if (existingParticipant) {
        debugLog(`⚠️ Participante ${name} ya existe, actualizando en lugar de crear nuevo`);
        updateParticipantList(); // Solo actualizar la lista existente
        return;
    }

    const participantItem = document.createElement('li');
    participantItem.className = 'participant-item';
    participantItem.id = `participant-${name}`;

    const avatar = document.createElement('div');
    avatar.className = 'participant-avatar';
    avatar.textContent = name.charAt(0).toUpperCase();

    const participantInfo = document.createElement('div');
    participantInfo.className = 'participant-info';

    const nameElement = document.createElement('div');
    nameElement.className = 'participant-name';
    nameElement.textContent = name + (isLocal ? ' (Tú)' : '');

    const statusElement = document.createElement('div');
    statusElement.className = 'participant-status';
    statusElement.style.display = isModerator && !isLocal ? 'flex' : 'none';
    const micStatus = document.createElement('span');
    micStatus.id = `mic-status-${name}`;
    micStatus.textContent = participantStates[name]?.micActive ? '🎙️' : '🔇';
    const camStatus = document.createElement('span');
    camStatus.id = `cam-status-${name}`;
    camStatus.textContent = participantStates[name]?.camActive ? '📹' : '📴';
    statusElement.appendChild(micStatus);
    statusElement.appendChild(camStatus);

    const roleElement = document.createElement('div');
    roleElement.className = 'participant-role';
    roleElement.textContent = userRoles[name] || 'Participante';

    participantInfo.appendChild(nameElement);
    participantInfo.appendChild(statusElement);
    participantInfo.appendChild(roleElement);

    const controlsContainer = document.createElement('div');
    controlsContainer.className = 'participant-controls';
    controlsContainer.style.display = isModerator && !isLocal ? 'flex' : 'none';

    // Botón de silenciar
    const muteBtn = document.createElement('button');
    muteBtn.className = 'participant-control-btn mute-btn';
    muteBtn.title = participantStates[name]?.micActive ? 'Silenciar' : 'Activar Micrófono';
    muteBtn.setAttribute('data-participant-name', name); // ✅ Guardar referencia al nombre

    muteBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const targetName = muteBtn.getAttribute('data-participant-name');

        if (!isModerator) {
            showError('Solo los moderadores pueden silenciar participantes.', 3000);
            debugLog('Intento de silenciamiento fallido: No es moderador.');
            return;
        }
        if (ws && ws.readyState === WebSocket.OPEN) {
            const newMicState = !participantStates[targetName]?.micActive;
            ws.send(JSON.stringify({ type: 'mute-participant', room: roomCode, target: targetName, micActive: newMicState }));
            debugLog(`Solicitando ${newMicState ? 'activar' : 'silenciar'} micrófono para ${targetName}`);
        } else {
            showError('No se pudo realizar la acción: Conexión con el servidor perdida.', 5000);
            debugLog('Error: WebSocket no está abierto al intentar silenciar.');
        }
    });

    // Botón de expulsión
    const kickBtn = document.createElement('button');
    kickBtn.className = 'participant-control-btn kick-btn';
    kickBtn.title = 'Expulsar';
    kickBtn.setAttribute('data-participant-name', name); // ✅ Guardar referencia al nombre

    kickBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const targetName = kickBtn.getAttribute('data-participant-name');

        if (!isModerator) {
            showError('Solo los moderadores pueden expulsar participantes.', 3000);
            debugLog('Intento de expulsión fallido: No es moderador.');
            return;
        }
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'kick-participant', room: roomCode, target: targetName }));
            debugLog(`Solicitando expulsar a ${targetName}`);
        } else {
            showError('No se pudo realizar la acción: Conexión con el servidor perdida.', 5000);
            debugLog('Error: WebSocket no está abierto al intentar expulsar.');
        }
    });

    const assignModeratorBtn = document.createElement('button');
    assignModeratorBtn.className = 'participant-control-btn promote-btn';
    assignModeratorBtn.title = 'Hacer Moderador';
    assignModeratorBtn.setAttribute('data-participant-name', name); // ✅ Guardar referencia al nombre

    assignModeratorBtn.style.display = isModerator && !isLocal && userRoles[name] !== 'Organizador de la Reunión' ? 'inline' : 'none';

    // ✅ Usar addEventListener en lugar de onclick para mejor control
    assignModeratorBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const targetName = assignModeratorBtn.getAttribute('data-participant-name');

        if (!isModerator) {
            showError('Solo los moderadores pueden asignar roles.', 3000);
            return;
        }

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'assign-moderator', room: roomCode, target: targetName }));
            debugLog(`Solicitando asignar rol de moderador a ${targetName}`);
            showError(`Asignando moderador a ${targetName}...`, 2000);
        } else {
            showError('No se pudo realizar la acción: Conexión con el servidor perdida.', 5000);
            debugLog('Error: WebSocket no está abierto al intentar asignar moderador.');
        }
    }, { once: false }); // ✅ No usar once aquí porque el botón se crea una sola vez

    controlsContainer.appendChild(muteBtn);
    controlsContainer.appendChild(kickBtn);
    controlsContainer.appendChild(assignModeratorBtn);

    const revokeModeratorBtn = document.createElement('button');
    revokeModeratorBtn.className = 'participant-control-btn revoke-btn';
    revokeModeratorBtn.title = '❌ Quitar Moderador';
    revokeModeratorBtn.innerHTML = '❌';
    revokeModeratorBtn.setAttribute('data-participant-name', name); // ✅ Guardar referencia al nombre

    revokeModeratorBtn.style.display = isModerator && !isLocal && userRoles[name] === 'Moderador' ? 'inline' : 'none';

    // ✅ Usar addEventListener en lugar de onclick para mejor control
    revokeModeratorBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const targetName = revokeModeratorBtn.getAttribute('data-participant-name');

        if (!isModerator) {
            showError('Solo los moderadores pueden quitar roles.', 3000);
            return;
        }

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'revoke-moderator', room: roomCode, target: targetName }));
            debugLog(`Solicitando quitar rol de moderador a ${targetName}`);
            showError(`Quitando moderador a ${targetName}...`, 2000);
        } else {
            showError('No se pudo realizar la acción: Conexión con el servidor perdida.', 5000);
            debugLog('Error: WebSocket no está abierto al intentar quitar moderador.');
        }
    }, { once: false }); // ✅ No usar once aquí porque el botón se crea una sola vez

    controlsContainer.appendChild(revokeModeratorBtn);

    participantItem.append(avatar, participantInfo, controlsContainer);
    participantList?.appendChild(participantItem);

    updateParticipantCount();
    debugLog(`Participante añadido: ${name} (local: ${isLocal})`);
}

function updateParticipantList() {
    // Mostrar/ocultar botón de silenciar a todos si ya existe en el HTML
    const muteAllBtn = document.getElementById('muteAllBtn');
    if (muteAllBtn) {
        muteAllBtn.style.display = isModerator ? 'flex' : 'none';

        // Configurar el evento click si no está ya configurado
        if (!muteAllBtn.onclick) {
            muteAllBtn.onclick = () => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'mute-all-participants', room: roomCode }));
                    debugLog('Enviando solicitud para silenciar a todos los participantes.');
                    showError('Silenciando a todos los participantes...', 2000);
                }
            };
        }
    }

    const items = document.querySelectorAll('.participant-item');
    items.forEach(item => {
        const name = item.id.replace('participant-', '');

        // Actualizar rol y corona
        const roleElement = item.querySelector('.participant-role');
        if (roleElement) {
            const role = userRoles[name] || 'Participante';
            const isModeratorOnly = role.toLowerCase().includes('moderador') && role !== 'Organizador de la Reunión';
            roleElement.textContent = (isModeratorOnly ? '👑 ' : '') + role.replace(/^👑\s*/, '');
        }

        // Mostrar u ocultar botón de "Hacer moderador"
        const assignModeratorBtn = item.querySelector('.participant-control-btn.promote-btn');
        if (assignModeratorBtn) {
            assignModeratorBtn.style.display = isModerator && name !== userName && userRoles[name] !== 'Organizador de la Reunión' ? 'inline' : 'none';
        }

        // Mostrar u ocultar botón de "Quitar moderador"
        const revokeModeratorBtn = item.querySelector('.participant-control-btn.revoke-btn');
        if (revokeModeratorBtn) {
            revokeModeratorBtn.style.display = isModerator && name !== userName && userRoles[name] === 'Moderador' ? 'inline' : 'none';
        }

        // Mostrar u ocultar estado mic/cam solo si yo soy moderador
        const statusElement = item.querySelector('.participant-status');

        // ✅ VALIDAR que el nombre no esté vacío antes de usar querySelector
        if (name && name.trim()) {
            const micStatus = item.querySelector(`#mic-status-${name}`);
            const camStatus = item.querySelector(`#cam-status-${name}`);

            if (statusElement) {
                statusElement.style.display = isModerator && name !== userName ? 'flex' : 'none';
            }
            if (micStatus && camStatus) {
                micStatus.textContent = participantStates[name]?.micActive ? '🎙️' : '🔇';
                camStatus.textContent = participantStates[name]?.camActive ? '📹' : '📴';
            }
        } else {
        }

        const muteBtn = item.querySelector('.participant-control-btn.mute');
        if (muteBtn) {
            muteBtn.title = participantStates[name]?.micActive ? 'Silenciar' : 'Activar Micrófono';
        }
    });
}


function removeParticipant(userId) {
    const participantItem = document.getElementById(`participant-${userId}`);
    if (participantItem) {
        participantItem.remove();
        debugLog(`Participante ${userId} eliminado de la lista.`);
    }
    updateParticipantCount();

    const videoContainer = document.getElementById(`video-container-${userId}`);
    if (videoContainer) {
        const videoEl = videoContainer.querySelector('video');
        if (videoEl && videoEl.srcObject) {
            videoEl.srcObject.getTracks().forEach(track => track.stop());
        }
        videoContainer.remove();
        debugLog(`Video de ${userId} eliminado.`);
    }

    const screenVideoContainer = document.getElementById(`video-screen-${userId}`);
    if (screenVideoContainer) {
        const videoEl = screenVideoContainer.querySelector('video');
        if (videoEl && videoEl.srcObject) {
            videoEl.srcObject.getTracks().forEach(track => track.stop());
        }
        screenVideoContainer.remove();
        debugLog(`Video de pantalla compartida de ${userId} eliminado.`);
    }

    delete participantStates[userId];
}

function addVideoElement(userId, stream) {
    debugLog(`📺 addVideoElement llamado para ${userId}`);
    if (DEBUG_MODE) {
    };

    // ✅ SIEMPRE agregar videos a #videoGrid (donde está el sistema de vistas)
    const videoGrid = document.getElementById('videoGrid');
    if (!videoGrid) {
        return;
    }

    if (DEBUG_MODE) console.log(`✅ videoGrid encontrado. Videos actuales:`, videoGrid.querySelectorAll('.video-container').length);

    let videoContainer = document.getElementById(`video-container-${userId}`);
    let videoElement = null;

    if (videoContainer) {
        videoElement = videoContainer.querySelector('video');
        debugLog(`🔄 Actualizando video existente para ${userId}.`);
    } else {
        if (DEBUG_MODE) console.log(`🆕 CREANDO NUEVO VIDEO CONTAINER para ${userId}`);
        videoContainer = document.createElement('div');
        videoContainer.className = 'video-container remote-video';
        videoContainer.id = `video-container-${userId}`;
        videoContainer.style.display = 'block'; // FORZAR VISIBLE
        videoGrid.appendChild(videoContainer); // ✅ AGREGAR A #videoGrid
        if (DEBUG_MODE) console.log(`✅ CONTENEDOR AGREGADO! Total videos ahora:`, videoGrid.querySelectorAll('.video-container').length);

        videoElement = document.createElement('video');
        videoElement.autoplay = true;
        videoElement.playsInline = true;
        videoElement.controls = false;
        videoElement.id = `video-${userId}`;
        videoContainer.appendChild(videoElement);

        const videoInfo = document.createElement('div');
        videoInfo.className = 'video-info';
        const nameSpan = document.createElement('span');
        nameSpan.textContent = userId;
        videoInfo.appendChild(nameSpan);
        videoContainer.appendChild(videoInfo);

        // Agregar indicador de pin y botón de pin
        const pinIndicator = document.createElement('div');
        pinIndicator.className = 'pin-indicator';
        pinIndicator.textContent = '📌 Fijado';
        videoContainer.appendChild(pinIndicator);

        const pinBtn = document.createElement('button');
        pinBtn.className = 'pin-video-btn';
        pinBtn.dataset.peerId = userId;
        pinBtn.title = 'Fijar video';
        pinBtn.innerHTML = '<i class="fas fa-thumbtack"></i>';
        pinBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (typeof pinVideo === 'function') {
                pinVideo(userId);
            }
        });
        videoContainer.appendChild(pinBtn);

        // Agregar atributo para identificar el peer
        videoContainer.dataset.peerId = userId;

        debugLog(`✅ Nuevo elemento de video creado para ${userId}.`);
    }

    if (videoElement) {
        if (DEBUG_MODE) console.log(`🎥 Asignando stream al elemento <video> de ${userId}`);
        videoElement.srcObject = stream;
        videoElement.style.width = '100%';
        videoElement.style.height = '100%';
        videoElement.style.objectFit = 'cover';
        debugLog(`🔗 Stream asignado a elemento de video para ${userId}`);

        // 🔊 IMPORTANTE: Los videos REMOTOS NO deben estar en muted para escuchar audio
        videoElement.muted = false; // ✅ Asegurar que NO está silenciado
        videoElement.volume = 1.0;  // ✅ Volumen al máximo

        // ✅ USAR EL NUEVO SISTEMA DE AUDIO ROBUSTO
        ensureVideoPlaying(videoElement, userId);

        // 🔊 Forzar salida de audio al altavoz
        forceSpeakerOutput(videoElement);

        // Verificar estado después de 1 segundo
        setTimeout(() => {
            if (DEBUG_MODE) {
                debugLog(`📊 Estado de video para ${userId} después de 1s:`);
            }
            
            // ✅ Si está pausado, intentar reproducir de nuevo
            if (videoElement.paused && videoElement.srcObject) {
                if (DEBUG_MODE) console.log(`[🔄] Reintentando reproducir video de ${userId}...`);
                ensureVideoPlaying(videoElement, userId);
            }
        }, 1000);
        
        // ✅ Reintentar después de 3 segundos si aún está pausado
        setTimeout(() => {
            if (videoElement.paused && videoElement.srcObject) {
                if (DEBUG_MODE) console.log(`[🔄] Segundo intento de reproducir video de ${userId}...`);
                ensureVideoPlaying(videoElement, userId);
            }
        }, 3000);
    } else {
    }
    // Si hay una pantalla compartida activa, re-aplicar layout para colocar este video en miniatura
    try {
        if (document.querySelector('.screen-share-preview')) {
            activateScreenShareLayout(videoGrid);
        }
    } catch (e) { /* no bloquear por errores menores de layout */ }
}


// ============================================================================
// NUEVO SISTEMA DE COMPARTIR PANTALLA DESDE CERO
// ============================================================================

/**
 * Crea y muestra el preview de pantalla compartida en el layout
 * @param {string} userId - ID del usuario que comparte
 * @param {MediaStream} stream - Stream de pantalla compartida
 */
function createScreenSharePreview(userId, stream) {
    if (DEBUG_MODE) {
    }

    const videoGrid = document.getElementById('videoGrid');
    if (!videoGrid) {
        return;
    }

    // Limpiar preview existente si hay
    const existingPreview = document.getElementById(`screen-preview-${userId}`);
    if (existingPreview) {
        if (DEBUG_MODE) console.log(`[SCREEN-SHARE] 🗑️ Eliminando preview anterior de ${userId}`);
        // Detener stream anterior si existe
        const oldVideo = existingPreview.querySelector('video');
        if (oldVideo && oldVideo.srcObject) {
            oldVideo.srcObject = null;
        }
        existingPreview.remove();
    }

    // Crear contenedor principal
    const previewContainer = document.createElement('div');
    previewContainer.id = `screen-preview-${userId}`;
    previewContainer.className = 'video-container screen-share screen-share-preview';
    previewContainer.dataset.userId = userId;

    // Crear elemento de video
    const video = document.createElement('video');
    video.id = `screen-video-${userId}`;
    video.autoplay = true;
    video.playsInline = true;
    
    // ✅ AUDIO: Solo silenciar para el presentador (evitar echo)
    // Para los receptores, el audio debe estar activo
    const isLocalShare = (userId === userName);
    video.muted = isLocalShare;
    video.volume = isLocalShare ? 0 : 1;
    
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'contain';
    video.style.backgroundColor = '#000';
    // ✅ IMPORTANTE: Pantalla compartida sin mirror (sin espejo)
    video.style.transform = 'scaleX(1)';

    // Asignar stream
    video.srcObject = stream;

    // ✅ Configurar audio para reproducción en altavoz (móviles)
    if (!isLocalShare && stream.getAudioTracks().length > 0) {
        if (DEBUG_MODE) console.log(`[SCREEN-SHARE] 🔊 Configurando audio para reproducción...`);
        forceSpeakerOutput(video);
    }

    // Intentar reproducir
    video.play()
        .then(() => {
            if (DEBUG_MODE) {
                if (!isLocalShare && stream.getAudioTracks().length > 0) {
                }
            }
        })
        .catch(err => {
            // En móviles, a veces necesita interacción del usuario
            if (err.name === 'NotAllowedError') {
                showError('Toca la pantalla compartida para activar el audio', 4000);
                // Agregar handler para reproducir al tocar
                previewContainer.addEventListener('click', () => {
                    video.muted = false;
                    video.volume = 1;
                    video.play().catch(() => {});
                }, { once: true });
            }
        });

    // Crear info overlay
    const infoOverlay = document.createElement('div');
    infoOverlay.className = 'screen-share-info-overlay';
    infoOverlay.innerHTML = `
        <span class="screen-share-user-name">${isLocalShare ? 'Tu pantalla' : `Pantalla de ${userId}`}</span>
        <span class="screen-share-status">●</span>
        ${!isLocalShare && stream.getAudioTracks().length > 0 ? '<span class="screen-share-audio">🔊</span>' : ''}
    `;

    // Agregar elementos al contenedor
    previewContainer.appendChild(video);
    previewContainer.appendChild(infoOverlay);

    // ✅ FORZAR POSICIÓN: Insertar al principio del grid como primer hijo
    videoGrid.insertBefore(previewContainer, videoGrid.firstChild);
    
    // ✅ FORZAR ESTILOS DIRECTOS para asegurar que sea visible
    previewContainer.style.display = 'block';
    previewContainer.style.order = '-1'; // Siempre primero
    previewContainer.style.zIndex = '10';
    // Activar layout de grid para screen-share usando el sistema centralizado
    // ✅ Usar setTimeout para asegurar que el DOM está actualizado
    setTimeout(() => {
        if (typeof setViewMode === 'function') {
            setViewMode('sidebar');
        } else if (window.ViewControl && typeof window.ViewControl.setViewMode === 'function') {
            window.ViewControl.setViewMode('sidebar');
        } else {
        }
    }, 100);

    // NOTA: No ocultamos la cámara del presentador, para que se vea en pequeño
}

/**
 * Maneja la recepción de un stream de pantalla remota
 * Esta función conecta el evento ontrack con la UI
 */
function handleRemoteScreenShare(userId, stream) {
    if (DEBUG_MODE) {
    }

    // Si ya existe un preview, actualizar el stream
    const existingPreview = document.getElementById(`screen-preview-${userId}`);
    if (existingPreview) {
        const videoEl = existingPreview.querySelector('video');
        if (videoEl && videoEl.srcObject !== stream) {
            if (DEBUG_MODE) console.log(`[SCREEN-SHARE] 🔄 Actualizando stream existente para ${userId}`);
            videoEl.srcObject = stream;
            videoEl.muted = false; // Asegurar que el audio esté activo
            videoEl.volume = 1;
            videoEl.play().catch(e => {
            });
            forceSpeakerOutput(videoEl);
        }
        return;
    }

    // Crear nueva preview
    createScreenSharePreview(userId, stream);

    // Forzar actualización del layout
    if (typeof setViewMode === 'function') {
        if (DEBUG_MODE) console.log('[SCREEN-SHARE] 📐 Forzando vista sidebar');
        setViewMode('sidebar');
    }
}

/**
 * REMOVIDO: activateScreenShareLayout
 * Se reemplaza por el sistema centralizado en viewControl.js
 */

/**
 * Crea un placeholder para la pantalla compartida antes de que llegue el stream.
 * Esto asegura que todos los participantes vean un área principal reservada.
 */
function ensureScreenPreviewPlaceholder(userId) {
    const videoGrid = document.getElementById('videoGrid');
    if (!videoGrid) return;

    const existing = document.getElementById(`screen-preview-${userId}`);
    if (existing) return; // ya existe

    const previewContainer = document.createElement('div');
    previewContainer.id = `screen-preview-${userId}`;
    previewContainer.className = 'video-container screen-share-preview div1';

    const video = document.createElement('video');
    video.id = `screen-video-${userId}`;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'contain';
    // No srcObject aún

    const infoOverlay = document.createElement('div');
    infoOverlay.className = 'screen-share-info-overlay';
    infoOverlay.innerHTML = `
        <span class="screen-share-user-name">${userId === userName ? 'Tu pantalla' : `Pantalla de ${userId}`}</span>
        <span class="screen-share-status">●</span>
    `;

    previewContainer.appendChild(video);
    previewContainer.appendChild(infoOverlay);

    // Insertar primero
    videoGrid.insertBefore(previewContainer, videoGrid.firstChild);

    if (typeof setViewMode === 'function') {
        setViewMode('sidebar');
    } else if (window.ViewControl && typeof window.ViewControl.setViewMode === 'function') {
        window.ViewControl.setViewMode('sidebar');
    }
}

/**
 * Elimina el preview de pantalla compartida y restaura el layout
 */
function removeScreenSharePreview(userId) {
    if (DEBUG_MODE) console.log(`[SCREEN-SHARE] 🗑️ Eliminando preview de ${userId}`);

    const videoGrid = document.getElementById('videoGrid');
    const preview = document.getElementById(`screen-preview-${userId}`);

    if (preview) {
        // Detener tracks del stream
        const video = preview.querySelector('video');
        if (video && video.srcObject) {
            video.srcObject.getTracks().forEach(track => {
                track.stop();
                if (DEBUG_MODE) console.log(`[SCREEN-SHARE] ⏹️ Track detenido: ${track.kind}`);
            });
        }
        preview.remove();
    }

    // Restaurar layout normal
    // Restaurar layout normal usando el sistema centralizado
    if (typeof setViewMode === 'function') {
        setViewMode('grid-auto');
    } else if (window.ViewControl && typeof window.ViewControl.setViewMode === 'function') {
        window.ViewControl.setViewMode('grid-auto');
    }

    if (DEBUG_MODE) console.log('[SCREEN-SHARE] ✅ Preview eliminado y layout restaurado');
}

async function initMedia() {
    try {
        // ============ USAR STREAM DEL LOBBY SI EXISTE ============
        if (localStream && localStream.active) {
        } else {
            // Obtener nuevo stream si no hay uno del lobby
            const devices = await navigator.mediaDevices.enumerateDevices();
            const hasVideoInput = devices.some(d => d.kind === 'videoinput');
            const hasAudioInput = devices.some(d => d.kind === 'audioinput');

            if (!hasVideoInput && !hasAudioInput) {
                showError('No se encontraron dispositivos de audio o video. Asegúrate de que estén conectados y permitidos.', 10000);
                debugLog('Error: No se encontraron dispositivos de entrada.');
                return;
            }

            localStream = await navigator.mediaDevices.getUserMedia({
                video: hasVideoInput ? {
                    width: { ideal: 640, max: 1280 },
                    height: { ideal: 480, max: 720 },
                    frameRate: { ideal: 15, max: 30 }
                } : false,
                audio: hasAudioInput ? {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    sampleRate: 48000,
                    channelCount: 2
                } : false
            });
        }
        // =========================================================
        
        debugLog('✅ Stream local obtenido:', localStream);
        if (DEBUG_MODE) {
            localStream.getTracks().forEach(track => {
            });
        }

        const localVideoElement = document.getElementById('localVideo');
        if (localVideoElement) {
            localVideoElement.srcObject = localStream;
            localVideoElement.muted = true;
            localVideoElement.play().catch(e => {
                showError("No se pudo reproducir automáticamente tu video local. Haz clic para reproducir.", 5000);
            });
            debugLog('Video local cargado.');
        } else {
            debugLog('Advertencia: #localVideo no encontrado en el DOM.');
        }

        // 🎤 Configurar estado inicial de audio/video
        localStream.getAudioTracks().forEach(track => {
            track.enabled = isMicActive;
            if (DEBUG_MODE) console.log(`🎤 Audio track inicial: enabled=${track.enabled}, readyState=${track.readyState}, id=${track.id}`);
        });
        localStream.getVideoTracks().forEach(track => {
            track.enabled = isCamActive;
            if (DEBUG_MODE) console.log(`🎥 Video track inicial: enabled=${track.enabled}, readyState=${track.readyState}, id=${track.id}`);
        });

        userRoles[userName] = isModerator ? 'Organizador de la Reunión' : 'Participante';
        participantStates[userName] = { micActive: isMicActive, camActive: isCamActive };
        addParticipant(userName, true);
        updateParticipantList();

        // ✅ DETECCIÓN DE HABLANTE ACTIVO: Agregar stream local para análisis
        if (localStream.getAudioTracks().length > 0) {
            addAudioStreamForAnalysis('local', localStream);
        }

        document.getElementById('toggleMic')?.classList.toggle('active', isMicActive);
        document.getElementById('toggleCam')?.classList.toggle('active', isCamActive);

        if (DEBUG_MODE) {
        }

        setInterval(async () => {
            // Sólo intentar re-obtener/reemplazar la pista de audio si la pista actual terminó
            if (localStream && isMicActive) {
                const audioTrack = localStream.getAudioTracks()[0];
                if (!audioTrack || audioTrack.readyState === 'ended' || audioTrack.enabled === false) {
                    debugLog('🔁 Audio track finalizado o deshabilitado. Intentando recuperar pista de audio...');
                    try {
                        const newStream = await navigator.mediaDevices.getUserMedia({
                            audio: {
                                echoCancellation: true,
                                noiseSuppression: true,
                                autoGainControl: true,
                                sampleRate: 48000,
                                channelCount: 2
                            }
                        });
                        const newAudioTrack = newStream.getAudioTracks()[0];
                        if (newAudioTrack) {
                            // Remover cualquier pista antigua marcada como ended
                            localStream.getAudioTracks().forEach(t => {
                                try { if (t.readyState === 'ended') localStream.removeTrack(t); } catch (e) { }
                            });
                            localStream.addTrack(newAudioTrack);
                            for (const userId in peerConnections) {
                                const pc = peerConnections[userId];
                                const sender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
                                if (sender) {
                                    try {
                                        await sender.replaceTrack(newAudioTrack);
                                        debugLog(`Pista de audio reemplazada para ${userId}.`);
                                    } catch (e) {
                                        debugLog(`Error reemplazando pista de audio para ${userId}:`, e);
                                    }
                                }
                            }
                        }
                        newStream.getTracks().forEach(t => { if (t !== newAudioTrack) t.stop(); });
                    } catch (err) {
                        debugLog('⚠️ No se pudo recuperar pista de audio automáticamente:', err);
                    }
                }
            }
        }, 30000);
    } catch (err) {
        let errorMessage = `Error de dispositivo: ${err.name}`;
        if (err.name === 'NotAllowedError') {
            errorMessage += ': Permiso denegado por el usuario o el sistema. Por favor, permite el acceso a la cámara y al micrófono en la configuración del navegador.';
        } else if (err.name === 'NotFoundError') {
            errorMessage += ': No se encontraron dispositivos de cámara o micrófono.';
        } else if (err.name === 'NotReadableError') {
            errorMessage += ': No se pudo acceder a los dispositivos (posiblemente en uso por otra aplicación).';
        } else if (err.name === 'AbortError') {
            errorMessage += ': El acceso al dispositivo fue abortado.';
        } else if (err.name === 'SecurityError') {
            errorMessage += ': Operación no permitida en este contexto (¿HTTPS?).';
        } else if (err.name === 'OverconstrainedError') {
            errorMessage += ': La cámara/micrófono no pudo satisfacer las restricciones solicitadas (por ejemplo, resolución). Intenta con menos restricciones.';
        }
        showError(errorMessage, 15000);
        debugLog('Fallo al inicializar medios:', err);
    }
}

function initWebSocket() {
    fetch('/frontendConfig.json')
        .then(r => {
            if (!r.ok) throw new Error(`Error HTTP! estado: ${r.status}`);
            return r.json();
        })
        .then(config => {
            if (!config.wsUrl) {
                showError('URL del servidor WebSocket no configurada en frontendConfig.json.', 10000);
                debugLog('Error de configuración: wsUrl no definido.');
                return;
            }

            ws = new WebSocket(config.wsUrl);
            updateConnectionStatus('connecting');
            debugLog('Intentando conexión WebSocket a:', config.wsUrl);

            ws.addEventListener('open', () => {
                updateConnectionStatus('connected');
                reconnectionAttempts = 0; // Reiniciar contador de intentos
                intentionalDisconnect = false; // Permitir reconexión automática en caso de pérdida

                // Enviar mensaje de unión a la sala
                ws.send(JSON.stringify({
                    type: 'join',
                    room: roomCode,
                    name: userName,
                    moderator: isModerator,
                    micActive: isMicActive,
                    camActive: isCamActive
                }));

                debugLog(`WebSocket abierto. Enviando 'join' para sala ${roomCode}.`);

                // Si ya hay un localStream activo, asegurarse de que esté configurado
                if (localStream) {
                    debugLog('LocalStream ya existe, manteniendo conexión con pares existentes');
                }

                // Enviar candidatos pendientes de todas las conexiones
                for (const [userId, pc] of Object.entries(peerConnections)) {
                    if (pc && pc.pendingCandidates && pc.pendingCandidates.length > 0) {
                        debugLog(`📤 Enviando ${pc.pendingCandidates.length} candidatos pendientes para ${userId} tras reconexión WS`);
                        pc.pendingCandidates.forEach(candidate => {
                            ws.send(JSON.stringify({
                                type: 'signal',
                                room: roomCode,
                                target: userId,
                                payload: { candidate: candidate }
                            }));
                        });
                        pc.pendingCandidates = [];
                    }
                }
            });

            ws.addEventListener('message', async e => {
                const msg = JSON.parse(e.data);
                debugLog('Mensaje WebSocket recibido:', msg.type, msg);

                switch (msg.type) {
                    case 'waiting-for-approval':
                        showWaitingRoom();
                        break;
                    
                    case 'join-approved':
                        hideWaitingRoom();
                        // Continuar con la inicialización normal
                        break;
                    
                    case 'join-rejected':
                        hideWaitingRoom();
                        showError('Tu solicitud fue rechazada por el moderador', 5000);
                        setTimeout(() => window.location.href = '/', 3000);
                        break;

                    case 'joined':
                        if (!msg.exists || msg.error) {
                            showError(`Error: ${msg.error || 'La sala no existe'}`, 5000);
                            setTimeout(() => window.location.href = '/', 3000);
                        } else {
                            // ✅ Ocultar sala de espera si estaba visible
                            hideWaitingRoom();
                            
                            // ✅ Guardar si es admin de la sala
                            if (msg.isRoomAdmin) {
                                isRoomAdmin = true;
                            }
                            debugLog('Unido a la sala exitosamente.');
                            const errorPanel = document.getElementById('errorPanel');
                            if (errorPanel && errorPanel.textContent.includes('Esperando aprobación')) {
                                errorPanel.style.display = 'none';
                            }

                            // Si es moderador, mostrar link para compartir
                            if (isModerator && !sessionStorage.getItem('linkShown')) {
                                sessionStorage.setItem('linkShown', 'true');
                                showShareLink();
                            }
                        }
                        break;

                    case 'join-request-removed':
                        const requestItem = document.getElementById(`join-request-${msg.userId}`);
                        if (requestItem) {
                            requestItem.remove();
                            debugLog(`Solicitud de unión para ${msg.userId} eliminada de la UI.`);

                            // Actualizar el contador del mini modal
                            const notificationsList = document.getElementById('notificationsList');
                            if (notificationsList) {
                                const count = notificationsList.children.length;
                                const countSpan = document.getElementById('joinRequestCount');
                                if (countSpan) {
                                    countSpan.textContent = count;
                                }

                                // Ocultar el modal si no quedan solicitudes
                                if (count === 0) {
                                    hideNotificationsModal();
                                }
                            }
                        }
                        break;

                    case 'join-request':
                        if (isModerator) {
                            const notificationsList = document.getElementById('notificationsList');
                            if (notificationsList) {
                                const li = document.createElement('li');
                                li.id = `join-request-${msg.userId}`;
                                li.className = 'notification-item';
                                li.innerHTML = `
                <span>${msg.userId} desea unirse.</span>
                <button class="accept-btn">Aceptar</button>
                <button class="reject-btn">Rechazar</button>
            `;
                                const acceptBtn = li.querySelector('.accept-btn');
                                const rejectBtn = li.querySelector('.reject-btn');
                                acceptBtn.onclick = () => {
                                    ws.send(JSON.stringify({ type: 'approve-join', userId: msg.userId }));
                                    li.remove();
                                    const count = notificationsList.children.length;
                                    if (count === 0) {
                                        hideNotificationsModal();
                                    }

                                    debugLog(`Solicitud de ${msg.userId} aceptada.`);
                                };
                                rejectBtn.onclick = () => {
                                    ws.send(JSON.stringify({ type: 'reject-join', userId: msg.userId }));
                                    li.remove();
                                    const count = notificationsList.children.length;

                                    // Siempre actualizar el contador primero
                                    const countSpan = document.getElementById('joinRequestCount');
                                    if (countSpan) {
                                        countSpan.textContent = count;
                                    }

                                    // Ocultar modal si no hay más solicitudes
                                    if (count === 0) {
                                        hideNotificationsModal();
                                    }

                                    debugLog(`Solicitud de ${msg.userId} rechazada.`);
                                };
                                notificationsList.appendChild(li);
                                showNotificationsModal(notificationsList.children.length);
                            } else {
                                showError('Error al mostrar solicitudes de unión.', 3000);
                            }
                        }
                        break;

                    case 'new-peer':
                        debugLog(`Nuevo par detectado: ${msg.userId}`);
                        if (msg.name && !userRoles[msg.name]) {
                            userRoles[msg.name] = msg.isModerator ? 'Organizador de la Reunión' : 'Participante';
                        }
                        participantStates[msg.name] = { micActive: msg.micActive ?? true, camActive: msg.camActive ?? true };
                        addParticipant(msg.name || msg.userId, false);
                        updateParticipantList();
                        
                        {
                            // Bloque para scope de variables
                            // ✅ VERIFICAR QUE LOCALSTREAM ESTÉ LISTO ANTES DE CREAR CONEXIÓN
                            if (!localStream || !localStream.active || localStream.getTracks().length === 0) {
                                // Esperar un poco y reintentar
                                await new Promise(resolve => setTimeout(resolve, 500));
                            }
                            
                            const peerConn = createPeerConnection(msg.userId);
                            
                            // ✅ Si tengo initiateOffer, crear oferta inmediatamente
                            if (peerConn && msg.initiateOffer && peerConn.signalingState === 'stable') {
                                try {
                                    // ✅ IMPORTANTE: Esperar a que los tracks estén agregados
                                    await new Promise(resolve => setTimeout(resolve, 100));
                                    
                                    const offer = await peerConn.createOffer({
                                        offerToReceiveAudio: true,
                                        offerToReceiveVideo: true
                                    });
                                    await peerConn.setLocalDescription(offer);
                                    if (ws.readyState === WebSocket.OPEN) {
                                        ws.send(JSON.stringify({
                                            type: 'signal',
                                            room: roomCode,
                                            target: msg.userId,
                                            payload: { sdp: peerConn.localDescription }
                                        }));
                                    }
                                } catch (e) {
                                    showError(`Error negociando con ${msg.userId}`, 5000);
                                    debugLog(`Error en la negociación WebRTC con ${msg.userId}:`, e);
                                }
                            } else if (!msg.initiateOffer && isScreenSharing && localScreenStream && localScreenStream.active) {
                                // ✅ Si estoy compartiendo pantalla pero NO tengo initiateOffer,
                                // esperar a que el otro usuario negocie primero, luego forzar renegociación
                                const targetUserId = msg.userId;
                                const targetPeerConn = peerConn;
                                
                                // Esperar a que la conexión esté establecida y luego renegociar
                                const checkAndRenegotiate = () => {
                                    if (targetPeerConn.iceConnectionState === 'connected' || targetPeerConn.iceConnectionState === 'completed') {
                                        // Forzar renegociación
                                        targetPeerConn.createOffer()
                                            .then(offer => targetPeerConn.setLocalDescription(offer))
                                            .then(() => {
                                                if (ws.readyState === WebSocket.OPEN) {
                                                    ws.send(JSON.stringify({
                                                        type: 'signal',
                                                        room: roomCode,
                                                        target: targetUserId,
                                                        payload: { sdp: targetPeerConn.localDescription }
                                                    }));
                                                }
                                            })
                                            .catch(e => console.error('[SCREEN-SHARE] Error renegociando:', e));
                                    } else {
                                        // Reintentar en 500ms si aún no está conectado
                                        setTimeout(checkAndRenegotiate, 500);
                                    }
                                };
                                
                                // Iniciar verificación después de 1 segundo
                                setTimeout(checkAndRenegotiate, 1000);
                            }
                        }
                        break;

                    case 'signal':
                        await handleSignal(msg.sender, msg.payload);
                        break;

                    case 'peer-disconnected':
                        removePeerConnection(msg.userId);
                        removeParticipant(msg.userId);
                        if (raisedHands.has(msg.userId)) {
                            raisedHands.delete(msg.userId);
                            updateHandList();
                            updateHandNotification();
                        }
                        break;

                    case 'raise-hand':
                        if (!raisedHands.has(msg.name)) {
                            raisedHands.add(msg.name);
                            updateHandList();
                            updateHandNotification();
                            // ✅ Solo notificar al admin/moderador, no a todos los participantes
                            if (isModerator) {
                                showError(`${msg.name} ha levantado la mano ✋`, 3000);
                            }
                        }
                        break;

                    case 'hand-lowered':
                        handleHandLowered(msg.name);
                        break;

                    case 'give-word':
                        // Recibir notificación de que alguien tiene la palabra
                        if (msg.target && msg.duration) {
                            // Si soy yo, activar micrófono automáticamente
                            if (msg.target === userName) {
                                isMicActive = true;
                                if (localStream) {
                                    localStream.getAudioTracks().forEach(t => t.enabled = true);
                                }
                                document.getElementById('toggleMic')?.classList.add('active');

                                // Notificar al servidor del nuevo estado
                                if (ws && ws.readyState === WebSocket.OPEN) {
                                    ws.send(JSON.stringify({
                                        type: 'participant-state-update',
                                        room: roomCode,
                                        name: userName,
                                        micActive: true,
                                        camActive: isCamActive
                                    }));

                                    // Auto-bajar la mano
                                    ws.send(JSON.stringify({ type: 'hand-lowered', name: userName }));
                                }
                                handleHandLowered(userName); // Optimistic update
                                showError('¡Tienes la palabra! Tu micrófono ha sido activado.', 5000);
                            }

                            // Si ya hay alguien con la palabra y es diferente, quitársela primero
                            if (currentSpeaker && currentSpeaker.name !== msg.target) {
                                if (speakingTimerInterval) {
                                    clearInterval(speakingTimerInterval);
                                    speakingTimerInterval = null;
                                }
                            }

                            currentSpeaker = {
                                name: msg.target,
                                timeLeft: msg.duration,
                                totalTime: msg.duration
                            };

                            const speakingPanel = document.getElementById('speakingPanel');
                            const speakingPersonName = document.getElementById('speakingPersonName');
                            const speakingActions = document.getElementById('speakingActions');
                            if (speakingPanel && speakingPersonName) {
                                // ✅ ASEGURAR que el panel esté en el body para evitar problemas de z-index/overflow
                                if (speakingPanel.parentNode !== document.body) {
                                    document.body.appendChild(speakingPanel);
                                }

                                // ✅ Actualizar contenido del panel
                                speakingPersonName.textContent = msg.target;
                                updateTimerDisplay();

                                // ✅ FORZAR VISIBILIDAD TOTAL - Remover clases anteriores y aplicar estilos directamente
                                speakingPanel.classList.remove('closing');
                                speakingPanel.classList.add('visible');
                                speakingPanel.style.cssText = 'display: block !important; opacity: 1 !important; visibility: visible !important; z-index: 10000 !important;';
                                // ✅ TODOS pueden ver el panel, pero SOLO los moderadores ven los botones de control
                                if (speakingActions) {
                                    speakingActions.style.display = isModerator ? 'flex' : 'none';
                                }
                            } else {
                            }

                            // Iniciar temporizador sincronizado
                            if (speakingTimerInterval) {
                                clearInterval(speakingTimerInterval);
                            }

                            speakingTimerInterval = setInterval(() => {
                                if (currentSpeaker && currentSpeaker.timeLeft > 0) {
                                    currentSpeaker.timeLeft--;
                                    updateTimerDisplay();

                                    // Cuando el tiempo se acaba
                                    if (currentSpeaker.timeLeft <= 0) {
                                        const targetName = currentSpeaker.name;

                                        // 📢 SOLO EL MODERADOR ejecuta el cierre automático
                                        if (isModerator) {
                                            handleTimeExpired(targetName);
                                        } else {
                                            // Los participantes solo actualizan la UI localmente
                                            if (speakingTimerInterval) {
                                                clearInterval(speakingTimerInterval);
                                                speakingTimerInterval = null;
                                            }
                                            currentSpeaker = null;
                                        }
                                    }
                                }
                            }, 1000);

                            // Mostrar notificación a todos
                            showError(`🎤 ${msg.target} tiene la palabra (${msg.duration}s)`, 3000);
                            debugLog(`📢 ${msg.target} tiene la palabra por ${msg.duration} segundos`);
                        }
                        break;

                    case 'take-word':
                        // Recibir notificación de que se quitó la palabra
                        if (currentSpeaker || msg.target) {
                            const participantName = currentSpeaker?.name || msg.target;

                            // Detener temporizador
                            if (speakingTimerInterval) {
                                clearInterval(speakingTimerInterval);
                                speakingTimerInterval = null;
                            }

                            // ✅ Ocultar panel con animación PARA TODOS LOS PARTICIPANTES
                            const speakingPanel = document.getElementById('speakingPanel');
                            if (speakingPanel && speakingPanel.classList.contains('visible')) {
                                speakingPanel.classList.add('closing');
                                setTimeout(() => {
                                    speakingPanel.classList.remove('visible', 'closing');
                                    speakingPanel.style.cssText = 'display: none !important; opacity: 0 !important; visibility: hidden !important;';
                                    // Resetear posición del panel
                                    speakingPanel.style.transform = 'translate(0px, 0px)';
                                    xOffset = 0;
                                    yOffset = 0;
                                }, 400);
                            }

                            // ✅ Limpiar el speaker actual
                            currentSpeaker = null;

                            showError(`🔇 Se quitó la palabra a ${participantName}`, 2000);
                            // NOTA: El silenciamiento del micrófono se maneja en el mensaje 'mute-participant' que el servidor envía
                        }
                        break;

                    case 'chat':
                        if (msg.author && msg.message) {
                            const isOwn = msg.author === userName;
                            // Mostrar todos los mensajes que vienen del servidor
                            addChatMessage(msg.author, msg.message, msg.timestamp, isOwn);

                            // Mostrar notificación si el mensaje es de otro usuario y el chat está cerrado
                            if (!isOwn) {
                                // Verificar si el sidebar está colapsado o chat no está activo
                                const sidebar = document.getElementById('sidebar');
                                const chatTab = document.querySelector('.sidebar-tab[data-tab="chat"]');
                                const isSidebarCollapsed = sidebar && sidebar.classList.contains('sidebar-collapsed');
                                const isChatActive = chatTab && chatTab.classList.contains('active');
                                const isChatClosed = isSidebarCollapsed || !isChatActive;

                                if (isChatClosed) {
                                    // ✅ Usar notificación clickeable que abre el chat
                                    const preview = msg.message.substring(0, 50) + (msg.message.length > 50 ? '...' : '');
                                    showChatNotification(msg.author, preview, 4000);
                                }

                                // Agregar indicador visual en el botón de chat
                                const chatToggleBtn = document.getElementById('chatToggle');
                                if (chatToggleBtn && isChatClosed) {
                                    chatToggleBtn.classList.add('has-notification');
                                }
                            }
                        } else {
                        }
                        break;

                    case 'hand-lowered':
                        handleHandLowered(msg.name);
                        break;

                    case 'floor-granted':
                        handleFloorGranted(msg.target);
                        if (raisedHands.has(msg.target)) {
                            raisedHands.delete(msg.target);
                            updateHandList();
                            updateHandNotification();
                        }
                        break;

                    case 'floor-ended':
                        handleFloorEnded(msg.name);
                        break;

                    case 'screen-share-started':
                        if (DEBUG_MODE) {
                        }

                        // ✅ FORZAR VISTA SIDEBAR INMEDIATAMENTE PARA TODOS
                        if (typeof setViewMode === 'function') {
                            setViewMode('sidebar');
                        } else if (window.ViewControl && typeof window.ViewControl.setViewMode === 'function') {
                            window.ViewControl.setViewMode('sidebar');
                        }

                        if (msg.streamId) {
                            remoteScreenStreams[msg.userId] = msg.streamId;
                            if (DEBUG_MODE) console.log(`[SCREEN-SHARE] ID registrado: ${msg.streamId}`);

                            // Crear un placeholder de preview para reservar el área principal
                            ensureScreenPreviewPlaceholder(msg.userId);

                            // 1. Verificar si el stream estaba esperando en pendingStreams
                            if (pendingStreams[msg.streamId]) {
                                if (DEBUG_MODE) console.log(`[SCREEN-SHARE] 🔄 Recuperando stream pendiente para ${msg.userId} (por ID exacto)`);
                                const pending = pendingStreams[msg.streamId];
                                handleRemoteScreenShare(pending.userId, pending.stream);
                                delete pendingStreams[msg.streamId];
                            } else {
                                // Búsqueda flexible: buscar cualquier stream pendiente de este usuario
                                if (DEBUG_MODE) console.log(`[SCREEN-SHARE] 🔍 Buscando streams pendientes por usuario ${msg.userId}...`);
                                const pendingKey = Object.keys(pendingStreams).find(key => pendingStreams[key].userId === msg.userId);
                                if (pendingKey) {
                                    if (DEBUG_MODE) console.log(`[SCREEN-SHARE] 🔄 Recuperando stream pendiente para ${msg.userId} (por coincidencia de usuario)`);
                                    const pending = pendingStreams[pendingKey];
                                    handleRemoteScreenShare(pending.userId, pending.stream);
                                    delete pendingStreams[pendingKey];
                                } else if (msg.isSync) {
                                    // ✅ Es una sincronización para nuevo usuario - esperar que llegue el stream por WebRTC
                                    if (DEBUG_MODE) console.log(`[SCREEN-SHARE] ⏳ Sincronización: Esperando stream de ${msg.userId} por WebRTC...`);
                                    // Registrar que esperamos un stream de este usuario
                                    // El stream llegará por ontrack y se procesará ahí con timeout
                                }
                            }

                            // 2. Verificar si el video ya llegó y se asignó incorrectamente a la cámara
                            const existingVideoContainer = document.getElementById(`video-container-${msg.userId}`);
                            if (existingVideoContainer) {
                                // ✅ MEJORADO: Buscar todos los videos en el container y ver si hay más de uno
                                const allVideos = existingVideoContainer.querySelectorAll('video');
                                if (DEBUG_MODE) {
                                    allVideos.forEach((videoEl, idx) => {
                                    });
                                }
                                
                                const videoEl = existingVideoContainer.querySelector('video');
                                if (videoEl && videoEl.srcObject && videoEl.srcObject.id === msg.streamId) {
                                    if (DEBUG_MODE) console.log('[SCREEN-SHARE] ⚠️ Rectificando video asignado a cámara...');

                                    // Mover a screen share
                                    handleRemoteScreenShare(msg.userId, videoEl.srcObject);

                                    // Limpiar el container de cámara que tiene el stream incorrecto
                                    videoEl.srcObject = null;
                                }
                            }
                        } else {
                            // ⚠️ FALLBACK CRÍTICO: Si el servidor no envía streamId (versión vieja), asumimos que comparte
                            if (DEBUG_MODE) console.warn(`[SCREEN-SHARE] ⚠️ streamId no recibido. Activando modo compatibilidad para ${msg.userId}`);
                            remoteScreenStreams[msg.userId] = 'unknown'; // Marcar como activo
                            ensureScreenPreviewPlaceholder(msg.userId);

                            // Buscar cualquier stream pendiente de este usuario
                            const pendingKey = Object.keys(pendingStreams).find(key => pendingStreams[key].userId === msg.userId);
                            if (pendingKey) {
                                if (DEBUG_MODE) console.log(`[SCREEN-SHARE] 🔄 Fallback: Recuperando stream pendiente para ${msg.userId}`);
                                const pending = pendingStreams[pendingKey];
                                handleRemoteScreenShare(pending.userId, pending.stream);
                                delete pendingStreams[pendingKey];
                            }
                        }
                        
                        // ✅ Actualizar tracker de quién está compartiendo
                        currentScreenSharer = msg.userId;
                        if (DEBUG_MODE) console.log(`[SCREEN-SHARE] 📺 Tracker actualizado: ${currentScreenSharer} está compartiendo`);
                        break;

                    case 'screen-share-stopped':
                        if (DEBUG_MODE) console.log(`[SCREEN-SHARE] 🛑 Notificación de parada de ${msg.userId}`);
                        delete remoteScreenStreams[msg.userId];
                        stopRemoteScreenShare(msg.userId);
                        
                        // ✅ Limpiar tracker si era el que estaba compartiendo
                        if (currentScreenSharer === msg.userId) {
                            currentScreenSharer = null;
                            if (DEBUG_MODE) console.log(`[SCREEN-SHARE] 📺 Tracker limpiado: nadie está compartiendo`);
                        }
                        break;


                    case 'poll-started':
                        currentPoll = msg.poll;
                        hasVoted = false;
                        displayPollForParticipant(currentPoll);
                        break;

                    case 'poll-ended':
                        // ✅ USAR FUNCIÓN CENTRALIZADA PARA LIMPIAR TIMERS
                        stopAllPollTimers();
                        
                        // Actualizar currentPoll
                        if (currentPoll) {
                            currentPoll.ended = true;
                            currentPoll.results = msg.results;
                            currentPoll.votes = msg.votes || [];
                        } else {
                            currentPoll = {
                                id: msg.pollId,
                                question: msg.question,
                                options: msg.options,
                                results: msg.results,
                                votes: msg.votes || [],
                                ended: true
                            };
                        }
                        
                        hidePollForParticipant();
                        
                        if (isModerator) {
                            displayPollResults(msg.results, msg.question, msg.options, msg.votes);
                            // Ocultar timer y botón de finalizar
                            document.getElementById('endPollBtn').style.display = 'none';
                            const pollResultsTimer = document.getElementById('pollResultsTimer');
                            if (pollResultsTimer) {
                                pollResultsTimer.textContent = '¡Votación terminada!';
                            }
                            const minimizedTimer = document.getElementById('minimizedTimer');
                            if (minimizedTimer) minimizedTimer.style.display = 'none';
                        } else {
                            showError('La votación ha terminado.', 3000);
                        }
                        break;

                    case 'vote-submitted':
                        if (msg.status === "success") {
                            showError('Tu voto ha sido registrado!', 3000);
                            hidePollForParticipant();
                        } else if (msg.status === "already_voted") {
                            showError(msg.message, 3000);
                        } else if (msg.status === "poll_ended") {
                            showError(msg.message, 3000);
                            hidePollForParticipant();
                        } else {
                            showError(`Error al enviar el voto: ${msg.message || 'Desconocido'}`, 5000);
                        }
                        break;

                    case 'poll-update':
                        if (isModerator) {
                            debugLog('Actualización de votación recibida:', msg);
                            
                            // Verificar si la votación ya terminó
                            if (currentPoll?.ended) {
                                debugLog('Ignorando poll-update porque la votación ya terminó');
                                break;
                            }
                            
                            // Guardar el conteo de votos anterior
                            const previousVoteCount = currentPoll?.votes?.length || 0;
                            const newVoteCount = msg.votes?.length || 0;
                            
                            currentPoll = msg;
                            
                            // Verificar si el panel de resultados está abierto o minimizado
                            const pollResultsPanel = document.getElementById('pollResultsPanel');
                            const isPanelVisible = pollResultsPanel && pollResultsPanel.style.display !== 'none';
                            const isMinimized = pollResultsPanel?.classList.contains('minimized');
                            
                            // ✅ LÓGICA MEJORADA:
                            // - Si es el PRIMER VOTO (panel no visible): Abrir automáticamente
                            // - Si ya está visible pero minimizado: Mantener minimizado, solo notificar
                            // - Si está visible y expandido: Actualizar normalmente
                            
                            if (!isPanelVisible) {
                                // PRIMER VOTO: Abrir el panel automáticamente
                                if (DEBUG_MODE) console.log('[POLL-UPDATE] 🎉 Primer voto recibido, abriendo panel de resultados');
                                displayPollResults(msg.results, msg.question, msg.options, msg.votes);
                            } else if (isMinimized) {
                                // Panel YA existe pero está minimizado: Solo notificar, no abrir
                                if (DEBUG_MODE) console.log('[POLL-UPDATE] Panel minimizado, solo actualizando contador');
                                
                                const totalVotes = msg.options.reduce((sum, opt) => sum + (msg.results[opt.id] || 0), 0);
                                const minimizedVoteCount = document.getElementById('minimizedVoteCount');
                                if (minimizedVoteCount) {
                                    minimizedVoteCount.textContent = `${totalVotes} voto${totalVotes !== 1 ? 's' : ''}`;
                                }
                                
                                // Mostrar notificación de nuevo voto
                                if (newVoteCount > previousVoteCount) {
                                    const newVotes = newVoteCount - previousVoteCount;
                                    updateMinimizedPollNotification(newVotes);
                                    showError(`🗳️ +${newVotes} nuevo${newVotes > 1 ? 's' : ''} voto${newVotes > 1 ? 's' : ''}`, 2000);
                                }
                            } else {
                                // Panel visible y expandido: Actualizar normalmente
                                if (DEBUG_MODE) console.log('[POLL-UPDATE] Panel expandido, actualizando resultados');
                                displayPollResults(msg.results, msg.question, msg.options, msg.votes);
                            }
                            
                            // Actualizar timer solo si no ha terminado
                            const pollResultsTimer = document.getElementById('pollResultsTimer');
                            if (pollResultsTimer && msg.endTime) {
                                const remainingTime = Math.max(0, Math.floor((msg.endTime - Date.now()) / 1000));
                                if (remainingTime > 0) {
                                    startResultsTimer(remainingTime);
                                }
                            }
                        }
                        break;

                    // ✅ Resultados compartidos por el moderador a todos los participantes
                    case 'poll-results-shared':
                        showError(`📊 ${msg.sharedBy || 'El moderador'} compartió los resultados de la encuesta.`, 4000);
                        
                        // Guardar la encuesta actual para mostrar resultados
                        currentPoll = {
                            id: msg.pollId,
                            question: msg.question,
                            options: msg.options,
                            results: msg.results,
                            totalVotes: msg.totalVotes,
                            voters: msg.voters,
                            ended: msg.ended
                        };
                        
                        // Mostrar resultados al participante
                        displayPollResults(msg.results, msg.question, msg.options, msg.voters || []);
                        
                        // Ocultar botones de moderador (compartir y finalizar) para participantes
                        const shareBtn = document.getElementById('shareResultsBtn');
                        const endBtn = document.getElementById('endPollBtn');
                        if (shareBtn) shareBtn.style.display = 'none';
                        if (endBtn) endBtn.style.display = 'none';
                        break;

                    case 'moderator-assigned':
                        if (msg.name && msg.role) {
                            userRoles[msg.name] = msg.role;

                            if (msg.name === userName) {
                                isModerator = true;
                                updateModeratorUI?.();
                                showError("✅ Ahora eres moderador de la sala.", 4000);
                                debugLog("✅ Asignado como moderador.");
                            } else {
                                showError(`✅ ${msg.name} es ahora moderador.`, 3000);
                                debugLog(`✅ ${msg.name} ha sido asignado como moderador.`);
                            }

                            updateParticipantList();  // 🔁 refresca la lista para mostrar la corona
                            updateHandList?.();       // 👋 actualiza panel de manos si es necesario
                        } else {
                        }
                        break;

                    case 'moderator-revoked':
                        if (msg.name && msg.role) {
                            userRoles[msg.name] = msg.role;

                            if (msg.name === userName) {
                                isModerator = false;
                                updateModeratorUI?.();
                                showError("❌ Ya no eres moderador de la sala.", 4000);
                                debugLog("❌ Rol de moderador revocado.");
                            } else {
                                showError(`❌ ${msg.name} ya no es moderador.`, 3000);
                                debugLog(`❌ Rol de moderador revocado para ${msg.name}.`);
                            }

                            updateParticipantList();  // 🔁 refresca la lista para quitar la corona
                            updateHandList?.();       // 👋 actualiza panel de manos si es necesario
                        } else {
                        }
                        break;

                    case 'mute-participant':
                        console.log('[MUTE-PARTICIPANT] Recibido:', msg);
                        if (msg.target === userName) {
                            console.log('[MUTE-PARTICIPANT] Soy el target. isRoomAdmin:', isRoomAdmin, 'micActive:', msg.micActive);
                            
                            // ✅ Si es admin de la sala Y el mensaje es para silenciar, ignorar
                            // Pero si es para activar el mic, sí aplicar
                            if (isRoomAdmin && msg.micActive === false) {
                                console.log('[MUTE-PARTICIPANT] Admin ignorando silenciamiento');
                                return;
                            }

                            // 🎤 APLICAR EL CAMBIO DE ESTADO DEL MICRÓFONO
                            isMicActive = msg.micActive;
                            console.log('[MUTE-PARTICIPANT] Aplicando cambio de micrófono:', isMicActive);
                            if (localStream) {
                                localStream.getAudioTracks().forEach(track => {
                                    track.enabled = isMicActive;
                                    console.log('[MUTE-PARTICIPANT] Track de audio enabled:', track.enabled);
                                });
                            }

                            const toggleMicBtn = document.getElementById('toggleMic');
                            if (toggleMicBtn) {
                                // ✅ CORREGIDO: active = micrófono ENCENDIDO (verde)
                                // isMicActive = true → añadir 'active' (verde)
                                // isMicActive = false → quitar 'active' (gris/apagado)
                                if (isMicActive) {
                                    toggleMicBtn.classList.add('active');
                                } else {
                                    toggleMicBtn.classList.remove('active');
                                }
                            }

                            showError(isMicActive ? 'Tu micrófono ha sido activado por un moderador.' : 'Tu micrófono ha sido silenciado por un moderador.', 3000);
                        }

                        // 📊 Actualizar estado en la lista de participantes
                        participantStates[msg.target] = participantStates[msg.target] || {};
                        participantStates[msg.target].micActive = msg.micActive;
                        updateParticipantList();

                        // 🔄 Actualizar el título del botón de silenciar
                        const muteBtn = document.querySelector(`#participant-${msg.target} .mute-btn`);
                        if (muteBtn) {
                            muteBtn.title = msg.micActive ? 'Silenciar' : 'Activar Micrófono';
                        }
                        break;

                    case 'kick-participant':

                        if (msg.target === userName) {
                            intentionalDisconnect = true;
                            showError('Has sido expulsado de la sala.', 3000);
                            debugLog('Usuario expulsado de la sala.');
                            for (const userId in peerConnections) {
                                peerConnections[userId].close();
                            }
                            localStream?.getTracks().forEach(track => track.stop());
                            localScreenStream?.getTracks().forEach(track => track.stop());
                            // ✅ Reasignar micrófono a los peers
                            localStream.getAudioTracks().forEach(micTrack => {
                                for (const userId in peerConnections) {
                                    const pc = peerConnections[userId];
                                    const sender = pc.getSenders().find(s => s.track?.kind === 'audio');
                                    if (sender) {
                                        sender.replaceTrack(micTrack);
                                        debugLog(`🎤 Micrófono restaurado en conexión con ${userId}.`);
                                    }
                                }
                            });

                            ws.close();
                            setTimeout(() => window.location.href = '/', 2000);
                        } else {
                            removePeerConnection(msg.target);
                            removeParticipant(msg.target);
                            if (raisedHands.has(msg.target)) {
                                raisedHands.delete(msg.target);
                                updateHandList();
                                updateHandNotification();
                            }
                            showError(`${msg.target} ha sido expulsado de la sala.`, 3000);
                            debugLog(`Participante ${msg.target} expulsado.`);
                        }
                        break;

                    case 'participant-state-update':
                        participantStates[msg.name] = {
                            micActive: msg.micActive ?? participantStates[msg.name]?.micActive ?? true,
                            camActive: msg.camActive ?? participantStates[msg.name]?.camActive ?? true
                        };
                        updateParticipantList();
                        debugLog(`Estado actualizado para ${msg.name}: mic=${msg.micActive}, cam=${msg.camActive}`);
                        break;

                    default:
                        debugLog('Tipo de mensaje WebSocket desconocido:', msg.type);
                }
            });

            ws.addEventListener('close', (event) => {
                updateConnectionStatus('disconnected');
                debugLog('WebSocket cerrado. Código:', event.code, 'Razón:', event.reason);

                // ✅ VERIFICA SI LA DESCONEXIÓN FUE INTENCIONAL
                if (!intentionalDisconnect) {
                    // Mostrar mensaje de reconexión
                    showError('Conexión perdida. Reconectando...', 0);

                    let retryAttempts = 0;
                    const maxRetries = 10;
                    let retryDelay = 2000;
                    const maxDelay = 30000;

                    const reconnect = () => {
                        if (retryAttempts >= maxRetries) {
                            showError('No se pudo reconectar después de varios intentos. Por favor, recarga la página.', 0);
                            return;
                        }

                        if (ws.readyState !== WebSocket.OPEN && ws.readyState !== WebSocket.CONNECTING) {
                            retryAttempts++;
                            debugLog(`Intento de reconexión ${retryAttempts}/${maxRetries}`);
                            showError(`Reconectando... (${retryAttempts}/${maxRetries})`, 0);

                            // Intentar reconectar
                            initWebSocket();

                            retryDelay = Math.min(retryDelay * 1.5, maxDelay);
                            setTimeout(reconnect, retryDelay);
                        } else if (ws.readyState === WebSocket.OPEN) {
                            // Reconexión exitosa
                            showError('¡Reconexión exitosa!', 3000);
                            debugLog('Reconexión exitosa al servidor WebSocket');
                        }
                    };

                    setTimeout(reconnect, retryDelay);
                } else {
                    debugLog("Desconexión intencional, no se intentará reconectar.");
                }
            });

            ws.addEventListener('error', (err) => {
                showError('Error de conexión con el servidor. Intentando reconectar...', 5000);
                updateConnectionStatus('disconnected');
            });
        })
        .catch(error => {
            showError('Error crítico: No se pudo cargar la configuración de la aplicación.', 15000);
        });
}

function createPeerConnection(userId) {
    debugLog(`Creando PeerConnection para ${userId}`);
    
    // ✅ IMPORTANTE: Usar 'relay' fuerza el uso de TURN servers
    // Esto es más lento pero garantiza conectividad entre redes diferentes
    // Cambiar a 'all' si están en la misma red local para mejor rendimiento
    const iceTransportPolicy = 'all'; // Usar 'relay' si hay problemas de conectividad
    
    const pc = new RTCPeerConnection({
        iceServers: iceServers,
        iceTransportPolicy: iceTransportPolicy,
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
        iceCandidatePoolSize: 10
    });
    peerConnections[userId] = pc;

    // Agregar tracks locales si existen
    if (localStream && localStream.getTracks().length > 0) {
        debugLog(`📹 LocalStream disponible con ${localStream.getTracks().length} tracks para ${userId}`);
        localStream.getTracks().forEach(track => {
            try {
                const sender = pc.addTrack(track, localStream);
                debugLog(`✅ Track ${track.kind} agregado a conexión con ${userId} (enabled: ${track.enabled}, readyState: ${track.readyState})`);
            } catch (e) {
            }
        });

        // Verificar que los senders están configurados correctamente
        const senders = pc.getSenders();
        debugLog(`Total de senders para ${userId}: ${senders.length}`);
        senders.forEach(sender => {
            if (sender.track) {
                debugLog(`  - Sender ${sender.track.kind}: enabled=${sender.track.enabled}, muted=${sender.track.muted}, readyState=${sender.track.readyState}`);
            }
        });
    } else {
        if (localStream) {
        }
    }
    
    // ✅ IMPORTANTE: Si estoy compartiendo pantalla, agregar también esos tracks al nuevo peer
    if (isScreenSharing && localScreenStream && localScreenStream.active) {
        localScreenStream.getTracks().forEach(track => {
            try {
                pc.addTrack(track, localScreenStream);
            } catch (e) {
            }
        });
        
        // ✅ Notificar al nuevo peer que hay un screen share activo (después de la negociación)
        setTimeout(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'screen-share-started',
                    room: roomCode,
                    userId: userName,
                    streamId: localScreenStream.id,
                    targetUser: userId // Para que el servidor sepa a quién enviar
                }));
            }
        }, 1000);
    }

    // Buffer para ICE candidates pendientes
    pc.pendingCandidates = [];

    pc.onicecandidate = event => {
        if (event.candidate) {
            const candidateType = event.candidate.candidate.includes('typ relay') ? 'TURN/RELAY' :
                event.candidate.candidate.includes('typ srflx') ? 'STUN/SRFLX' :
                    event.candidate.candidate.includes('typ host') ? 'HOST' : 'UNKNOWN';

            debugLog(`🔷 Candidato ICE generado para ${userId}:`);
            debugLog(`   Tipo: ${candidateType}`);
            debugLog(`   Candidato: ${event.candidate.candidate}`);

            // Preferir candidatos relay (TURN) para conexiones entre diferentes redes
            if (candidateType === 'TURN/RELAY') {
                debugLog(`   ⭐ Candidato RELAY (mejor para redes diferentes)`);
            }

            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'signal',
                    room: roomCode,
                    target: userId,
                    payload: { candidate: event.candidate }
                }));
            } else {
                // Guardar candidato si WebSocket no está listo
                pc.pendingCandidates.push(event.candidate);
                debugLog(`Candidato ICE guardado en buffer para ${userId}`);
            }
        } else {
            debugLog(`✅ Recolección de candidatos ICE completada para ${userId}`);
        }
    };

    pc.onicegatheringstatechange = () => {
        debugLog(`Estado de recolección ICE para ${userId}: ${pc.iceGatheringState}`);
    };

    pc.ontrack = event => {
        const stream = event.streams[0];
        const track = event.track;
        // ✅ IMPORTANTE: ASEGURAR QUE EL TRACK ESTÉ HABILITADO
        if (!track.enabled) {
            track.enabled = true;
        }

        // ✅ DETECCIÓN DE HABLANTE ACTIVO: Agregar stream de audio para análisis
        if (track.kind === 'audio' && !remoteScreenStreams[userId]) {
            // Solo analizar audio de cámaras, no de pantallas compartidas
            addAudioStreamForAnalysis(userId, stream);
        }

        // Verificar si este stream corresponde a una pantalla compartida conocida
        if (remoteScreenStreams[userId] === stream.id) {
            handleRemoteScreenShare(userId, stream);
        } else {
            // Si no coincide con el ID de pantalla, podría ser cámara O una pantalla que llegó antes del mensaje

            // Verificar si YA existe un video de cámara activo para este usuario
            const existingCameraContainer = document.getElementById(`video-container-${userId}`);
            const existingVideo = existingCameraContainer ? existingCameraContainer.querySelector('video') : null;
            // Si ya tiene un video de cámara Y el stream ID es diferente, probablemente el nuevo es la pantalla
            // y aún no llegó el mensaje de señalización.
            if (existingVideo && existingVideo.srcObject && existingVideo.srcObject.id !== stream.id) {

                // Verificar si YA sabemos que este usuario está compartiendo pantalla (aunque el ID no coincida exacto)
                if (remoteScreenStreams[userId]) {
                    handleRemoteScreenShare(userId, stream);
                } else {
                    pendingStreams[stream.id] = { userId, stream };
                    // ✅ NUEVO: Si hay un stream pendiente de este usuario, probablemente es pantalla
                    // Esperar un poco y si llega screen-share-started, se procesará
                    // Si no, asumir que es un segundo stream de video (pantalla)
                    setTimeout(() => {
                        // Verificar si el stream sigue pendiente (no se procesó por screen-share-started)
                        if (pendingStreams[stream.id]) {
                            const pending = pendingStreams[stream.id];
                            // Marcar que este usuario está compartiendo pantalla (aunque no tengamos el ID original)
                            remoteScreenStreams[userId] = stream.id;
                            handleRemoteScreenShare(pending.userId, pending.stream);
                            delete pendingStreams[stream.id];
                        }
                    }, 1500); // Esperar 1.5 segundos
                }
            } else {
                // Si no hay cámara previa, o es el mismo stream (reemplazo), asumimos cámara por defecto
                // (Si luego resulta ser pantalla, el evento screen-share-started lo corregirá)
                addVideoElement(userId, stream);

                // ✅ ASEGURAR QUE TODOS LOS TRACKS DEL STREAM ESTÉN HABILITADOS
                stream.getTracks().forEach(t => {
                    if (!t.enabled) {
                        t.enabled = true;
                    }
                });
            }
        }
    };

    pc.oniceconnectionstatechange = () => {
        debugLog(`Estado de conexión ICE para ${userId}: ${pc.iceConnectionState}`);

        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
            debugLog(`✅ Conexión ICE establecida con ${userId}`);
            
            // ✅ VERIFICAR TRACKS DESPUÉS DE CONEXIÓN
            setTimeout(() => {
                const senders = pc.getSenders();
                const receivers = pc.getReceivers();
                senders.forEach(s => {
                    if (s.track) {
                    }
                });
                receivers.forEach(r => {
                    if (r.track) {
                        // ✅ ASEGURAR QUE LOS TRACKS RECIBIDOS ESTÉN HABILITADOS
                        if (!r.track.enabled) {
                            r.track.enabled = true;
                        }
                    }
                });
                
                // ✅ VERIFICAR QUE EL VIDEO ESTÉ REPRODUCIENDO
                const videoContainer = document.getElementById(`video-container-${userId}`);
                if (videoContainer) {
                    const videoEl = videoContainer.querySelector('video');
                    if (videoEl && videoEl.srcObject) {
                        if (videoEl.paused) {
                            ensureVideoPlaying(videoEl, userId);
                        }
                    }
                }
            }, 500);

            // Verificar qué tipo de candidato se está usando
            pc.getStats().then(stats => {
                stats.forEach(report => {
                    if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                        debugLog(`🎯 Par de candidatos activo para ${userId}:`);
                        debugLog(`   - Estado: ${report.state}`);
                        debugLog(`   - Prioridad: ${report.priority}`);

                        // Obtener información del candidato local
                        stats.forEach(r => {
                            if (r.id === report.localCandidateId) {
                                const type = r.candidateType === 'relay' ? 'TURN/RELAY ⭐' :
                                    r.candidateType === 'srflx' ? 'STUN/SRFLX' :
                                        r.candidateType === 'host' ? 'HOST (local)' : r.candidateType;
                                debugLog(`   - Candidato Local: ${type}`);
                                if (r.candidateType === 'relay') {
                                    debugLog(`   ✅ Usando TURN - Funciona para redes diferentes`);
                                } else if (r.candidateType === 'host') {
                                    debugLog(`   ⚠️ Usando conexión local - Puede fallar entre redes diferentes`);
                                }
                            }
                            if (r.id === report.remoteCandidateId) {
                                const type = r.candidateType === 'relay' ? 'TURN/RELAY ⭐' :
                                    r.candidateType === 'srflx' ? 'STUN/SRFLX' :
                                        r.candidateType === 'host' ? 'HOST (local)' : r.candidateType;
                                debugLog(`   - Candidato Remoto: ${type}`);
                            }
                        });
                    }
                });
            }).catch(err => console.error('Error obteniendo estadísticas:', err));

            // Limpiar cualquier timeout de reconexión pendiente
            if (pc.reconnectTimeout) {
                clearTimeout(pc.reconnectTimeout);
                pc.reconnectTimeout = null;
            }
            // Reiniciar contador de intentos de reconexión
            pc.reconnectAttempts = 0;

            // Enviar candidatos pendientes si hay
            if (pc.pendingCandidates && pc.pendingCandidates.length > 0 && ws && ws.readyState === WebSocket.OPEN) {
                debugLog(`Enviando ${pc.pendingCandidates.length} candidatos ICE pendientes para ${userId}`);
                pc.pendingCandidates.forEach(candidate => {
                    ws.send(JSON.stringify({
                        type: 'signal',
                        room: roomCode,
                        target: userId,
                        payload: { candidate: candidate }
                    }));
                });
                pc.pendingCandidates = [];
            }
        } else if (pc.iceConnectionState === 'checking') {
            debugLog(`🔍 Verificando candidatos ICE para ${userId}`);
        } else if (pc.iceConnectionState === 'disconnected') {
            debugLog(`⚠️ Conexión ICE desconectada con ${userId}, esperando antes de reiniciar...`);
            // Esperar 5 segundos antes de intentar reconectar (puede reconectarse solo)
            if (!pc.reconnectTimeout) {
                pc.reconnectTimeout = setTimeout(() => {
                    if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
                        debugLog(`Intentando reiniciar PeerConnection para ${userId} (intento ${(pc.reconnectAttempts || 0) + 1})`);
                        restartPeerConnection(userId);
                    }
                    pc.reconnectTimeout = null;
                }, 5000);
            }
        } else if (pc.iceConnectionState === 'failed') {
            debugLog(`❌ Conexión ICE falló con ${userId}, reiniciando...`);
            if (pc.reconnectTimeout) {
                clearTimeout(pc.reconnectTimeout);
                pc.reconnectTimeout = null;
            }
            restartPeerConnection(userId);
        } else if (pc.iceConnectionState === 'closed') {
            debugLog(`🚪 Conexión ICE cerrada con ${userId}`);
            if (pc.reconnectTimeout) {
                clearTimeout(pc.reconnectTimeout);
                pc.reconnectTimeout = null;
            }
            removePeerConnection(userId);
            removeParticipant(userId);
        }
    };

    pc.onconnectionstatechange = () => {
        debugLog(`Estado de conexión general para ${userId}: ${pc.connectionState}`);
        if (pc.connectionState === 'failed') {
            debugLog(`Conexión general falló con ${userId}, intentando reconectar...`);
            restartPeerConnection(userId);
        }
    };

    return pc;
}

async function handleSignal(senderId, payload) {
    const existingPc = peerConnections[senderId];
    // ✅ IMPORTANTE: Si no hay localStream, esperar a que esté listo
    if (!localStream || !localStream.active) {
        await new Promise(resolve => setTimeout(resolve, 500));
        if (!localStream || !localStream.active) {
        }
    }
    
    const pc = existingPc || createPeerConnection(senderId);

    try {
        if (payload.sdp) {
            if (payload.sdp.type === 'offer') {
                // ✅ Manejar el caso de que ya tengamos una oferta pendiente
                if (pc.signalingState !== 'stable' && pc.signalingState !== 'have-remote-offer') {
                    await pc.setLocalDescription({ type: 'rollback' });
                }
                
                await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
                // ✅ Procesar candidatos ICE pendientes
                if (pc.pendingRemoteCandidates && pc.pendingRemoteCandidates.length > 0) {
                    for (const candidate of pc.pendingRemoteCandidates) {
                        try {
                            await pc.addIceCandidate(new RTCIceCandidate(candidate));
                        } catch (err) {
                        }
                    }
                    pc.pendingRemoteCandidates = [];
                }
                
                const answer = await pc.createAnswer({
                    offerToReceiveAudio: true,
                    offerToReceiveVideo: true
                });
                await pc.setLocalDescription(answer);
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'signal',
                        room: roomCode,
                        target: senderId,
                        payload: { sdp: pc.localDescription }
                    }));
                }
            } else if (payload.sdp.type === 'answer') {
                if (pc.signalingState === 'have-local-offer') {
                    await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
                    // ✅ Procesar candidatos ICE pendientes después de recibir answer
                    if (pc.pendingRemoteCandidates && pc.pendingRemoteCandidates.length > 0) {
                        for (const candidate of pc.pendingRemoteCandidates) {
                            try {
                                await pc.addIceCandidate(new RTCIceCandidate(candidate));
                            } catch (err) {
                            }
                        }
                        pc.pendingRemoteCandidates = [];
                    }
                } else {
                }
            }
        } else if (payload.candidate) {
            const candidateType = payload.candidate.candidate.includes('typ relay') ? 'TURN/RELAY ⭐' :
                payload.candidate.candidate.includes('typ srflx') ? 'STUN/SRFLX' :
                    payload.candidate.candidate.includes('typ host') ? 'HOST' : 'UNKNOWN';

            debugLog(`🔶 Candidato ICE recibido de ${senderId}:`);
            debugLog(`   Tipo: ${candidateType}`);
            
            // ✅ Preferir candidatos RELAY (TURN) para mejor conectividad
            if (candidateType === 'TURN/RELAY ⭐') {
            }

            try {
                // ✅ Solo agregar si tenemos remoteDescription
                if (pc.remoteDescription) {
                    await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
                    debugLog(`   ✅ Candidato agregado exitosamente`);
                } else {
                    // Guardar para después si no hay remoteDescription aún
                    if (!pc.pendingRemoteCandidates) {
                        pc.pendingRemoteCandidates = [];
                    }
                    pc.pendingRemoteCandidates.push(payload.candidate);
                }
            } catch (err) {
            }
        }
    } catch (e) {
        showError(`Error procesando señal de ${senderId}.`, 5000);
    }
}

async function restartPeerConnection(userId) {
    const pc = peerConnections[userId];
    if (!pc) {
        debugLog(`No se encontró PeerConnection para ${userId}, creando nueva...`);
        createPeerConnection(userId);
        return;
    }

    // Inicializar contador de intentos si no existe
    if (typeof pc.reconnectAttempts === 'undefined') {
        pc.reconnectAttempts = 0;
    }

    // Limitar intentos de reconexión (máximo 3)
    if (pc.reconnectAttempts >= 3) {
        debugLog(`❌ Máximo de intentos alcanzado para ${userId}, eliminando conexión`);
        removePeerConnection(userId);
        removeParticipant(userId);
        return;
    }

    // Evitar múltiples intentos simultáneos
    if (pc.restartInProgress) {
        debugLog(`Ya hay un reinicio en progreso para ${userId}`);
        return;
    }

    pc.restartInProgress = true;
    pc.reconnectAttempts++;
    debugLog(`Iniciando reinicio de conexión para ${userId} (intento ${pc.reconnectAttempts}/3)...`);

    try {
        // Timeout de 15 segundos para el reinicio
        const restartPromise = (async () => {
            const offer = await pc.createOffer({ iceRestart: true });
            await pc.setLocalDescription(offer);
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'signal',
                    room: roomCode,
                    target: userId,
                    payload: { sdp: pc.localDescription }
                }));
                debugLog(`Reinicio ICE enviado a ${userId}`);
            } else {
                throw new Error('WebSocket no está abierto');
            }
        })();

        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout en reinicio de conexión')), 15000)
        );

        await Promise.race([restartPromise, timeoutPromise]);

    } catch (e) {
        debugLog(`Intento fallido de reinicio para ${userId}, recreando conexión...`);

        // Si falla el reinicio, eliminar y recrear la conexión
        removePeerConnection(userId);

        // Esperar un poco antes de recrear
        setTimeout(() => {
            if (!peerConnections[userId]) {
                const newPc = createPeerConnection(userId);
                if (newPc && ws && ws.readyState === WebSocket.OPEN) {
                    newPc.createOffer()
                        .then(offer => newPc.setLocalDescription(offer))
                        .then(() => {
                            ws.send(JSON.stringify({
                                type: 'signal',
                                room: roomCode,
                                target: userId,
                                payload: { sdp: newPc.localDescription }
                            }));
                            debugLog(`Nueva oferta enviada a ${userId} después de recrear conexión`);
                        })
                        .catch(err => console.error(`Error creando nueva oferta para ${userId}:`, err));
                }
            }
        }, 1000);
    } finally {
        if (pc) {
            pc.restartInProgress = false;
        }
    }
}

function removePeerConnection(userId) {
    // ✅ Limpiar el analyser de audio al desconectar
    removeAudioStreamFromAnalysis(userId);
    
    if (peerConnections[userId]) {
        peerConnections[userId].close();
        delete peerConnections[userId];
        debugLog(`PeerConnection con ${userId} cerrado y eliminado.`);
    }
}

document.getElementById('toggleMic')?.addEventListener('click', () => {
    isMicActive = !isMicActive;

    // 🎤 Actualizar tracks de audio locales
    if (localStream) {
        const audioTracks = localStream.getAudioTracks();
        audioTracks.forEach(track => {
            track.enabled = isMicActive;
        });

        // 🔊 Verificar que los senders tienen el audio
        Object.keys(peerConnections).forEach(userId => {
            const pc = peerConnections[userId];
            const audioSender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
            if (audioSender) {
            } else {
            }
        });
    }

    document.getElementById('toggleMic').classList.toggle('active', isMicActive);
    participantStates[userName].micActive = isMicActive;
    showError(isMicActive ? 'Micrófono Activado' : 'Micrófono Silenciado', 2000);
    debugLog(`Micrófono ${isMicActive ? 'activado' : 'silenciado'}.`);
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'participant-state-update',
            room: roomCode,
            name: userName,
            micActive: isMicActive,
            camActive: isCamActive
        }));
    }
    updateParticipantList();
});

// ============ CAMERA TOGGLE CON DETECCIÓN DE ESTADO REAL ============
document.getElementById('toggleCam')?.addEventListener('click', async () => {
    const toggleCamBtn = document.getElementById('toggleCam');
    const localVideoElement = document.getElementById('localVideo');
    const localVideoPlaceholder = document.getElementById('localVideoPlaceholder');
    
    if (isCamActive) {
        // DESACTIVAR CÁMARA
        isCamActive = false;
        
        // Deshabilitar track de video (no lo detenemos para poder reactivar rápido)
        localStream?.getVideoTracks().forEach(track => {
            track.enabled = false;
        });
        
        // Actualizar UI
        if (toggleCamBtn) {
            toggleCamBtn.classList.remove('active');
            const icon = toggleCamBtn.querySelector('i');
            if (icon) icon.className = 'fas fa-video-slash';
        }
        
        // Mostrar placeholder si existe
        if (localVideoPlaceholder) {
            localVideoPlaceholder.style.display = 'flex';
        }
        if (localVideoElement) {
            localVideoElement.style.opacity = '0';
        }
        
        showError('Cámara Desactivada', 2000);
        
    } else {
        // ACTIVAR CÁMARA
        try {
            const videoTracks = localStream?.getVideoTracks();
            
            if (videoTracks && videoTracks.length > 0) {
                // Verificar estado del track
                const track = videoTracks[0];
                
                if (track.readyState === 'ended') {
                    // Track terminado, necesitamos obtener uno nuevo
                    const newStream = await navigator.mediaDevices.getUserMedia({
                        video: {
                            width: { ideal: 640, max: 1280 },
                            height: { ideal: 480, max: 720 },
                            frameRate: { ideal: 15, max: 30 }
                        }
                    });
                    
                    const newVideoTrack = newStream.getVideoTracks()[0];
                    if (newVideoTrack) {
                        // Reemplazar en localStream
                        localStream.getVideoTracks().forEach(t => {
                            localStream.removeTrack(t);
                            t.stop();
                        });
                        localStream.addTrack(newVideoTrack);
                        
                        // Reemplazar en peerConnections
                        for (const peerId in peerConnections) {
                            const pc = peerConnections[peerId];
                            const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
                            if (sender) {
                                await sender.replaceTrack(newVideoTrack);
                            }
                        }
                    }
                } else {
                    // Track disponible, solo activar
                    track.enabled = true;
                }
                
                isCamActive = true;
                
                // Actualizar UI
                if (toggleCamBtn) {
                    toggleCamBtn.classList.add('active');
                    const icon = toggleCamBtn.querySelector('i');
                    if (icon) icon.className = 'fas fa-video';
                }
                
                // Ocultar placeholder
                if (localVideoPlaceholder) {
                    localVideoPlaceholder.style.display = 'none';
                }
                if (localVideoElement) {
                    localVideoElement.style.opacity = '1';
                    localVideoElement.srcObject = localStream;
                }
                
                showError('Cámara Activada', 2000);
                
            } else {
                // No hay tracks de video, obtener uno nuevo
                const newStream = await navigator.mediaDevices.getUserMedia({ video: true });
                const newVideoTrack = newStream.getVideoTracks()[0];
                
                if (newVideoTrack) {
                    localStream.addTrack(newVideoTrack);
                    isCamActive = true;
                    
                    if (toggleCamBtn) {
                        toggleCamBtn.classList.add('active');
                        const icon = toggleCamBtn.querySelector('i');
                        if (icon) icon.className = 'fas fa-video';
                    }
                    
                    if (localVideoElement) {
                        localVideoElement.srcObject = localStream;
                        localVideoElement.style.opacity = '1';
                    }
                    if (localVideoPlaceholder) {
                        localVideoPlaceholder.style.display = 'none';
                    }
                    
                    showError('Cámara Activada', 2000);
                }
            }
            
        } catch (err) {
            if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
                showError('La cámara está siendo usada por otra aplicación', 4000);
            } else if (err.name === 'NotAllowedError') {
                showError('Permisos de cámara denegados', 4000);
            } else if (err.name === 'NotFoundError') {
                showError('No se encontró una cámara disponible', 4000);
            } else {
                showError('Error al activar la cámara: ' + err.message, 4000);
            }
            
            // Mantener estado en off
            isCamActive = false;
            if (toggleCamBtn) {
                toggleCamBtn.classList.remove('active');
                const icon = toggleCamBtn.querySelector('i');
                if (icon) icon.className = 'fas fa-video-slash';
            }
        }
    }
    
    // Actualizar estado del participante
    participantStates[userName].camActive = isCamActive;
    debugLog(`Cámara ${isCamActive ? 'activada' : 'apagada'}.`);
    
    // Notificar a otros participantes
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'participant-state-update',
            room: roomCode,
            name: userName,
            micActive: isMicActive,
            camActive: isCamActive
        }));
    }
    updateParticipantList();
});

// ============================================================================
// NUEVO HANDLER PARA COMPARTIR PANTALLA - CON MODAL DE SELECCIÓN Y PREVIEW
// ============================================================================

// Variables para el modal de compartir pantalla
let selectedShareType = null;
let previewStream = null; // Stream de preview antes de confirmar

document.getElementById('shareScreen')?.addEventListener('click', async () => {
    if (isScreenSharing) {
        await stopScreenSharing();
    } else {
        // Abrir el modal de selección de pantalla
        openScreenShareModal();
    }
});

function openScreenShareModal() {
    const modal = document.getElementById('screenShareModal');
    if (modal) {
        modal.classList.add('active');
        selectedShareType = null;
        previewStream = null;
        
        // Mostrar selector, ocultar preview
        document.getElementById('screenShareSelector').style.display = 'block';
        document.getElementById('screenSharePreviewContainer').style.display = 'none';
        document.getElementById('screenShareAudioOption').style.display = 'none';
        document.getElementById('confirmScreenShare').style.display = 'none';
        document.getElementById('changeScreenShare').style.display = 'none';
        
        // Resetear selecciones
        document.querySelectorAll('.screen-share-option').forEach(opt => {
            opt.classList.remove('selected');
        });
        document.getElementById('shareAudioCheckbox').checked = true;
    }
}

function closeScreenShareModal() {
    const modal = document.getElementById('screenShareModal');
    if (modal) {
        modal.classList.remove('active');
        
        // Si hay un preview stream activo que no se va a usar, detenerlo
        if (previewStream && !isScreenSharing) {
            previewStream.getTracks().forEach(track => track.stop());
            previewStream = null;
        }
        
        selectedShareType = null;
    }
}

// Función para solicitar el stream según el tipo seleccionado
async function requestScreenStream(shareType) {
    const typeLabels = {
        'screen': 'Pantalla completa',
        'window': 'Ventana',
        'tab': 'Pestaña del navegador'
    };
    
    try {
        // Configurar opciones según el tipo
        const displayMediaOptions = {
            video: { 
                cursor: 'always'
            },
            audio: true // Siempre solicitar audio, el usuario decide después
        };
        
        // Agregar preferencias según el tipo
        if (shareType === 'screen') {
            displayMediaOptions.video.displaySurface = 'monitor';
        } else if (shareType === 'window') {
            displayMediaOptions.video.displaySurface = 'window';
        } else if (shareType === 'tab') {
            displayMediaOptions.video.displaySurface = 'browser';
            displayMediaOptions.preferCurrentTab = false;
            displayMediaOptions.selfBrowserSurface = 'exclude';
            displayMediaOptions.systemAudio = 'include';
        }
        const stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
        return { stream, typeLabel: typeLabels[shareType] || shareType };
    } catch (err) {
        if (err.name === 'NotAllowedError') {
            showError('Permiso denegado para compartir pantalla', 3000);
        }
        return null;
    }
}

// Mostrar preview del stream seleccionado
function showStreamPreview(stream, typeLabel) {
    const previewContainer = document.getElementById('screenSharePreviewContainer');
    const previewVideo = document.getElementById('screenSharePreviewVideo');
    const previewTypeLabel = document.getElementById('previewTypeLabel');
    const selector = document.getElementById('screenShareSelector');
    const audioOption = document.getElementById('screenShareAudioOption');
    const confirmBtn = document.getElementById('confirmScreenShare');
    const changeBtn = document.getElementById('changeScreenShare');
    
    if (previewContainer && previewVideo) {
        // Asignar stream al video de preview
        previewVideo.srcObject = stream;
        previewTypeLabel.textContent = typeLabel;
        
        // Mostrar preview, ocultar selector
        selector.style.display = 'none';
        previewContainer.style.display = 'block';
        audioOption.style.display = 'block';
        confirmBtn.style.display = 'flex';
        changeBtn.style.display = 'flex';
        
        // Verificar si el stream tiene audio
        const hasAudio = stream.getAudioTracks().length > 0;
        const audioCheckbox = document.getElementById('shareAudioCheckbox');
        const audioNote = document.querySelector('.audio-note');
        
        if (hasAudio) {
            audioCheckbox.checked = true;
            audioCheckbox.disabled = false;
            audioNote.textContent = 'El audio de lo que compartes se escuchará en la reunión';
        } else {
            audioCheckbox.checked = false;
            audioCheckbox.disabled = true;
            audioNote.textContent = 'Este contenido no tiene audio disponible para compartir';
        }
    }
}

// Event listeners para el modal de compartir pantalla
document.addEventListener('DOMContentLoaded', () => {
    // Cerrar modal
    document.getElementById('closeScreenShareModal')?.addEventListener('click', closeScreenShareModal);
    document.getElementById('cancelScreenShare')?.addEventListener('click', closeScreenShareModal);
    
    // Cerrar al hacer clic fuera
    document.getElementById('screenShareModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'screenShareModal') {
            closeScreenShareModal();
        }
    });
    
    // Seleccionar tipo de pantalla - ahora solicita el stream inmediatamente
    document.querySelectorAll('.screen-share-option').forEach(option => {
        option.addEventListener('click', async () => {
            const shareType = option.dataset.shareType;
            selectedShareType = shareType;
            
            // Detener preview anterior si existe
            if (previewStream) {
                previewStream.getTracks().forEach(track => track.stop());
                previewStream = null;
            }
            
            // Solicitar el stream
            const result = await requestScreenStream(shareType);
            
            if (result && result.stream) {
                previewStream = result.stream;
                
                // Handler para cuando el usuario cancela desde el navegador
                previewStream.getVideoTracks()[0].onended = () => {
                    // Volver al selector
                    document.getElementById('screenShareSelector').style.display = 'block';
                    document.getElementById('screenSharePreviewContainer').style.display = 'none';
                    document.getElementById('screenShareAudioOption').style.display = 'none';
                    document.getElementById('confirmScreenShare').style.display = 'none';
                    document.getElementById('changeScreenShare').style.display = 'none';
                    previewStream = null;
                };
                
                showStreamPreview(result.stream, result.typeLabel);
            }
        });
    });
    
    // Botón "Cambiar" - volver al selector
    document.getElementById('changeScreenShare')?.addEventListener('click', () => {
        // Detener preview actual
        if (previewStream) {
            previewStream.getTracks().forEach(track => track.stop());
            previewStream = null;
        }
        
        // Mostrar selector, ocultar preview
        document.getElementById('screenShareSelector').style.display = 'block';
        document.getElementById('screenSharePreviewContainer').style.display = 'none';
        document.getElementById('screenShareAudioOption').style.display = 'none';
        document.getElementById('confirmScreenShare').style.display = 'none';
        document.getElementById('changeScreenShare').style.display = 'none';
    });
    
    // Botón de confirmar compartir
    document.getElementById('confirmScreenShare')?.addEventListener('click', async () => {
        if (!previewStream) return;
        
        const includeAudio = document.getElementById('shareAudioCheckbox')?.checked ?? true;
        
        // Si el usuario desactivó el audio, remover los tracks de audio
        if (!includeAudio) {
            previewStream.getAudioTracks().forEach(track => {
                track.stop();
                previewStream.removeTrack(track);
            });
        }
        
        // Cerrar modal y usar el stream de preview
        document.getElementById('screenShareModal').classList.remove('active');
        
        // Iniciar compartir con el stream ya capturado
        await startScreenSharingWithStream(previewStream);
        previewStream = null; // Ya fue transferido
    });
});

// Variable para rastrear quién está compartiendo pantalla actualmente
let currentScreenSharer = null;

// Nueva función que usa un stream ya capturado
async function startScreenSharingWithStream(stream) {
    // ✅ VALIDACIÓN: Verificar si alguien más ya está compartiendo
    if (currentScreenSharer && currentScreenSharer !== userName) {
        showError(`⚠️ ${currentScreenSharer} ya está compartiendo pantalla. Espera a que termine.`, 4000);
        stream.getTracks().forEach(track => track.stop());
        return;
    }
    
    const activeRemoteShares = Object.keys(remoteScreenStreams);
    if (activeRemoteShares.length > 0) {
        const sharerName = activeRemoteShares[0];
        showError(`⚠️ ${sharerName} ya está compartiendo pantalla. Espera a que termine.`, 4000);
        stream.getTracks().forEach(track => track.stop());
        return;
    }
    
    try {
        localScreenStream = stream;
        isScreenSharing = true;
        currentScreenSharer = userName;
        document.getElementById('shareScreen')?.classList.add('active');

        // 1. Mostrar preview local
        createScreenSharePreview(userName, localScreenStream);

        // Silenciar el video local de pantalla para evitar eco
        const myVideo = document.getElementById(`screen-video-${userName}`);
        if (myVideo) {
            myVideo.muted = true;
            myVideo.volume = 0;
        }

        // 2. Notificar al servidor
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'screen-share-started',
                room: roomCode,
                userId: userName,
                streamId: localScreenStream.id
            }));
        }

        // 3. Añadir tracks a todas las conexiones
        const videoTrack = localScreenStream.getVideoTracks()[0];
        const audioTrack = localScreenStream.getAudioTracks()[0];
        for (const peerId in peerConnections) {
            const pc = peerConnections[peerId];
            if (videoTrack) {
                try {
                    pc.addTrack(videoTrack, localScreenStream);
                } catch (e) {
                }
            }
            if (audioTrack) {
                try {
                    pc.addTrack(audioTrack, localScreenStream);
                } catch (e) {
                }
            }

            // Renegociar
            await renegotiate(peerId, pc);
        }

        // Handler para cuando el usuario detiene desde los controles del navegador
        videoTrack.onended = () => {
            stopScreenSharing();
        };

        showError('✅ Compartiendo pantalla', 2000);
    } catch (err) {
        showError('Error al compartir pantalla: ' + err.message, 5000);
        isScreenSharing = false;
        currentScreenSharer = null;
        document.getElementById('shareScreen')?.classList.remove('active');
    }
}

// Función legacy para compatibilidad (ahora redirige al modal)
async function startScreenSharing(shareType = 'screen', includeAudio = true) {
    // ✅ VALIDACIÓN: Verificar si alguien más ya está compartiendo
    if (currentScreenSharer && currentScreenSharer !== userName) {
        showError(`⚠️ ${currentScreenSharer} ya está compartiendo pantalla. Espera a que termine.`, 4000);
        return;
    }
    
    // Verificar si hay screen shares remotos activos
    const activeRemoteShares = Object.keys(remoteScreenStreams);
    if (activeRemoteShares.length > 0) {
        const sharerName = activeRemoteShares[0];
        showError(`⚠️ ${sharerName} ya está compartiendo pantalla. Espera a que termine.`, 4000);
        return;
    }
    
    try {
        // Configurar las constraints según el tipo de pantalla
        const displayMediaOptions = {
            video: { 
                cursor: 'always'
            },
            audio: includeAudio ? {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                sampleRate: 48000
            } : false
        };
        
        // Agregar preferencias según el tipo
        if (shareType === 'screen') {
            displayMediaOptions.video.displaySurface = 'monitor';
        } else if (shareType === 'window') {
            displayMediaOptions.video.displaySurface = 'window';
        } else if (shareType === 'tab') {
            displayMediaOptions.video.displaySurface = 'browser';
            // Para pestañas, el audio es más confiable
            if (includeAudio) {
                displayMediaOptions.preferCurrentTab = false;
                displayMediaOptions.selfBrowserSurface = 'exclude';
                displayMediaOptions.systemAudio = 'include';
            }
        }
        
        localScreenStream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);

        isScreenSharing = true;
        currentScreenSharer = userName;
        document.getElementById('shareScreen')?.classList.add('active');

        // 1. Mostrar preview local
        createScreenSharePreview(userName, localScreenStream);

        // Silenciar el video local de pantalla para evitar eco/feedback (solo para el presentador)
        const myVideo = document.getElementById(`screen-video-${userName}`);
        if (myVideo) {
            myVideo.muted = true;
            myVideo.volume = 0;
        }

        // 2. Notificar al servidor (IMPORTANTE: Antes de negociar)
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'screen-share-started',
                room: roomCode,
                userId: userName,
                streamId: localScreenStream.id
            }));
        }

        // 3. Añadir tracks a todas las conexiones
        const videoTrack = localScreenStream.getVideoTracks()[0];
        const audioTrack = localScreenStream.getAudioTracks()[0];
        for (const peerId in peerConnections) {
            const pc = peerConnections[peerId];
            if (videoTrack) {
                try {
                    const sender = pc.addTrack(videoTrack, localScreenStream);
                } catch (e) {
                }
            }
            if (audioTrack) {
                try {
                    const sender = pc.addTrack(audioTrack, localScreenStream);
                } catch (e) {
                }
            }

            // Renegociar
            await renegotiate(peerId, pc);
        }

        // 4. Manejar parada desde el navegador
        videoTrack.onended = () => {
            if (isScreenSharing) stopScreenSharing();
        };

        showError('✅ Compartiendo pantalla', 2000);

    } catch (err) {
        isScreenSharing = false;
        localScreenStream = null;
        if (err.name !== 'NotAllowedError') {
            showError('Error al compartir pantalla', 3000);
        }
    }
}

async function stopScreenSharing() {
    if (!localScreenStream) return;

    // 1. Detener tracks
    localScreenStream.getTracks().forEach(t => t.stop());

    // 2. Remover tracks de las conexiones
    for (const peerId in peerConnections) {
        const pc = peerConnections[peerId];
        const senders = pc.getSenders();

        for (const sender of senders) {
            if (sender.track && sender.track.kind === 'video' && sender.track.label === localScreenStream.getVideoTracks()[0]?.label) {
                pc.removeTrack(sender);
            }
            // También remover audio track de screen share si existe
            if (sender.track && sender.track.kind === 'audio' && localScreenStream.getAudioTracks().some(t => t.label === sender.track.label)) {
                pc.removeTrack(sender);
            }
        }

        // Renegociar
        await renegotiate(peerId, pc);
    }

    // 3. Limpiar UI y estado
    removeScreenSharePreview(userName);
    isScreenSharing = false;
    currentScreenSharer = null; // ✅ Limpiar el tracker
    localScreenStream = null;
    document.getElementById('shareScreen')?.classList.remove('active');

    // Restaurar vista normal
    if (typeof setViewMode === 'function') {
        setViewMode('grid-auto');
    } else if (window.ViewControl && typeof window.ViewControl.setViewMode === 'function') {
        window.ViewControl.setViewMode('grid-auto');
    }

    // 4. Notificar servidor
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'screen-share-stopped',
            room: roomCode,
            userId: userName
        }));
    }

    showError('Pantalla compartida detenida', 2000);
}

async function renegotiate(peerId, pc) {
    if (pc.signalingState !== 'stable') {
        return;
    }

    try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'signal',
                room: roomCode,
                target: peerId,
                payload: { sdp: pc.localDescription }
            }));
        } else {
        }
    } catch (e) {
    }
}

function stopRemoteScreenShare(userId) {
    removeScreenSharePreview(userId);
}

function openPollCreationModal() {
    const pollCreationModal = document.getElementById('pollCreationModal');
    if (pollCreationModal) {
        pollCreationModal.style.display = 'block';
        document.getElementById('pollQuestionInput').value = '';
        const optionsContainer = document.getElementById('pollOptionsContainer');
        optionsContainer.innerHTML = '';
        addPollOption();
        addPollOption();
        debugLog('Modal de creación de votación abierto.');
    } else {
        showError('Error interno: No se pudo abrir el creador de votaciones.', 5000);
    }
}

function addPollOption() {
    const optionsContainer = document.getElementById('pollOptionsContainer');
    if (!optionsContainer) {
        return;
    }
    const optionDiv = document.createElement('div');
    optionDiv.className = 'option-input';
    optionDiv.innerHTML = `
        <input type="text" class="poll-option-input" placeholder="Opción de respuesta" required>
        <button type="button" class="remove-option-btn">✖️</button>
    `;
    optionsContainer.appendChild(optionDiv);

    optionDiv.querySelector('.remove-option-btn')?.addEventListener('click', (e) => {
        if (optionsContainer.querySelectorAll('.option-input').length > 2) {
            e.target.closest('.option-input').remove();
            debugLog('Opción de votación eliminada.');
        } else {
            showError('Debe haber al menos dos opciones.', 3000);
        }
    });
    debugLog('Opción de votación añadida.');
}

document.getElementById('addOptionBtn')?.addEventListener('click', addPollOption);

// Función para limpiar el formulario de creación de encuestas
function clearPollCreationForm() {
    document.getElementById('pollQuestionInput').value = '';
    document.getElementById('pollDurationInput').value = '60';

    const container = document.getElementById('pollOptionsContainer');
    container.innerHTML = '';

    // Recrear las dos opciones por defecto
    for (let i = 1; i <= 2; i++) {
        const optionDiv = document.createElement('div');
        optionDiv.className = 'option-input';
        optionDiv.innerHTML = `
            <input type="text" class="poll-option-input" placeholder="Opción ${i}" required aria-required="true">
            <button class="remove-option-btn" aria-label="Eliminar opción">
                <i class="fas fa-times"></i>
            </button>
        `;
        container.appendChild(optionDiv);
    }

    // Re-adjuntar eventos a los botones de eliminar
    document.querySelectorAll('.remove-option-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const optionInput = this.closest('.option-input');
            if (document.querySelectorAll('.poll-option-input').length > 2) {
                optionInput.remove();
                debugLog('Opción de votación eliminada.');
            } else {
                showError('Necesitas al menos dos opciones.', 3000);
            }
        });
    });

    debugLog('Formulario de creación de encuesta limpiado.');
}

document.getElementById('startPollBtn')?.addEventListener('click', () => {
    const question = document.getElementById('pollQuestionInput').value.trim();
    const options = [];
    document.querySelectorAll('.poll-option-input').forEach((input, index) => {
        const text = input.value.trim();
        if (text) {
            options.push({ id: index, text: text });
        }
    });

    if (!question) {
        showError('La pregunta de la votación no puede estar vacía.', 3000);
        return;
    }
    if (options.length < 2) {
        showError('Necesitas al menos dos opciones para la votación.', 3000);
        return;
    }

    const durationInput = document.getElementById('pollDurationInput');
    const duration = parseInt(durationInput.value) || 60;

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'start-poll',
            room: roomCode,
            poll: {
                id: Date.now().toString(),
                question: question,
                options: options,
                duration: duration
            }
        }));
        document.getElementById('pollCreationModal').style.display = 'none';
        document.getElementById('pollCreationModal').classList.remove('minimized');
        clearPollCreationForm(); // Limpiar el formulario después de enviar
        showError('Votación iniciada y enviada.', 3000);
        debugLog('Votación enviada al servidor:', { question: question, options: options, duration: duration });
    } else {
        showError('No se pudo iniciar la votación: Conexión con el servidor no establecida.', 5000);
    }
});

function displayPollForParticipant(poll) {
    debugLog('displayPollForParticipant llamado con votación:', poll);
    const pollPanel = document.getElementById('pollPanel');
    const submitVoteButton = document.getElementById('submitVoteBtn');

    if (!pollPanel || !submitVoteButton) {
        showError('Error interno: Panel de votación no encontrado.', 5000);
        return;
    }

    if (!poll || !poll.question || !poll.options || !Array.isArray(poll.options)) {
        showError('No se pudo mostrar la votación: Datos incompletos o incorrectos.', 5000);
        return;
    }

    document.getElementById('pollQuestionDisplay').textContent = poll.question;
    const optionsDisplay = document.getElementById('pollOptionsDisplay');
    optionsDisplay.innerHTML = '';
    poll.options.forEach((option, index) => {
        const label = document.createElement('label');
        label.className = 'poll-option-item';
        label.innerHTML = `<input type="radio" name="pollOption" value="${option.id !== undefined ? option.id : index}"> <span>${option.text}</span>`;
        optionsDisplay.appendChild(label);
    });

    pollPanel.style.display = 'block';
    pollPanel.classList.remove('minimized');
    debugLog('Panel de votación visible para el usuario.');

    // Asegurar que el poll tenga endTime válido. Si el servidor no lo envió, calcularlo desde duration.
    const currentTime = Date.now();
    let endTime = Number(poll.endTime);
    if (!endTime || isNaN(endTime) || endTime <= 0) {
        const duration = parseInt(poll.duration) || (poll.duration === 0 ? 0 : null);
        if (duration && duration > 0) {
            endTime = Date.now() + (duration * 1000);
            // Propagar endTime al objeto poll y al currentPoll global si existe
            poll.endTime = endTime;
            if (currentPoll && currentPoll.id === poll.id) currentPoll.endTime = endTime;
            debugLog('⚠️ endTime no estaba definido. Calculado localmente desde duration:', duration, 'endTime:', endTime);
        }
    }

    const remainingTimeSeconds = endTime ? Math.max(0, Math.ceil((endTime - currentTime) / 1000)) : 0;

    if (remainingTimeSeconds === 0 && !isModerator) {
        // Si no hay tiempo restante, ocultar votación para participantes
        showError('La votación ha terminado.', 3000);
        submitVoteButton.disabled = true;
        document.querySelectorAll('.poll-option-item input[type="radio"]').forEach(radio => radio.disabled = true);
    } else {
        submitVoteButton.disabled = false;
        document.querySelectorAll('.poll-option-item input[type="radio"]').forEach(radio => radio.disabled = false);
        // Iniciar temporizador con la cantidad exacta de segundos
        startPollTimer(remainingTimeSeconds);
    }

    if (isModerator) {
        document.getElementById('pollCreationModal').style.display = 'none';
        if (remainingTimeSeconds === 0) {
            // Usar los votos guardados si existen
            displayPollResults(poll.results, poll.question, poll.options, poll.votes);
        }
    }
}

// Variable para rastrear notificaciones de votos pendientes
let pendingVoteNotifications = 0;

// Función para actualizar notificación en modal minimizado
function updateMinimizedPollNotification(newVotes) {
    pendingVoteNotifications += newVotes;
    
    const pollResultsPanel = document.getElementById('pollResultsPanel');
    if (!pollResultsPanel) return;
    
    // Buscar o crear el badge de notificación
    let notificationBadge = pollResultsPanel.querySelector('.poll-notification-badge');
    
    if (!notificationBadge) {
        notificationBadge = document.createElement('span');
        notificationBadge.className = 'poll-notification-badge';
        notificationBadge.style.cssText = `
            position: absolute;
            top: -8px;
            right: -8px;
            background: linear-gradient(135deg, #ef4444, #dc2626);
            color: white;
            font-size: 12px;
            font-weight: 700;
            min-width: 22px;
            height: 22px;
            border-radius: 11px;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 0 6px;
            box-shadow: 0 2px 8px rgba(239, 68, 68, 0.5);
            animation: pollBadgePulse 0.5s ease-out;
            z-index: 10;
        `;
        
        // Agregar animación si no existe
        if (!document.getElementById('pollBadgeAnimation')) {
            const style = document.createElement('style');
            style.id = 'pollBadgeAnimation';
            style.textContent = `
                @keyframes pollBadgePulse {
                    0% { transform: scale(0); }
                    50% { transform: scale(1.3); }
                    100% { transform: scale(1); }
                }
            `;
            document.head.appendChild(style);
        }
        
        // Agregar al modal-content para que se posicione relativo a él
        const modalContent = pollResultsPanel.querySelector('.modal-content');
        if (modalContent) {
            modalContent.style.position = 'relative';
            modalContent.appendChild(notificationBadge);
        }
    }
    
    notificationBadge.textContent = pendingVoteNotifications > 99 ? '99+' : pendingVoteNotifications;
    notificationBadge.style.display = 'flex';
    
    // Re-animar
    notificationBadge.style.animation = 'none';
    notificationBadge.offsetHeight; // Trigger reflow
    notificationBadge.style.animation = 'pollBadgePulse 0.5s ease-out';
}

// Función para limpiar notificaciones cuando se abre el modal
function clearPollNotifications() {
    pendingVoteNotifications = 0;
    const pollResultsPanel = document.getElementById('pollResultsPanel');
    if (pollResultsPanel) {
        const badge = pollResultsPanel.querySelector('.poll-notification-badge');
        if (badge) {
            badge.style.display = 'none';
        }
    }
}

function startPollTimer(durationSeconds) {
    const timerDisplay = document.getElementById('pollTimerDisplay');
    const submitVoteButton = document.getElementById('submitVoteBtn');
    if (!timerDisplay || !submitVoteButton) return;

    // ✅ Verificar que currentPoll existe antes de acceder a sus propiedades
    if (currentPoll?.timerInterval) {
        clearInterval(currentPoll.timerInterval);
    }

    let seconds = durationSeconds;
    let intervalId = null; // ✅ Guardar referencia local al intervalo

    const updateTimer = () => {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        timerDisplay.textContent = `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;

        if (seconds <= 0) {
            // ✅ Usar la referencia local en lugar de currentPoll
            if (intervalId) {
                clearInterval(intervalId);
                intervalId = null;
            }
            timerDisplay.textContent = "¡Tiempo terminado!";
            submitVoteButton.disabled = true;
            document.querySelectorAll('.poll-option-item input[type="radio"]').forEach(radio => radio.disabled = true);
            showError('La votación ha terminado.', 3000);

            if (isModerator && currentPoll && ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'end-poll',
                    room: roomCode,
                    pollId: currentPoll.id
                }));
                debugLog('Cliente moderador envió end-poll debido a la expiración del temporizador.');
            }
        } else {
            seconds--;
        }
    };

    updateTimer();
    intervalId = setInterval(updateTimer, 1000);

    // ✅ Guardar referencia también en currentPoll si existe
    if (currentPoll) {
        currentPoll.timerInterval = intervalId;
    }
}

function hidePollForParticipant() {
    const pollPanel = document.getElementById('pollPanel');
    if (pollPanel) {
        pollPanel.style.display = 'none';
        pollPanel.classList.remove('minimized');
        debugLog('Votación oculta para participante.');
    }

    // ✅ LIMPIAR TIMERS PERO NO MARCAR COMO ENDED (para seguir recibiendo actualizaciones)
    stopAllPollTimers(false);
    
    document.getElementById('submitVoteBtn').disabled = true;
    document.querySelectorAll('.poll-option-item input[type="radio"]').forEach(radio => radio.disabled = true);
}

function displayPollResults(results, question, options, votes) {
    debugLog('displayPollResults llamado con resultados:', results, 'pregunta:', question, 'opciones:', options, 'votos:', votes);
    const pollResultsPanel = document.getElementById('pollResultsPanel');
    if (!pollResultsPanel) {
        showError('Error interno: Panel de resultados de votación no encontrado.', 5000);
        return;
    }

    if (!question || !options || !Array.isArray(options)) {
        showError('No se pudo mostrar los resultados de la votación: Datos incompletos o incorrectos.', 5000);
        return;
    }

    document.getElementById('resultsPollQuestion').textContent = question;
    pollResultsPanel.style.display = 'flex';
    pollResultsPanel.classList.remove('minimized');
    debugLog('Panel de resultados de votación visible para moderador.');

    // Add event listener for minimize button
    const minimizeResultsBtn = document.getElementById('minimizeResultsBtn');
    if (minimizeResultsBtn) {
        minimizeResultsBtn.addEventListener('click', togglePollResultsPanel);
    }

    // Calcular totales
    const dataCounts = options.map(opt => results[opt.id] || 0);
    const totalVotes = dataCounts.reduce((sum, count) => sum + count, 0);

    // Renderizar barras de progreso horizontales
    const chartContainer = document.getElementById('chartContainerResults');
    if (chartContainer) {
        chartContainer.innerHTML = ''; // Limpiar contenido previo

        options.forEach((option, index) => {
            const voteCount = results[option.id] || 0;
            const percentage = totalVotes > 0 ? ((voteCount / totalVotes) * 100).toFixed(1) : 0;
            const barClass = `bar-fill-results-${(index % 5) + 1}`;

            const optionBarHTML = `
                <div class="option-bar-results">
                    <div class="option-header-results">
                        <span class="option-label-results">${option.text}</span>
                        <div class="option-stats-results">
                            <span class="vote-count-results">${voteCount} voto${voteCount !== 1 ? 's' : ''}</span>
                            <span class="percentage-results">${percentage}%</span>
                        </div>
                    </div>
                    <div class="bar-track-results">
                        <div class="${barClass} bar-fill-results" style="width: ${percentage}%;"></div>
                    </div>
                </div>
            `;
            chartContainer.innerHTML += optionBarHTML;
        });

        debugLog('Barras de resultados de votación renderizadas.');
    } else {
        showError('No se pudo mostrar el gráfico de resultados de votación.', 5000);
    }

    // Renderizar lista de votantes con avatares
    const votesList = document.getElementById('votesList');
    if (votesList && votes && Array.isArray(votes) && votes.length > 0) {
        votesList.innerHTML = '';
        votes.forEach(vote => {
            const li = document.createElement('li');
            li.className = 'voter-item-results';

            // Crear avatar con inicial del nombre
            const initial = vote.voter ? vote.voter.charAt(0).toUpperCase() : '?';
            const avatar = document.createElement('div');
            avatar.className = 'voter-avatar-results';
            avatar.textContent = initial;

            const voterName = document.createElement('span');
            voterName.className = 'voter-name-results';
            voterName.textContent = `${vote.voter} → ${vote.optionText}`;

            li.appendChild(avatar);
            li.appendChild(voterName);
            votesList.appendChild(li);
        });
    } else if (votesList) {
        votesList.innerHTML = '<p style="margin-top: 20px; color: var(--text-tertiary); text-align: center; font-style: italic;">No hay votos registrados aún.</p>';
    }

    // Actualizar información del estado minimizado
    const minimizedVoteCount = document.getElementById('minimizedVoteCount');
    if (minimizedVoteCount) {
        minimizedVoteCount.textContent = `${totalVotes} voto${totalVotes !== 1 ? 's' : ''}`;
    }

    if (isModerator && currentPoll && currentPoll.endTime) {
        const pollResultsTimer = document.getElementById('pollResultsTimer');
        if (pollResultsTimer) pollResultsTimer.style.display = 'inline-flex';
        const remainingTime = Math.max(0, Math.floor((currentPoll.endTime - Date.now()) / 1000));
        startResultsTimer(remainingTime);

        const endPollBtn = document.getElementById('endPollBtn');
        if (endPollBtn) {
            if (remainingTime > 0) {
                endPollBtn.style.display = 'block';
            } else {
                endPollBtn.style.display = 'none';
            }
        }
        
        // Mostrar botón de compartir resultados para moderadores
        const shareResultsBtn = document.getElementById('shareResultsBtn');
        if (shareResultsBtn) {
            shareResultsBtn.style.display = 'block';
        }
        
        document.getElementById('closePollResultsPanel').style.display = 'block';
    } else if (!isModerator) {
        document.getElementById('closeResultsBtn').style.display = 'block';
        document.getElementById('endPollBtn').style.display = 'none';
        // Ocultar botón de compartir para no-moderadores
        const shareResultsBtn = document.getElementById('shareResultsBtn');
        if (shareResultsBtn) shareResultsBtn.style.display = 'none';
    }
}

function startResultsTimer(durationSeconds) {
    const timerDisplay = document.getElementById('pollResultsTimer');
    const minimizedTimer = document.getElementById('minimizedTimer');
    const minimizedTimerValue = document.getElementById('minimizedTimerValue');
    
    if (!timerDisplay) return;

    // ✅ Verificar que currentPoll existe antes de acceder a sus propiedades
    if (currentPoll?.resultsTimerInterval) {
        clearInterval(currentPoll.resultsTimerInterval);
    }

    let seconds = durationSeconds;
    let intervalId = null; // ✅ Guardar referencia local al intervalo

    const updateTimer = () => {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        const timeText = `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
        
        timerDisplay.textContent = timeText;
        if (minimizedTimerValue) {
            minimizedTimerValue.textContent = timeText;
        }
        
        // Mostrar u ocultar el timer minimizado según si hay tiempo
        if (minimizedTimer) {
            minimizedTimer.style.display = seconds > 0 ? 'inline-flex' : 'none';
        }

        if (seconds <= 0) {
            // ✅ Usar la referencia local en lugar de currentPoll
            if (intervalId) {
                clearInterval(intervalId);
                intervalId = null;
            }
            timerDisplay.textContent = "¡Votación terminada!";
            if (minimizedTimer) {
                minimizedTimer.style.display = 'none';
            }
            if (isModerator) {
                document.getElementById('endPollBtn').style.display = 'none';
            }
        } else {
            seconds--;
        }
    };

    updateTimer();
    intervalId = setInterval(updateTimer, 1000);

    // ✅ Guardar referencia también en currentPoll si existe
    if (currentPoll) {
        currentPoll.resultsTimerInterval = intervalId;
    }
}

function togglePollResultsPanel() {
    const pollResultsPanel = document.getElementById('pollResultsPanel');
    if (pollResultsPanel) {
        pollResultsPanel.classList.toggle('minimized');
        debugLog(`Poll results panel ${pollResultsPanel.classList.contains('minimized') ? 'minimized' : 'restored'}.`);
    }
}

document.getElementById('submitVoteBtn')?.addEventListener('click', () => {
    if (!currentPoll) {
        showError('No hay votación activa para votar.', 3000);
        return;
    }
    if (hasVoted) {
        showError('Ya has votado en esta votación.', 3000);
        return;
    }

    if (currentPoll.endTime && Date.now() > currentPoll.endTime) {
        showError('La votación ha terminado y no se puede votar.', 3000);
        hidePollForParticipant();
        return;
    }

    const selectedOption = document.querySelector('input[name="pollOption"]:checked');
    if (!selectedOption) {
        showError('Por favor, selecciona una opción para votar.', 3000);
        return;
    }

    const vote = {
        pollId: currentPoll.id,
        optionId: parseInt(selectedOption.value),
        optionText: selectedOption.nextElementSibling.textContent,
        voter: userName
    };

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'submit-vote', room: roomCode, vote: vote }));
        debugLog('Voto enviado al servidor:', vote);
    } else {
        showError('No se pudo enviar el voto: Conexión con el servidor no establecida.', 5000);
    }
});

document.getElementById('skipVoteBtn')?.addEventListener('click', () => {
    hidePollForParticipant();
    showError('Voto omitido.', 3000);
    debugLog('Voto omitido.');
});

document.getElementById('endPollBtn')?.addEventListener('click', () => {
    if (!isModerator) {
        showError('Solo los moderadores pueden finalizar la votación.', 3000);
        return;
    }
    if (!currentPoll) {
        showError('No hay votación activa para finalizar.', 3000);
        return;
    }

    // ✅ USAR FUNCIÓN CENTRALIZADA PARA LIMPIAR TIMERS
    stopAllPollTimers();

    // Marcar la votación como finalizada
    currentPoll.ended = true;
    currentPoll.endTime = Date.now();

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'end-poll',
            room: roomCode,
            pollId: currentPoll.id
        }));
        showError('Votación finalizada manualmente.', 3000);
        debugLog('Votación finalizada manualmente por moderador.');
        
        // Ocultar botón de finalizar y timer
        document.getElementById('endPollBtn').style.display = 'none';
        const pollResultsTimer = document.getElementById('pollResultsTimer');
        if (pollResultsTimer) {
            pollResultsTimer.textContent = '¡Votación terminada!';
            pollResultsTimer.style.display = 'inline-flex';
        }
        const minimizedTimer = document.getElementById('minimizedTimer');
        if (minimizedTimer) minimizedTimer.style.display = 'none';
        
        hidePollForParticipant();
    } else {
        showError('No se pudo finalizar la votación: Conexión con el servidor no establecida.', 5000);
    }
});

document.querySelector('#pollPanel .minimize-btn')?.addEventListener('click', () => {
    const pollPanel = document.getElementById('pollPanel');
    if (pollPanel) {
        pollPanel.classList.toggle('minimized');
        debugLog('Panel de votación minimizado/restaurado.');
    }
});

document.querySelector('#pollPanel .close-poll-btn')?.addEventListener('click', () => {
    hidePollForParticipant();
    showError('Votación cerrada por el usuario.', 3000);
    debugLog('Panel de votación cerrado por el usuario.');
});

document.getElementById('closePollResultsPanel')?.addEventListener('click', () => {
    const pollResultsPanel = document.getElementById('pollResultsPanel');
    if (pollResultsPanel) {
        pollResultsPanel.style.display = 'none';
        if (pollChart) {
            pollChart.destroy();
            pollChart = null;
        }
        // ✅ USAR FUNCIÓN CENTRALIZADA PARA LIMPIAR TIMERS
        stopAllPollTimers();
        debugLog('Panel de resultados de votación cerrado.');
    }
});

document.getElementById('closeResultsBtn')?.addEventListener('click', () => {
    const pollResultsPanel = document.getElementById('pollResultsPanel');
    if (pollResultsPanel) {
        pollResultsPanel.style.display = 'none';
        if (pollChart) {
            pollChart.destroy();
            pollChart = null;
        }
        if (currentPoll?.resultsTimerInterval) {
            clearInterval(currentPoll.resultsTimerInterval);
            currentPoll.resultsTimerInterval = null;
        }
        debugLog('Panel de resultados de votación cerrado (participante).');
    }
});

// ✅ Botón para compartir resultados con todos los participantes
document.getElementById('shareResultsBtn')?.addEventListener('click', () => {
    if (!isModerator) {
        showError('Solo los moderadores pueden compartir resultados.', 3000);
        return;
    }
    if (!currentPoll) {
        showError('No hay votación activa para compartir.', 3000);
        return;
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'broadcast-results',
            room: roomCode,
            pollId: currentPoll.id,
            poll: {
                id: currentPoll.id,
                question: currentPoll.question,
                options: currentPoll.options,
                results: currentPoll.results,
                totalVotes: currentPoll.totalVotes || 0,
                voters: currentPoll.voters || [],
                ended: currentPoll.ended || false
            }
        }));
        showError('✅ Resultados compartidos con todos los participantes.', 3000);
        debugLog('[POLL] Resultados compartidos con todos.');
    } else {
        showError('No se pudo compartir: Conexión no establecida.', 5000);
    }
});

// Función para monitorear salud de las conexiones
// ✅ OPTIMIZADO: Solo ejecuta si hay conexiones activas
async function checkConnectionsHealth() {
    const connections = Object.entries(peerConnections);
    
    // ✅ Salida temprana si no hay conexiones
    if (connections.length === 0) return;
    
    if (DEBUG_MODE) debugLog('🔍 Verificando salud de las conexiones...');

    for (const [userId, pc] of connections) {
        if (!pc) continue;

        const iceState = pc.iceConnectionState;
        const connectionState = pc.connectionState;

        debugLog(`Conexión con ${userId}: ICE=${iceState}, Connection=${connectionState}`);

        // Si la conexión está en mal estado, intentar obtener estadísticas
        if (iceState === 'disconnected' || iceState === 'failed' || connectionState === 'disconnected' || connectionState === 'failed') {
            debugLog(`⚠️ Conexión en mal estado con ${userId}, verificando estadísticas...`);

            try {
                const stats = await pc.getStats();
                let hasActiveConnection = false;

                stats.forEach(report => {
                    if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                        hasActiveConnection = true;
                        debugLog(`✅ Encontrado par de candidatos activo para ${userId}`);
                    }
                });

                if (!hasActiveConnection && (iceState === 'disconnected' || iceState === 'failed')) {
                    debugLog(`❌ No hay conexión activa con ${userId}, intentando reiniciar...`);
                    restartPeerConnection(userId);
                }
            } catch (e) {
            }
        } else if (iceState === 'connected' || iceState === 'completed') {
            // Conexión saludable, resetear contador de intentos
            if (pc.reconnectAttempts > 0) {
                debugLog(`✅ Conexión restablecida con ${userId}, reseteando intentos`);
                pc.reconnectAttempts = 0;
            }
        }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    if (DEBUG_MODE) {
    }

    if (!roomCode) {
        showError('Código de sala no proporcionado en la URL. Redirigiendo...', 5000);
        debugLog('Código de sala no encontrado. Redirigiendo.');
        setTimeout(() => window.location.href = '/', 3000);
        return;
    }

    // ============ ESPERAR A QUE EL LOBBY COMPLETE ============
    // Si hay un sistema de lobby, esperar hasta que el usuario haga click en "Unirme"
    const lobbyScreen = document.getElementById('lobbyScreen');

    // Check for a recent local acceptance to skip lobby on reload
    try {
        const key = `lobbyAccepted:${roomCode}`;
        const raw = localStorage.getItem(key);
        if (raw) {
            const parsed = JSON.parse(raw);
            const TTL = 60 * 60 * 1000; // 1 hour
            if (parsed && parsed.ts && (Date.now() - parsed.ts) < TTL) {
                // Hide lobby UI if present
                if (lobbyScreen) {
                    lobbyScreen.style.display = 'none';
                }
                // Signal that lobby is complete so the rest of the init flows
                window.lobbyComplete = true;
                document.dispatchEvent(new CustomEvent('lobbyComplete', { detail: {} }));
            }
        }
    } catch (e) {
        // Ignore parse/storage errors and fall back to normal lobby flow
    }
    if (lobbyScreen && lobbyScreen.style.display !== 'none') {
        await new Promise((resolve) => {
            document.addEventListener('lobbyComplete', (e) => {
                // Usar configuración del lobby
                const settings = e.detail || {};
                isMicActive = settings.micEnabled !== undefined ? settings.micEnabled : true;
                isCamActive = settings.camEnabled !== undefined ? settings.camEnabled : true;
                
                // Si hay un stream del lobby, usarlo
                if (settings.stream) {
                    localStream = settings.stream;
                }
                
                resolve();
            }, { once: true });
        });
    }
    // =========================================================

    // Inicializar elementos del DOM
    const roomCodeElement = document.getElementById('roomCode');
    if (roomCodeElement) {
        roomCodeElement.textContent = roomCode;
    } else {
    }

    const userNameElement = document.getElementById('userName');
    if (userNameElement) userNameElement.textContent = userName;

    const localUserNameElement = document.getElementById('localUserName');
    if (localUserNameElement) localUserNameElement.textContent = userName + ' (Tú)';

    // Inicializar referencias a contenedores de video
    // ✅ CAMBIO: Ahora usamos #videoGrid directamente
    videosContainer = document.getElementById('videoGrid');
    screenShareContainer = document.getElementById('screenShareContainer');
    participantList = document.getElementById('participantsList');
    participantCount = document.getElementById('participantCount');

    if (!videosContainer) {
    }

    await initMedia();
    initWebSocket();

    // Iniciar monitoreo periódico de salud de conexiones (cada 60 segundos, solo si tab visible)
    setInterval(() => {
        // ✅ OPTIMIZACIÓN: Solo verificar si la pestaña está visible
        if (!document.hidden) {
            checkConnectionsHealth();
        }
    }, 60000);

    if (isModerator) {
        updateModeratorUI();
        updateHandList();
        updateHandNotification();
    }

    // Event listeners que necesitan el DOM cargado
    const createPollBtn = document.getElementById('createPollBtn');
    if (createPollBtn) {
        createPollBtn.addEventListener('click', openPollCreationModal);
    }

    // Event listener para quitar la palabra
    const endWordBtn = document.getElementById('endWordBtn');
    if (endWordBtn) {
        if (DEBUG_MODE) console.log('[INIT] ✅ Botón "Quitar palabra" encontrado y configurando listener');
        endWordBtn.addEventListener('click', () => {
            if (DEBUG_MODE) console.log('[END-WORD-BTN] 🔴 Botón clickeado');
            if (currentSpeaker && isModerator) {
                takeWordFromParticipant();
            } else {
                if (!currentSpeaker) {
                }
                if (!isModerator) {
                }
            }
        });
    } else {
    }

    // Inicializar panel arrastrable
    initDraggableSpeakingPanel();

    debugLog('Contenido DOM cargado. Medios y WebSocket inicializados.');

    // Minimizar panel de resultados
    const minimizePollResultsBtn = document.getElementById('minimizePollResultsBtn');
    if (minimizePollResultsBtn) {
        minimizePollResultsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const panel = document.getElementById('pollResultsPanel');
            if (panel) {
                panel.classList.add('minimized');
            }
        });
    }

    // Restaurar panel minimizado al hacer click
    const pollResultsPanel = document.getElementById('pollResultsPanel');
    if (pollResultsPanel) {
        pollResultsPanel.addEventListener('click', (e) => {
            const panel = e.currentTarget;
            if (panel.classList.contains('minimized') &&
                !e.target.closest('.minimize-btn') &&
                !e.target.closest('.close-modal') &&
                e.target.closest('.modal-content')) {
                e.stopPropagation();
                panel.classList.remove('minimized');
                const modalContent = panel.querySelector('.modal-content');
                if (modalContent) {
                    modalContent.style.transform = 'translate(0, 0)';
                }
            }
        });
    }
});

document.getElementById('leaveBtn')?.addEventListener('click', () => {
    // Marcar como desconexión intencional
    intentionalDisconnect = true;

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'leave', room: roomCode, name: userName }));
    }

    // Cerrar todas las conexiones peer
    for (const userId in peerConnections) {
        if (peerConnections[userId]) {
            peerConnections[userId].close();
        }
    }
    peerConnections = {};

    // Detener todos los streams
    localStream?.getTracks().forEach(track => track.stop());
    localScreenStream?.getTracks().forEach(track => track.stop());
    localStream = null;
    localScreenStream = null;

    // Cerrar WebSocket
    if (ws) {
        ws.close(1000, 'Usuario salió de la sala');
    }

    // Remove persisted lobby acceptance for this room
    try {
        const key = `lobbyAccepted:${roomCode}`;
        localStorage.removeItem(key);
    } catch (e) {
        // ignore
    }

    showError('Saliendo de la sala...', 2000);
    debugLog('Saliendo de la sala intencionalmente.');

    setTimeout(() => {
        window.location.href = '/';
    }, 2000);
});

// Función para mostrar el link de invitación
async function showShareLink() {
    // Obtener la URL base (ngrok o localhost)
    let baseUrl = window.location.origin;

    // Intentar obtener la URL de ngrok desde frontendConfig.json
    try {
        const response = await fetch('/frontendConfig.json');
        const config = await response.json();
        if (config.wsUrl) {
            // Convertir wss:// a https://
            baseUrl = config.wsUrl.replace('wss://', 'https://');
        }
    } catch (error) {
    }

    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    const shareUrl = `${baseUrl}/index.html?room=${encodeURIComponent(room)}&name=Invitado`;

    // Crear modal
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
        backdrop-filter: blur(8px);
    `;

    const content = document.createElement('div');
    content.style.cssText = `
        background: linear-gradient(145deg, #1a1a2e 0%, #16213e 100%);
        padding: 32px;
        border-radius: 24px;
        max-width: 600px;
        width: 90%;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        border: 1px solid rgba(255, 255, 255, 0.1);
        text-align: center;
    `;

    content.innerHTML = `
        <h2 style="color: #22c55e; margin-bottom: 16px; font-size: 24px; font-weight: 700;">
            🎉 Reunión Creada
        </h2>
        <p style="color: rgba(255, 255, 255, 0.8); margin-bottom: 24px; font-size: 14px;">
            Comparte este link con los participantes para que se unan a la reunión:
        </p>
        <div style="
            background: rgba(0, 0, 0, 0.3);
            padding: 16px;
            border-radius: 12px;
            margin-bottom: 24px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            word-break: break-all;
            font-family: monospace;
            color: #22c55e;
            font-size: 14px;
        ">
            ${shareUrl}
        </div>
        <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
            <button id="copyLinkBtn" style="
                background: linear-gradient(145deg, #22c55e 0%, #16a34a 100%);
                color: white;
                border: none;
                padding: 14px 28px;
                border-radius: 12px;
                cursor: pointer;
                font-weight: 600;
                font-size: 14px;
                box-shadow: 0 4px 12px rgba(34, 197, 94, 0.3);
                transition: all 0.3s ease;
            ">
                📋 Copiar Link
            </button>
            <button id="closeLinkModalBtn" style="
                background: linear-gradient(145deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.05) 100%);
                color: white;
                border: 1px solid rgba(255, 255, 255, 0.2);
                padding: 14px 28px;
                border-radius: 12px;
                cursor: pointer;
                font-weight: 600;
                font-size: 14px;
                transition: all 0.3s ease;
            ">
                Cerrar
            </button>
        </div>
    `;

    modal.appendChild(content);
    document.body.appendChild(modal);

    // Botón copiar
    document.getElementById('copyLinkBtn').addEventListener('click', () => {
        navigator.clipboard.writeText(shareUrl).then(() => {
            const btn = document.getElementById('copyLinkBtn');
            btn.textContent = '✓ Copiado!';
            btn.style.background = 'linear-gradient(145deg, #16a34a 0%, #15803d 100%)';
            setTimeout(() => {
                btn.textContent = '📋 Copiar Link';
                btn.style.background = 'linear-gradient(145deg, #22c55e 0%, #16a34a 100%)';
            }, 2000);
        }).catch(err => {
            alert('No se pudo copiar el link. Inténtalo manualmente.');
        });
    });

    // Botón cerrar
    document.getElementById('closeLinkModalBtn').addEventListener('click', () => {
        modal.remove();
    });

    // Cerrar con click fuera del modal
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });


}

// ======================= EXPORTAR FUNCIONES GLOBALES =======================
// Exponer funciones y variables necesarias para otros módulos
window.clearPollNotifications = clearPollNotifications;
window.displayPollResults = displayPollResults;
window.stopAllPollTimers = stopAllPollTimers;
Object.defineProperty(window, 'currentPoll', {
    get: function() { return currentPoll; },
    set: function(value) { currentPoll = value; }
});
