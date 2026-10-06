import { saveToDB, deleteFromDB, clearStoreDB } from './db.js';
import { 
    refreshMap, toggleCadastreMode, toggleSavedParcels, toggleHeatmap, 
    toggleBorders, updateCadastreOpacity, registerMapCallbacks, getMapInstance, 
    startReplay, stopReplay, displaySingleTrip, clearTracksAndShowPoints,
    calculateGeoJSONArea, updateRadarDisplay, removeRadarDisplay,
    toggleBegoledexOnMap, toggleMeasureTool, clearMeasurement,
    setReplaySpeed, toggleReplayPause 
} from './map.js';
import { toggleSoundscape, updateAudioWeather } from './audio.js';
import { showAchievements, updateUserLevel } from './gamification.js';
import { handlePlantUpload, resetPlantNetUI } from './plantnet.js';
import { openPisteurModal } from './pisteur.js';
import { openBegoledexModal } from './begoledex.js';

import { 
    showToast, triggerHaptic, pad, compressImage, getSpeedColor,
    exportTripToGPX, parseGPX, toDMS, playAudioCue 
} from './utils.js';
import { VILLAGE_COORDS, SECRET_EMOJIS } from './config.js';
import { appState, setPoints } from './state.js'; 
import { updateWeatherWidget } from './modules/weather.js';

// --- État UI (Variables locales) ---
let tempLatLng = null;
let currentEditingIndex = -1;
let currentEditingTripId = null; 
let currentParcelGeoJSON = null;
let selectedParcelColor = '#95a5a6';
let isCompassMode = false;
let userMarker = null;
let userAccuracyCircle = null;

/**
 * Initialise tous les écouteurs d'événements du DOM
 */
