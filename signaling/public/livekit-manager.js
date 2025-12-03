/**
 * LivekitManager - Gestiona conexión SFU para video/audio/screen
 * Mantiene compatibilidad con el sistema existente de WebSocket
 * 
 * 💰 COSTO: GRATIS hasta 50GB/mes con LiveKit Cloud
 *    - Después: $0.10/GB adicional
 * 
 * LiveKit Cloud incluye:
 * - 50GB de ancho de banda gratis/mes
 * - Sin límite de participantes
 * - Escalabilidad automática
 * - SSL incluido
 */
class LivekitManager {
    constructor() {
        this.room = null;
        this.localVideoTrack = null;
        this.localAudioTrack = null;
        this.localScreenTrack = null;
        this.localScreenAudioTrack = null;
        this.isConnected = false;
        this.participantTracks = new Map(); // participantId -> { video, audio, screen }
        
        // Callbacks para integrar con script.js
        this.onTrackSubscribed = null;
        this.onTrackUnsubscribed = null;
        this.onParticipantConnected = null;
        this.onParticipantDisconnected = null;
        this.onActiveSpeakerChanged = null;
        this.onConnectionStateChanged = null;
        
        console.log('[LIVEKIT] 💰 Manager inicializado (LiveKit Cloud - 50GB/mes GRATIS)');
    }

    async connect(roomName, userName, options = {}) {
        try {
            console.log('[LIVEKIT] Conectando a LiveKit Cloud...', { roomName, userName });
            
            // Obtener token del servidor (generado localmente, sin costo)
            const tokenRes = await fetch(`/livekit-token?room=${encodeURIComponent(roomName)}&name=${encodeURIComponent(userName)}`);
            if (!tokenRes.ok) {
                const errorData = await tokenRes.json().catch(() => ({}));
                throw new Error(errorData.error || 'Error obteniendo token');
            }
            const { token, wsUrl } = await tokenRes.json();
            
            console.log('[LIVEKIT] Token obtenido, conectando a:', wsUrl);
            
            // Crear Room con configuración optimizada
            this.room = new LivekitClient.Room({
                adaptiveStream: true,
                dynacast: true,
                videoCaptureDefaults: {
                    resolution: LivekitClient.VideoPresets.h540.resolution,
                    facingMode: 'user',
                },
                audioCaptureDefaults: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
                publishDefaults: {
                    videoSimulcastLayers: [
                        LivekitClient.VideoPresets.h180,
                        LivekitClient.VideoPresets.h360,
                    ],
                    screenShareSimulcastLayers: [
                        LivekitClient.VideoPresets.h720,
                    ],
                },
            });

            this._setupEventListeners();
            
            // Conectar a LiveKit Cloud
            await this.room.connect(wsUrl, token);
            this.isConnected = true;
            console.log('[LIVEKIT] ✅ Conectado a sala (LiveKit Cloud):', roomName);
            
            // Publicar tracks si se solicita
            if (options.audio !== false || options.video !== false) {
                await this.publishLocalTracks(options.audio !== false, options.video !== false);
            }
            
            return true;
        } catch (error) {
            console.error('[LIVEKIT] ❌ Error conectando:', error);
            this.isConnected = false;
            throw error;
        }
    }

