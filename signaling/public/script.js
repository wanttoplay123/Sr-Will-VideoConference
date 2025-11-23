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

const iceServers = [
    // Servidores STUN de Google (para NAT traversal)
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },

    // Servidores STUN adicionales
    { urls: 'stun:stun.services.mozilla.com' },
    { urls: 'stun:stun.stunprotocol.org:3478' },
    { urls: 'stun:stun.voip.blackberry.com:3478' },

    // Servidores TURN públicos (para cuando STUN no es suficiente)
    {
        urls: 'turn:openrelay.metered.ca:80',
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
        urls: 'turn:turn.anyfirewall.com:443?transport=tcp',
        username: 'webrtc',
        credential: 'webrtc'
    },
    // Servidor TURN de Twilio (más confiable pero puede tener límites)
    {
        urls: 'turn:global.turn.twilio.com:3478?transport=udp',
        username: 'f4b4035eaa76f4a55de5f4351567653ee4ff6fa97b50b6b334fcc1be9c27212d',
        credential: 'w1uxM55V9yVoqyVFjt+mxDBV0F87AUCemaYVQGxsPLw='
    },
    {
        urls: 'turn:global.turn.twilio.com:3478?transport=tcp',
        username: 'f4b4035eaa76f4a55de5f4351567653ee4ff6fa97b50b6b334fcc1be9c27212d',
        credential: 'w1uxM55V9yVoqyVFjt+mxDBV0F87AUCemaYVQGxsPLw='
    },
    {
        urls: 'turn:global.turn.twilio.com:443?transport=tcp',
        username: 'f4b4035eaa76f4a55de5f4351567653ee4ff6fa97b50b6b334fcc1be9c27212d',
        credential: 'w1uxM55V9yVoqyVFjt+mxDBV0F87AUCemaYVQGxsPLw='
    }
];

async function forceSpeakerOutput(mediaEl) {
    if (typeof mediaEl.setSinkId !== 'function') return;

    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
        const speaker = audioOutputs.find(d => /speaker/i.test(d.label)) || audioOutputs[0];

        if (speaker) {
            await mediaEl.setSinkId(speaker.deviceId);
            console.log('[🔊] Audio forzado al altavoz:', speaker.label);
        }
    } catch (err) {
        console.warn('[⚠️] No se pudo forzar el altavoz:', err);
    }
}


function debugLog(...messages) {
    console.log('[DEBUG]', new Date().toISOString(), ...messages);
}

function showError(message, duration = 5000) {
    const errorPanel = document.getElementById('errorPanel');
    if (!errorPanel) {
        console.error('Error: #errorPanel no encontrado en el DOM.', message);
        return;
    }
    errorPanel.textContent = message;
    errorPanel.style.display = 'block';
    debugLog('ERROR UI:', message);

    if (duration > 0) {
        setTimeout(() => {
            errorPanel.style.display = 'none';
        }, duration);
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
    console.warn('⚠️ Nombre de usuario vacío, asignando nombre aleatorio:', userName);
}
let isModerator = urlParams.has('moderator');
let isRoomAdmin = false; // ✅ Flag para identificar al admin de la sala

console.log('[INIT] URL completa:', window.location.href);
console.log('[INIT] Parámetros URL:', {
    room: roomCode,
    name: userName,
    moderator: isModerator
});

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

// ======================= SISTEMA DE "DAR LA PALABRA" =======================
let currentSpeaker = null; // { name: string, timeLeft: number (segundos), totalTime: number }
let speakingTimerInterval = null;

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
    console.log('[GIVE-WORD-FUNC] 📢 Función llamada');
    console.log('[GIVE-WORD-FUNC] participantName:', participantName);
    console.log('[GIVE-WORD-FUNC] duration:', duration);

    // Si ya hay alguien con la palabra, quitársela primero
    if (currentSpeaker) {
        console.log('[GIVE-WORD-FUNC] ⚠️ Ya hay alguien con la palabra:', currentSpeaker.name);
        console.log('[GIVE-WORD-FUNC] Quitando palabra primero...');
        takeWordFromParticipant();
    }

    currentSpeaker = {
        name: participantName,
        timeLeft: duration,
        totalTime: duration
    };
    console.log('[GIVE-WORD-FUNC] ✅ currentSpeaker actualizado:', currentSpeaker);

    // Mostrar panel
    const speakingPanel = document.getElementById('speakingPanel');
    const speakingPersonName = document.getElementById('speakingPersonName');
    const timerDisplay = document.getElementById('timerDisplay');
    const timerProgressBar = document.getElementById('timerProgressBar');
    const speakingActions = document.getElementById('speakingActions');

    console.log('[GIVE-WORD-FUNC] Elementos DOM:', {
        speakingPanel: !!speakingPanel,
        speakingPersonName: !!speakingPersonName,
        timerDisplay: !!timerDisplay,
        speakingActions: !!speakingActions
    });

    if (speakingPanel && speakingPersonName && timerDisplay) {
        // ✅ ASEGURAR que el panel esté en el body
        if (speakingPanel.parentNode !== document.body) {
            document.body.appendChild(speakingPanel);
            console.log('[GIVE-WORD-FUNC] Panel movido al body');
        }

        speakingPersonName.textContent = participantName;
        updateTimerDisplay();
        speakingPanel.classList.remove('closing');
        speakingPanel.classList.add('visible');

        // ✅ FORZAR VISIBILIDAD TOTAL con estilos inline importantes
        speakingPanel.style.cssText = 'display: block !important; opacity: 1 !important; visibility: visible !important; z-index: 10000 !important;';
        console.log('[GIVE-WORD-FUNC] ✅ Panel mostrado localmente');

        // Mostrar botón de quitar palabra solo si eres moderador
        if (speakingActions) {
            speakingActions.style.display = isModerator ? 'flex' : 'none';
            console.log('[GIVE-WORD-FUNC] Botones de acción:', isModerator ? 'VISIBLES' : 'OCULTOS');
        }
    }

    // ❌ NO iniciar temporizador LOCAL aquí para evitar duplicados
    // El temporizador se iniciará cuando llegue el mensaje 'give-word' del servidor
    // Así todos los clientes están sincronizados
    console.log('[GIVE-WORD-FUNC] ⏰ Temporizador se iniciará al recibir confirmación del servidor');

    // Notificar al servidor que se dio la palabra
    if (ws && ws.readyState === WebSocket.OPEN) {
        const message = {
            type: 'give-word',
            room: roomCode,
            target: participantName,
            duration: duration
        };
        console.log('[GIVE-WORD-FUNC] 📤 Enviando mensaje al servidor:', message);
        ws.send(JSON.stringify(message));
        console.log('[GIVE-WORD-FUNC] ✅ Mensaje enviado al servidor');

        // También activar el micrófono del participante
        ws.send(JSON.stringify({
            type: 'mute-participant',
            room: roomCode,
            target: participantName,
            micActive: true
        }));
        console.log('[GIVE-WORD-FUNC] ✅ Solicitud de activación de micrófono enviada');
    } else {
        console.error('[GIVE-WORD-FUNC] ❌ ERROR: WebSocket no está abierto');
        console.error('[GIVE-WORD-FUNC] ws:', ws);
        console.error('[GIVE-WORD-FUNC] readyState:', ws?.readyState);
    }

    showError(`${participantName} tiene la palabra (${duration}s)`, 3000);
    console.log(`[GIVE-WORD-FUNC] ✅ Función completada. ${participantName} tiene la palabra por ${duration} segundos`);
}

