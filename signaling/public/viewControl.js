/**
 * SISTEMA DE CONTROL DE VISTAS - TOTALMENTE INDEPENDIENTE
 * 
 * Este archivo maneja únicamente la lógica de las vistas de video.
 * No interfiere con WebRTC, chat, polls, ni ninguna otra funcionalidad.
 * 
 * @version 3.0
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
    isChangingLayout: false // ✅ Flag para evitar bucles infinitos
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
    
    // Aplicar vista por defecto
    setTimeout(() => {
        setViewMode('grid-auto');
        ViewControlSystem.initialized = true;
        viewLog('✅ Sistema de control de vistas inicializado');
    }, 500);
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

    // Cerrar con ESC
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && viewControlPanel.classList.contains('active')) {
            closeViewControlPanel();
        }
    });

    viewLog('✅ Panel de control configurado');
}

function openViewControlPanel() {
    const viewControlPanel = document.getElementById('viewControlPanel');
    const viewControlOverlay = document.getElementById('viewControlOverlay');
    const viewControlToggle = document.getElementById('viewControlToggle');

    viewControlPanel.classList.add('active');
    viewControlOverlay.classList.add('active');
    viewControlToggle.classList.add('active');
    document.body.classList.add('view-control-open');
    
    viewLog('📖 Panel abierto');
}

function closeViewControlPanel() {
    const viewControlPanel = document.getElementById('viewControlPanel');
    const viewControlOverlay = document.getElementById('viewControlOverlay');
    const viewControlToggle = document.getElementById('viewControlToggle');

    viewControlPanel.classList.remove('active');
    viewControlOverlay.classList.remove('active');
    viewControlToggle.classList.remove('active');
    document.body.classList.remove('view-control-open');
    
    viewLog('📕 Panel cerrado');
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
        });
    });

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
            const videos = videoGrid.querySelectorAll('.video-container');
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
        viewLog('⚠️ VideoGrid no encontrado');
        return;
    }

    let observerTimeout = null;
    
    ViewControlSystem.observer = new MutationObserver(() => {
        // ✅ Evitar bucle infinito: solo re-aplicar después de un breve delay
        // y si NO estamos en medio de un cambio de layout
        if (ViewControlSystem.isChangingLayout) {
            return; // Ignorar mientras estamos cambiando de vista
        }
        
        // Debounce: esperar 500ms de inactividad antes de re-aplicar
        clearTimeout(observerTimeout);
        observerTimeout = setTimeout(() => {
            if (ViewControlSystem.currentView && ViewControlSystem.initialized) {
                const allVideos = Array.from(videoGrid.querySelectorAll('.video-container'));
                
                // Solo re-aplicar si hay videos reales (no contenedores especiales)
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
        subtree: false // Solo observar cambios directos, no profundos
    });

    viewLog('✅ Observer de DOM configurado');
}

// ============================================
// CAMBIO DE VISTA PRINCIPAL
// ============================================

function setViewMode(mode) {
    viewLog(`🎯 Cambiando vista a: ${mode}`);
    
    // ✅ Activar flag para evitar que el Observer interfiera
    ViewControlSystem.isChangingLayout = true;
    
    try {
        ViewControlSystem.currentView = mode;
        const videoGrid = document.getElementById('videoGrid');
        const allVideos = Array.from(videoGrid.querySelectorAll('.video-container'));
        
        if (allVideos.length === 0) {
            viewLog('⚠️ No hay videos para mostrar');
            return;
        }
        
        // PASO 1: Limpiar todo
        cleanupAllLayouts(videoGrid, allVideos);
        
        // PASO 2: Aplicar nuevo layout
        applyLayout(mode, videoGrid, allVideos);
        
        // PASO 3: Actualizar paginación
        updatePagination();
        
        viewLog(`✅ Vista cambiada exitosamente a: ${mode}`);
    } catch (e) {
        console.error('❌ Error cambiando vista:', e);
    } finally {
        // ✅ Desactivar flag después de un breve delay
        setTimeout(() => {
            ViewControlSystem.isChangingLayout = false;
        }, 100);
    }
}

// ============================================
// LIMPIEZA Y APLICACIÓN DE LAYOUTS
// ============================================

function cleanupAllLayouts(videoGrid, allVideos) {
    // Remover contenedores especiales
    const specialContainers = videoGrid.querySelectorAll('.spotlight-thumbnails, .sidebar-videos');
    specialContainers.forEach(container => {
        const videos = container.querySelectorAll('.video-container');
        videos.forEach(video => videoGrid.appendChild(video));
        container.remove();
    });
    
    // Reset clases del grid (mantener video-grid y id)
    const gridId = videoGrid.id;
    videoGrid.className = '';
    videoGrid.id = gridId; // Restaurar ID
    videoGrid.removeAttribute('style');
    
    // Limpiar estilos inline de videos pero MANTENERLOS VISIBLES
    allVideos.forEach(video => {
        video.classList.remove('spotlight-main', 'main-video', 'active-speaker');
        video.style.display = ''; // Asegurar que estén visibles
        video.style.width = '';
        video.style.height = '';
        video.style.minHeight = '';
        video.style.maxHeight = '';
        video.style.objectFit = '';
        video.style.aspectRatio = '';
        video.style.flex = '';
        video.style.margin = '';
        video.style.gridRow = '';
    });
}

function applyLayout(mode, videoGrid, allVideos) {
    // Agregar clase del modo
    videoGrid.classList.add(`view-${mode}`);
    
    // Aplicar layout específico
    switch(mode) {
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
// LAYOUTS ESPECÍFICOS
// ============================================

function applyGridAutoLayout(videoGrid, allVideos) {
    const count = allVideos.length;
    
    videoGrid.style.display = 'grid';
    videoGrid.style.gap = '12px';
    videoGrid.style.width = '100%';
    videoGrid.style.height = '100%';
    videoGrid.style.padding = '12px';
    videoGrid.style.overflow = 'hidden';
    
    // Calcular columnas adaptativas según cantidad
    let cols;
    if (count === 1) cols = 1;
    else if (count === 2) cols = 2; // 2 videos: 2 columnas (lado a lado)
    else if (count === 3) cols = 3; // 3 videos: 3 columnas (lado a lado)
    else if (count === 4) cols = 2; // 4 videos: 2x2
    else if (count <= 6) cols = 3; // 5-6 videos: 3 columnas
    else if (count <= 9) cols = 3; // 7-9 videos: 3 columnas
    else if (count <= 16) cols = 4; // 10-16 videos: 4 columnas
    else cols = 5; // 17+ videos: 5 columnas
    
    videoGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    
    // Calcular filas
    const rows = Math.ceil(count / cols);
    videoGrid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    
    // TODOS los videos visibles y del mismo tamaño
    allVideos.forEach(video => {
        video.style.display = 'block'; // SIEMPRE VISIBLE
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'cover';
        video.style.aspectRatio = '16/9';
    });
    
    viewLog(`✅ Grid Auto: ${count} videos en ${cols}x${rows}`);
}

function applyGridFixedLayout(videoGrid, allVideos, maxVideos) {
    const count = allVideos.length;
    const cols = maxVideos === 4 ? 2 : 3;
    const rows = maxVideos === 4 ? 2 : 3;
    
    videoGrid.style.display = 'grid';
    videoGrid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    videoGrid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    videoGrid.style.gap = '12px';
    videoGrid.style.width = '100%';
    videoGrid.style.height = '100%';
    videoGrid.style.padding = '12px';
    videoGrid.style.overflow = 'hidden';
    videoGrid.style.boxSizing = 'border-box'; // ✅ Asegurar que padding no cause desbordamiento
    
    // ✅ Limitar la cantidad de videos mostrados según el tipo de grid
    const videosToShow = allVideos.slice(0, maxVideos);
    const videosToHide = allVideos.slice(maxVideos);
    
    // Mostrar solo los primeros N videos (4 para 2x2, 9 para 3x3)
    videosToShow.forEach(video => {
        video.style.display = 'block'; // VISIBLE
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.maxWidth = '100%'; // ✅ Evitar desbordamiento
        video.style.maxHeight = '100%'; // ✅ Evitar desbordamiento
        video.style.objectFit = 'cover';
        video.style.aspectRatio = ''; // ✅ Remover aspect-ratio fijo para que se ajuste al grid
        video.style.boxSizing = 'border-box';
    });
    
    // Ocultar el resto de videos
    videosToHide.forEach(video => {
        video.style.display = 'none'; // OCULTO
    });
    
    viewLog(`✅ Grid ${cols}x${rows}: mostrando ${videosToShow.length} de ${count} videos (límite: ${maxVideos})`);
}

function applyGridManyLayout(videoGrid, allVideos) {
    const count = allVideos.length;
    
    videoGrid.style.display = 'grid';
    videoGrid.style.gap = '8px';
    videoGrid.style.width = '100%';
    videoGrid.style.height = '100%';
    videoGrid.style.padding = '8px';
    videoGrid.style.overflow = 'hidden';
    
    // ✅ Sistema dinámico: Grid 5x5 adaptable según cantidad de participantes
    let cols, rowSpan;
    
    if (count <= 10) {
        // Hasta 10 personas: 5 columnas, cada video ocupa 2 filas
        cols = 5;
        rowSpan = 2;
        videoGrid.style.gridTemplateColumns = 'repeat(5, 1fr)';
        videoGrid.style.gridTemplateRows = 'repeat(5, 1fr)';
        
        allVideos.forEach((video, index) => {
            video.style.display = 'block';
            video.style.width = '100%';
            video.style.height = '100%';
            video.style.objectFit = 'cover';
            video.style.aspectRatio = '';
            video.style.gridRow = 'span 2';
            
            // Posicionar en 2 filas de 5 columnas
            if (index < 5) {
                video.style.gridRowStart = '1'; // Primera fila (filas 1-2)
            } else {
                video.style.gridRowStart = '3'; // Segunda fila (filas 3-4)
            }
        });
        
        viewLog(`✅ Grid Compacto: ${count} videos en 2 filas x 5 columnas (span 2 filas cada uno)`);
        
    } else if (count <= 15) {
        // 11-15 personas: 5 columnas, 3 filas, cada video ocupa 1 fila
        cols = 5;
        videoGrid.style.gridTemplateColumns = 'repeat(5, 1fr)';
        videoGrid.style.gridTemplateRows = 'repeat(3, 1fr)';
        
        allVideos.forEach(video => {
            video.style.display = 'block';
            video.style.width = '100%';
            video.style.height = '100%';
            video.style.objectFit = 'cover';
            video.style.aspectRatio = '16/9';
            video.style.gridRow = '';
            video.style.gridRowStart = '';
        });
        
        viewLog(`✅ Grid Compacto: ${count} videos en 3 filas x 5 columnas`);
        
    } else if (count <= 25) {
        // 16-25 personas: 5 columnas, hasta 5 filas
        cols = 5;
        const rows = Math.ceil(count / cols);
        videoGrid.style.gridTemplateColumns = 'repeat(5, 1fr)';
        videoGrid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
        
        allVideos.forEach(video => {
            video.style.display = 'block';
            video.style.width = '100%';
            video.style.height = '100%';
            video.style.objectFit = 'cover';
            video.style.aspectRatio = '16/9';
            video.style.gridRow = '';
            video.style.gridRowStart = '';
        });
        
        viewLog(`✅ Grid Compacto: ${count} videos en ${rows} filas x 5 columnas`);
        
    } else {
        // Más de 25 personas: 6 columnas adaptables
        cols = 6;
        const rows = Math.ceil(count / cols);
        videoGrid.style.gridTemplateColumns = 'repeat(6, 1fr)';
        videoGrid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
        
        allVideos.forEach(video => {
            video.style.display = 'block';
            video.style.width = '100%';
            video.style.height = '100%';
            video.style.objectFit = 'cover';
            video.style.aspectRatio = '16/9';
            video.style.gridRow = '';
            video.style.gridRowStart = '';
        });
        
        viewLog(`✅ Grid Compacto: ${count} videos en ${rows} filas x 6 columnas`);
    }
}

function applySpotlightLayout(videoGrid, allVideos) {
    if (allVideos.length === 0) return;
    
    viewLog(`Aplicando Spotlight con ${allVideos.length} videos`);
    
    // Si solo hay 1 video, usar grid simple
    if (allVideos.length === 1) {
        videoGrid.style.display = 'grid';
        videoGrid.style.gridTemplateColumns = '1fr';
        videoGrid.style.gap = '12px';
        allVideos[0].style.display = 'block';
        allVideos[0].style.width = '100%';
        allVideos[0].style.height = '100%';
        return;
    }
    
    try {
        // Video principal (hablando, pinned, o primero)
        let mainVideo = allVideos.find(v => v.classList.contains('speaking')) ||
                       allVideos.find(v => v.classList.contains('pinned')) ||
                       allVideos[0];
        
        // ✅ Configuración tipo Google Meet: Grid 5x5
        videoGrid.style.display = 'grid';
        videoGrid.style.gridTemplateColumns = 'repeat(5, 1fr)';
        videoGrid.style.gridTemplateRows = 'repeat(5, 1fr)';
        videoGrid.style.gap = '8px';
        videoGrid.style.width = '100%';
        videoGrid.style.height = '100%';
        videoGrid.style.padding = '10px';
        videoGrid.style.overflow = 'hidden';
        
        // Ordenar videos: principal primero
        const otherVideos = allVideos.filter(v => v !== mainVideo);
        
        // ✅ Video principal: ocupa 3 columnas x 5 filas (lado izquierdo)
        mainVideo.classList.add('spotlight-main');
        mainVideo.style.display = 'block';
        mainVideo.style.gridColumn = 'span 3';
        mainVideo.style.gridRow = 'span 5';
        mainVideo.style.width = '100%';
        mainVideo.style.height = '100%';
        mainVideo.style.objectFit = 'cover';
        
        // ✅ Miniaturas: máximo 4 videos en formato 2x2 en el lado derecho
        const thumbnails = otherVideos.slice(0, 4);
        const positions = [
            { column: 4, row: 1, span: 2 }, // div2: columna 4, fila 1, ocupa 2 filas
            { column: 5, row: 1, span: 2 }, // div3: columna 5, fila 1, ocupa 2 filas
            { column: 4, row: 3, span: 2 }, // div4: columna 4, fila 3, ocupa 2 filas
            { column: 5, row: 3, span: 2 }  // div5: columna 5, fila 3, ocupa 2 filas
        ];
        
        thumbnails.forEach((video, index) => {
            const pos = positions[index];
            video.style.display = 'block';
            video.style.gridColumnStart = pos.column.toString();
            video.style.gridRowStart = pos.row.toString();
            video.style.gridRow = `span ${pos.span}`;
            video.style.width = '100%';
            video.style.height = '100%';
            video.style.objectFit = 'cover';
        });
        
        // Ocultar videos adicionales si hay más de 4 miniaturas
        otherVideos.slice(4).forEach(video => {
            video.style.display = 'none';
        });
        
        viewLog(`✅ Spotlight OK: 1 principal + ${thumbnails.length} thumbnails en grid 2x2`);
    } catch (e) {
        console.error('❌ Error en applySpotlightLayout:', e);
        // Fallback a grid normal
        applyGridAutoLayout(videoGrid, allVideos);
    }
}

function applySidebarLayout(videoGrid, allVideos) {
    if (allVideos.length === 0) return;
    
    viewLog(`Aplicando Sidebar con ${allVideos.length} videos`);
    
    // Si solo hay 1 video, usar grid simple
    if (allVideos.length === 1) {
        videoGrid.style.display = 'grid';
        videoGrid.style.gridTemplateColumns = '1fr';
        videoGrid.style.gap = '8px';
        allVideos[0].style.display = 'block';
        allVideos[0].style.width = '100%';
        allVideos[0].style.height = '100%';
        return;
    }
    
    try {
        // Video principal
        let mainVideo = allVideos.find(v => v.classList.contains('speaking')) ||
                       allVideos.find(v => v.classList.contains('pinned')) ||
                       allVideos[0];
        
        // ✅ Grid 7x5: 4 columnas para principal + 3 columnas para sidebar (15 miniaturas)
        videoGrid.style.display = 'grid';
        videoGrid.style.gridTemplateColumns = 'repeat(7, 1fr)';
        videoGrid.style.gridTemplateRows = 'repeat(5, 1fr)';
        videoGrid.style.gap = '8px';
        videoGrid.style.width = '100%';
        videoGrid.style.height = '100%';
        videoGrid.style.padding = '8px';
        videoGrid.style.overflow = 'hidden';
        
        const otherVideos = allVideos.filter(v => v !== mainVideo);
        
        // ✅ Video principal: grid-area: 1 / 1 / 6 / 5 (ocupa columnas 1-4, filas 1-5)
        mainVideo.classList.add('main-video');
        mainVideo.style.display = 'block';
        mainVideo.style.gridArea = '1 / 1 / 6 / 5';
        mainVideo.style.width = '100%';
        mainVideo.style.height = '100%';
        mainVideo.style.objectFit = 'cover';
        
        // ✅ Miniaturas en sidebar: máximo 15 videos en columnas 5-7
        const thumbnails = otherVideos.slice(0, 15);
        
        // Definir posiciones para las 15 miniaturas (3 columnas x 5 filas)
        const positions = [
            '1 / 5 / 2 / 6',  // div2: fila 1, columna 5
            '1 / 6 / 2 / 7',  // div3: fila 1, columna 6
            '1 / 7 / 2 / 8',  // div4: fila 1, columna 7
            '2 / 5 / 3 / 6',  // div5: fila 2, columna 5
            '2 / 6 / 3 / 7',  // div6: fila 2, columna 6
            '2 / 7 / 3 / 8',  // div7: fila 2, columna 7
            '3 / 5 / 4 / 6',  // div8: fila 3, columna 5
            '3 / 6 / 4 / 7',  // div9: fila 3, columna 6
            '3 / 7 / 4 / 8',  // div10: fila 3, columna 7
            '4 / 5 / 5 / 6',  // div11: fila 4, columna 5
            '4 / 6 / 5 / 7',  // div12: fila 4, columna 6
            '4 / 7 / 5 / 8',  // div13: fila 4, columna 7
            '5 / 5 / 6 / 6',  // div14: fila 5, columna 5
            '5 / 6 / 6 / 7',  // div15: fila 5, columna 6
            '5 / 7 / 6 / 8'   // div16: fila 5, columna 7
        ];
        
        thumbnails.forEach((video, index) => {
            video.style.display = 'block';
            video.style.gridArea = positions[index];
            video.style.width = '100%';
            video.style.height = '100%';
            video.style.objectFit = 'cover';
            video.style.gridColumn = '';
            video.style.gridRow = '';
        });
        
        // Ocultar videos adicionales si hay más de 15 miniaturas
        otherVideos.slice(15).forEach(video => {
            video.style.display = 'none';
        });
        
        viewLog(`✅ Sidebar OK: 1 principal + ${thumbnails.length} miniaturas en grid 7x5`);
    } catch (e) {
        console.error('❌ Error en applySidebarLayout:', e);
        // Fallback a grid normal
        applyGridAutoLayout(videoGrid, allVideos);
    }
}

function applyActiveSpeakerLayout(videoGrid, allVideos) {
    videoGrid.style.display = 'flex';
    videoGrid.style.justifyContent = 'center';
    videoGrid.style.alignItems = 'center';
    videoGrid.style.width = '100%';
    videoGrid.style.height = '100%';
    videoGrid.style.padding = '20px';
    videoGrid.style.overflow = 'hidden';
    
    // Ocultar todos MENOS el hablante activo
    allVideos.forEach(video => {
        video.style.display = 'none';
    });
    
    // Mostrar solo el hablante activo
    const speakingVideo = allVideos.find(v => v.classList.contains('speaking')) ||
                         allVideos.find(v => v.classList.contains('active-speaker')) ||
                         allVideos[0];
    
    if (speakingVideo) {
        speakingVideo.style.display = 'block'; // VISIBLE
        speakingVideo.style.width = '100%';
        speakingVideo.style.height = '100%';
        speakingVideo.style.maxWidth = '1200px';
        speakingVideo.style.maxHeight = '100%';
        speakingVideo.style.objectFit = 'contain';
        speakingVideo.style.margin = '0 auto';
    }
    
    viewLog(`✅ Active Speaker: ${speakingVideo ? '1 video visible' : 'ninguno'}`);
}

// ============================================
// PAGINACIÓN
// ============================================

function updatePagination() {
    const videoGrid = document.getElementById('videoGrid');
    const videos = Array.from(videoGrid.querySelectorAll('.video-container'));
    const paginationControls = document.getElementById('paginationControls');
    
    if (!paginationControls) return;
    
    const perPage = ViewControlSystem.participantsPerPage;
    const currentView = ViewControlSystem.currentView;
    
    // No paginar en ciertas vistas
    if (perPage === 'all' || currentView === 'active-speaker') {
        videos.forEach(video => {
            if (!video.style.display || video.style.display === 'none') {
                video.style.display = '';
            }
        });
        paginationControls.style.display = 'none';
        return;
    }
    
    const totalPages = Math.ceil(videos.length / perPage);
    
    if (totalPages <= 1) {
        paginationControls.style.display = 'none';
        videos.forEach(video => {
            if (!video.style.display || video.style.display === 'none') {
                video.style.display = '';
            }
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
    
    // Mostrar/ocultar videos
    const startIndex = (ViewControlSystem.currentPage - 1) * perPage;
    const endIndex = startIndex + perPage;
    
    videos.forEach((video, index) => {
        if (index >= startIndex && index < endIndex) {
            if (!video.style.display || video.style.display === 'none') {
                video.style.display = '';
            }
        } else {
            video.style.display = 'none';
        }
    });
    
    viewLog(`Paginación: Página ${ViewControlSystem.currentPage}/${totalPages}`);
}

// ============================================
// API PÚBLICA - Para llamar desde script.js
// ============================================

// Marcar hablante activo (llamar desde script.js cuando detecte audio)
function markActiveSpeaker(peerId) {
    ViewControlSystem.activeSpeakerId = peerId;
    
    const videoGrid = document.getElementById('videoGrid');
    const allVideos = videoGrid.querySelectorAll('.video-container');
    
    allVideos.forEach(video => {
        video.classList.remove('active-speaker', 'speaking');
    });
    
    const activeVideo = peerId === 'local' 
        ? videoGrid.querySelector('.video-container.local')
        : document.querySelector(`[data-peer-id="${peerId}"]`)?.closest('.video-container');
    
    if (activeVideo) {
        activeVideo.classList.add('active-speaker', 'speaking');
        
        // Re-aplicar layout si está en modo active-speaker
        if (ViewControlSystem.currentView === 'active-speaker') {
            const allVideos = Array.from(videoGrid.querySelectorAll('.video-container'));
            applyActiveSpeakerLayout(videoGrid, allVideos);
        }
        
        viewLog(`🔊 Hablante activo: ${peerId}`);
    }
}

// Forzar actualización del layout (útil después de agregar/quitar participantes)
function refreshViewLayout() {
    if (!ViewControlSystem.initialized) return;
    
    const videoGrid = document.getElementById('videoGrid');
    const allVideos = Array.from(videoGrid.querySelectorAll('.video-container'));
    
    if (allVideos.length > 0) {
        applyLayout(ViewControlSystem.currentView, videoGrid, allVideos);
        updatePagination();
        viewLog('🔄 Layout actualizado manualmente');
    }
}

// ============================================
// AUTO-INICIALIZACIÓN
// ============================================

// Inicializar cuando el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(initViewControl, 500);
    });
} else {
    setTimeout(initViewControl, 500);
}

// Exportar API pública
window.ViewControl = {
    markActiveSpeaker,
    refreshViewLayout,
    setViewMode
};

viewLog('📦 Módulo de control de vistas cargado');