export function initEventListeners(map) {
    // Callbacks Carte (Lien Map -> UI)
    registerMapCallbacks({
        onEditPoint: (point, index) => openEditPointModal(index),
        onParcelFound: (feature) => openParcelModal(feature),
        onDeleteParcel: (id) => deleteParcel(id),
        onReplayFinished: () => {
            showToast("Replay terminé ! 🏁");
            triggerHaptic('success');
            document.getElementById('replay-controls').classList.add('hidden');
        }
    });

    // Écouteurs globaux
    document.addEventListener('map-click-point', (e) => {
        tempLatLng = e.detail.latlng;
        openNewPointModal();
    });

    document.addEventListener('tracking-update', (e) => {
        updateUserMarker(e.detail.lat, e.detail.lng, e.detail.acc, e.detail.head);
    });

    // Écouteur pour la mise à jour Météo (Vent)
    document.addEventListener('weather-updated', updateWindVisuals);

    // --- Boutons Flottants & Menu ---
    document.getElementById('menu-toggle').addEventListener('click', toggleMenu);
    document.getElementById('btn-compass').addEventListener('click', toggleCompass);
    document.getElementById('btn-recenter').addEventListener('click', () => {
        const mapInstance = getMapInstance();
        if (userMarker && mapInstance) mapInstance.setView(userMarker.getLatLng(), 16);
        document.getElementById('btn-recenter').classList.add('hidden');
    });

    // --- Actions Rapides ---
    // 1. Bouton Tracking Ancien (Clic simple)
    document.getElementById('btn-tracking').addEventListener('click', () => {
        import('./tracking.js').then(module => module.toggleTracking());
    });
    
    // 2. Sliders pour le Mode Poche
    createSwipeAction('swipe-pocket-container', 'swipe-pocket-thumb', 'swipe-pocket-text', () => {
        togglePocketMode();
    });

    createSwipeAction('swipe-unlock-container', 'swipe-unlock-thumb', 'swipe-unlock-text', () => {
        togglePocketMode();
    });

    document.getElementById('btn-fullscreen').addEventListener('click', toggleFullScreen);
    
    // --- Outils Grid & Immersion ---
    document.getElementById('btn-plantnet').addEventListener('click', openPlantNetModal);
    document.getElementById('plantnet-file-input').addEventListener('change', (e) => handlePlantUpload(e.target));
    document.getElementById('btn-plantnet-close').addEventListener('click', () => document.getElementById('modal-plantnet').classList.add('hidden'));

    document.getElementById('btn-pisteur').addEventListener('click', openPisteurModal);
    document.getElementById('btn-pisteur-close').addEventListener('click', () => document.getElementById('modal-pisteur').classList.add('hidden'));

    document.getElementById('btn-sound').addEventListener('click', toggleSoundscape);
    
    // --- Listener Bégoledex ---
    const btnBegoledex = document.getElementById('btn-begoledex');
    if (btnBegoledex) {
        btnBegoledex.addEventListener('click', openBegoledexModal);
    }

    const btnCloseBegoledex = document.getElementById('btn-begoledex-close');
    if (btnCloseBegoledex) {
        btnCloseBegoledex.addEventListener('click', () => {
            const modal = document.getElementById('modal-begoledex');
            if (modal) modal.classList.add('hidden');
        });
    }
    
    // --- Toggles Carte ---
    document.getElementById('cadastre-mode-toggle').addEventListener('change', (e) => {
        toggleCadastreMode(e.target.checked);
        document.getElementById('cadastre-opacity-container').classList.toggle('hidden', !e.target.checked && !document.getElementById('show-parcels-toggle').checked);
    });
    
    document.getElementById('show-parcels-toggle').addEventListener('change', (e) => {
        toggleSavedParcels(e.target.checked);
        document.getElementById('cadastre-opacity-container').classList.toggle('hidden', !e.target.checked && !document.getElementById('cadastre-mode-toggle').checked);
    });

    document.getElementById('cadastre-opacity-input').addEventListener('input', (e) => updateCadastreOpacity(e.target.value));
    
    document.getElementById('heatmap-toggle').addEventListener('change', (e) => toggleHeatmap(e.target.checked, appState.trips));
    
    // --- Radar Proximité ---
    const radarToggle = document.getElementById('radar-toggle');
    const radarSelect = document.getElementById('radar-radius-select');
    if (radarToggle) {
        radarToggle.addEventListener('change', (e) => {
            appState.radarActive = e.target.checked;
            if (e.target.checked) {
                showToast(`📡 Radar activé (${appState.radarRadius}m)`);
                playAudioCue('radar');
                const center = userMarker ? userMarker.getLatLng() : map.getCenter();
                updateRadarDisplay(center, appState.radarRadius, false);
            } else {
                removeRadarDisplay();
                showToast("Radar désactivé");
            }
        });
    }
    if (radarSelect) {
        radarSelect.addEventListener('change', (e) => {
            appState.radarRadius = parseInt(e.target.value, 10);
            if (appState.radarActive) {
                const center = userMarker ? userMarker.getLatLng() : map.getCenter();
                updateRadarDisplay(center, appState.radarRadius, false);
            }
        });
    }

    // --- Bégoledex sur Carte ---
    const begoledexMapToggle = document.getElementById('begoledex-map-toggle');
    if (begoledexMapToggle) {
        begoledexMapToggle.addEventListener('change', (e) => {
            appState.showBegoledexOnMap = e.target.checked;
            toggleBegoledexOnMap(e.target.checked, appState.begoledex);
        });
    }

    // --- Outil Mesure / Télémètre ---
    const btnMeasure = document.getElementById('btn-measure');
    if (btnMeasure) {
        btnMeasure.addEventListener('click', () => {
            toggleMenu();
            const active = toggleMeasureTool();
            btnMeasure.style.background = active ? "#d35400" : "#e67e22";
        });
    }

    // --- SOS & Partage Coordonnées ---
    const btnSos = document.getElementById('btn-sos');
    if (btnSos) {
        btnSos.addEventListener('click', () => {
            toggleMenu();
            openSosModal();
        });
    }
    const btnSosClose = document.getElementById('btn-sos-close');
    if (btnSosClose) {
        btnSosClose.addEventListener('click', () => {
            document.getElementById('modal-sos').classList.add('hidden');
        });
    }
    const btnSosCopy = document.getElementById('btn-sos-copy');
    if (btnSosCopy) {
        btnSosCopy.addEventListener('click', copySosCoordinates);
    }

    // --- Replay Contrôles Avancés ---
    const btnReplayPause = document.getElementById('btn-replay-pause');
    if (btnReplayPause) {
        btnReplayPause.addEventListener('click', () => {
            const paused = toggleReplayPause();
            btnReplayPause.textContent = paused ? "▶️" : "⏸️";
        });
    }
    document.querySelectorAll('.replay-speed-pill').forEach(pill => {
        pill.addEventListener('click', (e) => {
            document.querySelectorAll('.replay-speed-pill').forEach(p => p.classList.remove('active'));
            e.target.classList.add('active');
            const spd = parseFloat(e.target.dataset.speed);
            setReplaySpeed(spd);
        });
    });
    document.addEventListener('replay-progress', (e) => {
        const pBar = document.getElementById('replay-progress-bar');
        if (pBar) pBar.style.width = `${e.detail.percent}%`;
    });

    // --- Chips Catégories Rapides ---
    document.querySelectorAll('.btn-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const emoji = chip.dataset.emoji;
            const text = chip.dataset.text;
            document.getElementById('input-emoji').value = emoji;
            const noteInput = document.getElementById('input-note');
            if (!noteInput.value) {
                noteInput.value = text;
            }
            triggerHaptic('success');
        });
    });

    document.getElementById('deep-night-toggle').addEventListener('change', toggleDeepNight);
    document.getElementById('intruder-toggle').addEventListener('change', () => applyFilters(false));
    
    const borderToggle = document.getElementById('borders-toggle');
    if (borderToggle) {
        borderToggle.checked = true;
        toggleBorders(true);
        borderToggle.addEventListener('change', (e) => toggleBorders(e.target.checked));
    }
    
    document.getElementById('clouds-toggle').addEventListener('change', toggleClouds);

    // --- Filtres en direct (Live Search) ---
    let filterDebounce = null;
    const onLiveFilter = () => {
        clearTimeout(filterDebounce);
        filterDebounce = setTimeout(() => {
            applyFilters(false);
        }, 200);
    };
    document.getElementById('text-filter-input').addEventListener('input', onLiveFilter);
    document.getElementById('filter-input').addEventListener('input', onLiveFilter);
    document.getElementById('filter-year').addEventListener('change', () => applyFilters(false));
    document.getElementById('filter-month').addEventListener('change', () => applyFilters(false));
    document.getElementById('btn-filter-ok').addEventListener('click', () => applyFilters(true));
    document.getElementById('btn-filter-reset').addEventListener('click', resetFilters);
    document.getElementById('btn-loc').addEventListener('click', toggleLocationRequest);

    // --- Modales Points ---
    document.getElementById('btn-modal-point-cancel').addEventListener('click', closeModal);
    document.getElementById('btn-modal-point-confirm').addEventListener('click', confirmAddPoint);
    document.getElementById('btn-edit-point-save').addEventListener('click', savePointEdits);
    document.getElementById('btn-edit-point-delete').addEventListener('click', deleteCurrentPoint);
    document.getElementById('btn-add-history').addEventListener('click', addHistoryToCurrentPoint);

    // --- Modales Parcelles ---
    document.getElementById('btn-parcel-close').addEventListener('click', () => document.getElementById('modal-parcel').classList.add('hidden'));
    document.getElementById('btn-parcel-save').addEventListener('click', confirmSaveParcel);
    document.querySelectorAll('.color-option').forEach(el => {
        el.addEventListener('click', (e) => {
            selectedParcelColor = e.target.getAttribute('data-color');
            document.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
            e.target.classList.add('selected');
        });
    });

    // --- Historique / Stats ---
    document.getElementById('btn-open-history').addEventListener('click', openHistory);
    document.getElementById('btn-history-close').addEventListener('click', () => document.getElementById('history-overlay').classList.add('hidden'));
    
    document.getElementById('btn-show-stats').addEventListener('click', openStatsModal);
    document.getElementById('btn-stats-close').addEventListener('click', () => document.getElementById('stats-overlay').classList.add('hidden'));
    
    document.getElementById('btn-show-cadastre-stats').addEventListener('click', openCadastreStats);
    document.getElementById('btn-cadastre-stats-close').addEventListener('click', () => document.getElementById('modal-cadastre-stats').classList.add('hidden'));
    
    // --- Modales Trajet ---
    document.getElementById('btn-edit-trip-close').addEventListener('click', () => document.getElementById('modal-edit-trip').classList.add('hidden'));
    document.getElementById('btn-edit-trip-save').addEventListener('click', confirmSaveTripNote);
    document.getElementById('btn-elevation-close').addEventListener('click', () => document.getElementById('modal-elevation').classList.add('hidden'));
    document.getElementById('btn-replay-stop').addEventListener('click', () => {
        stopReplay();
        document.getElementById('replay-controls').classList.add('hidden');
    });

    // --- Achievements ---
    document.getElementById('achievements-trigger').addEventListener('click', () => showAchievements(appState.points, appState.trips));
    document.getElementById('btn-achievements-close').addEventListener('click', () => document.getElementById('modal-achievements').classList.add('hidden'));

    // --- Système & Import GPX ---
    document.getElementById('btn-export').addEventListener('click', exportData);
    document.getElementById('import-file').addEventListener('change', importData);
    
    const gpxInput = document.getElementById('import-gpx-file');
    if (gpxInput) {
        gpxInput.addEventListener('change', handleGpxImport);
    }

    // Réaction sauvegarde trajet
    document.addEventListener('trip-saved', () => {
        if (!document.getElementById('history-overlay').classList.contains('hidden')) {
            openHistory();
        }
        const heatToggle = document.getElementById('heatmap-toggle');
        if (heatToggle && heatToggle.checked) {
            toggleHeatmap(true, appState.trips);
        }
    });

    document.getElementById('btn-reset-data').addEventListener('click', async () => {
        if(confirm("⚠️ Tout effacer ? Action irréversible.")) {
            await clearStoreDB('points'); await clearStoreDB('parcels'); await clearStoreDB('trips'); await clearStoreDB('begoledex');
            location.reload();
        }
    });

    document.getElementById('weather-widget-btn').addEventListener('click', updateWeatherWidget);

    initAvatarSelection();
    initAmbientEffects();
}