function handleTimeExpired(participantName) {
    console.log('[TIME-EXPIRED] ⏰ Tiempo expirado para:', participantName);

    // 🔇 PASO 1: Silenciar inmediatamente al participante
    if (ws && ws.readyState === WebSocket.OPEN) {
        console.log('[TIME-EXPIRED] 📤 Enviando mute-participant (micActive: false)');
        ws.send(JSON.stringify({
            type: 'mute-participant',
            room: roomCode,
            target: participantName,
            micActive: false
        }));
    }

    // 📢 PASO 2: Quitar la palabra
    if (ws && ws.readyState === WebSocket.OPEN) {
        console.log('[TIME-EXPIRED] 📤 Enviando take-word');
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
    console.log('[TIME-EXPIRED] ✅ Proceso completado');
}

function takeWordFromParticipant() {
    console.log('[TAKE-WORD-FUNC] 📢 Función llamada');
    console.log('[TAKE-WORD-FUNC] currentSpeaker:', currentSpeaker);

    if (!currentSpeaker) {
        console.log('[TAKE-WORD-FUNC] ❌ No hay nadie con la palabra, abortando');
        return;
    }

    const participantName = currentSpeaker.name;
    console.log('[TAKE-WORD-FUNC] 🎯 Quitando palabra a:', participantName);

    // Detener temporizador
    if (speakingTimerInterval) {
        clearInterval(speakingTimerInterval);
        speakingTimerInterval = null;
        console.log('[TAKE-WORD-FUNC] ⏰ Temporizador detenido');
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
        console.log('[TAKE-WORD-FUNC] ✅ Panel ocultado localmente');
    }

    // 📢 Notificar al servidor que se quitó la palabra
    // El servidor se encargará de silenciar al participante automáticamente
    if (ws && ws.readyState === WebSocket.OPEN) {
        const message = {
            type: 'take-word',
            room: roomCode,
            target: participantName
        };
        console.log('[TAKE-WORD-FUNC] 📤 Enviando mensaje al servidor:', message);
        ws.send(JSON.stringify(message));
        console.log('[TAKE-WORD-FUNC] ✅ Mensaje enviado al servidor');
    } else {
        console.error('[TAKE-WORD-FUNC] ❌ ERROR: WebSocket no está abierto');
        console.error('[TAKE-WORD-FUNC] ws:', ws);
        console.error('[TAKE-WORD-FUNC] readyState:', ws?.readyState);
    }

    currentSpeaker = null;
    showError(`Se quitó la palabra a ${participantName}`, 2000);
    console.log(`[TAKE-WORD-FUNC] ✅ Función completada. Palabra quitada a ${participantName}`);
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

// ======================= CHAT FUNCTIONS =======================
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
    chatMessages.scrollTop = chatMessages.scrollHeight;
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
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = 'No hay manos levantadas';
        handList.appendChild(li);
        updateHandNotification();
        return;
    }

    arr.forEach(name => {
        const li = document.createElement('li');
        li.className = 'hand-item';
        li.textContent = name;

        if (isModerator) {
            const grantBtn = document.createElement('button');
            grantBtn.className = 'grant-btn';
            grantBtn.textContent = 'Dar palabra';
            grantBtn.addEventListener('click', () => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'give-word', room: roomCode, target: name, duration: 60 }));
                }
            });

            const lowerBtn = document.createElement('button');
            lowerBtn.className = 'lower-btn';
            lowerBtn.textContent = 'Bajar mano';
            lowerBtn.addEventListener('click', () => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: 'hand-lowered', name: name }));
                }
                // Optimistic update
                handleHandLowered(name);
            });

            li.appendChild(grantBtn);
            li.appendChild(lowerBtn);
        }

        handList.appendChild(li);
    });

    updateHandNotification();
}

function updateHandNotification() {
    const raiseBtn = document.getElementById('raiseHand');
    const count = raisedHands.size;
    if (raiseBtn) {
        raiseBtn.classList.toggle('has-notification', count > 0);
    }
    const badge = document.getElementById('handCountBadge');
    if (badge) {
        badge.textContent = count > 0 ? String(count) : '';
        badge.style.display = count > 0 ? 'inline-block' : 'none';
    }
}
document.getElementById('raiseHand')?.addEventListener('click', () => {
    if (isModerator) {
        toggleHandPanel();
    } else {
        if (ws && ws.readyState === WebSocket.OPEN && !raisedHands.has(userName)) {
            ws.send(JSON.stringify({ type: 'raise-hand', name: userName }));
            raisedHands.add(userName);
            updateHandList();
            updateHandNotification();
            showError('Has levantado la mano ✋', 3000);
            debugLog('Levantando mano.');
            document.getElementById('raiseHand')?.classList.add('active');
        }
    }
});

document.getElementById('closeHandPanel')?.addEventListener('click', () => {
    toggleHandPanel();
});


