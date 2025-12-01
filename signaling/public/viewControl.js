/**
 * SISTEMA DE CONTROL DE VISTAS - TOTALMENTE INDEPENDIENTE
 * 
 * Este archivo maneja únicamente la lógica de las vistas de video.
 * No interfiere con WebRTC, chat, polls, ni ninguna otra funcionalidad.
 * 
 * @version 3.1 - CORREGIDO Y FUNCIONAL
 * @date 2025-01-05
 */

// ============================================
// ESTADO GLOBAL DEL SISTEMA DE VISTAS
// ============================================

const ViewControlSystem = {
    currentView: 'grid-auto',
    participantsPerPage: 9,
    currentPage: 1,
    pinnedPeerId: null,
    activeSpeakerId: null,
    initialized: false,
    observer: null,
    isChangingLayout: false
};

// ============================================
// UTILIDADES Y LOG
// ============================================

function viewLog(message, ...args) {
    console.log(`[VIEW CONTROL] ${message}`, ...args);
}

// ============================================
// INICIALIZACIÓN
// ============================================

function initViewControl() {
    if (ViewControlSystem.initialized) {
        viewLog('⚠️ Sistema ya inicializado');
        return;
    }

    viewLog('🚀 Inicializando sistema de control de vistas...');

    // Setup botones del panel
    setupViewControlPanel();

    // Setup opciones de vista
    setupViewOptions();

    // Setup paginación
    setupPagination();

    // Setup observer para cambios en el DOM
    setupDOMObserver();

    // Aplicar vista inicial
    setTimeout(() => {
        const initialView = 'grid-auto';
        setViewMode(initialView);
        ViewControlSystem.initialized = true;
        viewLog(`✅ Sistema de control de vistas inicializado con vista: ${initialView}`);
    }, 1000);
}

// ============================================
// SETUP DE CONTROLES
// ============================================

function setupViewControlPanel() {
    const viewControlToggle = document.getElementById('viewControlToggle');
    const viewControlPanel = document.getElementById('viewControlPanel');
    const viewControlOverlay = document.getElementById('viewControlOverlay');
    const closeViewControl = document.getElementById('closeViewControl');

    if (!viewControlToggle || !viewControlPanel || !viewControlOverlay) {
        viewLog('⚠️ Elementos del panel no encontrados');
        return;
    }

    // Toggle del panel
    viewControlToggle.addEventListener('click', () => {
        const isActive = viewControlPanel.classList.contains('active');
        if (isActive) {
            closeViewControlPanel();
        } else {
            openViewControlPanel();
        }
    });

    // Botón de cerrar
    if (closeViewControl) {
        closeViewControl.addEventListener('click', closeViewControlPanel);
    }

    // Cerrar con overlay
    viewControlOverlay.addEventListener('click', closeViewControlPanel);

    viewLog('✅ Panel de control configurado');
}

function openViewControlPanel() {
    const viewControlPanel = document.getElementById('viewControlPanel');
    const viewControlOverlay = document.getElementById('viewControlOverlay');
    const viewControlToggle = document.getElementById('viewControlToggle');

    if (viewControlPanel && viewControlOverlay && viewControlToggle) {
        viewControlPanel.classList.add('active');
        viewControlOverlay.classList.add('active');
        viewControlToggle.classList.add('active');
        document.body.classList.add('view-control-open');

        viewLog('📖 Panel abierto');
    }
}

function closeViewControlPanel() {
    const viewControlPanel = document.getElementById('viewControlPanel');
    const viewControlOverlay = document.getElementById('viewControlOverlay');
    const viewControlToggle = document.getElementById('viewControlToggle');

    if (viewControlPanel && viewControlOverlay && viewControlToggle) {
        viewControlPanel.classList.remove('active');
        viewControlOverlay.classList.remove('active');
        viewControlToggle.classList.remove('active');
        document.body.classList.remove('view-control-open');

        viewLog('📕 Panel cerrado');
    }
}

function setupViewOptions() {
    const viewOptions = document.querySelectorAll('.view-option');

    viewOptions.forEach(option => {
        option.addEventListener('click', () => {
            const view = option.dataset.view;

            // Actualizar UI
            viewOptions.forEach(opt => opt.classList.remove('active'));
            option.classList.add('active');

            // Cambiar vista
            setViewMode(view);

            // Cerrar panel después de seleccionar
            setTimeout(closeViewControlPanel, 300);
        });
    });

    // Marcar vista inicial como activa
    const initialOption = document.querySelector('.view-option[data-view="grid-auto"]');
    if (initialOption) {
        initialOption.classList.add('active');
    }

    viewLog('✅ Opciones de vista configuradas');
}