// ============================================================
// --- GESTION HISTORIQUE TRAJETS (SÉCURISÉ) ---
// ============================================================

function openHistory() {
    const div = document.getElementById('tripList');
    div.innerHTML = ""; 
    const filterDist = document.getElementById('filter-trip-class').value;

    const cleanBtn = document.createElement('button');
    cleanBtn.className = "btn-cancel"; 
    cleanBtn.style.marginBottom = "10px";
    cleanBtn.style.width = "100%";
    cleanBtn.textContent = "🧹 Retirer les tracés & Voir les points";
    cleanBtn.onclick = () => {
        clearTracksAndShowPoints();
        toggleMenu(); 
        document.getElementById('history-overlay').classList.add('hidden');
    };
    div.appendChild(cleanBtn);

    appState.trips.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(t => {
        const dKm = t.distance || 0;
        
        if(filterDist==='blue' && dKm>=2) return;
        if(filterDist==='green' && (dKm<2||dKm>=5)) return;
        if(filterDist==='orange' && (dKm<5||dKm>=10)) return;
        if(filterDist==='red' && dKm<10) return;

        const dateStr = new Date(t.date).toLocaleDateString();
        let color = dKm < 2 ? '#3498db' : dKm < 5 ? '#2ecc71' : dKm < 10 ? '#f39c12' : '#e74c3c';

        // --- Construction DOM ---
        const item = document.createElement('div');
        item.className = "trip-item";

        // Zone cliquable
        const clickArea = document.createElement('div');
        clickArea.className = "trip-click-area";
        clickArea.style.flexGrow = "1";
        clickArea.style.cursor = "pointer";

        const dateSpan = document.createElement('span');
        dateSpan.className = "trip-date";
        dateSpan.style.borderLeft = `4px solid ${color}`;
        dateSpan.style.paddingLeft = "5px";
        dateSpan.textContent = dateStr;

        const infoSpan = document.createElement('span');
        infoSpan.className = "trip-info";
        infoSpan.textContent = `📏 ${(t.distance||0).toFixed(2)}km 🏔️ +${t.elevationGain||0}m`;

        const noteDiv = document.createElement('div');
        noteDiv.style.fontSize = "10px";
        noteDiv.style.color = "#666";
        noteDiv.style.fontStyle = "italic";
        noteDiv.textContent = t.note || ""; 

        clickArea.appendChild(dateSpan);
        clickArea.appendChild(infoSpan);
        clickArea.appendChild(noteDiv);

        // Actions
        const btnArea = document.createElement('div');
        btnArea.style.display = "flex";
        btnArea.style.gap = "5px";

        const btnPlay = document.createElement('button');
        btnPlay.className = "btn-graph-trip";
        btnPlay.style.background = "#e67e22";
        btnPlay.title = "Rejouer";
        btnPlay.textContent = "▶️";

        const btnElev = document.createElement('button');
        btnElev.className = "btn-graph-trip";
        btnElev.title = "Dénivelé";
        btnElev.textContent = "📈";

        const btnGpx = document.createElement('button');
        btnGpx.className = "btn-graph-trip";
        btnGpx.style.background = "#27ae60";
        btnGpx.title = "Exporter GPX";
        btnGpx.textContent = "🗺️";

        const btnEdit = document.createElement('button');
        btnEdit.className = "btn-delete-trip";
        btnEdit.style.background = "#8e44ad";
        btnEdit.title = "Modifier Note";
        btnEdit.textContent = "✏️";

        const btnDel = document.createElement('button');
        btnDel.className = "btn-delete-trip";
        btnDel.title = "Supprimer";
        btnDel.textContent = "🗑️";

        btnArea.appendChild(btnPlay);
        btnArea.appendChild(btnElev);
        btnArea.appendChild(btnGpx);
        btnArea.appendChild(btnEdit);
        btnArea.appendChild(btnDel);

        item.appendChild(clickArea);
        item.appendChild(btnArea);

        // Events
        clickArea.onclick = () => {
            displaySingleTrip(t, color);
            document.getElementById('history-overlay').classList.add('hidden');
            toggleMenu();
        };

        btnPlay.onclick = () => {
            document.getElementById('history-overlay').classList.add('hidden');
            document.getElementById('replay-controls').classList.remove('hidden');
            toggleMenu(); 
            startReplay(t);
        };

        btnElev.onclick = () => {
            openElevationModal(t);
        };

        btnGpx.onclick = (e) => {
            e.stopPropagation();
            exportTripToGPX(t);
        };

        btnEdit.onclick = () => {
            currentEditingTripId = t.id;
            document.getElementById('edit-trip-note').value = t.note || "";
            document.getElementById('modal-edit-trip').classList.remove('hidden');
        };

        btnDel.onclick = async (e) => {
            e.stopPropagation();
            if(confirm("Supprimer ce trajet ?")) {
                await deleteFromDB('trips', t.id);
                appState.trips = appState.trips.filter(x => x.id !== t.id);
                openHistory();
            }
        };

        div.appendChild(item);
    });

    if(!div.hasChildNodes() || (div.childNodes.length === 1 && div.firstChild === cleanBtn)) { 
        const empty = document.createElement('div');
        empty.style.textAlign = 'center';
        empty.style.padding = '20px';
        empty.style.color = '#999';
        empty.textContent = "Aucun trajet";
        div.appendChild(empty);
    }
    
    document.getElementById('history-overlay').classList.remove('hidden');
    toggleMenu();
}