function handleHandLowered(name) {
    raisedHands.delete(name);
    updateHandList();
    updateHandNotification();

    if (name === userName) {
        showError('Tu mano ha sido bajada.', 3000);
        document.getElementById('raiseHand')?.classList.remove('active');
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

function handleHandLowered(name) {
    raisedHands.delete(name);
    updateHandList();
    updateHandNotification();

    if (name === userName) {
        showError('Tu mano ha sido bajada.', 3000);
        document.getElementById('raiseHand')?.classList.remove('active');
    }

    debugLog(`Mano bajada para ${name}.`);
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

    // Actualizar contador en el sidebar
    const sidebarCount = document.getElementById('sidebarParticipantCountText');
    if (sidebarCount) {
        sidebarCount.textContent = count;
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
            console.warn(`⚠️ Nombre de participante vacío o inválido, saltando actualización de estado`);
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
    console.log(`Stream recibido:`, stream);
    console.log(`  - ID: ${stream.id}`);
    console.log(`  - Active: ${stream.active}`);
    console.log(`  - Tracks:`, stream.getTracks().map(t => `${t.kind} (enabled=${t.enabled}, readyState=${t.readyState})`));

    // ✅ SIEMPRE agregar videos a #videoGrid (donde está el sistema de vistas)
    const videoGrid = document.getElementById('videoGrid');
    if (!videoGrid) {
        console.error('❌ ERROR CRÍTICO: No se puede encontrar el contenedor #videoGrid');
        return;
    }

    console.log(`✅ videoGrid encontrado. Videos actuales:`, videoGrid.querySelectorAll('.video-container').length);

    let videoContainer = document.getElementById(`video-container-${userId}`);
    let videoElement = null;

    if (videoContainer) {
        videoElement = videoContainer.querySelector('video');
        debugLog(`🔄 Actualizando video existente para ${userId}.`);
    } else {
        console.log(`🆕 CREANDO NUEVO VIDEO CONTAINER para ${userId}`);
        videoContainer = document.createElement('div');
        videoContainer.className = 'video-container remote-video';
        videoContainer.id = `video-container-${userId}`;
        videoContainer.style.display = 'block'; // FORZAR VISIBLE
        videoGrid.appendChild(videoContainer); // ✅ AGREGAR A #videoGrid
        console.log(`✅ CONTENEDOR AGREGADO! Total videos ahora:`, videoGrid.querySelectorAll('.video-container').length);

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
        pinBtn.className = 'pin-btn';
        pinBtn.dataset.peer = userId;
        pinBtn.innerHTML = '<i class="fas fa-thumbtack"></i> Fijar';
        videoContainer.appendChild(pinBtn);

        // Agregar atributo para identificar el peer
        videoContainer.dataset.peerId = userId;

        debugLog(`✅ Nuevo elemento de video creado para ${userId}.`);
    }

    if (videoElement) {
        console.log(`🎥 Asignando stream al elemento <video> de ${userId}`);
        videoElement.srcObject = stream;
        videoElement.style.width = '100%';
        videoElement.style.height = '100%';
        videoElement.style.objectFit = 'cover';
        debugLog(`🔗 Stream asignado a elemento de video para ${userId}`);

        // 🔊 IMPORTANTE: Los videos REMOTOS NO deben estar en muted para escuchar audio
        videoElement.muted = false; // ✅ Asegurar que NO está silenciado
        videoElement.volume = 1.0;  // ✅ Volumen al máximo

        videoElement.play().then(() => {
            console.log(`✅✅✅ VIDEO Y AUDIO REPRODUCIENDO PARA ${userId} ✅✅✅`);
            debugLog(`▶️ Video y audio reproduciendo para ${userId}`);
        }).catch(e => {
            console.error(`❌ Autoplay para ${userId} falló:`, e);
            // NOTA: NO poner muted=true aquí porque silenciaría el audio
            // El usuario tendrá que hacer clic en el video para reproducir
            showError(`Haz clic en el video de ${userId} para escuchar el audio`, 5000);
        });

        // 🔊 Forzar salida de audio al altavoz
        forceSpeakerOutput(videoElement);

        // Verificar estado después de 1 segundo
        setTimeout(() => {
            debugLog(`📊 Estado de video para ${userId} después de 1s:`);
            console.log(`  - srcObject:`, videoElement.srcObject);
            console.log(`  - readyState:`, videoElement.readyState);
            console.log(`  - paused:`, videoElement.paused);
            console.log(`  - muted:`, videoElement.muted);
        }, 1000);
    } else {
        console.error('❌ No se pudo encontrar o crear elemento de video.');
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
    console.log(`[SCREEN-SHARE] 📺 Creando preview para ${userId}`);

    const videoGrid = document.getElementById('videoGrid');
    if (!videoGrid) {
        console.error('[SCREEN-SHARE] ❌ #videoGrid no encontrado');
        return;
    }

    // Limpiar preview existente si hay
    const existingPreview = document.getElementById(`screen-preview-${userId}`);
    if (existingPreview) {
        console.log(`[SCREEN-SHARE] 🗑️ Eliminando preview anterior de ${userId}`);
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
    video.muted = (userId === userName); // Silenciar solo para el que comparte (evita echo)
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'contain';
    video.style.backgroundColor = '#000';

    // Asignar stream
    video.srcObject = stream;

    // Intentar reproducir
    video.play()
        .then(() => {
            console.log(`[SCREEN-SHARE] ✅ Video reproduciendo para ${userId}`);
        })
        .catch(err => {
            console.error(`[SCREEN-SHARE] ❌ Error reproduciendo video:`, err);
            if (userId === userName) {
                showError('Haz clic en la pantalla compartida para activar la reproducción', 4000);
            }
        });

    // Crear info overlay
    const infoOverlay = document.createElement('div');
    infoOverlay.className = 'screen-share-info-overlay';
    infoOverlay.innerHTML = `
        <span class="screen-share-user-name">${userId === userName ? 'Tu pantalla' : `Pantalla de ${userId}`}</span>
        <span class="screen-share-status">●</span>
    `;

    // Agregar elementos al contenedor
    previewContainer.appendChild(video);
    previewContainer.appendChild(infoOverlay);

    // Insertar al principio del grid
    videoGrid.insertBefore(previewContainer, videoGrid.firstChild);

    // Activar layout de grid para screen-share usando el sistema centralizado
    if (typeof setViewMode === 'function') {
        setViewMode('sidebar');
    } else {
        console.warn('setViewMode no está disponible');
    }

    // NOTA: No ocultamos la cámara del presentador, para que se vea en pequeño
    console.log(`[SCREEN-SHARE] ✅ Preview creado exitosamente para ${userId}`);
}

/**
 * Maneja la recepción de un stream de pantalla remota
 * Esta función era la pieza faltante que conectaba el evento ontrack con la UI
 */
function handleRemoteScreenShare(userId, stream) {
    console.log(`[SCREEN-SHARE] 🚀 handleRemoteScreenShare llamado para ${userId}`);
    console.log(`[SCREEN-SHARE] 🆔 Stream ID: ${stream.id}`);

    // Usar la función existente para crear la UI
    createScreenSharePreview(userId, stream);

    // Forzar actualización del layout
    if (typeof setViewMode === 'function') {
        console.log('[SCREEN-SHARE] 📐 Forzando vista sidebar');
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
    console.log(`[SCREEN-SHARE] 🗑️ Eliminando preview de ${userId}`);

    const videoGrid = document.getElementById('videoGrid');
    const preview = document.getElementById(`screen-preview-${userId}`);

    if (preview) {
        // Detener tracks del stream
        const video = preview.querySelector('video');
        if (video && video.srcObject) {
            video.srcObject.getTracks().forEach(track => {
                track.stop();
                console.log(`[SCREEN-SHARE] ⏹️ Track detenido: ${track.kind}`);
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

    console.log('[SCREEN-SHARE] ✅ Preview eliminado y layout restaurado');
}

async function initMedia() {
    try {
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
        debugLog('✅ Stream local obtenido:', localStream);
        console.log('LocalStream details:');
        console.log('  - ID:', localStream.id);
        console.log('  - Active:', localStream.active);
        console.log('  - Tracks:', localStream.getTracks().length);
        localStream.getTracks().forEach(track => {
            console.log(`    * ${track.kind}: id=${track.id}, enabled=${track.enabled}, readyState=${track.readyState}, muted=${track.muted}`);
        });

        const localVideoElement = document.getElementById('localVideo');
        if (localVideoElement) {
            localVideoElement.srcObject = localStream;
            localVideoElement.muted = true;
            localVideoElement.play().catch(e => {
                console.warn("Autoplay de video local falló:", e);
                showError("No se pudo reproducir automáticamente tu video local. Haz clic para reproducir.", 5000);
            });
            debugLog('Video local cargado.');
        } else {
            debugLog('Advertencia: #localVideo no encontrado en el DOM.');
        }

        // 🎤 Configurar estado inicial de audio/video
        localStream.getAudioTracks().forEach(track => {
            track.enabled = isMicActive;
            console.log(`🎤 Audio track inicial: enabled=${track.enabled}, readyState=${track.readyState}, id=${track.id}`);
        });
        localStream.getVideoTracks().forEach(track => {
            track.enabled = isCamActive;
            console.log(`🎥 Video track inicial: enabled=${track.enabled}, readyState=${track.readyState}, id=${track.id}`);
        });

        userRoles[userName] = isModerator ? 'Organizador de la Reunión' : 'Participante';
        participantStates[userName] = { micActive: isMicActive, camActive: isCamActive };
        addParticipant(userName, true);
        updateParticipantList();

        document.getElementById('toggleMic')?.classList.toggle('active', isMicActive);
        document.getElementById('toggleCam')?.classList.toggle('active', isCamActive);

        console.log(`✅ Micrófono inicial: ${isMicActive ? 'ACTIVADO' : 'DESACTIVADO'}`);
        console.log(`✅ Cámara inicial: ${isCamActive ? 'ACTIVADA' : 'DESACTIVADA'}`);

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
        console.error('Error inicializando medios:', err);
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
                        showError('Esperando aprobación del moderador para unirse a la sala.', 0);
                        break;

                    case 'joined':
                        if (!msg.exists || msg.error) {
                            showError(`Error: ${msg.error || 'La sala no existe'}`, 5000);
                            setTimeout(() => window.location.href = '/', 3000);
                        } else {
                            // ✅ Guardar si es admin de la sala
                            if (msg.isRoomAdmin) {
                                isRoomAdmin = true;
                                console.log('[ADMIN] Este usuario es el administrador de la sala');
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
                                console.error('Error: #notificationsList no encontrado.');
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
                        const pc = createPeerConnection(msg.userId);
                        if (pc && msg.initiateOffer && pc.signalingState === 'stable') {
                            try {
                                const offer = await pc.createOffer();
                                await pc.setLocalDescription(offer);
                                if (ws.readyState === WebSocket.OPEN) {
                                    ws.send(JSON.stringify({
                                        type: 'signal',
                                        room: roomCode,
                                        target: msg.userId,
                                        payload: { sdp: pc.localDescription }
                                    }));
                                }
                            } catch (e) {
                                showError(`Error negociando con ${msg.userId}`, 5000);
                                debugLog(`Error en la negociación WebRTC con ${msg.userId}:`, e);
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
                            showError(`${msg.name} ha levantado la mano ✋`, 3000);
                        }
                        break;

                    case 'hand-lowered':
                        handleHandLowered(msg.name);
                        break;

                    case 'give-word':
                        // Recibir notificación de que alguien tiene la palabra
                        console.log('[GIVE-WORD] 📢 Mensaje recibido:', msg);
                        if (msg.target && msg.duration) {
                            // Si ya hay alguien con la palabra y es diferente, quitársela primero
                            if (currentSpeaker && currentSpeaker.name !== msg.target) {
                                console.log('[GIVE-WORD] Ya hay un speaker diferente, cerrando panel anterior');
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

                            console.log('[GIVE-WORD] Elementos DOM:', {
                                panel: !!speakingPanel,
                                name: !!speakingPersonName,
                                actions: !!speakingActions,
                                isModerator: isModerator,
                                userName: userName
                            });

                            if (speakingPanel && speakingPersonName) {
                                // ✅ ASEGURAR que el panel esté en el body para evitar problemas de z-index/overflow
                                if (speakingPanel.parentNode !== document.body) {
                                    document.body.appendChild(speakingPanel);
                                    console.log('[GIVE-WORD] Panel movido al body');
                                }

                                // ✅ Actualizar contenido del panel
                                speakingPersonName.textContent = msg.target;
                                updateTimerDisplay();

                                // ✅ FORZAR VISIBILIDAD TOTAL - Remover clases anteriores y aplicar estilos directamente
                                speakingPanel.classList.remove('closing');
                                speakingPanel.classList.add('visible');
                                speakingPanel.style.cssText = 'display: block !important; opacity: 1 !important; visibility: visible !important; z-index: 10000 !important;';

                                console.log('[GIVE-WORD] ✅✅✅ PANEL MOSTRADO PARA TODOS LOS PARTICIPANTES ✅✅✅');
                                console.log('[GIVE-WORD] Classes:', speakingPanel.className);
                                console.log('[GIVE-WORD] Display:', window.getComputedStyle(speakingPanel).display);
                                console.log('[GIVE-WORD] Opacity:', window.getComputedStyle(speakingPanel).opacity);
                                console.log('[GIVE-WORD] Z-index:', window.getComputedStyle(speakingPanel).zIndex);

                                // ✅ TODOS pueden ver el panel, pero SOLO los moderadores ven los botones de control
                                if (speakingActions) {
                                    speakingActions.style.display = isModerator ? 'flex' : 'none';
                                    console.log('[GIVE-WORD] Botones de control:', isModerator ? 'VISIBLE (Moderador)' : 'OCULTOS (Participante)');
                                }
                            } else {
                                console.error('[GIVE-WORD] ❌ ERROR: No se encontró el panel o el nombre!');
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
                                        console.log('[GIVE-WORD] ⏰ Tiempo agotado en este cliente');
                                        const targetName = currentSpeaker.name;

                                        // 📢 SOLO EL MODERADOR ejecuta el cierre automático
                                        if (isModerator) {
                                            console.log('[GIVE-WORD] 🔴 Moderador detectó expiración, ejecutando handleTimeExpired()');
                                            handleTimeExpired(targetName);
                                        } else {
                                            // Los participantes solo actualizan la UI localmente
                                            console.log('[GIVE-WORD] ⏱️ Participante detectó expiración, esperando confirmación del servidor');
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
                        console.log('[TAKE-WORD] 🔇 Mensaje recibido:', msg);

                        if (currentSpeaker || msg.target) {
                            const participantName = currentSpeaker?.name || msg.target;

                            // Detener temporizador
                            if (speakingTimerInterval) {
                                clearInterval(speakingTimerInterval);
                                speakingTimerInterval = null;
                                console.log('[TAKE-WORD] ⏰ Temporizador detenido');
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
                                console.log('[TAKE-WORD] ✅ Panel ocultado para todos los participantes');
                            }

                            // ✅ Limpiar el speaker actual
                            currentSpeaker = null;

                            showError(`🔇 Se quitó la palabra a ${participantName}`, 2000);
                            console.log(`[TAKE-WORD] ✅ Palabra quitada a ${participantName}`);

                            // NOTA: El silenciamiento del micrófono se maneja en el mensaje 'mute-participant' que el servidor envía
                        }
                        break;

                    case 'chat':
                        console.log('[CHAT] Mensaje de chat recibido:', msg);
                        if (msg.author && msg.message) {
                            const isOwn = msg.author === userName;
                            console.log('[CHAT] Procesando mensaje. Author:', msg.author, 'isOwn:', isOwn, 'userName:', userName);
                            // Mostrar todos los mensajes que vienen del servidor
                            addChatMessage(msg.author, msg.message, msg.timestamp, isOwn);

                            // Mostrar notificación si el mensaje es de otro usuario y el chat está cerrado
                            if (!isOwn) {
                                const chatPanel = document.getElementById('chatPanel');
                                const isChatOpen = chatPanel && chatPanel.classList.contains('visible');

                                if (!isChatOpen) {
                                    // Mostrar notificación emergente
                                    showError(`💬 ${msg.author}: ${msg.message.substring(0, 50)}${msg.message.length > 50 ? '...' : ''}`, 4000);
                                }

                                // Agregar indicador visual en el botón de chat
                                const chatToggleBtn = document.getElementById('chatToggle');
                                if (chatToggleBtn && !isChatOpen) {
                                    chatToggleBtn.classList.add('has-notification');
                                }
                            }
                        } else {
                            console.log('[CHAT] Mensaje de chat inválido - falta author o message');
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
                        console.log(`[SCREEN-SHARE] 📡 Notificación recibida de ${msg.userId}`);
                        console.log(`[SCREEN-SHARE] 📦 Mensaje completo:`, msg);
                        console.log(`[SCREEN-SHARE] 🆔 streamId recibido:`, msg.streamId);

                        // ✅ FORZAR VISTA SIDEBAR INMEDIATAMENTE PARA TODOS
                        if (typeof setViewMode === 'function') {
                            setViewMode('sidebar');
                        } else if (window.ViewControl && typeof window.ViewControl.setViewMode === 'function') {
                            window.ViewControl.setViewMode('sidebar');
                        }

                        if (msg.streamId) {
                            remoteScreenStreams[msg.userId] = msg.streamId;
                            console.log(`[SCREEN-SHARE] ID registrado: ${msg.streamId}`);

                            // Crear un placeholder de preview para reservar el área principal
                            ensureScreenPreviewPlaceholder(msg.userId);

                            // 1. Verificar si el stream estaba esperando en pendingStreams
                            if (pendingStreams[msg.streamId]) {
                                console.log(`[SCREEN-SHARE] 🔄 Recuperando stream pendiente para ${msg.userId} (por ID exacto)`);
                                const pending = pendingStreams[msg.streamId];
                                handleRemoteScreenShare(pending.userId, pending.stream);
                                delete pendingStreams[msg.streamId];
                            } else {
                                // Búsqueda flexible: buscar cualquier stream pendiente de este usuario
                                console.log(`[SCREEN-SHARE] 🔍 Buscando streams pendientes por usuario ${msg.userId}...`);
                                const pendingKey = Object.keys(pendingStreams).find(key => pendingStreams[key].userId === msg.userId);
                                if (pendingKey) {
                                    console.log(`[SCREEN-SHARE] 🔄 Recuperando stream pendiente para ${msg.userId} (por coincidencia de usuario)`);
                                    const pending = pendingStreams[pendingKey];
                                    handleRemoteScreenShare(pending.userId, pending.stream);
                                    delete pendingStreams[pendingKey];
                                }
                            }

                            // 2. Verificar si el video ya llegó y se asignó incorrectamente a la cámara
                            const existingVideoContainer = document.getElementById(`video-container-${msg.userId}`);
                            if (existingVideoContainer) {
                                const videoEl = existingVideoContainer.querySelector('video');
                                if (videoEl && videoEl.srcObject && videoEl.srcObject.id === msg.streamId) {
                                    console.log('[SCREEN-SHARE] ⚠️ Rectificando video asignado a cámara...');

                                    // Mover a screen share
                                    handleRemoteScreenShare(msg.userId, videoEl.srcObject);

                                    // Limpiar el container de cámara que tiene el stream incorrecto
                                    videoEl.srcObject = null;
                                }
                            }
                        } else {
                            // ⚠️ FALLBACK CRÍTICO: Si el servidor no envía streamId (versión vieja), asumimos que comparte
                            console.warn(`[SCREEN-SHARE] ⚠️ streamId no recibido. Activando modo compatibilidad para ${msg.userId}`);
                            remoteScreenStreams[msg.userId] = 'unknown'; // Marcar como activo
                            ensureScreenPreviewPlaceholder(msg.userId);

                            // Buscar cualquier stream pendiente de este usuario
                            const pendingKey = Object.keys(pendingStreams).find(key => pendingStreams[key].userId === msg.userId);
                            if (pendingKey) {
                                console.log(`[SCREEN-SHARE] 🔄 Fallback: Recuperando stream pendiente para ${msg.userId}`);
                                const pending = pendingStreams[pendingKey];
                                handleRemoteScreenShare(pending.userId, pending.stream);
                                delete pendingStreams[pendingKey];
                            }
                        }
                        break;

                    case 'screen-share-stopped':
                        console.log(`[SCREEN-SHARE] 🛑 Notificación de parada de ${msg.userId}`);
                        delete remoteScreenStreams[msg.userId];
                        stopRemoteScreenShare(msg.userId);
                        break;


                    case 'poll-started':
                        currentPoll = msg.poll;
                        hasVoted = false;
                        displayPollForParticipant(currentPoll);
                        break;

                    case 'poll-ended':
                        currentPoll = msg.poll;
                        hidePollForParticipant();
                        if (isModerator) {
                            // Guardar los votos en el poll para que persistan
                            if (!currentPoll) {
                                currentPoll = {
                                    id: msg.pollId,
                                    question: msg.question,
                                    options: msg.options,
                                    results: msg.results,
                                    votes: msg.votes || []
                                };
                            } else {
                                currentPoll.results = msg.results;
                                currentPoll.votes = msg.votes || [];
                            }
                            displayPollResults(msg.results, msg.question, msg.options, msg.votes);
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
                            currentPoll = msg;
                            displayPollResults(msg.results, msg.question, msg.options, msg.votes);
                            const pollResultsTimer = document.getElementById('pollResultsTimer');
                            if (pollResultsTimer) {
                                const remainingTime = Math.max(0, Math.floor((msg.endTime - Date.now()) / 1000));
                                startResultsTimer(remainingTime);
                            }
                        }
                        break;

                    case 'moderator-assigned':
                        console.log('[MODERATOR] Mensaje recibido:', msg);

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
                            console.warn('[MODERATOR] ⚠️ Mensaje incompleto:', msg);
                        }
                        break;

                    case 'moderator-revoked':
                        console.log('[MODERATOR] Mensaje de revocación recibido:', msg);

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
                            console.warn('[MODERATOR] ⚠️ Mensaje de revocación incompleto:', msg);
                        }
                        break;

                    case 'mute-participant':
                        console.log('[MUTE-PARTICIPANT] 🔇 Mensaje recibido:', msg);

                        if (msg.target === userName) {
                            // ✅ Si es admin de la sala, ignorar orden de silencio
                            if (isRoomAdmin) {
                                console.log('[ADMIN] Ignorando orden de silencio (el admin no puede ser silenciado)');
                                return;
                            }

                            // 🎤 APLICAR EL CAMBIO DE ESTADO DEL MICRÓFONO
                            isMicActive = msg.micActive;
                            console.log(`[MUTE-PARTICIPANT] Cambiando estado de micrófono a: ${isMicActive}`);

                            if (localStream) {
                                localStream.getAudioTracks().forEach(track => {
                                    track.enabled = isMicActive;
                                    console.log(`[MUTE-PARTICIPANT] Track ${track.id} enabled=${track.enabled}`);
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
                                console.log(`[MUTE-PARTICIPANT] Botón actualizado: active=${toggleMicBtn.classList.contains('active')}`);
                            }

                            showError(isMicActive ? 'Tu micrófono ha sido activado por un moderador.' : 'Tu micrófono ha sido silenciado por un moderador.', 3000);
                            console.log(`[MUTE-PARTICIPANT] ✅ Micrófono ${isMicActive ? 'ACTIVADO' : 'SILENCIADO'} para ${userName}`);
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

                        console.log(`[MUTE-PARTICIPANT] ✅ Estado actualizado para ${msg.target}: micActive=${msg.micActive}`);
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
                console.error('Error de WebSocket:', err);
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
    const pc = new RTCPeerConnection({
        iceServers: iceServers,
        iceTransportPolicy: 'all',
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
                console.log(`Sender agregado para ${userId}:`, sender);
            } catch (e) {
                console.error(`❌ Error agregando track ${track.kind} a ${userId}:`, e);
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
        console.error(`❌ No hay tracks locales disponibles para ${userId}. localStream:`, localStream);
        if (localStream) {
            console.error(`LocalStream existe pero no tiene tracks:`, localStream.getTracks());
        }
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

        console.log(`[WEBRTC] 📥 Track recibido de ${userId}: ${track.kind} (${track.label})`);
        console.log(`[WEBRTC] 🆔 Stream ID: ${stream.id}`);
        console.log(`[WEBRTC] 🔍 remoteScreenStreams[${userId}]:`, remoteScreenStreams[userId]);
        console.log(`[WEBRTC] 🔍 ¿Es pantalla compartida?:`, remoteScreenStreams[userId] === stream.id);

        // Verificar si este stream corresponde a una pantalla compartida conocida
        if (remoteScreenStreams[userId] === stream.id) {
            console.log(`[WEBRTC] 🖥️ Confirmado: Es stream de PANTALLA de ${userId}`);
            handleRemoteScreenShare(userId, stream);
        } else {
            // Si no coincide con el ID de pantalla, podría ser cámara O una pantalla que llegó antes del mensaje

            // Verificar si YA existe un video de cámara activo para este usuario
            const existingCameraContainer = document.getElementById(`video-container-${userId}`);
            const existingVideo = existingCameraContainer ? existingCameraContainer.querySelector('video') : null;

            console.log(`[WEBRTC] 🔍 existingCameraContainer:`, !!existingCameraContainer);
            console.log(`[WEBRTC] 🔍 existingVideo:`, !!existingVideo);
            console.log(`[WEBRTC] 🔍 existingVideo.srcObject:`, existingVideo?.srcObject?.id);

            // Si ya tiene un video de cámara Y el stream ID es diferente, probablemente el nuevo es la pantalla
            // y aún no llegó el mensaje de señalización.
            if (existingVideo && existingVideo.srcObject && existingVideo.srcObject.id !== stream.id) {

                // Verificar si YA sabemos que este usuario está compartiendo pantalla (aunque el ID no coincida exacto)
                if (remoteScreenStreams[userId]) {
                    console.log(`[WEBRTC] 🔄 Stream adicional recibido y usuario ${userId} está compartiendo pantalla. Asumiendo PANTALLA.`);
                    handleRemoteScreenShare(userId, stream);
                } else {
                    console.log(`[WEBRTC] ⏳ Stream recibido pero ya hay cámara activa. Guardando en buffer: ${stream.id}`);
                    pendingStreams[stream.id] = { userId, stream };
                    console.log(`[WEBRTC] 📦 pendingStreams ahora tiene:`, Object.keys(pendingStreams));
                }
            } else {
                // Si no hay cámara previa, o es el mismo stream (reemplazo), asumimos cámara por defecto
                // (Si luego resulta ser pantalla, el evento screen-share-started lo corregirá)
                console.log(`[WEBRTC] 📷 Asumiendo: Es stream de CÁMARA/AUDIO de ${userId}`);
                addVideoElement(userId, stream);

                // Asegurar que el audio esté habilitado
                if (track.kind === 'audio') {
                    track.enabled = true;
                }
            }
        }
    };

    pc.oniceconnectionstatechange = () => {
        debugLog(`Estado de conexión ICE para ${userId}: ${pc.iceConnectionState}`);

        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
            debugLog(`✅ Conexión ICE establecida con ${userId}`);

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
    const pc = peerConnections[senderId] || createPeerConnection(senderId);

    try {
        if (payload.sdp) {
            if (payload.sdp.type === 'offer') {
                debugLog(`Oferta SDP recibida de ${senderId}.`);
                await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'signal',
                        room: roomCode,
                        target: senderId,
                        payload: { sdp: pc.localDescription }
                    }));
                    debugLog(`Respuesta SDP enviada a ${senderId}.`);
                }
            } else if (payload.sdp.type === 'answer') {
                debugLog(`Respuesta SDP recibida de ${senderId}.`);
                await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
            }
        } else if (payload.candidate) {
            const candidateType = payload.candidate.candidate.includes('typ relay') ? 'TURN/RELAY' :
                payload.candidate.candidate.includes('typ srflx') ? 'STUN/SRFLX' :
                    payload.candidate.candidate.includes('typ host') ? 'HOST' : 'UNKNOWN';

            debugLog(`🔶 Candidato ICE recibido de ${senderId}:`);
            debugLog(`   Tipo: ${candidateType}`);

            try {
                await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
                debugLog(`   ✅ Candidato agregado exitosamente`);
            } catch (err) {
                console.error(`   ❌ Error agregando candidato ICE:`, err);
            }
        }
    } catch (e) {
        console.error(`Error procesando señal de ${senderId}:`, e);
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
        console.error(`Error reiniciando PeerConnection para ${userId}:`, e);
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
        console.log(`🎤 Tracks de audio locales: ${audioTracks.length}`);
        audioTracks.forEach(track => {
            track.enabled = isMicActive;
            console.log(`  - Track ${track.id}: enabled=${track.enabled}, readyState=${track.readyState}, muted=${track.muted}`);
        });

        // 🔊 Verificar que los senders tienen el audio
        Object.keys(peerConnections).forEach(userId => {
            const pc = peerConnections[userId];
            const audioSender = pc.getSenders().find(s => s.track && s.track.kind === 'audio');
            if (audioSender) {
                console.log(`  ✅ Sender de audio a ${userId}: enabled=${audioSender.track.enabled}`);
            } else {
                console.warn(`  ⚠️ NO hay sender de audio para ${userId}!`);
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

document.getElementById('toggleCam')?.addEventListener('click', () => {
    isCamActive = !isCamActive;
    localStream?.getVideoTracks().forEach(track => track.enabled = isCamActive);
    document.getElementById('toggleCam').classList.toggle('active', isCamActive);
    participantStates[userName].camActive = isCamActive;
    showError(isCamActive ? 'Cámara Activada' : 'Cámara Apagada', 2000);
    debugLog(`Cámara ${isCamActive ? 'activada' : 'apagada'}.`);
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
// NUEVO HANDLER PARA COMPARTIR PANTALLA - COMPLETAMENTE DESDE CERO
// ============================================================================
document.getElementById('shareScreen')?.addEventListener('click', async () => {
    if (isScreenSharing) {
        await stopScreenSharing();
    } else {
        await startScreenSharing();
    }
});

async function startScreenSharing() {
    console.log('[SCREEN-SHARE] 🚀 Iniciando proceso...');
    try {
        localScreenStream = await navigator.mediaDevices.getDisplayMedia({
            video: { cursor: 'always' },
            audio: true
        });

        isScreenSharing = true;
        document.getElementById('shareScreen')?.classList.add('active');

        // 1. Mostrar preview local
        createScreenSharePreview(userName, localScreenStream);

        // Silenciar el video local de pantalla para evitar eco/feedback
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

        console.log('[SCREEN-SHARE] 📹 Video track:', videoTrack);
        console.log('[SCREEN-SHARE] 🔊 Audio track:', audioTrack);
        console.log('[SCREEN-SHARE] 🔗 Conexiones peer activas:', Object.keys(peerConnections));

        for (const peerId in peerConnections) {
            const pc = peerConnections[peerId];
            console.log(`[SCREEN-SHARE] 📤 Agregando tracks a ${peerId}...`);

            if (videoTrack) {
                try {
                    const sender = pc.addTrack(videoTrack, localScreenStream);
                    console.log(`[SCREEN-SHARE] ✅ Video track agregado a ${peerId}:`, sender);
                } catch (e) {
                    console.error(`[SCREEN-SHARE] ❌ Error adding video track to ${peerId}:`, e);
                }
            }
            if (audioTrack) {
                try {
                    const sender = pc.addTrack(audioTrack, localScreenStream);
                    console.log(`[SCREEN-SHARE] ✅ Audio track agregado a ${peerId}:`, sender);
                } catch (e) {
                    console.error(`[SCREEN-SHARE] ❌ Error adding audio track to ${peerId}:`, e);
                }
            }

            // Renegociar
            console.log(`[SCREEN-SHARE] 🔄 Renegociando con ${peerId}...`);
            await renegotiate(peerId, pc);
            console.log(`[SCREEN-SHARE] ✅ Renegociación completada con ${peerId}`);
        }

        // 4. Manejar parada desde el navegador
        videoTrack.onended = () => {
            if (isScreenSharing) stopScreenSharing();
        };

        showError('✅ Compartiendo pantalla', 2000);

    } catch (err) {
        console.error('[SCREEN-SHARE] ❌ Error:', err);
        isScreenSharing = false;
        localScreenStream = null;
        if (err.name !== 'NotAllowedError') {
            showError('Error al compartir pantalla', 3000);
        }
    }
}

async function stopScreenSharing() {
    console.log('[SCREEN-SHARE] 🛑 Deteniendo...');

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
            // Nota: Audio de pantalla es más difícil de distinguir si no guardamos referencia, 
            // pero por ahora nos enfocamos en video.
        }

        // Renegociar
        await renegotiate(peerId, pc);
    }

    // 3. Limpiar UI y estado
    removeScreenSharePreview(userName);
    isScreenSharing = false;
    localScreenStream = null;
    document.getElementById('shareScreen')?.classList.remove('active');

    // Restaurar vista normal
    if (typeof setViewMode === 'function') {
        setViewMode('grid-auto');
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
    console.log(`[RENEGOTIATE] 🔄 Iniciando renegociación con ${peerId}`);
    console.log(`[RENEGOTIATE] 📊 Estado de señalización: ${pc.signalingState}`);

    if (pc.signalingState !== 'stable') {
        console.warn(`[RENEGOTIATE] ⚠️ No se puede renegociar, estado: ${pc.signalingState}`);
        return;
    }

    try {
        const offer = await pc.createOffer();
        console.log(`[RENEGOTIATE] ✅ Oferta creada para ${peerId}`);

        await pc.setLocalDescription(offer);
        console.log(`[RENEGOTIATE] ✅ Descripción local establecida para ${peerId}`);

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'signal',
                room: roomCode,
                target: peerId,
                payload: { sdp: pc.localDescription }
            }));
            console.log(`[RENEGOTIATE] ✅ Oferta enviada al servidor para ${peerId}`);
        } else {
            console.error(`[RENEGOTIATE] ❌ WebSocket no está abierto, no se puede enviar oferta`);
        }
    } catch (e) {
        console.error(`[RENEGOTIATE] ❌ Error renegociando con ${peerId}:`, e);
    }
}

// Alias para mantener compatibilidad con el código de initWebSocket
function handleRemoteScreenShare(userId, stream) {
    // Si ya existe un placeholder, asignar el stream al video existente
    const preview = document.getElementById(`screen-preview-${userId}`);
    if (preview) {
        const videoEl = preview.querySelector('video');
        if (videoEl && videoEl.srcObject !== stream) {
            videoEl.srcObject = stream;
            try { videoEl.play().catch(() => { }); } catch (e) { }
        }

        // Asegurar layout
        if (typeof setViewMode === 'function') {
            setViewMode('sidebar');
        } else if (window.ViewControl && typeof window.ViewControl.setViewMode === 'function') {
            window.ViewControl.setViewMode('sidebar');
        }
        return;
    }

    // Si no hay placeholder, crear la preview normalmente
    createScreenSharePreview(userId, stream);
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
        console.error('Error: #pollCreationModal no encontrado.');
        showError('Error interno: No se pudo abrir el creador de votaciones.', 5000);
    }
}

function addPollOption() {
    const optionsContainer = document.getElementById('pollOptionsContainer');
    if (!optionsContainer) {
        console.error('Error: #pollOptionsContainer no encontrado.');
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
        console.error('Error: #pollPanel o #submitVoteBtn no encontrado en el DOM.');
        showError('Error interno: Panel de votación no encontrado.', 5000);
        return;
    }

    if (!poll || !poll.question || !poll.options || !Array.isArray(poll.options)) {
        console.error('Error: Objeto de votación inválido recibido:', poll);
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

    if (currentPoll?.timerInterval) {
        clearInterval(currentPoll.timerInterval);
        currentPoll.timerInterval = null;
    }
    if (currentPoll?.resultsTimerInterval) {
        clearInterval(currentPoll.resultsTimerInterval);
        currentPoll.resultsTimerInterval = null;
    }
    document.getElementById('submitVoteBtn').disabled = true;
    document.querySelectorAll('.poll-option-item input[type="radio"]').forEach(radio => radio.disabled = true);
}

function displayPollResults(results, question, options, votes) {
    debugLog('displayPollResults llamado con resultados:', results, 'pregunta:', question, 'opciones:', options, 'votos:', votes);
    const pollResultsPanel = document.getElementById('pollResultsPanel');
    if (!pollResultsPanel) {
        console.error('Error: #pollResultsPanel no encontrado en el DOM.');
        showError('Error interno: Panel de resultados de votación no encontrado.', 5000);
        return;
    }

    if (!question || !options || !Array.isArray(options)) {
        console.error('Error: Datos de resultados de votación inválidos:', question, options);
        showError('No se pudo mostrar los resultados de la votación: Datos incompletos o incorrectos.', 5000);
        return;
    }

    document.getElementById('resultsPollQuestion').textContent = question;
    pollResultsPanel.style.display = 'flex';
    pollResultsPanel.classList.remove('minimized'); // Ensure panel is not minimized initially
    debugLog('Panel de resultados de votación visible para moderador.');

    // Add event listener for minimize button
    const minimizeResultsBtn = document.getElementById('minimizeResultsBtn');
    if (minimizeResultsBtn) {
        minimizeResultsBtn.addEventListener('click', togglePollResultsPanel);
    }

    const ctx = document.getElementById('pollResultsChart').getContext('2d');
    if (ctx) {
        if (pollChart) {
            pollChart.destroy();
        }
        const labels = options.map(opt => opt.text);
        const dataCounts = options.map(opt => results[opt.id] || 0);
        const totalVotes = dataCounts.reduce((sum, count) => sum + count, 0);

        const backgroundColors = [
            '#4facfe', '#00f2fe', '#ff416c', '#ff9a00', '#00c853',
            '#8e2de2', '#4a00e0', '#fbd72b', '#f9c513', '#ff6a00'
        ].map(color => {
            const gradient = ctx.createLinearGradient(0, 0, 400, 0);
            gradient.addColorStop(0, color);
            gradient.addColorStop(1, `${color}80`);
            return gradient;
        });

        const data = {
            labels: labels,
            datasets: [{
                label: 'Número de Votos',
                data: dataCounts,
                backgroundColor: backgroundColors,
                borderColor: 'transparent',
                borderWidth: 1
            }]
        };

        const chartOptions = {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: {
                        color: 'var(--text-light)',
                        callback: function (value) {
                            if (value % 1 === 0) return value;
                        }
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.1)',
                        drawBorder: false,
                    }
                },
                y: {
                    ticks: {
                        color: 'var(--text-light)',
                        font: {
                            size: 14,
                            weight: 'bold'
                        }
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        drawBorder: false,
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            label += context.raw;
                            const percentage = totalVotes > 0 ? ((context.raw / totalVotes) * 100).toFixed(1) + '%' : '0%';
                            return label + ' (' + percentage + ')';
                        }
                    },
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    titleColor: 'var(--primary)',
                    bodyColor: 'var(--text-light)',
                    borderColor: 'var(--border-color)',
                    borderWidth: 1,
                    cornerRadius: 5,
                },
                datalabels: {
                    color: '#FFF',
                    anchor: 'end',
                    align: 'end',
                    offset: 4,
                    font: {
                        weight: 'bold',
                        size: 12
                    },
                    formatter: (value, context) => {
                        const percentage = totalVotes > 0 ? ((value / totalVotes) * 100).toFixed(0) : '0';
                        return `${value} (${percentage}%)`;
                    }
                }
            }
        };

        pollChart = new Chart(ctx, {
            type: 'bar',
            data: data,
            options: chartOptions,
            plugins: [ChartDataLabels]
        });
        debugLog('Gráfico de resultados de votación renderizado.');
    } else {
        console.error('No se pudo obtener el contexto 2D para el lienzo del gráfico de votación.');
        showError('No se pudo mostrar el gráfico de resultados de votación.', 5000);
    }

    const votesList = document.getElementById('votesList');
    if (votesList && votes && Array.isArray(votes) && votes.length > 0) {
        votesList.innerHTML = '<h4 style="margin-top: 24px; margin-bottom: 12px; color: var(--primary-light); font-size: 16px; font-weight: 600;">📋 Lista de Votantes:</h4>';
        votes.forEach(vote => {
            const li = document.createElement('li');
            li.className = 'vote-item';
            li.style.cssText = `
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 12px 16px;
                margin-bottom: 8px;
                background: linear-gradient(145deg, var(--glass-bg) 0%, var(--glass-hover) 100%);
                border-radius: 12px;
                border: 1px solid var(--glass-border);
                backdrop-filter: blur(12px);
                transition: all 0.3s ease;
            `;

            const voterName = document.createElement('span');
            voterName.textContent = vote.voter;
            voterName.style.cssText = 'font-weight: 600; color: var(--text-primary);';

            const voteOption = document.createElement('span');
            voteOption.textContent = vote.optionText;
            voteOption.style.cssText = `
                padding: 4px 12px;
                background: linear-gradient(145deg, var(--primary) 0%, var(--primary-light) 100%);
                color: white;
                border-radius: 8px;
                font-size: 13px;
                font-weight: 500;
            `;

            li.appendChild(voterName);
            li.appendChild(voteOption);
            votesList.appendChild(li);

            // Efecto hover
            li.addEventListener('mouseenter', () => {
                li.style.transform = 'translateX(4px)';
                li.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
            });
            li.addEventListener('mouseleave', () => {
                li.style.transform = 'translateX(0)';
                li.style.boxShadow = 'none';
            });
        });
    } else if (votesList) {
        votesList.innerHTML = '<p style="margin-top: 20px; color: var(--text-tertiary); text-align: center; font-style: italic;">No hay votos registrados aún.</p>';
    }

    if (isModerator && currentPoll && currentPoll.endTime) {
        const pollResultsTimer = document.getElementById('pollResultsTimer');
        if (pollResultsTimer) pollResultsTimer.style.display = 'block';
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
        document.getElementById('closePollResultsPanel').style.display = 'block';
    } else if (!isModerator) {
        document.getElementById('closeResultsBtn').style.display = 'block';
        document.getElementById('endPollBtn').style.display = 'none';
    }
}

function startResultsTimer(durationSeconds) {
    const timerDisplay = document.getElementById('pollResultsTimer');
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
        timerDisplay.textContent = `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;

        if (seconds <= 0) {
            // ✅ Usar la referencia local en lugar de currentPoll
            if (intervalId) {
                clearInterval(intervalId);
                intervalId = null;
            }
            timerDisplay.textContent = "¡Votación terminada!";
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

    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'end-poll',
            room: roomCode,
            pollId: currentPoll.id
        }));
        showError('Votación finalizada manualmente.', 3000);
        debugLog('Votación finalizada manualmente por moderador.');
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
        if (currentPoll?.resultsTimerInterval) {
            clearInterval(currentPoll.resultsTimerInterval);
            currentPoll.resultsTimerInterval = null;
        }
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

// Función para monitorear salud de las conexiones
async function checkConnectionsHealth() {
    debugLog('🔍 Verificando salud de las conexiones...');

    for (const [userId, pc] of Object.entries(peerConnections)) {
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
                console.error(`Error obteniendo estadísticas para ${userId}:`, e);
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
    console.log('[DOM] DOMContentLoaded disparado');
    console.log('[DOM] roomCode:', roomCode);
    console.log('[DOM] userName:', userName);
    console.log('[DOM] isModerator:', isModerator);

    if (!roomCode) {
        console.error('[DOM] ERROR: Código de sala no proporcionado en la URL');
        showError('Código de sala no proporcionado en la URL. Redirigiendo...', 5000);
        debugLog('Código de sala no encontrado. Redirigiendo.');
        setTimeout(() => window.location.href = '/', 3000);
        return;
    }

    // Inicializar elementos del DOM
    const roomCodeElement = document.getElementById('roomCode');
    console.log('[DOM] roomCodeElement:', roomCodeElement);
    if (roomCodeElement) {
        roomCodeElement.textContent = roomCode;
        console.log('[DOM] Código de sala establecido en el DOM:', roomCode);
    } else {
        console.error('[DOM] ERROR: Elemento roomCode no encontrado en el DOM');
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
        console.error('❌ ERROR: Contenedor de videos (#videoGrid) no encontrado');
    }

    await initMedia();
    initWebSocket();

    // Iniciar monitoreo periódico de salud de conexiones (cada 30 segundos)
    setInterval(checkConnectionsHealth, 30000);

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
        console.log('[INIT] ✅ Botón "Quitar palabra" encontrado y configurando listener');
        endWordBtn.addEventListener('click', () => {
            console.log('[END-WORD-BTN] 🔴 Botón clickeado');
            console.log('[END-WORD-BTN] currentSpeaker:', currentSpeaker);
            console.log('[END-WORD-BTN] isModerator:', isModerator);

            if (currentSpeaker && isModerator) {
                console.log('[END-WORD-BTN] ✅ Condiciones cumplidas, llamando a takeWordFromParticipant()');
                takeWordFromParticipant();
            } else {
                if (!currentSpeaker) {
                    console.log('[END-WORD-BTN] ❌ No hay nadie con la palabra actualmente');
                }
                if (!isModerator) {
                    console.log('[END-WORD-BTN] ❌ Usuario no es moderador');
                }
            }
        });
        console.log('[INIT] ✅ Listener para botón "Quitar palabra" configurado');
    } else {
        console.error('[INIT] ❌ ERROR: No se encontró el botón #endWordBtn');
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
                console.log('Panel de resultados minimizado desde script.js');
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
                console.log('Panel de resultados restaurado desde script.js');
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
        console.log('[JOIN] Usando URL local:', baseUrl);
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
            console.error('Error al copiar:', err);
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