function setupPagination() {
    const participantsPerPageSelect = document.getElementById('participantsPerPageSelect');
    const prevPageBtn = document.getElementById('prevPageBtn');
    const nextPageBtn = document.getElementById('nextPageBtn');

    if (participantsPerPageSelect) {
        participantsPerPageSelect.addEventListener('change', (e) => {
            const value = e.target.value;
            ViewControlSystem.participantsPerPage = value === 'all' ? 'all' : parseInt(value);
            ViewControlSystem.currentPage = 1;
            updatePagination();
            viewLog(`📊 Participantes por página: ${ViewControlSystem.participantsPerPage}`);
        });
    }

    if (prevPageBtn) {
        prevPageBtn.addEventListener('click', () => {
            if (ViewControlSystem.currentPage > 1) {
                ViewControlSystem.currentPage--;
                updatePagination();
            }
        });
    }

    if (nextPageBtn) {
        nextPageBtn.addEventListener('click', () => {
            const videoGrid = document.getElementById('videoGrid');
            if (!videoGrid) return;

            const videos = videoGrid.querySelectorAll('.video-container:not(.local)');
            const totalPages = Math.ceil(videos.length / ViewControlSystem.participantsPerPage);

            if (ViewControlSystem.currentPage < totalPages) {
                ViewControlSystem.currentPage++;
                updatePagination();
            }
        });
    }

    viewLog('✅ Paginación configurada');
}

function setupDOMObserver() {
    const videoGrid = document.getElementById('videoGrid');

    if (!videoGrid) {
        viewLog('⚠️ VideoGrid no encontrado para observer');
        return;
    }

    let observerTimeout = null;

    ViewControlSystem.observer = new MutationObserver(() => {
        if (ViewControlSystem.isChangingLayout) {
            return;
        }

        clearTimeout(observerTimeout);
        observerTimeout = setTimeout(() => {
            if (ViewControlSystem.currentView && ViewControlSystem.initialized) {
                const allVideos = Array.from(videoGrid.querySelectorAll('.video-container'));
                const realVideos = allVideos.filter(v =>
                    !v.classList.contains('spotlight-thumbnails') &&
                    !v.classList.contains('sidebar-videos')
                );

                if (realVideos.length > 0) {
                    viewLog('🔄 DOM cambió, re-aplicando layout');
                    ViewControlSystem.isChangingLayout = true;
                    applyLayout(ViewControlSystem.currentView, videoGrid, realVideos);
                    updatePagination();
                    ViewControlSystem.isChangingLayout = false;
                }
            }
        }, 500);
    });

    ViewControlSystem.observer.observe(videoGrid, {
        childList: true,
        subtree: false
    });

    viewLog('✅ Observer de DOM configurado');
}

// ============================================
// CAMBIO DE VISTA PRINCIPAL
// ============================================

function setViewMode(mode) {
    viewLog(`🎯 Cambiando vista a: ${mode}`);

    ViewControlSystem.isChangingLayout = true;

    try {
        ViewControlSystem.currentView = mode;
        const videoGrid = document.getElementById('videoGrid');

        if (!videoGrid) {
            viewLog('❌ VideoGrid no encontrado');
            return;
        }

        // ✅ PRIMERO: Identificar si hay screen share ANTES de limpiar
        const screenSharePreview = videoGrid.querySelector('.screen-share, .screen-share-preview, [id^="screen-preview-"]');
        if (screenSharePreview) {
            viewLog(`📺 Screen share detectado: ${screenSharePreview.id}`);
            // Asegurar que tiene las clases correctas
            screenSharePreview.classList.add('screen-share');
        }

        const allVideos = Array.from(videoGrid.querySelectorAll('.video-container'));

        if (allVideos.length === 0) {
            viewLog('⚠️ No hay videos para mostrar');
            return;
        }

        // PASO 1: Limpiar todo
        cleanupAllLayouts(videoGrid, allVideos);

        // ✅ Re-capturar videos después de la limpieza (puede haber cambiado el orden)
        const cleanedVideos = Array.from(videoGrid.querySelectorAll('.video-container'));

        // PASO 2: Aplicar nuevo layout con screen share como PRINCIPAL
        applyLayout(mode, videoGrid, cleanedVideos);

        // PASO 3: Actualizar paginación
        updatePagination();

        viewLog(`✅ Vista cambiada exitosamente a: ${mode}`);
    } catch (e) {
        console.error('❌ Error cambiando vista:', e);
    } finally {
        setTimeout(() => {
            ViewControlSystem.isChangingLayout = false;
        }, 100);
    }
}

// ============================================
// LIMPIEZA Y APLICACIÓN DE LAYOUTS
// ============================================