async function confirmSaveTripNote() {
    if (currentEditingTripId) {
        const trip = appState.trips.find(t => t.id === currentEditingTripId);
        if (trip) {
            trip.note = document.getElementById('edit-trip-note').value;
            await saveToDB('trips', trip);
            document.getElementById('modal-edit-trip').classList.add('hidden');
            if (!document.getElementById('history-overlay').classList.contains('hidden')) {
                openHistory();
            }
            showToast("Note enregistrée");
        }
    }
}

function openElevationModal(trip) {
    if (!trip || !trip.points || trip.points.length < 2) {
        showToast("Pas assez de données");
        return;
    }
    document.getElementById('modal-elevation').classList.remove('hidden');
    setTimeout(() => drawElevationProfile(trip.points), 100);
}

function drawElevationProfile(pts) {
    const canvas = document.getElementById('elevation-canvas');
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    
    ctx.clearRect(0, 0, w, h);
    
    const alts = pts.map(p => p[2] || 0);
    const min = Math.min(...alts);
    const max = Math.max(...alts);
    const rng = max - min || 1;
    
    document.getElementById('elev-min').textContent = `Min: ${Math.round(min)}m`;
    document.getElementById('elev-max').textContent = `Max: ${Math.round(max)}m`;
    
    ctx.beginPath();
    ctx.moveTo(0, h);
    const step = w / (alts.length - 1);
    
    alts.forEach((a, i) => {
        const y = h - ((a - min) / rng * (h - 20)) - 10;
        ctx.lineTo(i * step, y);
    });
    
    ctx.lineTo(w, h);
    ctx.closePath();
    
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(46,204,113,0.8)");
    g.addColorStop(1, "rgba(46,204,113,0.1)");
    ctx.fillStyle = g;
    ctx.fill();
    
    ctx.strokeStyle = "#27ae60";
    ctx.lineWidth = 2;
    ctx.stroke();
}

async function handleGpxImport(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    try {
        const text = await file.text();
        const parsed = parseGPX(text);
        if (!parsed.points || parsed.points.length < 2) {
            showToast("Tracé GPX invalide ou trop court ❌");
            return;
        }

        const newTrip = {
            id: Date.now(),
            date: new Date().toISOString(),
            duration: 0,
            distance: parsed.distance,
            points: parsed.points,
            elevationGain: parsed.elevationGain,
            note: parsed.name ? `GPX: ${parsed.name}` : "Trace GPX importée"
        };

        await saveToDB('trips', newTrip);
        appState.trips.push(newTrip);
        updateUserLevel(appState.points, appState.trips);
        
        displaySingleTrip(newTrip, '#2ecc71');
        showToast(`GPX importé : ${(parsed.distance).toFixed(2)}km, +${parsed.elevationGain}m 🥾`);
        triggerHaptic('success');
        playAudioCue('success');
        
        document.dispatchEvent(new CustomEvent('trip-saved', { detail: { trip: newTrip } }));
    } catch (err) {
        console.error("Erreur import GPX", err);
        alert("Erreur lors de l'import GPX : " + err.message);
    } finally {
        e.target.value = '';
    }
}

// ============================================================
// --- GESTION DES STATISTIQUES ---
// ============================================================

function openStatsModal() {
    const totalPoints = appState.points.length;
    const totalTrips = appState.trips.length;
    const totalDist = appState.trips.reduce((acc, t) => acc + (t.distance || 0), 0);
    const totalElev = appState.trips.reduce((acc, t) => acc + (t.elevationGain || 0), 0);

    const html = `
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; padding:15px;">
            <div style="background:#f8f9fa; padding:15px; text-align:center; border-radius:12px; box-shadow:0 2px 5px rgba(0,0,0,0.05);">
                <div style="font-size:28px; font-weight:800; color:#2c3e50;">${totalPoints}</div>
                <div style="font-size:12px; text-transform:uppercase; color:#7f8c8d; font-weight:bold;">Points</div>
            </div>
            <div style="background:#f8f9fa; padding:15px; text-align:center; border-radius:12px; box-shadow:0 2px 5px rgba(0,0,0,0.05);">
                <div style="font-size:28px; font-weight:800; color:#e67e22;">${totalTrips}</div>
                <div style="font-size:12px; text-transform:uppercase; color:#7f8c8d; font-weight:bold;">Trajets</div>
            </div>
            <div style="background:#f8f9fa; padding:15px; text-align:center; border-radius:12px; box-shadow:0 2px 5px rgba(0,0,0,0.05);">
                <div style="font-size:24px; font-weight:800; color:#3498db;">${totalDist.toFixed(1)}<small style="font-size:14px;">km</small></div>
                <div style="font-size:12px; text-transform:uppercase; color:#7f8c8d; font-weight:bold;">Distance</div>
            </div>
            <div style="background:#f8f9fa; padding:15px; text-align:center; border-radius:12px; box-shadow:0 2px 5px rgba(0,0,0,0.05);">
                <div style="font-size:24px; font-weight:800; color:#27ae60;">+${Math.round(totalElev)}<small style="font-size:14px;">m</small></div>
                <div style="font-size:12px; text-transform:uppercase; color:#7f8c8d; font-weight:bold;">Dénivelé</div>
            </div>
        </div>
        <div style="text-align:center; padding:10px; color:#aaa; font-style:italic; font-size:11px;">
            Statistiques basées sur les données locales.
        </div>
    `;

    const container = document.getElementById('stats-content');
    if(container) container.innerHTML = html;
    document.getElementById('stats-overlay').classList.remove('hidden');
    toggleMenuIfMobile();
}