    _setupEventListeners() {
        // Participante conectado
        this.room.on(LivekitClient.RoomEvent.ParticipantConnected, (participant) => {
            console.log('[LIVEKIT] 👤 Participante conectado:', participant.identity);
            if (this.onParticipantConnected) {
                this.onParticipantConnected(participant.identity, participant);
            }
        });

        // Participante desconectado
        this.room.on(LivekitClient.RoomEvent.ParticipantDisconnected, (participant) => {
            console.log('[LIVEKIT] 👋 Participante desconectado:', participant.identity);
            this.participantTracks.delete(participant.identity);
            if (this.onParticipantDisconnected) {
                this.onParticipantDisconnected(participant.identity);
            }
        });

        // Track suscrito
        this.room.on(LivekitClient.RoomEvent.TrackSubscribed, (track, publication, participant) => {
            console.log('[LIVEKIT] 📹 Track suscrito:', track.kind, 'source:', publication.source, 'de:', participant.identity);
            
            // Guardar referencia
            if (!this.participantTracks.has(participant.identity)) {
                this.participantTracks.set(participant.identity, {});
            }
            const tracks = this.participantTracks.get(participant.identity);
            
            if (publication.source === LivekitClient.Track.Source.ScreenShare) {
                tracks.screen = track;
            } else if (publication.source === LivekitClient.Track.Source.ScreenShareAudio) {
                tracks.screenAudio = track;
            } else if (track.kind === 'video') {
                tracks.video = track;
            } else if (track.kind === 'audio') {
                tracks.audio = track;
            }
            
            if (this.onTrackSubscribed) {
                this.onTrackSubscribed(track, participant.identity, publication.source);
            }
        });

        // Track desuscrito
        this.room.on(LivekitClient.RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
            console.log('[LIVEKIT] 🚫 Track desuscrito:', track.kind, 'de:', participant.identity);
            
            if (this.onTrackUnsubscribed) {
                this.onTrackUnsubscribed(track, participant.identity, publication.source);
            }
        });

        // Track muted/unmuted
        this.room.on(LivekitClient.RoomEvent.TrackMuted, (publication, participant) => {
            console.log('[LIVEKIT] 🔇 Track mutado:', publication.kind, 'de:', participant.identity);
        });

        this.room.on(LivekitClient.RoomEvent.TrackUnmuted, (publication, participant) => {
            console.log('[LIVEKIT] 🔊 Track desmutado:', publication.kind, 'de:', participant.identity);
        });

        // Hablante activo
        this.room.on(LivekitClient.RoomEvent.ActiveSpeakersChanged, (speakers) => {
            if (this.onActiveSpeakerChanged && speakers.length > 0) {
                this.onActiveSpeakerChanged(speakers[0].identity);
            }
        });

        // Estado de conexión
        this.room.on(LivekitClient.RoomEvent.ConnectionStateChanged, (state) => {
            console.log('[LIVEKIT] 🔌 Estado:', state);
            this.isConnected = (state === 'connected');
            if (this.onConnectionStateChanged) {
                this.onConnectionStateChanged(state);
            }
        });

        // Reconexión
        this.room.on(LivekitClient.RoomEvent.Reconnecting, () => {
            console.log('[LIVEKIT] 🔄 Reconectando...');
        });

        this.room.on(LivekitClient.RoomEvent.Reconnected, () => {
            console.log('[LIVEKIT] ✅ Reconectado');
        });