function cleanupAllLayouts(videoGrid, allVideos) {
    // Remover contenedores especiales (incluyendo sidebar-videos-container)
    const specialContainers = videoGrid.querySelectorAll('.spotlight-thumbnails, .sidebar-videos, .sidebar-videos-container');
    specialContainers.forEach(container => {
        const videos = container.querySelectorAll('.video-container');
        videos.forEach(video => videoGrid.appendChild(video));
        container.remove();
    });

    // Reset del grid
    const gridId = videoGrid.id;
    videoGrid.className = '';
    videoGrid.id = gridId;
    videoGrid.removeAttribute('style');

    // Limpiar todos los estilos inline de los videos (EXCEPTO screen-share)
    allVideos.forEach(video => {
        video.classList.remove('spotlight-main', 'main-video', 'active-speaker', 'pinned');
        // ✅ NO limpiar estilos de screen-share preview
        if (!video.classList.contains('screen-share') && !video.classList.contains('screen-share-preview')) {
            video.style.cssText = '';
            video.removeAttribute('style');
        }
    });
}

function applyLayout(mode, videoGrid, allVideos) {
    // Agregar clase del modo
    videoGrid.classList.add(`view-${mode}`);

    // ✅ DETECTAR SI HAY SCREEN SHARE ACTIVO (por clase o por ID)
    const hasScreenShare = allVideos.some(v => 
        v.classList.contains('screen-share') || 
        v.classList.contains('screen-share-preview') ||
        (v.id && v.id.startsWith('screen-preview-'))
    );
    
    // Si hay screen share activo, forzar modo sidebar para mejor visualización
    if (hasScreenShare && mode !== 'sidebar' && mode !== 'active-speaker') {
        viewLog('📺 Screen share detectado, forzando modo sidebar');
        mode = 'sidebar';
    }

    // Aplicar layout específico
    switch (mode) {
        case 'grid-auto':
            applyGridAutoLayout(videoGrid, allVideos);
            break;
        case 'grid-fixed-4':
            applyGridFixedLayout(videoGrid, allVideos, 4);
            break;
        case 'grid-fixed-9':
            applyGridFixedLayout(videoGrid, allVideos, 9);
            break;
        case 'grid-many':
            applyGridManyLayout(videoGrid, allVideos);
            break;
        case 'spotlight':
            applySpotlightLayout(videoGrid, allVideos);
            break;
        case 'sidebar':
            applySidebarLayout(videoGrid, allVideos);
            break;
        case 'active-speaker':
            applyActiveSpeakerLayout(videoGrid, allVideos);
            break;
        default:
            viewLog(`⚠️ Modo desconocido: ${mode}`);
            applyGridAutoLayout(videoGrid, allVideos);
    }
}

// ============================================
// LAYOUTS ESPECÍFICOS - CORREGIDOS
// ============================================

function applyGridAutoLayout(videoGrid, allVideos) {
    const count = allVideos.length;

    // PRIORIZAR: screen share SIEMPRE primero, luego speaking, luego pinned
    const sortedVideos = [...allVideos].sort((a, b) => {
        if (a.classList.contains('screen-share')) return -1;
        if (b.classList.contains('screen-share')) return 1;
        if (a.classList.contains('speaking')) return -1;
        if (b.classList.contains('speaking')) return 1;
        if (a.classList.contains('pinned')) return -1;
        if (b.classList.contains('pinned')) return 1;
        return 0;
    });

    // Configuración base del grid
    videoGrid.style.display = 'grid';
    videoGrid.style.gap = '8px';
    videoGrid.style.width = '100%';
    videoGrid.style.height = '100%';
    videoGrid.style.padding = '8px';
    videoGrid.style.overflow = 'auto';
    videoGrid.style.boxSizing = 'border-box';

    // Calcular columnas adaptativas
    let cols = 1;
    if (count >= 2) cols = 2;
    if (count >= 3) cols = 3;
    if (count >= 5) cols = 3;
    if (count >= 7) cols = 4;
    if (count >= 10) cols = 5;

    videoGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

    // Calcular filas necesarias
    const rows = Math.ceil(count / cols);
    videoGrid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    videoGrid.style.autoRows = '1fr';

    // Reorganizar videos en el DOM según prioridad
    sortedVideos.forEach(video => {
        videoGrid.appendChild(video);
    });

    // Aplicar estilos uniformes a TODOS los videos
    sortedVideos.forEach(video => {
        video.style.display = 'block';
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.minHeight = '120px';
        video.style.objectFit = 'cover';
        video.style.borderRadius = '12px';
        video.style.overflow = 'hidden';
        video.style.gridColumn = '';
        video.style.gridRow = '';
        video.style.gridArea = '';
    });

    viewLog(`✅ Grid Auto: ${count} videos en ${cols}x${rows}`);
}