function openCadastreStats() {
    const parcels = appState.parcels;
    
    const statsByColor = {};
    let globalAreaM2 = 0;

    parcels.forEach(p => {
        const color = p.color || '#95a5a6';
        let pArea = 0;
        if (p.geoJSON.properties && p.geoJSON.properties.contenance) {
            pArea = parseInt(p.geoJSON.properties.contenance);
        } else {
            pArea = calculateGeoJSONArea(p.geoJSON.geometry);
        }

        globalAreaM2 += pArea;

        if (!statsByColor[color]) {
            statsByColor[color] = { count: 0, area: 0 };
        }
        statsByColor[color].count++;
        statsByColor[color].area += pArea;
    });

    const totalHa = (globalAreaM2 / 10000).toFixed(3);

    let html = `
        <div style="text-align:center; padding:25px; background:linear-gradient(to bottom, #fff, #f9f9f9); border-bottom:1px solid #eee;">
            <div style="font-size:42px; font-weight:800; color:#2c3e50; line-height:1;">${totalHa}</div>
            <div style="font-size:16px; font-weight:bold; color:#7f8c8d; margin-top:5px;">Hectares Totaux</div>
            <div style="margin-top:15px; display:inline-block; background:#e67e22; color:white; padding:4px 12px; border-radius:20px; font-size:12px; font-weight:bold;">
                ${parcels.length} Parcelles
            </div>
        </div>
        <div style="padding:15px;">
    `;

    if (parcels.length === 0) {
        html += `<div style="text-align:center; padding:30px; color:#bbb;">Aucune donnée cadastre.<br><small>Sélectionnez des parcelles sur la carte.</small></div>`;
    } else {
        const sortedColors = Object.keys(statsByColor).sort((a, b) => statsByColor[b].area - statsByColor[a].area);

        sortedColors.forEach(color => {
            const data = statsByColor[color];
            const ha = (data.area / 10000).toFixed(3);
            const m2 = Math.round(data.area).toLocaleString();
            
            html += `
                <div style="display:flex; align-items:center; padding:15px; margin-bottom:10px; background:white; border-radius:10px; box-shadow:0 1px 3px rgba(0,0,0,0.1); border-left: 5px solid ${color};">
                    <div style="flex:1;">
                        <div style="font-weight:bold; font-size:16px; color:#333;">
                            <span style="display:inline-block; width:12px; height:12px; background:${color}; border-radius:50%; margin-right:5px;"></span>
                            ${data.count} parcelle${data.count > 1 ? 's' : ''}
                        </div>
                        <div style="font-size:11px; color:#888;">Cumulé pour ce groupe</div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-weight:800; color:#2c3e50; font-size:15px;">${ha} ha</div>
                        <div style="font-size:11px; color:#95a5a6;">${m2} m²</div>
                    </div>
                </div>
            `;
        });
    }
    
    html += `</div>`;

    const container = document.getElementById('cadastre-stats-content');
    if(container) container.innerHTML = html;
    document.getElementById('modal-cadastre-stats').classList.remove('hidden');
    toggleMenuIfMobile();
}

// ============================================================
// --- GESTION DES MODALES ---
// ============================================================

function closeModal() {
    document.querySelectorAll('.modal-box').forEach(box => {
        box.parentElement.classList.add('hidden');
    });
    document.getElementById('modal-overlay').classList.add('hidden');
}

export function openModalForShake(map) {
    if (userMarker) {
        tempLatLng = userMarker.getLatLng();
    } else {
        tempLatLng = map.getCenter();
        showToast("⚠️ GPS non fixé : Point au centre");
    }
    openNewPointModal("Point Shake 🫨");
    triggerHaptic('success');
}

function openNewPointModal(defaultNote = "") {
    updateModalEnvInfo();
    document.getElementById('input-emoji').value = "📍";
    document.getElementById('input-note').value = defaultNote;
    document.getElementById('modal-overlay').classList.remove('hidden');
}

async function confirmAddPoint() {
    const newPoint = {
        id: Date.now(),
        lat: tempLatLng.lat,
        lng: tempLatLng.lng,
        note: document.getElementById('input-note').value,
        emoji: document.getElementById('input-emoji').value || "📍",
        date: new Date().toLocaleDateString(),
        weather: appState.currentEnv.fullString,
        history: []
    };

    await saveToDB('points', newPoint);
    appState.points.push(newPoint);
    applyFilters(); 
    closeModal();
    showToast("Point ajouté !");
    
    import('./gamification.js').then(g => g.updateUserLevel(appState.points, appState.trips));
}

function openEditPointModal(index) {
    currentEditingIndex = index;
    const p = appState.points[index];
    
    document.getElementById('edit-emoji').value = p.emoji;
    document.getElementById('edit-note').value = p.note;
    
    renderPointHistory(p.history);
    updateModalEnvInfo();
    
    document.getElementById('modal-edit-point').classList.remove('hidden');
}

async function savePointEdits() {
    if (currentEditingIndex > -1) {
        const p = appState.points[currentEditingIndex];
        p.emoji = document.getElementById('edit-emoji').value;
        p.note = document.getElementById('edit-note').value;
        
        await saveToDB('points', p);
        applyFilters();
        document.getElementById('modal-edit-point').classList.add('hidden');
        showToast("Modifications enregistrées");
    }
}

async function deleteCurrentPoint() {
    if (currentEditingIndex > -1 && confirm("Supprimer ce point définitivement ?")) {
        const p = appState.points[currentEditingIndex];
        await deleteFromDB('points', p.id);
        
        appState.points.splice(currentEditingIndex, 1);
        applyFilters();
        document.getElementById('modal-edit-point').classList.add('hidden');
        showToast("Point supprimé");
    }
}

// ============================================================
// --- GESTION PARCELLES ---
// ============================================================

function openParcelModal(feature) {
    currentParcelGeoJSON = feature;
    const props = feature.properties;
    
    document.getElementById('parcel-ref').textContent = `Ref: ${props.section} ${props.numero}`;
    
    let area = props.contenance ? parseInt(props.contenance) : 0; 
    
    document.getElementById('parcel-area').innerHTML = `${(area / 10000).toFixed(4)} ha<br><small>(${area} m²)</small>`;
    document.getElementById('parcel-note').value = "";
    
    document.getElementById('modal-parcel').classList.remove('hidden');
    document.getElementById('menu-items').classList.add('hidden-mobile');
}

async function confirmSaveParcel() {
    const newParcel = {
        id: Date.now(),
        geoJSON: currentParcelGeoJSON,
        color: selectedParcelColor,
        note: document.getElementById('parcel-note').value
    };
    
    await saveToDB('parcels', newParcel);
    appState.parcels.push(newParcel);
    
    const toggle = document.getElementById('show-parcels-toggle');
    if (!toggle.checked) {
        toggle.checked = true;
        toggleSavedParcels(true);
    }
    
    import('./map.js').then(m => m.displayParcels(appState.parcels));
    
    document.getElementById('modal-parcel').classList.add('hidden');
    showToast("Parcelle sauvegardée");
}