        // Desconexión
        this.room.on(LivekitClient.RoomEvent.Disconnected, (reason) => {
            console.log('[LIVEKIT] 🔴 Desconectado, razón:', reason);
            this.isConnected = false;
        });
    }

    async publishLocalTracks(audio = true, video = true) {
        try {
            console.log('[LIVEKIT] Publicando tracks locales...', { audio, video });
            
            // Intentar crear tracks de audio y video por separado para mejor manejo de errores
            let audioTrack = null;
            let videoTrack = null;
            
            // Intentar audio
            if (audio) {
                try {
                    const audioTracks = await LivekitClient.createLocalTracks({
                        audio: {
                            echoCancellation: true,
                            noiseSuppression: true,
                            autoGainControl: true,
                        },
                        video: false,
                    });
                    audioTrack = audioTracks.find(t => t.kind === 'audio');
                    if (audioTrack) {
                        await this.room.localParticipant.publishTrack(audioTrack);
                        this.localAudioTrack = audioTrack;
                        console.log('[LIVEKIT] ✅ Track de audio publicado');
                    }
                } catch (audioError) {
                    console.warn('[LIVEKIT] ⚠️ No se pudo crear track de audio:', audioError.message);
                    // Continuar sin audio
                }
            }
            
            // Intentar video
            if (video) {
                try {
                    const videoTracks = await LivekitClient.createLocalTracks({
                        audio: false,
                        video: {
                            resolution: LivekitClient.VideoPresets.h540.resolution,
                            facingMode: 'user',
                        },
                    });
                    videoTrack = videoTracks.find(t => t.kind === 'video');
                    if (videoTrack) {
                        await this.room.localParticipant.publishTrack(videoTrack);
                        this.localVideoTrack = videoTrack;
                        console.log('[LIVEKIT] ✅ Track de video publicado');
                    }
                } catch (videoError) {
                    console.warn('[LIVEKIT] ⚠️ No se pudo crear track de video:', videoError.message);
                    // Continuar sin video
                }
            }

            console.log('[LIVEKIT] ✅ Tracks locales publicados', {
                audio: !!this.localAudioTrack,
                video: !!this.localVideoTrack
            });
            return { videoTrack: this.localVideoTrack, audioTrack: this.localAudioTrack };
        } catch (error) {
            console.error('[LIVEKIT] ❌ Error publicando tracks:', error);
            throw error;
        }
    }

    getLocalVideoElement() {
        if (this.localVideoTrack) {
            const element = this.localVideoTrack.attach();
            element.muted = true;
            return element;
        }
        return null;
    }

    async toggleMicrophone() {
        // Si no hay track o está en mal estado, intentar crear uno
        if (!this.localAudioTrack || 
            this.localAudioTrack.mediaStreamTrack?.readyState === 'ended') {
            console.log('[LIVEKIT] No hay track de audio válido, intentando crear...');
            try {
                // Limpiar track viejo si existe
                if (this.localAudioTrack) {
                    try {
                        await this.room.localParticipant.unpublishTrack(this.localAudioTrack);
                        this.localAudioTrack.stop();
                    } catch (e) {
                        console.warn('[LIVEKIT] Error limpiando track viejo:', e);
                    }
                    this.localAudioTrack = null;
                }
                
                const tracks = await LivekitClient.createLocalTracks({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                    },
                    video: false,
                });
                
                for (const track of tracks) {
                    if (track.kind === 'audio') {
                        await this.room.localParticipant.publishTrack(track);
                        this.localAudioTrack = track;
                        console.log('[LIVEKIT] ✅ Track de audio creado y publicado');
                        return true; // mic activo
                    }
                }
            } catch (error) {
                console.error('[LIVEKIT] ❌ Error creando track de audio:', error);
                return false;
            }
        }
        
        console.log('[LIVEKIT] toggleMicrophone - estado actual:', 
            'isMuted:', this.localAudioTrack.isMuted,
            'readyState:', this.localAudioTrack.mediaStreamTrack?.readyState
        );
        
        if (this.localAudioTrack.isMuted) {
            await this.localAudioTrack.unmute();
            console.log('[LIVEKIT] 🎤 Micrófono activado');
            return true; // mic activo
        } else {
            await this.localAudioTrack.mute();
            console.log('[LIVEKIT] 🔇 Micrófono mutado');
            return false; // mic mutado
        }
    }

    async toggleCamera() {
        // Si no hay track, intentar crear uno
        if (!this.localVideoTrack) {
            console.log('[LIVEKIT] No hay track de video, intentando crear...');
            try {
                const tracks = await LivekitClient.createLocalTracks({
                    audio: false,
                    video: {
                        resolution: LivekitClient.VideoPresets.h540.resolution,
                        facingMode: 'user',
                    },
                });
                
                for (const track of tracks) {
                    if (track.kind === 'video') {
                        await this.room.localParticipant.publishTrack(track);
                        this.localVideoTrack = track;
                        console.log('[LIVEKIT] ✅ Track de video creado y publicado');
                        
                        // Mostrar video local
                        const localVideoEl = document.getElementById('localVideo');
                        if (localVideoEl) {
                            const newVideoEl = track.attach();
                            newVideoEl.muted = true;
                            newVideoEl.className = localVideoEl.className;
                            newVideoEl.id = 'localVideo';
                            newVideoEl.playsInline = true;
                            newVideoEl.autoplay = true;
                            localVideoEl.parentNode.replaceChild(newVideoEl, localVideoEl);
                        }
                        
                        return true; // cam activa
                    }
                }
            } catch (error) {
                console.error('[LIVEKIT] ❌ Error creando track de video:', error);
                return false;
            }
        }
        
        if (this.localVideoTrack.isMuted) {
            await this.localVideoTrack.unmute();
            console.log('[LIVEKIT] 📹 Cámara activada');
            return true; // cam activa
        } else {
            await this.localVideoTrack.mute();
            console.log('[LIVEKIT] 📷 Cámara apagada');
            return false; // cam apagada
        }
    }

    async setMicrophoneEnabled(enabled) {
        if (!this.localAudioTrack) {
            console.warn('[LIVEKIT] No hay track de audio local para cambiar estado');
            return;
        }
        
        if (enabled) {
            await this.localAudioTrack.unmute();
            console.log('[LIVEKIT] 🎤 Micrófono forzado a activado');
        } else {
            await this.localAudioTrack.mute();
            console.log('[LIVEKIT] 🔇 Micrófono forzado a mutado');
        }
    }

    async setCameraEnabled(enabled) {
        if (!this.localVideoTrack) {
            console.warn('[LIVEKIT] No hay track de video local para cambiar estado');
            return;
        }
        
        if (enabled) {
            await this.localVideoTrack.unmute();
        } else {
            await this.localVideoTrack.mute();
        }
    }

    isMicrophoneMuted() {
        return this.localAudioTrack ? this.localAudioTrack.isMuted : true;
    }

    isCameraMuted() {
        return this.localVideoTrack ? this.localVideoTrack.isMuted : true;
    }

    async startScreenShare(withAudio = true) {
        try {
            console.log('[LIVEKIT] Iniciando screen share...', { withAudio });
            
            // ⭐ Guardar estado del micrófono antes de compartir
            const micWasActive = this.localAudioTrack && !this.localAudioTrack.isMuted;
            console.log('[LIVEKIT] Estado del mic antes de screen share:', micWasActive ? 'activo' : 'mutado');
            
            const tracks = await LivekitClient.createLocalScreenTracks({
                audio: withAudio,
                resolution: LivekitClient.VideoPresets.h1080.resolution,
                contentHint: 'detail',
            });

            for (const track of tracks) {
                await this.room.localParticipant.publishTrack(track, {
                    source: track.kind === 'video' 
                        ? LivekitClient.Track.Source.ScreenShare 
                        : LivekitClient.Track.Source.ScreenShareAudio,
                });
                
                if (track.kind === 'video') {
                    this.localScreenTrack = track;
                    
                    // Detectar cuando usuario detiene desde navegador
                    track.mediaStreamTrack.onended = () => {
                        console.log('[LIVEKIT] 🖥️ Screen share detenido por usuario');
                        this.stopScreenShare();
                        if (window.onLivekitScreenShareEnded) {
                            window.onLivekitScreenShareEnded();
                        }
                    };
                } else {
                    this.localScreenAudioTrack = track;
                }
            }
            
            // ⭐ Verificar que el micrófono sigue activo después de publicar screen share
            if (this.localAudioTrack) {
                console.log('[LIVEKIT] Estado del mic después de screen share:', 
                    this.localAudioTrack.isMuted ? 'mutado' : 'activo',
                    'mediaStreamTrack.enabled:', this.localAudioTrack.mediaStreamTrack?.enabled,
                    'mediaStreamTrack.readyState:', this.localAudioTrack.mediaStreamTrack?.readyState
                );
                
                // Si el mic estaba activo pero ahora está en mal estado, restaurar
                if (micWasActive && this.localAudioTrack.mediaStreamTrack?.readyState === 'ended') {
                    console.log('[LIVEKIT] ⚠️ Track de audio terminado, recreando...');
                    await this._recreateAudioTrack();
                }
            }

            console.log('[LIVEKIT] ✅ Screen share iniciado');
            return true;
        } catch (error) {
            console.error('[LIVEKIT] ❌ Error screen share:', error);
            throw error;
        }
    }
    
    /**
     * Recrea el track de audio si se perdió - VERSION MEJORADA
     */
    async _recreateAudioTrack() {
        try {
            console.log('[LIVEKIT] 🔄 Iniciando recreación del track de audio...');
            
            // Despublicar track viejo si existe
            if (this.localAudioTrack) {
                try {
                    console.log('[LIVEKIT] Limpiando track de audio anterior...');
                    await this.room.localParticipant.unpublishTrack(this.localAudioTrack);
                    this.localAudioTrack.stop();
                } catch (e) {
                    console.warn('[LIVEKIT] Error despublicando track viejo:', e);
                }
                this.localAudioTrack = null;
            }
            
            // Pequeña pausa para liberar recursos del navegador
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Crear nuevo track con configuración óptima
            console.log('[LIVEKIT] Solicitando permiso de micrófono...');
            const tracks = await LivekitClient.createLocalTracks({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1,
                    sampleRate: 48000,
                },
                video: false,
            });
            
            for (const track of tracks) {
                if (track.kind === 'audio') {
                    console.log('[LIVEKIT] Publicando nuevo track de audio...');
                    await this.room.localParticipant.publishTrack(track, {
                        source: LivekitClient.Track.Source.Microphone,
                    });
                    this.localAudioTrack = track;
                    
                    // Verificar que se publicó correctamente
                    console.log('[LIVEKIT] ✅ Track de audio recreado y publicado:',
                        'isMuted:', track.isMuted,
                        'readyState:', track.mediaStreamTrack?.readyState
                    );
                    
                    return true;
                }
            }
            
            console.error('[LIVEKIT] ❌ No se encontró track de audio en la respuesta');
            return false;
        } catch (error) {
            console.error('[LIVEKIT] ❌ Error recreando track de audio:', error);
            return false;
        }
    }

    async stopScreenShare() {
        try {
            console.log('[LIVEKIT] Deteniendo screen share...');
            
            // ⭐ IMPORTANTE: Guardar si el micrófono estaba activo ANTES de detener screen share
            const micWasActive = this.localAudioTrack && !this.localAudioTrack.isMuted;
            console.log('[LIVEKIT] Estado del mic antes de detener screen share:', micWasActive ? 'ACTIVO' : 'mutado');
            
            if (this.localScreenTrack) {
                await this.room.localParticipant.unpublishTrack(this.localScreenTrack);
                this.localScreenTrack.stop();
                this.localScreenTrack = null;
            }
            if (this.localScreenAudioTrack) {
                await this.room.localParticipant.unpublishTrack(this.localScreenAudioTrack);
                this.localScreenAudioTrack.stop();
                this.localScreenAudioTrack = null;
            }
            
            // ⭐ CRÍTICO: Esperar un momento para que el navegador libere recursos
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // ⭐ SIEMPRE recrear el track de audio después de screen share
            // Esto es necesario porque algunos navegadores corrompen el track original
            console.log('[LIVEKIT] ⚠️ Recreando track de audio por seguridad...');
            await this._recreateAudioTrack();
            
            // Si el mic estaba activo antes, asegurarse de que esté activo después
            if (micWasActive && this.localAudioTrack) {
                console.log('[LIVEKIT] 🎤 Asegurando que el mic esté activo...');
                if (this.localAudioTrack.isMuted) {
                    await this.localAudioTrack.unmute();
                }
            }
            
            // ⭐ Verificación final
            console.log('[LIVEKIT] Estado FINAL del mic:',
                'existe:', !!this.localAudioTrack,
                'isMuted:', this.localAudioTrack?.isMuted,
                'readyState:', this.localAudioTrack?.mediaStreamTrack?.readyState
            );
            
            console.log('[LIVEKIT] ✅ Screen share detenido');
        } catch (error) {
            console.error('[LIVEKIT] ❌ Error deteniendo screen share:', error);
            
            // ⭐ Intentar recuperar el micrófono aunque haya error
            try {
                console.log('[LIVEKIT] 🔄 Intentando recuperar micrófono después de error...');
                await this._recreateAudioTrack();
            } catch (e) {
                console.error('[LIVEKIT] ❌ No se pudo recuperar el micrófono:', e);
            }
        }
    }

    isScreenSharing() {
        return this.localScreenTrack !== null;
    }

    attachTrack(track, element) {
        if (track && element) {
            track.attach(element);
        }
    }

    detachTrack(track) {
        if (track) {
            track.detach();
        }
    }

    async disconnect() {
        try {
            console.log('[LIVEKIT] Desconectando...');
            
            if (this.localVideoTrack) {
                this.localVideoTrack.stop();
                this.localVideoTrack = null;
            }
            if (this.localAudioTrack) {
                this.localAudioTrack.stop();
                this.localAudioTrack = null;
            }
            if (this.localScreenTrack) {
                this.localScreenTrack.stop();
                this.localScreenTrack = null;
            }
            if (this.localScreenAudioTrack) {
                this.localScreenAudioTrack.stop();
                this.localScreenAudioTrack = null;
            }
            
            if (this.room) {
                await this.room.disconnect();
                this.room = null;
            }
            
            this.participantTracks.clear();
            this.isConnected = false;
            console.log('[LIVEKIT] ✅ Desconectado');
        } catch (error) {
            console.error('[LIVEKIT] Error desconectando:', error);
        }
    }

    isRoomConnected() {
        return this.isConnected && this.room?.state === 'connected';
    }

    getParticipantTracks(participantId) {
        return this.participantTracks.get(participantId);
    }

    getRemoteParticipants() {
        if (!this.room) return [];
        return Array.from(this.room.remoteParticipants.values());
    }

    getLocalParticipant() {
        return this.room?.localParticipant;
    }

    /**
     * ⭐ Método público para restaurar el micrófono si dejó de funcionar
     * Puede ser llamado desde script.js o la consola
     * FUERZA la recreación del track de audio
     */
    async restoreMicrophone() {
        console.log('[LIVEKIT] 🎤 Restaurando micrófono (FORZADO)...');
        
        // SIEMPRE recrear el track para asegurar que funcione
        console.log('[LIVEKIT] Forzando recreación del track de audio...');
        const success = await this._recreateAudioTrack();
        
        if (success) {
            // Asegurarse de que no esté mutado
            if (this.localAudioTrack?.isMuted) {
                await this.localAudioTrack.unmute();
            }
            console.log('[LIVEKIT] ✅ Micrófono restaurado correctamente');
            return true;
        } else {
            console.error('[LIVEKIT] ❌ No se pudo restaurar el micrófono');
            return false;
        }
    }

    /**
     * Obtiene información de diagnóstico del micrófono
     */
    getMicrophoneStatus() {
        return {
            exists: !!this.localAudioTrack,
            isMuted: this.localAudioTrack?.isMuted ?? null,
            readyState: this.localAudioTrack?.mediaStreamTrack?.readyState ?? null,
            enabled: this.localAudioTrack?.mediaStreamTrack?.enabled ?? null,
            isPublished: this.room?.localParticipant?.audioTrackPublications?.size > 0
        };
    }
}

// Hacer disponible globalmente
window.LivekitManager = LivekitManager;

console.log('[LIVEKIT] 💰 LivekitManager cargado (100% GRATIS - open source)');