function applyGridFixedLayout(videoGrid, allVideos, maxVideos) {
    const count = allVideos.length;
    const cols = maxVideos === 4 ? 2 : 3;
    const rows = maxVideos === 4 ? 2 : 3;

    // PRIORIZAR: screen share SIEMPRE primero
    const sortedVideos = [...allVideos].sort((a, b) => {
        if (a.classList.contains('screen-share')) return -1;
        if (b.classList.contains('screen-share')) return 1;
        if (a.classList.contains('speaking')) return -1;
        if (b.classList.contains('speaking')) return 1;
        if (a.classList.contains('pinned')) return -1;
        if (b.classList.contains('pinned')) return 1;
        return 0;
    });

    videoGrid.style.display = 'grid';
    videoGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    videoGrid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    videoGrid.style.gap = '8px';
    videoGrid.style.width = '100%';
    videoGrid.style.height = '100%';
    videoGrid.style.padding = '8px';
    videoGrid.style.overflow = 'hidden';
    videoGrid.style.boxSizing = 'border-box';

    // Limitar la cantidad de videos mostrados
    const videosToShow = sortedVideos.slice(0, maxVideos);
    const videosToHide = sortedVideos.slice(maxVideos);

    // Mostrar solo los primeros N videos
    videosToShow.forEach(video => {
        video.style.display = 'block';
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.minHeight = '120px';
        video.style.objectFit = 'cover';
        video.style.borderRadius = '12px';
        video.style.overflow = 'hidden';
        video.style.gridColumn = '';
        video.style.gridRow = '';
        video.style.gridArea = '';
    });

    // Ocultar el resto de videos
    videosToHide.forEach(video => {
        video.style.display = 'none';
    });

    viewLog(`✅ Grid ${cols}x${rows}: mostrando ${videosToShow.length} de ${count} videos`);
}

function applyGridManyLayout(videoGrid, allVideos) {
    const count = allVideos.length;

    // PRIORIZAR: screen share SIEMPRE primero
    const sortedVideos = [...allVideos].sort((a, b) => {
        if (a.classList.contains('screen-share')) return -1;
        if (b.classList.contains('screen-share')) return 1;
        if (a.classList.contains('speaking')) return -1;
        if (b.classList.contains('speaking')) return 1;
        if (a.classList.contains('pinned')) return -1;
        if (b.classList.contains('pinned')) return 1;
        return 0;
    });

    // Configurar grid 5×5 exacto
    videoGrid.style.display = 'grid';
    videoGrid.style.gridTemplateColumns = 'repeat(5, 1fr)';
    videoGrid.style.gridTemplateRows = 'repeat(5, 1fr)';
    videoGrid.style.gridColumnGap = '0px';
    videoGrid.style.gridRowGap = '0px';
    videoGrid.style.gap = '4px';
    videoGrid.style.width = '100%';
    videoGrid.style.height = '100%';
    videoGrid.style.padding = '4px';
    videoGrid.style.overflow = 'hidden';
    videoGrid.style.boxSizing = 'border-box';

    // Posiciones exactas del grid 5×5 (máximo 25 videos)
    const gridPositions = [
        '1 / 1 / 2 / 2',  // div1
        '1 / 2 / 2 / 3',  // div2
        '1 / 3 / 2 / 4',  // div3
        '1 / 4 / 2 / 5',  // div4
        '1 / 5 / 2 / 6',  // div5
        '2 / 1 / 3 / 2',  // div6
        '2 / 2 / 3 / 3',  // div7
        '2 / 3 / 3 / 4',  // div8
        '2 / 4 / 3 / 5',  // div9
        '2 / 5 / 3 / 6',  // div10
        '3 / 1 / 4 / 2',  // div11
        '3 / 2 / 4 / 3',  // div12
        '3 / 3 / 4 / 4',  // div13
        '3 / 4 / 4 / 5',  // div14
        '3 / 5 / 4 / 6',  // div15
        '4 / 1 / 5 / 2',  // div16
        '4 / 2 / 5 / 3',  // div17
        '4 / 3 / 5 / 4',  // div18
        '4 / 4 / 5 / 5',  // div19
        '4 / 5 / 5 / 6',  // div20
        '5 / 1 / 6 / 2',  // div21
        '5 / 2 / 6 / 3',  // div22
        '5 / 3 / 6 / 4',  // div23
        '5 / 4 / 6 / 5',  // div24
        '5 / 5 / 6 / 6'   // div25
    ];

    // Reorganizar videos en el DOM
    sortedVideos.forEach(video => {
        videoGrid.appendChild(video);
    });

    // Mostrar hasta 25 videos en el grid 5×5
    const videosToShow = sortedVideos.slice(0, 25);
    const videosToHide = sortedVideos.slice(25);

    videosToShow.forEach((video, index) => {
        video.style.display = 'block';
        video.style.gridArea = gridPositions[index];
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.minHeight = '80px';
        video.style.objectFit = 'cover';
        video.style.borderRadius = '6px';
        video.style.overflow = 'hidden';
        video.style.gridColumn = '';
        video.style.gridRow = '';
    });

    // Ocultar videos adicionales
    videosToHide.forEach(video => {
        video.style.display = 'none';
    });

    viewLog(`✅ Grid Compacto 5×5: mostrando ${videosToShow.length} de ${count} videos`);
}