async function deleteParcel(id) {
    if (confirm("Supprimer cette parcelle ?")) {
        await deleteFromDB('parcels', id);
        appState.parcels = appState.parcels.filter(p => p.id !== id);
        import('./map.js').then(m => m.displayParcels(appState.parcels));
        showToast("Parcelle supprimée");
    }
}

// ============================================================
// --- FILTRES & CARTE ---
// ============================================================

function applyFilters(closeMenu = true) {
    const filters = {
        emoji: document.getElementById('filter-input').value.trim() || null,
        text: document.getElementById('text-filter-input').value.trim().toLowerCase() || null,
        year: document.getElementById('filter-year').value,
        month: document.getElementById('filter-month').value,
        intruderMode: document.getElementById('intruder-toggle').checked
    };
    refreshMap(appState.points, filters);
    if (closeMenu) {
        toggleMenuIfMobile();
    }
}

function resetFilters() {
    document.getElementById('filter-input').value = "";
    document.getElementById('text-filter-input').value = "";
    document.getElementById('filter-year').value = "all";
    document.getElementById('filter-month').value = "all";
    applyFilters();
}

// ============================================================
// --- WIDGETS & MENU ---
// ============================================================

export function toggleMenu() {
    document.getElementById('menu-items').classList.toggle('hidden-mobile');
}

export function updateDashboard(alt, speed, dist) {
    document.getElementById('dash-alt').textContent = alt ? Math.round(alt) : "--";
    document.getElementById('dash-speed').textContent = speed ? Math.round(speed * 3.6) : 0;
    document.getElementById('dash-dist').textContent = dist.toFixed(2);
}

function updateModalEnvInfo() {
    const el1 = document.getElementById('point-env-info');
    const el2 = document.getElementById('history-env-info');
    const info = "Conditions : " + appState.currentEnv.fullString;
    
    if(el1) el1.textContent = info;
    if(el2) el2.textContent = info;
}

function toggleFullScreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(e => showToast("Plein écran non supporté"));
    } else {
        if (document.exitFullscreen) document.exitFullscreen();
    }
    toggleMenu();
}

function togglePocketMode() {
    const el = document.getElementById('pocket-overlay');
    el.classList.toggle('hidden-poche');
    if (!el.classList.contains('hidden-poche')) {
        toggleMenu(); 
    }
}

// --- SECOURS & SOS ---
let currentSosText = "";

function openSosModal() {
    let lat, lng, acc;
    if (appState.userPosition && appState.userPosition.lat) {
        lat = appState.userPosition.lat;
        lng = appState.userPosition.lng;
        acc = Math.round(appState.userPosition.acc || 0);
    } else {
        lat = VILLAGE_COORDS[0];
        lng = VILLAGE_COORDS[1];
        acc = null;
    }

    const decText = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    const dmsText = toDMS(lat, lng);
    const accText = acc ? `Précision GPS : ±${acc}m` : "Précision GPS : Estimée (Centre village)";

    const elDec = document.getElementById('sos-decimal');
    const elDms = document.getElementById('sos-dms');
    const elPrec = document.getElementById('sos-precision');

    if (elDec) elDec.textContent = decText;
    if (elDms) elDms.textContent = dmsText;
    if (elPrec) elPrec.textContent = accText;

    const mapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
    const smsBody = encodeURIComponent(`URGENCE BÉGOLE - Mes coordonnées : ${decText} (${dmsText})${acc ? ' ±' + acc + 'm' : ''}\nLien Maps : ${mapsUrl}`);

    const btnSms = document.getElementById('btn-sos-sms');
    if (btnSms) btnSms.href = `sms:?body=${smsBody}`;

    const btnMaps = document.getElementById('btn-sos-maps');
    if (btnMaps) btnMaps.href = mapsUrl;

    currentSosText = `URGENCE BÉGOLE\nCoordonnées : ${decText}\nDMS : ${dmsText}\n${accText}\nLien Maps : ${mapsUrl}`;

    document.getElementById('modal-sos').classList.remove('hidden');
    triggerHaptic('warning');
}

function copySosCoordinates() {
    if (navigator.clipboard && currentSosText) {
        navigator.clipboard.writeText(currentSosText).then(() => {
            showToast("Coordonnées copiées dans le presse-papier !");
            triggerHaptic('success');
        }).catch(() => {
            showToast("Erreur lors de la copie");
        });
    } else {
        showToast("Texte non disponible");
    }
}

// --- BOUSSOLE ---
function toggleCompass() {
    isCompassMode = !isCompassMode;
    const btn = document.getElementById('btn-compass');
    
    if (isCompassMode) {
        btn.classList.add('active');
        showToast("🧭 Boussole Active");
        
        if (window.DeviceOrientationEvent && typeof window.DeviceOrientationEvent.requestPermission === 'function') {
            window.DeviceOrientationEvent.requestPermission().then(r => {
                if (r === 'granted') window.addEventListener('deviceorientation', handleOrientation);
            });
        } else {
            window.addEventListener('deviceorientation', handleOrientation);
        }
    } else {
        btn.classList.remove('active');
        window.removeEventListener('deviceorientation', handleOrientation);
        if (userMarker) {
            const ar = userMarker.getElement().querySelector('.user-location-arrow');
            if(ar) ar.style.transform = `rotate(0deg)`;
        }
    }
}

function handleOrientation(e) {
    if (!isCompassMode || !userMarker) return;
    let h = e.webkitCompassHeading || (e.alpha ? 360 - e.alpha : 0);
    const ar = userMarker.getElement().querySelector('.user-location-arrow');
    if(ar) ar.style.transform = `rotate(${h}deg)`;
}

// --- AVATAR & MARKER USER ---

