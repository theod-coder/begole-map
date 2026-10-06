import { saveToDB } from './db.js';
import { showToast, triggerHaptic, formatDuration, getSpeedColor, playAudioCue } from './utils.js';
import { updateDashboard } from './ui.js';
import { checkTrophyProximity, updateUserLevel } from './gamification.js';
import { getMapInstance, updateRadarDisplay } from './map.js';
import { appState } from './state.js';

let isRecording = false; 
let trackWatchId = null;
let currentPath = []; 
let currentStartTime = null;
let currentDistance = 0;
let lastPositionTime = null;
let timerInterval = null;
let wakeLock = null;
let autoSaveInterval = null;
let lastRadarAlertTime = 0;

let currentTraceLayer = null;

export function initTracking(mapInstance) {
    if (!currentTraceLayer && mapInstance) {
        currentTraceLayer = L.layerGroup().addTo(mapInstance);
    }
    startPassiveGPS();
}

function startPassiveGPS() {
    if (trackWatchId) return; 

    if ('geolocation' in navigator) {
        trackWatchId = navigator.geolocation.watchPosition(
            onLocationUpdate, 
            (err) => {
                console.warn("Erreur GPS", err);
                if(err.code === 1) showToast("⚠️ GPS refusé par l'utilisateur");
                else showToast("⚠️ Signal GPS introuvable");
            }, 
            { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
        );
    } else {
        showToast("Géolocalisation non supportée");
    }
}

function onLocationUpdate(pos) {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const alt = pos.coords.altitude || 0;
    const acc = pos.coords.accuracy;
    const head = pos.coords.heading;
    let speed = pos.coords.speed;
    const now = Date.now();

    document.dispatchEvent(new CustomEvent('tracking-update', { 
        detail: { lat, lng, acc, head } 
    }));

    const map = getMapInstance();
    if (map) checkTrophyProximity(map, lat, lng);

    // --- SCANNER RADAR PROXIMITÉ (40m / 100m) ---
    if (appState.radarActive && map) {
        const radius = appState.radarRadius || 40;
        let nearbyItem = null;

        // 1. Recherche dans les points d'intérêt
        for (const p of appState.points) {
            const d = map.distance([lat, lng], [p.lat, p.lng]);
            if (d <= radius) {
                nearbyItem = { type: 'point', name: `${p.emoji} ${p.note || 'Point'}`, dist: Math.round(d) };
                break;
            }
        }

        // 2. Recherche dans le Bégoledex
        if (!nearbyItem && appState.begoledex) {
            for (const b of appState.begoledex) {
                if (b.lat && b.lng) {
                    const d = map.distance([lat, lng], [b.lat, b.lng]);
                    if (d <= radius) {
                        nearbyItem = { type: 'plante', name: `🌿 ${b.name}`, dist: Math.round(d) };
                        break;
                    }
                }
            }
        }

        if (nearbyItem) {
            updateRadarDisplay([lat, lng], radius, true);
            if (now - lastRadarAlertTime > 15000) { // Alerte toutes les 15s max
                lastRadarAlertTime = now;
                triggerHaptic('warning');
                playAudioCue('radar');
                showToast(`📡 Radar (${nearbyItem.dist}m) : ${nearbyItem.name} à proximité !`);
            }
        } else {
            updateRadarDisplay([lat, lng], radius, false);
        }
    }

    if (!isRecording) return;

    if ((speed === null || speed === 0) && lastPositionTime && currentPath.length > 0) {
        const lastPt = currentPath[currentPath.length - 1];
        if (map) {
            const distM = map.distance([lastPt[0], lastPt[1]], [lat, lng]);
            const timeDiffS = (now - lastPositionTime) / 1000;
            if (timeDiffS > 0) speed = distM / timeDiffS;
        }
    }
    lastPositionTime = now;

    if (map && currentPath.length > 0) {
        const lastPt = currentPath[currentPath.length - 1];
        const distSeg = map.distance([lastPt[0], lastPt[1]], [lat, lng]);
        currentDistance += (distSeg / 1000); 
    }

    updateDashboard(alt, speed, currentDistance);

    if (currentTraceLayer && currentPath.length > 0) {
        const lastPt = currentPath[currentPath.length - 1];
        const segmentColor = getSpeedColor(speed);
        
        L.polyline([[lastPt[0], lastPt[1]], [lat, lng]], {
            color: segmentColor, weight: 5, opacity: 0.8, lineCap: 'round'
        }).addTo(currentTraceLayer);
    }

    const newPoint = [lat, lng, alt, speed || 0];
    currentPath.push(newPoint);
}

export async function toggleTracking() {
    const btn = document.getElementById('btn-tracking');
    const map = getMapInstance();

    if (!isRecording) {
        // --- DÉMARRAGE REC ---
        isRecording = true;
        
        currentPath = [];
        currentDistance = 0;
        currentStartTime = new Date();
        lastPositionTime = Date.now();
        
        // --- UI ANCIEN BOUTON ---
        if (btn) {
            btn.innerHTML = "⏹️ Stop";
            btn.className = "btn-stop-track";
        }
        
        document.getElementById('recording-container').classList.remove('hidden');
        document.getElementById('dashboard').classList.remove('hidden');

        startTimer();
        await requestWakeLock();
        autoSaveInterval = setInterval(saveTrackState, 10000);

        if (currentTraceLayer) currentTraceLayer.clearLayers();

        showToast("REC démarré 🌈");
        triggerHaptic('start');

        startPassiveGPS();

    } else {
        // --- ARRÊT REC ---
        isRecording = false;
        
        stopTimer();
        await releaseWakeLock();
        if (autoSaveInterval) {
            clearInterval(autoSaveInterval);
            autoSaveInterval = null;
        }
        localStorage.removeItem('begole_temp_track');

        // --- UI ANCIEN BOUTON ---
        if (btn) {
            btn.innerHTML = "▶️ Lancer Trajet";
            btn.className = "btn-start-track";
        }
        
        document.getElementById('recording-container').classList.add('hidden');
        document.getElementById('dashboard').classList.add('hidden');

        if (currentPath.length > 0) {
            const endTime = new Date();
            const elevationData = calculateElevation(currentPath);
            await saveTrip(currentPath, currentStartTime, endTime, currentDistance, elevationData);
            alert(`Trajet terminé !\nDistance: ${currentDistance.toFixed(2)}km\nDénivelé: +${elevationData.gain}m`);
            document.dispatchEvent(new CustomEvent('trip-saved'));
        }

        if (currentTraceLayer) currentTraceLayer.clearLayers();
    }
}

export function saveTrackState() {
    if (isRecording && currentPath.length > 0) {
        localStorage.setItem('begole_temp_track', JSON.stringify({
            path: currentPath,
            startTime: currentStartTime,
            distance: currentDistance
        }));
    }
}

export function checkCrashRecovery(mapInstance) {
    const temp = localStorage.getItem('begole_temp_track');
    if (!temp) return;

    try {
        const data = JSON.parse(temp);
        if (data && data.path && data.path.length > 0) {
            if (confirm("Un trajet en cours a été interrompu. Voulez-vous le reprendre ?")) {
                currentPath = data.path;
                currentStartTime = new Date(data.startTime);
                currentDistance = data.distance;
                
                isRecording = true;
                
                const btn = document.getElementById('btn-tracking');
                if (btn) {
                    btn.innerHTML = "⏹️ Stop";
                    btn.className = "btn-stop-track";
                }
                
                document.getElementById('recording-container').classList.remove('hidden');
                document.getElementById('dashboard').classList.remove('hidden');

                if (!currentTraceLayer && mapInstance) {
                    currentTraceLayer = L.layerGroup().addTo(mapInstance);
                }
                if (currentTraceLayer) {
                    L.polyline(currentPath.map(p => [p[0], p[1]]), {
                        color: 'red', weight: 5
                    }).addTo(currentTraceLayer);
                }

                startTimer();
                requestWakeLock();
                autoSaveInterval = setInterval(saveTrackState, 10000);
                startPassiveGPS(); 
                
                showToast("Trajet restauré ♻️");
            } else {
                localStorage.removeItem('begole_temp_track');
            }
        }
    } catch (e) {
        console.error("Erreur récupération", e);
        localStorage.removeItem('begole_temp_track');
    }
}

function startTimer() {
    const el = document.getElementById('recording-timer');
    if (!el) return;
    el.innerText = formatDuration(new Date() - currentStartTime);
    timerInterval = setInterval(() => {
        el.innerText = formatDuration(new Date() - currentStartTime);
    }, 1000);
}

function stopTimer() {
    clearInterval(timerInterval);
    const el = document.getElementById('recording-timer');
    if (el) el.innerText = "00:00";
}

async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (e) { console.warn("Wake Lock fail", e); }
}