function applySpotlightLayout(videoGrid, allVideos) {
    if (allVideos.length === 0) return;

    viewLog(`Aplicando Spotlight con ${allVideos.length} videos`);

    try {
        // Video principal: SCREEN SHARE siempre primero, luego speaking, pinned
        let mainVideo = allVideos.find(v => v.classList.contains('screen-share')) ||
            allVideos.find(v => v.classList.contains('speaking')) ||
            allVideos.find(v => v.classList.contains('pinned')) ||
            allVideos[0];

        const otherVideos = allVideos.filter(v => v !== mainVideo);

        // Configurar grid para spotlight
        videoGrid.style.display = 'grid';
        videoGrid.style.gridTemplateColumns = '3fr 1fr';
        videoGrid.style.gridTemplateRows = 'repeat(4, 1fr)';
        videoGrid.style.gap = '8px';
        videoGrid.style.width = '100%';
        videoGrid.style.height = '100%';
        videoGrid.style.padding = '8px';
        videoGrid.style.overflow = 'hidden';
        videoGrid.style.boxSizing = 'border-box';

        // Video principal: ocupa toda la izquierda (4 filas)
        mainVideo.classList.add('spotlight-main');
        mainVideo.style.display = 'block';
        mainVideo.style.gridColumn = '1 / 2';
        mainVideo.style.gridRow = '1 / 5';
        mainVideo.style.width = '100%';
        mainVideo.style.height = '100%';
        mainVideo.style.objectFit = 'cover';
        mainVideo.style.borderRadius = '12px';
        mainVideo.style.overflow = 'hidden';

        // Miniaturas: máximo 4 videos (derecha vertical)
        const thumbnails = otherVideos.slice(0, 4);

        thumbnails.forEach((video, index) => {
            video.style.display = 'block';
            video.style.gridColumn = '2 / 3';
            video.style.gridRow = `${index + 1} / ${index + 2}`;
            video.style.width = '100%';
            video.style.height = '100%';
            video.style.objectFit = 'cover';
            video.style.borderRadius = '8px';
            video.style.overflow = 'hidden';
        });

        // Ocultar videos adicionales
        otherVideos.slice(4).forEach(video => {
            video.style.display = 'none';
        });

        viewLog(`✅ Spotlight: 1 principal + ${thumbnails.length} thumbnails`);
    } catch (e) {
        console.error('❌ Error en applySpotlightLayout:', e);
        applyGridAutoLayout(videoGrid, allVideos);
    }
}