export function updateUserMarker(lat, lng, acc, h) {
    appState.userPosition = { lat, lng, acc, heading: h };

    const mapInstance = getMapInstance();
    if (!mapInstance) return;

    const currentAvatar = localStorage.getItem('begole_avatar') || 'man';
    const avatars = { 'man': '🚶', 'boar': '🐗', 'deer': '🦌', 'bird': '🦅' };
    const iconChar = avatars[currentAvatar] || '🚶';
    
    let animClass = (currentAvatar === 'bird') ? 'anim-fly' : 'anim-walk';
    let flipStyle = "";
    if (h !== null && h !== undefined && h > 0 && h < 180) flipStyle = "transform: scaleX(-1);";

    const customIcon = L.divIcon({
        className: 'custom-avatar-wrapper',
        html: `<div class="user-avatar-marker ${animClass}" style="${flipStyle}">${iconChar}</div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 30]
    });

    if (!userMarker) {
        userMarker = L.marker([lat, lng], {icon: customIcon, zIndexOffset: 1000}).addTo(mapInstance);
        userAccuracyCircle = L.circle([lat, lng], {radius: acc, color: '#3498db', fillOpacity: 0.15}).addTo(mapInstance);
    } else {
        userMarker.setLatLng([lat, lng]);
        userMarker.setIcon(customIcon);
        if (userAccuracyCircle) {
            userAccuracyCircle.setLatLng([lat, lng]);
            userAccuracyCircle.setRadius(acc);
        }
    }
}

function initAvatarSelection() {
    const currentAvatar = localStorage.getItem('begole_avatar') || 'man';
    document.querySelectorAll('.avatar-option').forEach(e => e.classList.remove('selected'));
    const el = document.getElementById('av-' + currentAvatar);
    if(el) el.classList.add('selected');

    document.querySelectorAll('.avatar-option').forEach(opt => {
        opt.addEventListener('click', (e) => {
            const type = e.target.id.replace('av-', '');
            localStorage.setItem('begole_avatar', type);
            initAvatarSelection();
            showToast("Avatar changé !");
        });
    });
}

// --- HISTORIQUE & CARNET ---

function addHistoryToCurrentPoint() {
    const text = document.getElementById('new-history-entry').value;
    const fileInput = document.getElementById('history-photo-input');
    
    if (!text && (!fileInput.files || !fileInput.files[0])) return;

    const processEntry = async () => {
        let photoData = null;
        if (fileInput.files[0]) {
            photoData = await compressImage(fileInput.files[0], 600, 0.6);
        }

        const p = appState.points[currentEditingIndex];
        if (!p.history) p.history = [];
        
        p.history.push({
            date: new Date().toLocaleDateString(),
            text: text,
            photo: photoData,
            weather: appState.currentEnv.fullString
        });

        await saveToDB('points', p);
        
        renderPointHistory(p.history);
        document.getElementById('new-history-entry').value = "";
        fileInput.value = "";
        document.getElementById('photo-status').style.display = 'none';
    };
    
    processEntry();
}

function renderPointHistory(history) {
    const c = document.getElementById('history-list-container');
    c.innerHTML = "";
    if (!history || !history.length) {
        c.innerHTML = "<small>Vide</small>";
        return;
    }
    
    [...history].reverse().forEach((e, revIndex) => {
        const realIndex = history.length - 1 - revIndex;
        
        const div = document.createElement('div');
        div.className = "history-item";

        // Header
        const header = document.createElement('div');
        header.className = "history-header";
        
        const spanText = document.createElement('span');
        spanText.textContent = `${e.date}: ${e.text || ""}`;
        
        const btnDel = document.createElement('button');
        btnDel.className = "btn-history-delete-row";
        btnDel.textContent = "🗑️";
        
        header.appendChild(spanText);
        header.appendChild(btnDel);
        div.appendChild(header);

        // Météo
        if (e.weather) {
            const wDiv = document.createElement('div');
            wDiv.style.fontSize = "10px";
            wDiv.style.color = "#8e44ad";
            wDiv.textContent = e.weather;
            div.appendChild(wDiv);
        }

        // Photo
        if (e.photo) {
            const img = document.createElement('img');
            img.src = e.photo;
            img.className = "history-img-thumb";
            div.appendChild(img);
            
            img.onclick = () => {
                document.getElementById('lightbox-img').src = e.photo;
                document.getElementById('lightbox-overlay').classList.remove('hidden');
            };
        }

        // Delete Event
        btnDel.onclick = async () => {
            if(confirm("Effacer cette note ?")) {
                appState.points[currentEditingIndex].history.splice(realIndex, 1);
                await saveToDB('points', appState.points[currentEditingIndex]);
                renderPointHistory(appState.points[currentEditingIndex].history);
            }
        };

        c.appendChild(div);
    });
}

// --- SYSTÈME ---

function exportData() {
    const d = { points: appState.points, trips: appState.trips, parcels: appState.parcels, begoledex: appState.begoledex };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(d)], {type:'application/json'}));
    a.download = 'Begole_Backup.json';
    a.click();
}

function importData(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const f = new FileReader();
    f.onload = async (ev) => {
        try {
            const d = JSON.parse(ev.target.result);
            let importedCount = 0;

            if (Array.isArray(d.points)) {
                for (let p of d.points) {
                    if (!p.id) p.id = Date.now() + Math.random();
                    await saveToDB('points', p);
                    importedCount++;
                }
            }
            if (Array.isArray(d.trips)) {
                for (let t of d.trips) {
                    if (!t.id) t.id = Date.now() + Math.random();
                    await saveToDB('trips', t);
                    importedCount++;
                }
            }
            if (Array.isArray(d.parcels)) {
                for (let pc of d.parcels) {
                    if (!pc.id) pc.id = Date.now() + Math.random();
                    await saveToDB('parcels', pc);
                    importedCount++;
                }
            }
            if (Array.isArray(d.begoledex)) { 
                for (let b of d.begoledex) {
                    if (!b.id) b.id = Date.now() + Math.random();
                    await saveToDB('begoledex', b);
                    importedCount++;
                }
            }
            showToast(`${importedCount} éléments restaurés ! Recharge...`);
            setTimeout(() => location.reload(), 1200);
        } catch (err) {
            alert("Erreur import : " + err);
        }
    };
    f.readAsText(file);
}

// --- EFFETS VISUELS UI ---

function toggleClouds() {
    const isActive = document.getElementById('clouds-toggle').checked;
    localStorage.setItem('begole_clouds_pref', isActive);
    const container = document.getElementById('cloud-overlay');
    
    if (isActive) {
        container.classList.add('active');
        if (container.children.length === 0) {
            for (let i = 0; i < 8; i++) {
                const c = document.createElement('div');
                c.className = 'cloud';
                const size = 150 + Math.random() * 300;
                c.style.width = size + 'px';
                c.style.height = (size * 0.6) + 'px';
                c.style.top = (Math.random() * 80 - 10) + 'vh';
                c.style.animationDuration = (30 + Math.random() * 40) + 's';
                c.style.animationDelay = (Math.random() * -50) + 's';
                container.appendChild(c);
            }
        }
    } else {
        container.classList.remove('active');
        setTimeout(() => { if(!isActive) container.innerHTML = ''; }, 2000);
    }
}

export function triggerWeatherEffect(desc) {
    const container = document.getElementById('weather-overlay');
    container.innerHTML = '';
    document.body.classList.remove('weather-active', 'weather-fading');
    
    if (!desc) return;
    const w = desc.toLowerCase();
    let type = null;
    if (w.includes('pluie') || w.includes('averse') || w.includes('orage')) type = 'rain';
    if (w.includes('neige')) type = 'snow';
    
    if (type) {
        document.body.classList.add('weather-active');
        const count = type === 'rain' ? 50 : 30;
        for (let i = 0; i < count; i++) {
            const p = document.createElement('div');
            p.classList.add(type);
            p.style.left = Math.random() * 100 + 'vw';
            p.style.animationDuration = (Math.random() + 0.5) + 's';
            container.appendChild(p);
        }
    }
}

export function updateWindVisuals() {
    const container = document.getElementById('pollen-overlay');
    if (!container) return;
    
    const isNight = document.body.classList.contains('theme-dark');
    if (isNight) {
        container.style.opacity = '0';
        return;
    } else {
        container.style.opacity = '1';
    }

    if (container.children.length === 0) {
        initAmbientEffects(); 
    }

    const windDir = (appState.currentEnv && appState.currentEnv.windDir) ? appState.currentEnv.windDir : 0;
    const windSpeed = (appState.currentEnv && appState.currentEnv.windSpeed) ? appState.currentEnv.windSpeed : 5;

    const rotation = windDir + 180;
    container.style.transform = `rotate(${rotation}deg)`;

    const particles = document.querySelectorAll('.pollen');
    const duration = Math.max(2, 20 - (windSpeed / 2)) + 's';
    
    particles.forEach(p => {
        p.style.animationDuration = duration;
    });
}

function toggleDeepNight(e, forceState = null) {
    const isActive = (forceState !== null) ? forceState : (e ? e.target.checked : false);
    
    if (forceState !== null) {
        const cb = document.getElementById('deep-night-toggle');
        if (cb) cb.checked = isActive;
    }
    
    localStorage.setItem('begole_deep_night_pref', isActive);
    if (isActive) document.body.classList.add('deep-night-active');
    else document.body.classList.remove('deep-night-active');
}

function toggleLocationRequest() { 
    if(!userMarker) showToast("Recherche GPS...");
    else {
        const mapInstance = getMapInstance();
        if(mapInstance) mapInstance.setView(userMarker.getLatLng(), 16);
    }
}

function openPlantNetModal() {
    resetPlantNetUI(); 
    document.getElementById('modal-plantnet').classList.remove('hidden');
}

function toggleMenuIfMobile() {
    const menu = document.getElementById('menu-items');
    if (!menu.classList.contains('hidden-mobile')) {
        menu.classList.add('hidden-mobile');
    }
}

function initAmbientEffects() {
    const fireflyContainer = document.getElementById('firefly-overlay');
    if (fireflyContainer && fireflyContainer.children.length === 0) {
        for (let i = 0; i < 20; i++) {
            const f = document.createElement('div');
            f.className = 'firefly';
            f.style.left = Math.random() * 100 + 'vw';
            f.style.top = Math.random() * 100 + 'vh';
            f.style.animationDelay = Math.random() * 5 + 's';
            f.style.setProperty('--moveX', (Math.random() * 200 - 100) + 'px');
            f.style.setProperty('--moveY', (Math.random() * 200 - 100) + 'px');
            fireflyContainer.appendChild(f);
        }
    }

    const pollenContainer = document.getElementById('pollen-overlay');
    if (pollenContainer) {
        pollenContainer.innerHTML = ''; 
        for (let i = 0; i < 40; i++) {
            const p = document.createElement('div');
            p.className = 'pollen';
            
            p.style.left = Math.random() * 100 + '%';
            p.style.top = Math.random() * 100 + '%';
            p.style.animationDelay = Math.random() * 10 + 's';
            p.style.setProperty('--drift', (Math.random() * 100 - 50) + 'px');
            
            pollenContainer.appendChild(p);
        }
        setTimeout(updateWindVisuals, 500);
    }
}

// --- LOGIQUE GÉNÉRIQUE DES BOUTONS SLIDER (GLISSER POUR VALIDER) ---
function createSwipeAction(containerId, thumbId, textId, onActionCallback) {
    const container = document.getElementById(containerId);
    const thumb = document.getElementById(thumbId);
    const text = document.getElementById(textId);
    if (!container || !thumb) return;

    let isDragging = false;
    let startX = 0;
    let maxTravel = 0;

    const startDrag = (e) => {
        isDragging = true;
        thumb.style.transition = 'none'; 
        maxTravel = container.clientWidth - thumb.clientWidth - 10; 
        startX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
    };

    const drag = (e) => {
        if (!isDragging) return;
        let currentX = e.type.includes('mouse') ? e.clientX : e.touches[0].clientX;
        let diffX = currentX - startX;

        // On bloque le bouton pour qu'il reste dans son conteneur
        if (diffX < 0) diffX = 0;
        if (diffX > maxTravel) diffX = maxTravel;

        thumb.style.transform = `translateX(${diffX}px)`;
        if (text) text.style.opacity = 1 - (diffX / maxTravel);
    };

    const endDrag = () => {
        if (!isDragging) return;
        isDragging = false;
        
        // On remet l'animation pour un retour fluide
        thumb.style.transition = 'transform 0.3s ease';

        const transform = thumb.style.transform;
        const match = transform.match(/translateX\((.*)px\)/);
        const diffX = match ? parseFloat(match[1]) : 0;

        // Si glissé à plus de 85%, on valide l'action !
        if (diffX > maxTravel * 0.85) {
            onActionCallback();
        }

        // On réinitialise l'apparence
        thumb.style.transform = `translateX(0px)`;
        if (text) text.style.opacity = 1;
    };

    // Écouteurs pour la souris et le tactile
    thumb.addEventListener('mousedown', startDrag);
    thumb.addEventListener('touchstart', startDrag, { passive: true });

    document.addEventListener('mousemove', drag);
    document.addEventListener('touchmove', drag, { passive: true });
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchend', endDrag);
}