async function releaseWakeLock() {
    if (wakeLock) {
        await wakeLock.release();
        wakeLock = null;
    }
}

function calculateElevation(points) {
    let gain = 0; let loss = 0;
    if (points.length < 2) return { gain: 0, loss: 0 };
    let lastAlt = points[0][2];
    for (let i = 1; i < points.length; i++) {
        let currAlt = points[i][2];
        if (currAlt !== null && lastAlt !== null && currAlt !== 0 && lastAlt !== 0) {
            let diff = currAlt - lastAlt;
            // Filtre anti-bruit GPS : ignore les variations < 3m ou les téléportations > 50m
            if (Math.abs(diff) >= 3 && Math.abs(diff) <= 50) {
                if (diff > 0) gain += diff; else loss += Math.abs(diff);
                lastAlt = currAlt;
            }
        }
    }
    return { gain: Math.round(gain), loss: Math.round(loss) };
}

async function saveTrip(points, start, end, dist, elevation) {
    const trip = {
        id: Date.now(),
        date: start.toISOString(),
        duration: end - start,
        distance: dist,
        points: points,
        elevationGain: elevation.gain,
        note: ""
    };
    await saveToDB('trips', trip);
    
    // Mise à jour immédiate de l'état en mémoire
    if (appState && appState.trips) {
        appState.trips.push(trip);
        updateUserLevel(appState.points, appState.trips);
    }

    document.dispatchEvent(new CustomEvent('trip-saved', { detail: { trip } }));
}