function applySidebarLayout(videoGrid, allVideos) {
    if (allVideos.length === 0) return;

    viewLog(`Aplicando Sidebar con ${allVideos.length} videos`);
    viewLog(`Videos disponibles:`, allVideos.map(v => `${v.id} [${v.className}]`));

    try {
        // ✅ PRIORIDAD ABSOLUTA: Buscar SCREEN SHARE primero por múltiples métodos
        let mainVideo = null;
        
        // Método 1: Buscar por clase 'screen-share' (exacta)
        mainVideo = allVideos.find(v => v.classList.contains('screen-share'));
        if (mainVideo) viewLog('✅ mainVideo encontrado por clase screen-share:', mainVideo.id);
        
        // Método 2: Buscar por clase 'screen-share-preview'
        if (!mainVideo) {
            mainVideo = allVideos.find(v => v.classList.contains('screen-share-preview'));
            if (mainVideo) viewLog('✅ mainVideo encontrado por clase screen-share-preview:', mainVideo.id);
        }
        
        // Método 3: Buscar por ID que empiece con 'screen-preview-'
        if (!mainVideo) {
            mainVideo = allVideos.find(v => v.id && v.id.startsWith('screen-preview-'));
            if (mainVideo) viewLog('✅ mainVideo encontrado por ID screen-preview-:', mainVideo.id);
        }
        
        // Método 4: Buscar cualquier video con 'screen' en el ID
        if (!mainVideo) {
            mainVideo = allVideos.find(v => v.id && v.id.includes('screen'));
            if (mainVideo) viewLog('✅ mainVideo encontrado por ID con "screen":', mainVideo.id);
        }
        
        // Si no hay screen share, usar speaking o pinned
        if (!mainVideo) {
            mainVideo = allVideos.find(v => v.classList.contains('speaking')) ||
                allVideos.find(v => v.classList.contains('pinned'));
            if (mainVideo) viewLog('✅ mainVideo encontrado por speaking/pinned:', mainVideo.id);
        }
        
        // Fallback: primer video con stream activo
        if (!mainVideo) {
            mainVideo = allVideos.find(v => {
                const vid = v.querySelector('video');
                return vid && vid.srcObject && vid.srcObject.active;
            });
            if (mainVideo) viewLog('✅ mainVideo encontrado por stream activo:', mainVideo.id);
        }
        
        // Último fallback
        if (!mainVideo) {
            mainVideo = allVideos[0];
            viewLog('⚠️ mainVideo usando fallback [0]:', mainVideo?.id);
        }

        const otherVideos = allVideos.filter(v => v !== mainVideo);
        viewLog(`📊 mainVideo: ${mainVideo?.id}, otros: ${otherVideos.length}`);

        // ✅ VERIFICACIÓN FINAL: Si el mainVideo no tiene video element o srcObject, buscar alternativa
        const mainVideoElement = mainVideo?.querySelector('video');
        if (!mainVideoElement || !mainVideoElement.srcObject) {
            viewLog(`⚠️ mainVideo (${mainVideo?.id}) no tiene stream, revisando...`);
            // Buscar cualquier video con stream activo
            for (const v of allVideos) {
                const vid = v.querySelector('video');
                if (vid && vid.srcObject && vid.srcObject.active) {
                    // Si este video es screen share, usarlo
                    if (v.classList.contains('screen-share') || v.id?.includes('screen')) {
                        mainVideo = v;
                        viewLog(`✅ Corregido mainVideo a: ${v.id}`);
                        break;
                    }
                }
            }
        }

        // ✅ LAYOUT: Pantalla grande a la izquierda, sidebar vertical a la derecha
        videoGrid.style.display = 'grid';
        videoGrid.style.gridTemplateColumns = '1fr 280px';
        videoGrid.style.gridTemplateRows = '1fr';
        videoGrid.style.gap = '12px';
        videoGrid.style.width = '100%';
        videoGrid.style.height = '100%';
        videoGrid.style.padding = '12px';
        videoGrid.style.overflow = 'hidden';
        videoGrid.style.boxSizing = 'border-box';

        // Reorganizar: mover el video principal al inicio del DOM
        videoGrid.insertBefore(mainVideo, videoGrid.firstChild);

        // Video principal: ocupa toda la columna izquierda
        mainVideo.classList.add('main-video');
        mainVideo.style.display = 'block';
        mainVideo.style.gridColumn = '1 / 2';
        mainVideo.style.gridRow = '1 / 2';
        mainVideo.style.width = '100%';
        mainVideo.style.height = '100%';
        mainVideo.style.objectFit = 'contain';
        mainVideo.style.borderRadius = '12px';
        mainVideo.style.backgroundColor = '#000';
        mainVideo.style.overflow = 'hidden';
        
        // ✅ Asegurar que el video interno también tenga los estilos correctos
        const innerVideo = mainVideo.querySelector('video');
        if (innerVideo) {
            innerVideo.style.width = '100%';
            innerVideo.style.height = '100%';
            innerVideo.style.objectFit = 'contain';
            innerVideo.style.transform = 'scaleX(1)';
        }

        // Crear contenedor para sidebar si no existe
        let sidebarContainer = videoGrid.querySelector('.sidebar-videos-container');
        if (!sidebarContainer) {
            sidebarContainer = document.createElement('div');
            sidebarContainer.className = 'sidebar-videos-container';
            videoGrid.appendChild(sidebarContainer);
        }
        
        // Estilos del sidebar
        sidebarContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 8px;
            overflow-y: auto;
            overflow-x: hidden;
            max-height: 100%;
            padding: 4px;
        `;

        // Limpiar sidebar container
        sidebarContainer.innerHTML = '';

        // ✅ Recalcular otros videos excluyendo el mainVideo actualizado
        const finalOtherVideos = allVideos.filter(v => v !== mainVideo);

        // Mover miniaturas al sidebar container (máximo 8 visibles)
        const thumbnails = finalOtherVideos.slice(0, 8);

        thumbnails.forEach((video) => {
            video.style.display = 'block';
            video.style.width = '100%';
            video.style.height = '100%';
            video.style.minHeight = '80px';
            video.style.maxHeight = '120px';
            video.style.objectFit = 'cover';
            video.style.borderRadius = '10px';
            video.style.overflow = 'hidden';
            video.style.flexShrink = '0';
            video.style.gridColumn = '';
            video.style.gridRow = '';
            video.style.gridArea = '';
            sidebarContainer.appendChild(video);
        });

        // Ocultar videos adicionales (más de 8)
        finalOtherVideos.slice(8).forEach(video => {
            video.style.display = 'none';
        });

        viewLog(`✅ Sidebar: 1 principal (${mainVideo?.id}) + ${thumbnails.length} en sidebar`);
    } catch (e) {
        console.error('❌ Error en applySidebarLayout:', e);
        applyGridAutoLayout(videoGrid, allVideos);
    }
}

function applyActiveSpeakerLayout(videoGrid, allVideos) {
    viewLog('Aplicando Active Speaker layout');

    videoGrid.style.display = 'flex';
    videoGrid.style.flexDirection = 'column';
    videoGrid.style.alignItems = 'center';
    videoGrid.style.justifyContent = 'center';
    videoGrid.style.width = '100%';
    videoGrid.style.height = '100%';
    videoGrid.style.padding = '16px';
    videoGrid.style.overflow = 'hidden';
    videoGrid.style.boxSizing = 'border-box';

    // Ocultar todos los videos primero
    allVideos.forEach(video => {
        video.style.display = 'none';
        video.style.gridColumn = '';
        video.style.gridRow = '';
        video.style.gridArea = '';
    });

    // PRIORIZAR: screen share SIEMPRE primero, luego speaking, active-speaker
    const activeVideo = allVideos.find(v => v.classList.contains('screen-share')) ||
        allVideos.find(v => v.classList.contains('speaking')) ||
        allVideos.find(v => v.classList.contains('active-speaker')) ||
        allVideos[0];

    if (activeVideo) {
        activeVideo.style.display = 'block';
        activeVideo.style.width = '90%';
        activeVideo.style.height = '90%';
        activeVideo.style.maxWidth = '1200px';
        activeVideo.style.maxHeight = '800px';
        activeVideo.style.objectFit = 'contain';
        activeVideo.style.borderRadius = '12px';
        activeVideo.classList.add('active-speaker');
    }

    viewLog(`✅ Active Speaker: ${activeVideo ? '1 video visible' : 'ninguno'}`);
}

function updatePagination() {
    const videoGrid = document.getElementById('videoGrid');
    const paginationControls = document.getElementById('paginationControls');

    if (!videoGrid || !paginationControls) return;

    const videos = Array.from(videoGrid.querySelectorAll('.video-container:not(.local)'));
    const perPage = ViewControlSystem.participantsPerPage;
    const currentView = ViewControlSystem.currentView;

    // No paginar en ciertas vistas o cuando se muestran todos
    if (perPage === 'all' ||
        currentView === 'active-speaker' ||
        currentView === 'spotlight' ||
        currentView === 'sidebar') {
        videos.forEach(video => {
            video.style.display = '';
        });
        paginationControls.style.display = 'none';
        return;
    }

    const totalPages = Math.ceil(videos.length / perPage);

    if (totalPages <= 1) {
        paginationControls.style.display = 'none';
        videos.forEach(video => {
            video.style.display = '';
        });
        return;
    }

    // Mostrar controles
    paginationControls.style.display = 'flex';
    document.getElementById('currentPage').textContent = ViewControlSystem.currentPage;
    document.getElementById('totalPages').textContent = totalPages;

    // Actualizar botones
    document.getElementById('prevPageBtn').disabled = ViewControlSystem.currentPage === 1;
    document.getElementById('nextPageBtn').disabled = ViewControlSystem.currentPage === totalPages;

    // Mostrar/ocultar videos según la página
    const startIndex = (ViewControlSystem.currentPage - 1) * perPage;
    const endIndex = startIndex + perPage;

    videos.forEach((video, index) => {
        if (index >= startIndex && index < endIndex) {
            video.style.display = '';
        } else {
            video.style.display = 'none';
        }
    });

    viewLog(`Paginación: Página ${ViewControlSystem.currentPage}/${totalPages}`);
}

// ============================================
// API PÚBLICA - Para llamar desde script.js
// ============================================

function markActiveSpeaker(peerId) {
    if (!ViewControlSystem.initialized) return;

    ViewControlSystem.activeSpeakerId = peerId;

    const videoGrid = document.getElementById('videoGrid');
    if (!videoGrid) return;

    const allVideos = videoGrid.querySelectorAll('.video-container');

    // Remover clases anteriores (pero NO de screen-share)
    allVideos.forEach(video => {
        if (!video.classList.contains('screen-share')) {
            video.classList.remove('active-speaker', 'speaking');
        }
    });

    // Encontrar y marcar el video activo
    let activeVideo = null;
    
    if (peerId === 'local') {
        activeVideo = videoGrid.querySelector('.video-container.local');
    } else {
        // Buscar por data-peer-id
        activeVideo = Array.from(allVideos).find(video => {
            const peerElement = video.querySelector('[data-peer-id]');
            return peerElement && peerElement.getAttribute('data-peer-id') === peerId;
        });
        
        // Fallback: buscar por id del contenedor
        if (!activeVideo) {
            activeVideo = document.getElementById(`video-container-${peerId}`);
        }
        
        // Fallback: buscar por nombre en el video-info
        if (!activeVideo) {
            activeVideo = Array.from(allVideos).find(video => {
                const nameEl = video.querySelector('.user-name span, .user-name');
                return nameEl && nameEl.textContent.includes(peerId);
            });
        }
    }

    if (activeVideo && !activeVideo.classList.contains('screen-share')) {
        activeVideo.classList.add('active-speaker', 'speaking');

        // Si estamos en modo active-speaker, re-aplicar el layout
        if (ViewControlSystem.currentView === 'active-speaker') {
            const allVideosArray = Array.from(allVideos);
            applyActiveSpeakerLayout(videoGrid, allVideosArray);
        }

        viewLog(`🔊 Hablante activo: ${peerId}`);
    }
}

function refreshViewLayout() {
    if (!ViewControlSystem.initialized) return;

    const videoGrid = document.getElementById('videoGrid');
    if (!videoGrid) return;

    const allVideos = Array.from(videoGrid.querySelectorAll('.video-container'));

    if (allVideos.length > 0) {
        viewLog('🔄 Refrescando layout manualmente');
        ViewControlSystem.isChangingLayout = true;
        applyLayout(ViewControlSystem.currentView, videoGrid, allVideos);
        updatePagination();
        ViewControlSystem.isChangingLayout = false;
        
        // Configurar botones de pin después de refrescar
        setTimeout(setupPinButtons, 100);
    }
}

// ============================================
// SISTEMA DE PIN/FIJAR VIDEOS
// ============================================

function setupPinButtons() {
    // Configurar event listeners para todos los botones de pin
    const pinButtons = document.querySelectorAll('.pin-video-btn');
    
    pinButtons.forEach(btn => {
        // Evitar agregar múltiples listeners
        if (btn.dataset.listenerAdded) return;
        btn.dataset.listenerAdded = 'true';
        
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const peerId = btn.dataset.peerId || btn.dataset.peer || 'local';
            pinVideo(peerId);
        });
    });
    
    viewLog(`✅ ${pinButtons.length} botones de pin configurados`);
}

function pinVideo(peerId) {
    if (ViewControlSystem.pinnedPeerId === peerId) {
        // Si ya está pinned, des-pin
        ViewControlSystem.pinnedPeerId = null;
    } else {
        ViewControlSystem.pinnedPeerId = peerId;
    }

    // Actualizar la UI
    const videoGrid = document.getElementById('videoGrid');
    if (!videoGrid) return;

    const allVideos = videoGrid.querySelectorAll('.video-container');
    allVideos.forEach(video => {
        video.classList.remove('pinned');

        // Mostrar/ocultar indicador de pin
        const pinIndicator = video.querySelector('.pin-indicator');
        if (pinIndicator) {
            pinIndicator.style.display = 'none';
        }
    });

    // Marcar el video pinned
    if (ViewControlSystem.pinnedPeerId) {
        const pinnedVideo = Array.from(allVideos).find(video => {
            if (ViewControlSystem.pinnedPeerId === 'local') {
                return video.classList.contains('local');
            }
            const peerElement = video.querySelector('[data-peer-id]');
            return peerElement && peerElement.getAttribute('data-peer-id') === ViewControlSystem.pinnedPeerId;
        });

        if (pinnedVideo) {
            pinnedVideo.classList.add('pinned');
            const pinIndicator = pinnedVideo.querySelector('.pin-indicator');
            if (pinIndicator) {
                pinIndicator.style.display = 'block';
            }
        }
    }

    // Re-aplicar el layout si es necesario
    refreshViewLayout();

    viewLog(`📌 Video ${ViewControlSystem.pinnedPeerId ? 'pinned: ' + ViewControlSystem.pinnedPeerId : 'unpinned'}`);
}

// ============================================
// AUTO-INICIALIZACIÓN MEJORADA
// ============================================

function waitForElement(selector, callback, maxAttempts = 20, interval = 250) {
    let attempts = 0;

    function checkElement() {
        attempts++;
        const element = document.querySelector(selector);

        if (element) {
            callback(element);
        } else if (attempts < maxAttempts) {
            setTimeout(checkElement, interval);
        } else {
            console.warn(`❌ Elemento no encontrado: ${selector} después de ${maxAttempts} intentos`);
        }
    }

    checkElement();
}

// Inicialización mejorada
function initializeViewControlSystem() {
    waitForElement('#videoGrid', (videoGrid) => {
        viewLog('✅ VideoGrid encontrado, inicializando sistema...');

        // Pequeño delay para asegurar que todo esté listo
        setTimeout(() => {
            try {
                initViewControl();

                // Configurar botones de pin existentes
                setTimeout(setupPinButtons, 1000);

            } catch (error) {
                console.error('❌ Error en inicialización:', error);
            }
        }, 500);
    });
}

// Inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeViewControlSystem);
} else {
    initializeViewControlSystem();
}

// ============================================
// EXPORTAR API PÚBLICA
// ============================================

window.ViewControl = {
    markActiveSpeaker,
    refreshViewLayout,
    setViewMode,
    pinVideo
};

viewLog('📦 Módulo de control de vistas cargado y listo');
