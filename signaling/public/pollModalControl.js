/**
 * Control de Modales de Votación (Creación, Activa, Resultados)
 * Maneja minimizar, cerrar y restaurar los paneles.
 */

(function() {
    function initAllPollControls() {
        console.log('[POLL CONTROL] Inicializando TODOS los controles de votación...');
        
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
        const modalContent = modal.querySelector('.modal-content');

        // Minimizar
        if (minimizeBtn) {
            const newBtn = minimizeBtn.cloneNode(true);
            minimizeBtn.parentNode.replaceChild(newBtn, minimizeBtn);
            newBtn.onclick = function(e) {
                e.preventDefault(); e.stopPropagation();
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
                modal.style.display = 'none';
                modal.classList.remove('minimized');
                if (modalContent) modalContent.style.transform = '';
                if (typeof window.clearPollCreationForm === 'function') window.clearPollCreationForm();
                return false;
            };
        }

        // Restaurar
        modal.onclick = function(e) {
            if (!modal.classList.contains('minimized')) return;
            const target = e.target;
            if (target.closest('button') || target.closest('.minimize-modal') || target.closest('.close-modal')) return;
            
            if (target.closest('.minimized-view') || target.closest('.modal-content')) {
                console.log('[POLL CONTROL] Restaurando modal creación...');
                modal.classList.remove('minimized');
                if (modalContent) modalContent.style.transform = '';
            }
        };

        // Override global open
        window.openPollCreationModal = function() {
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
            console.log('[POLL CONTROL] Restaurando panel activa...');
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
        const modalContent = panel.querySelector('.modal-content');

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
                if (modalContent) modalContent.style.transform = '';
                return false;
            };
        }

        // Restaurar
        panel.onclick = function(e) {
            if (!panel.classList.contains('minimized')) return;
            const target = e.target;
            
            if (target.closest('button')) return;

            if (target.closest('.minimized-results-text') || target.closest('.modal-content')) {
                console.log('[POLL CONTROL] Restaurando panel resultados...');
                panel.classList.remove('minimized');
                if (modalContent) modalContent.style.transform = '';
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
