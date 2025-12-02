/**
 * Control de Modales de Votación (Creación, Activa, Resultados)
 * Maneja minimizar, cerrar y restaurar los paneles.
 */

(function() {
    const POLL_DEBUG_MODE = false; // Cambiar a true para ver logs
    
    function pollLog(...args) {
        if (POLL_DEBUG_MODE) console.log('[POLL CONTROL]', ...args);
    }
    
    function initAllPollControls() {
        pollLog('Inicializando TODOS los controles de votación...');
        
        initPollCreationModal();
        initActivePollPanel();
        initPollResultsPanel();
    }

    // ==========================================
    // 1. MODAL DE CREACIÓN DE VOTACIÓN
    // ==========================================
    function initPollCreationModal() {
        const modal = document.getElementById('pollCreationModal');
        if (!modal) return;

        const minimizeBtn = modal.querySelector('.minimize-modal');
        const closeBtn = modal.querySelector('.close-modal');
        const restoreBtn = modal.querySelector('.restore-modal');
        const modalContent = modal.querySelector('.modal-content');

        // Minimizar
        if (minimizeBtn) {
            const newBtn = minimizeBtn.cloneNode(true);
            minimizeBtn.parentNode.replaceChild(newBtn, minimizeBtn);
            newBtn.onclick = function(e) {
                e.preventDefault(); e.stopPropagation();
                pollLog('Minimizando modal creación...');
                modal.classList.add('minimized');
                return false;
            };
        }

        // Cerrar
        if (closeBtn) {
            const newBtn = closeBtn.cloneNode(true);
            closeBtn.parentNode.replaceChild(newBtn, closeBtn);
            newBtn.onclick = function(e) {
                e.preventDefault(); e.stopPropagation();
                pollLog('Cerrando modal creación...');
                modal.style.display = 'none';
                modal.classList.remove('minimized');
                if (modalContent) modalContent.style.transform = '';
                if (typeof window.clearPollCreationForm === 'function') window.clearPollCreationForm();
                return false;
            };
        }

        // Botón Restaurar
        if (restoreBtn) {
            const newBtn = restoreBtn.cloneNode(true);
            restoreBtn.parentNode.replaceChild(newBtn, restoreBtn);
            newBtn.onclick = function(e) {
                e.preventDefault(); e.stopPropagation();
                pollLog('Restaurando modal creación (botón)...');
                modal.classList.remove('minimized');
                if (modalContent) modalContent.style.transform = '';
                return false;
            };
        }

        // Restaurar al hacer click en área minimizada
        modal.onclick = function(e) {
            if (!modal.classList.contains('minimized')) return;
            const target = e.target;
            if (target.closest('button')) return;
            
            if (target.closest('.minimized-view') || target.closest('.modal-content')) {
                pollLog('Restaurando modal creación (click)...');
                modal.classList.remove('minimized');
                if (modalContent) modalContent.style.transform = '';
            }
        };

        // Override global open
        window.openPollCreationModal = function() {
            pollLog('Abriendo modal creación...');
            modal.style.display = 'flex';
            modal.classList.remove('minimized');
            if (modalContent) modalContent.style.transform = '';
            if (typeof window.clearPollCreationForm === 'function') window.clearPollCreationForm();
        };
    }

    // ==========================================
    // 2. PANEL DE VOTACIÓN ACTIVA (Participantes)
    // ==========================================
    function initActivePollPanel() {
        const panel = document.getElementById('pollPanel');
        if (!panel) return;

        const minimizeBtn = panel.querySelector('.minimize-btn');
        const closeBtn = panel.querySelector('.close-poll-btn');

        // Minimizar
        if (minimizeBtn) {
            const newBtn = minimizeBtn.cloneNode(true);
            minimizeBtn.parentNode.replaceChild(newBtn, minimizeBtn);
            newBtn.onclick = function(e) {
                e.preventDefault(); e.stopPropagation();
                panel.classList.add('minimized');
                return false;
            };
        }

        // Cerrar
        if (closeBtn) {
            const newBtn = closeBtn.cloneNode(true);
            closeBtn.parentNode.replaceChild(newBtn, closeBtn);
            newBtn.onclick = function(e) {
                e.preventDefault(); e.stopPropagation();
                panel.style.display = 'none';
                panel.classList.remove('minimized');
                return false;
            };
        }

        // Restaurar
        panel.onclick = function(e) {
            if (!panel.classList.contains('minimized')) return;
            const target = e.target;
            
            // Evitar restaurar si se clickea en botones (aunque estén ocultos por CSS, por seguridad)
            if (target.closest('button')) return;

            // Restaurar al hacer click en cualquier parte del panel minimizado
            pollLog('Restaurando panel activa...');
            panel.classList.remove('minimized');
        };
    }

    // ==========================================
    // 3. PANEL DE RESULTADOS
    // ==========================================
    function initPollResultsPanel() {
        const panel = document.getElementById('pollResultsPanel');
        if (!panel) return;

        const minimizeBtn = document.getElementById('minimizePollResultsBtn') || panel.querySelector('.minimize-btn');
        const closeBtn = document.getElementById('closePollResultsPanel') || panel.querySelector('.close-modal');
        const restoreBtn = panel.querySelector('.restore-modal');
        const modalContent = panel.querySelector('.modal-content');

        // Función para restaurar y limpiar notificaciones
        function restorePanel() {
            pollLog('Restaurando panel resultados...');
            panel.classList.remove('minimized');
            if (modalContent) modalContent.style.transform = '';
            
            // Limpiar notificaciones de votos
            if (typeof window.clearPollNotifications === 'function') {
                window.clearPollNotifications();
            }
            
            // También actualizar los resultados si hay currentPoll
            if (window.currentPoll && typeof window.displayPollResults === 'function') {
                window.displayPollResults(
                    window.currentPoll.results, 
                    window.currentPoll.question, 
                    window.currentPoll.options, 
                    window.currentPoll.votes
                );
            }
        }

        // Minimizar
        if (minimizeBtn) {
            const newBtn = minimizeBtn.cloneNode(true);
            minimizeBtn.parentNode.replaceChild(newBtn, minimizeBtn);
            newBtn.onclick = function(e) {
                e.preventDefault(); e.stopPropagation();
                pollLog('Minimizando panel resultados...');
                panel.classList.add('minimized');
                return false;
            };
        }

        // Cerrar
        if (closeBtn) {
            const newBtn = closeBtn.cloneNode(true);
            closeBtn.parentNode.replaceChild(newBtn, closeBtn);
            newBtn.onclick = function(e) {
                e.preventDefault(); e.stopPropagation();
                pollLog('Cerrando panel resultados...');
                panel.style.display = 'none';
                panel.classList.remove('minimized');
                if (modalContent) modalContent.style.transform = '';
                
                // Limpiar notificaciones al cerrar
                if (typeof window.clearPollNotifications === 'function') {
                    window.clearPollNotifications();
                }
                return false;
            };
        }

        // Botón Restaurar
        if (restoreBtn) {
            const newBtn = restoreBtn.cloneNode(true);
            restoreBtn.parentNode.replaceChild(newBtn, restoreBtn);
            newBtn.onclick = function(e) {
                e.preventDefault(); e.stopPropagation();
                restorePanel();
                return false;
            };
        }

        // Restaurar al click en área minimizada
        panel.onclick = function(e) {
            if (!panel.classList.contains('minimized')) return;
            const target = e.target;
            
            if (target.closest('button')) return;

            if (target.closest('.minimized-results-text') || target.closest('.minimized-results-view') || target.closest('.modal-content')) {
                restorePanel();
            }
        };
    }

    // Inicializar
    if (document.readyState === 'complete') {
        initAllPollControls();
    } else {
        window.addEventListener('load', initAllPollControls);
    }
})();
