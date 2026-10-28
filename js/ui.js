// =========================================
// CONTRÔLEUR D'INTERFACE UTILISATEUR (UI)
// =========================================

import { saveToDB, deleteFromDB, clearStoreDB } from './db.js';
import {
    refreshMap, toggleCadastreMode, toggleSavedParcels, toggleHeatmap,
    toggleBorders, updateCadastreOpacity, registerMapCallbacks, getMapInstance,
    startReplay, stopReplay, displaySingleTrip, clearTracksAndShowPoints,
    updateRadarDisplay, removeRadarDisplay,
    toggleBegoledexOnMap, toggleMeasureTool, clearMeasurement,
    setReplaySpeed, toggleReplayPause, clearParcelHighlight
} from './map.js';
import {
    openCadastreStatsModal, openParcelModalFromFeature, openEditSavedParcelModal,
    confirmSaveParcel, deleteParcelById, setSelectedParcelColor,
    renderMenuCadastreSummary, computeCadastreAnalytics
} from './cadastre.js';
import { toggleSoundscape } from './audio.js';
import { showAchievements, updateUserLevel } from './gamification.js';
import { handlePlantUpload, resetPlantNetUI } from './plantnet.js';
import { openPisteurModal } from './pisteur.js';
import { openBegoledexModal } from './begoledex.js';
import {
    showToast, triggerHaptic, compressImage, formatDuration,
    exportTripToGPX, parseGPX, toDMS, playAudioCue, escapeHtml
} from './utils.js';
import { VILLAGE_COORDS } from './config.js';
import { appState } from './state.js';
import { updateWeatherWidget } from './modules/weather.js';

// --- État UI local ---
let tempLatLng = null;
let currentEditingIndex = -1;
let currentEditingTripId = null;
let isCompassMode = false;
let userMarker = null;
let userAccuracyCircle = null;

/**
 * Initialise tous les écouteurs d'événements du DOM
 */
export function initEventListeners(map) {
    // 1. Callbacks Carte (Lien Map -> UI / Cadastre)
    registerMapCallbacks({
        onEditPoint: (point, index) => openEditPointModal(index),
        onParcelFound: (feature) => openParcelModalFromFeature(feature),
        onEditSavedParcel: (parcel) => openEditSavedParcelModal(parcel),
        onDeleteParcel: (id) => deleteParcelById(id),
        onReplayFinished: () => {
            showToast("Replay terminé ! 🏁");
            triggerHaptic('success');
            document.getElementById('replay-controls').classList.add('hidden');
        }
    });

    // 2. Écouteurs globaux d'événements personnalisés
    document.addEventListener('map-click-point', (e) => {
        tempLatLng = e.detail.latlng;
        openNewPointModal();
    });

    document.addEventListener('tracking-update', (e) => {
        updateUserMarker(e.detail.lat, e.detail.lng, e.detail.acc, e.detail.head);
    });

    document.addEventListener('weather-updated', updateWindVisuals);

    document.addEventListener('mode-changed', (e) => {
        updateActiveModeBanner(e.detail.cadastre, e.detail.measure);
    });

    // 3. Navigation par Onglets dans le Menu
    document.querySelectorAll('.menu-tab-btn').forEach(tabBtn => {
        tabBtn.addEventListener('click', () => {
            const targetId = tabBtn.dataset.menuTab;
            switchMenuTab(targetId);
        });
    });

    // 4. Barre de statut supérieure & Boutons flottants
    document.getElementById('menu-toggle').addEventListener('click', toggleMenu);
    document.getElementById('btn-compass').addEventListener('click', toggleCompass);
    document.getElementById('btn-recenter').addEventListener('click', () => {
        const mapInstance = getMapInstance();
        if (userMarker && mapInstance) mapInstance.setView(userMarker.getLatLng(), 16);
        document.getElementById('btn-recenter').classList.add('hidden');
    });

    const topWeatherPill = document.getElementById('top-weather-pill');
    if (topWeatherPill) {
        topWeatherPill.addEventListener('click', () => {
            updateWeatherWidget();
            showToast("🔄 Météo actualisée");
        });
    }

    // 5. Dock d'Actions Rapides (Barre inférieure)
    const dockBtnPoint = document.getElementById('dock-btn-point');
    if (dockBtnPoint) {
        dockBtnPoint.addEventListener('click', () => {
            const mapInstance = getMapInstance();
            if (userMarker) {
                tempLatLng = userMarker.getLatLng();
            } else if (mapInstance) {
                tempLatLng = mapInstance.getCenter();
            }
            openNewPointModal();
        });
    }

    const dockBtnTrack = document.getElementById('dock-btn-track');
    if (dockBtnTrack) {
        dockBtnTrack.addEventListener('click', () => {
            import('./tracking.js').then(module => module.toggleTracking());
        });
    }

    const dockBtnCadastre = document.getElementById('dock-btn-cadastre');
    if (dockBtnCadastre) {
        dockBtnCadastre.addEventListener('click', () => {
            const toggle = document.getElementById('cadastre-mode-toggle');
            if (toggle) {
                toggle.checked = !toggle.checked;
                toggle.dispatchEvent(new Event('change'));
                showToast(toggle.checked ? "🏠 Mode Cadastre actif : touchez une parcelle" : "🏠 Mode Cadastre désactivé");
            }
        });
    }

    const dockBtnCadStats = document.getElementById('dock-btn-stats-cadastre');
    if (dockBtnCadStats) {
        dockBtnCadStats.addEventListener('click', () => openCadastreStatsModal('overview'));
    }

    const dockBtnPlant = document.getElementById('dock-btn-plantnet');
    if (dockBtnPlant) {
        dockBtnPlant.addEventListener('click', openPlantNetModal);
    }

    // 6. Actions Rapides du Menu
    document.getElementById('btn-tracking').addEventListener('click', () => {
        import('./tracking.js').then(module => module.toggleTracking());
    });

    createSwipeAction('swipe-pocket-container', 'swipe-pocket-thumb', 'swipe-pocket-text', () => {
        togglePocketMode();
    });

    createSwipeAction('swipe-unlock-container', 'swipe-unlock-thumb', 'swipe-unlock-text', () => {
        togglePocketMode();
    });

    document.getElementById('btn-fullscreen').addEventListener('click', toggleFullScreen);

    // 7. Outils Nature & Exploration
    document.getElementById('btn-plantnet').addEventListener('click', openPlantNetModal);
    document.getElementById('plantnet-file-input').addEventListener('change', (e) => handlePlantUpload(e.target));
    document.getElementById('btn-plantnet-close').addEventListener('click', () => document.getElementById('modal-plantnet').classList.add('hidden'));

    document.getElementById('btn-pisteur').addEventListener('click', openPisteurModal);
    document.getElementById('btn-pisteur-close').addEventListener('click', () => document.getElementById('modal-pisteur').classList.add('hidden'));

    document.getElementById('btn-sound').addEventListener('click', toggleSoundscape);

    const btnBegoledex = document.getElementById('btn-begoledex');
    if (btnBegoledex) btnBegoledex.addEventListener('click', openBegoledexModal);

    const btnCloseBegoledex = document.getElementById('btn-begoledex-close');
    if (btnCloseBegoledex) {
        btnCloseBegoledex.addEventListener('click', () => {
            document.getElementById('modal-begoledex')?.classList.add('hidden');
        });
    }

    // 8. Toggles Carte & Cadastre
    document.getElementById('cadastre-mode-toggle').addEventListener('change', (e) => {
        toggleCadastreMode(e.target.checked);
        const showParcels = document.getElementById('show-parcels-toggle')?.checked;
        document.getElementById('cadastre-opacity-container')?.classList.toggle('hidden', !e.target.checked && !showParcels);
    });

    document.getElementById('show-parcels-toggle').addEventListener('change', (e) => {
        toggleSavedParcels(e.target.checked);
        const cadMode = document.getElementById('cadastre-mode-toggle')?.checked;
        document.getElementById('cadastre-opacity-container')?.classList.toggle('hidden', !e.target.checked && !cadMode);
    });

    document.getElementById('cadastre-opacity-input').addEventListener('input', (e) => updateCadastreOpacity(e.target.value));
    document.getElementById('heatmap-toggle').addEventListener('change', (e) => toggleHeatmap(e.target.checked, appState.trips));

    // Bouton rapide d'activation cadastre depuis l'onglet Cadastre
    const btnQuickCadInspect = document.getElementById('btn-quick-cadastre-inspect');
    if (btnQuickCadInspect) {
        btnQuickCadInspect.addEventListener('click', () => {
            const toggle = document.getElementById('cadastre-mode-toggle');
            if (toggle) {
                toggle.checked = !toggle.checked;
                toggle.dispatchEvent(new Event('change'));
                if (toggle.checked) toggleMenuIfMobile();
            }
        });
    }

    // Radar Proximité
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

    // Bégoledex sur Carte
    const begoledexMapToggle = document.getElementById('begoledex-map-toggle');
    if (begoledexMapToggle) {
        begoledexMapToggle.addEventListener('change', (e) => {
            appState.showBegoledexOnMap = e.target.checked;
            toggleBegoledexOnMap(e.target.checked, appState.begoledex);
        });
    }

    // Outil Mesure / Télémètre
    const btnMeasure = document.getElementById('btn-measure');
    if (btnMeasure) {
        btnMeasure.addEventListener('click', () => {
            toggleMenuIfMobile();
            toggleMeasureTool();
        });
    }

    // SOS & Partage Coordonnées
    const btnSos = document.getElementById('btn-sos');
    if (btnSos) {
        btnSos.addEventListener('click', () => {
            toggleMenuIfMobile();
            openSosModal();
        });
    }
    document.getElementById('btn-sos-close')?.addEventListener('click', () => {
        document.getElementById('modal-sos').classList.add('hidden');
    });
    document.getElementById('btn-sos-copy')?.addEventListener('click', copySosCoordinates);

    // Replay Contrôles Avancés
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

    // Chips Catégories Rapides (Nouveau Point)
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

    // Chips Filtres Rapides (Menu Carte)
    document.querySelectorAll('.quick-filter-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const emoji = chip.dataset.filterEmoji || '';
            const filterInput = document.getElementById('filter-input');
            if (filterInput) {
                filterInput.value = (filterInput.value === emoji) ? '' : emoji;
                applyFilters(false);
                document.querySelectorAll('.quick-filter-chip').forEach(c => {
                    c.classList.toggle('active', c.dataset.filterEmoji === filterInput.value && filterInput.value !== '');
                });
            }
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

    // 9. Filtres en direct (Live Search)
    let filterDebounce = null;
    const onLiveFilter = () => {
        clearTimeout(filterDebounce);
        filterDebounce = setTimeout(() => {
            applyFilters(false);
        }, 180);
    };
    document.getElementById('text-filter-input').addEventListener('input', onLiveFilter);
    document.getElementById('filter-input').addEventListener('input', onLiveFilter);
    document.getElementById('filter-year').addEventListener('change', () => applyFilters(false));
    document.getElementById('filter-month').addEventListener('change', () => applyFilters(false));
    document.getElementById('btn-filter-ok').addEventListener('click', () => applyFilters(true));
    document.getElementById('btn-filter-reset').addEventListener('click', resetFilters);
    document.getElementById('btn-loc').addEventListener('click', toggleLocationRequest);

    // 10. Modales Points & Carnet
    document.getElementById('btn-modal-point-cancel').addEventListener('click', closeModal);
    document.getElementById('btn-modal-point-confirm').addEventListener('click', confirmAddPoint);
    document.getElementById('btn-edit-point-save').addEventListener('click', savePointEdits);
    document.getElementById('btn-edit-point-delete').addEventListener('click', deleteCurrentPoint);
    document.getElementById('btn-edit-point-close')?.addEventListener('click', () => {
        document.getElementById('modal-edit-point').classList.add('hidden');
    });
    document.getElementById('btn-add-history').addEventListener('click', addHistoryToCurrentPoint);

    const historyPhotoInput = document.getElementById('history-photo-input');
    if (historyPhotoInput) {
        historyPhotoInput.addEventListener('change', () => {
            const status = document.getElementById('photo-status');
            if (status) {
                status.style.display = (historyPhotoInput.files && historyPhotoInput.files[0]) ? 'inline-block' : 'none';
            }
        });
    }

    // 11. Modales Parcelles & Cadastre
    document.getElementById('btn-parcel-close').addEventListener('click', () => {
        clearParcelHighlight();
        document.getElementById('modal-parcel').classList.add('hidden');
    });
    document.getElementById('btn-parcel-save').addEventListener('click', confirmSaveParcel);
    document.querySelectorAll('.color-option').forEach(el => {
        el.addEventListener('click', (e) => {
            const color = e.currentTarget.getAttribute('data-color');
            setSelectedParcelColor(color);
        });
    });

    // 12. Historique Trajets & Statistiques
    document.getElementById('btn-open-history').addEventListener('click', openHistory);
    document.getElementById('btn-history-close').addEventListener('click', () => document.getElementById('history-overlay').classList.add('hidden'));
    document.getElementById('filter-trip-class')?.addEventListener('change', () => openHistory(false));

    document.getElementById('btn-show-stats').addEventListener('click', openStatsModal);
    document.getElementById('btn-stats-close').addEventListener('click', () => document.getElementById('stats-overlay').classList.add('hidden'));

    document.getElementById('btn-show-cadastre-stats').addEventListener('click', () => openCadastreStatsModal('overview'));
    document.getElementById('btn-open-cadastre-dashboard')?.addEventListener('click', () => openCadastreStatsModal('overview'));
    document.getElementById('btn-open-cadastre-list')?.addEventListener('click', () => openCadastreStatsModal('list'));
    document.getElementById('btn-cadastre-stats-close').addEventListener('click', () => document.getElementById('modal-cadastre-stats').classList.add('hidden'));

    // 13. Modales Trajet & Dénivelé
    document.getElementById('btn-edit-trip-close').addEventListener('click', () => document.getElementById('modal-edit-trip').classList.add('hidden'));
    document.getElementById('btn-edit-trip-save').addEventListener('click', confirmSaveTripNote);
    document.getElementById('btn-elevation-close').addEventListener('click', () => document.getElementById('modal-elevation').classList.add('hidden'));
    document.getElementById('btn-replay-stop').addEventListener('click', () => {
        stopReplay();
        document.getElementById('replay-controls').classList.add('hidden');
    });

    // 14. Succès & Badges
    document.getElementById('achievements-trigger').addEventListener('click', () => showAchievements(appState.points, appState.trips));
    document.getElementById('btn-achievements-close').addEventListener('click', () => document.getElementById('modal-achievements').classList.add('hidden'));

    // 15. Système, Sauvegarde & Import GPX
    document.getElementById('btn-export').addEventListener('click', exportData);
    document.getElementById('import-file').addEventListener('change', importData);

    const gpxInput = document.getElementById('import-gpx-file');
    if (gpxInput) gpxInput.addEventListener('change', handleGpxImport);

    document.addEventListener('trip-saved', () => {
        if (!document.getElementById('history-overlay').classList.contains('hidden')) {
            openHistory(false);
        }
        const heatToggle = document.getElementById('heatmap-toggle');
        if (heatToggle && heatToggle.checked) {
            toggleHeatmap(true, appState.trips);
        }
    });

    document.getElementById('btn-reset-data').addEventListener('click', async () => {
        if (confirm("⚠️ Tout effacer ? Action irréversible.")) {
            await clearStoreDB('points');
            await clearStoreDB('parcels');
            await clearStoreDB('trips');
            await clearStoreDB('begoledex');
            location.reload();
        }
    });

    document.getElementById('weather-widget-btn').addEventListener('click', updateWeatherWidget);

    // Fermeture des modales en cliquant sur l'arrière-plan sombre
    document.querySelectorAll('.modal-backdrop-close').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.add('hidden');
                clearParcelHighlight();
            }
        });
    });

    initAvatarSelection();
    initAmbientEffects();
}

/**
 * Change d'onglet dans le menu principal
 */
export function switchMenuTab(tabId) {
    document.querySelectorAll('.menu-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.menuTab === tabId);
    });
    document.querySelectorAll('.menu-tab-panel').forEach(panel => {
        panel.classList.toggle('active', panel.id === tabId);
    });
    if (tabId === 'tab-cadastre') {
        renderMenuCadastreSummary();
    }
}

/**
 * Met à jour la bannière flottante de mode actif (Cadastre ou Télémètre)
 */
function updateActiveModeBanner(isCadastre, isMeasure) {
    const banner = document.getElementById('active-mode-banner');
    const dockCadBtn = document.getElementById('dock-btn-cadastre');
    const btnQuickCad = document.getElementById('btn-quick-cadastre-inspect');
    const btnMeasure = document.getElementById('btn-measure');

    if (dockCadBtn) dockCadBtn.classList.toggle('active-mode', Boolean(isCadastre));
    if (btnQuickCad) {
        btnQuickCad.innerHTML = isCadastre
            ? '🟢 Mode Inspection Actif (Désactiver)'
            : '🏠 Activer l\'Inspection sur la Carte';
        btnQuickCad.classList.toggle('active', Boolean(isCadastre));
    }
    if (btnMeasure) {
        btnMeasure.style.background = isMeasure ? "#d35400" : "";
    }

    if (!banner) return;

    if (isCadastre) {
        banner.classList.remove('hidden');
        banner.className = 'mode-banner cadastre-banner';
        banner.innerHTML = `
            <span class="banner-text">🏠 <b>Mode Cadastre</b> : Touchez une parcelle</span>
            <div class="banner-actions">
                <button type="button" id="banner-btn-cad-stats" class="banner-btn">📊 Stats</button>
                <button type="button" id="banner-btn-cad-exit" class="banner-btn exit">✕</button>
            </div>
        `;
        banner.querySelector('#banner-btn-cad-stats')?.addEventListener('click', () => openCadastreStatsModal('overview'));
        banner.querySelector('#banner-btn-cad-exit')?.addEventListener('click', () => {
            const toggle = document.getElementById('cadastre-mode-toggle');
            if (toggle) {
                toggle.checked = false;
                toggle.dispatchEvent(new Event('change'));
            }
        });
    } else if (isMeasure) {
        banner.classList.remove('hidden');
        banner.className = 'mode-banner measure-banner';
        banner.innerHTML = `
            <span class="banner-text">📏 <b>Télémètre</b> : Touchez la carte</span>
            <div class="banner-actions">
                <button type="button" id="banner-btn-meas-clear" class="banner-btn">🗑️ Effacer</button>
                <button type="button" id="banner-btn-meas-exit" class="banner-btn exit">✕</button>
            </div>
        `;
        banner.querySelector('#banner-btn-meas-clear')?.addEventListener('click', clearMeasurement);
        banner.querySelector('#banner-btn-meas-exit')?.addEventListener('click', () => toggleMeasureTool(false));
    } else {
        banner.classList.add('hidden');
    }
}

/**
 * Peuple dynamiquement le sélecteur d'année avec les années présentes dans les points
 */
export function populateYearFilter() {
    const select = document.getElementById('filter-year');
    if (!select) return;

    const currentVal = select.value || 'all';
    const years = new Set();
    const currentYear = new Date().getFullYear().toString();
    years.add(currentYear);

    (appState.points || []).forEach(p => {
        if (p.date) {
            const parts = p.date.split('/');
            if (parts.length === 3 && parts[2].length === 4) {
                years.add(parts[2]);
            }
        }
    });

    const sortedYears = Array.from(years).sort((a, b) => b.localeCompare(a));
    select.innerHTML = `<option value="all">📅 Toutes années</option>` +
        sortedYears.map(y => `<option value="${y}">${y}</option>`).join('');

    if (sortedYears.includes(currentVal)) {
        select.value = currentVal;
    }
}

// ============================================================
// --- GESTION HISTORIQUE TRAJETS ---
// ============================================================

function openHistory(shouldCloseMenu = true) {
    const div = document.getElementById('tripList');
    if (!div) return;
    div.innerHTML = "";
    const filterDist = document.getElementById('filter-trip-class')?.value || 'all';

    const cleanBtn = document.createElement('button');
    cleanBtn.className = "btn-cancel";
    cleanBtn.style.marginBottom = "12px";
    cleanBtn.style.width = "100%";
    cleanBtn.textContent = "🧹 Retirer les tracés & Réafficher les points";
    cleanBtn.onclick = () => {
        clearTracksAndShowPoints();
        document.getElementById('history-overlay').classList.add('hidden');
    };
    div.appendChild(cleanBtn);

    appState.trips.sort((a, b) => new Date(b.date) - new Date(a.date)).forEach(t => {
        const dKm = t.distance || 0;

        if (filterDist === 'blue' && dKm >= 2) return;
        if (filterDist === 'green' && (dKm < 2 || dKm >= 5)) return;
        if (filterDist === 'orange' && (dKm < 5 || dKm >= 10)) return;
        if (filterDist === 'red' && dKm < 10) return;

        const dateStr = new Date(t.date).toLocaleDateString();
        const durStr = t.duration ? ` • ⏱️ ${formatDuration(t.duration)}` : '';
        let color = dKm < 2 ? '#3498db' : dKm < 5 ? '#2ecc71' : dKm < 10 ? '#f39c12' : '#e74c3c';

        const item = document.createElement('div');
        item.className = "trip-item";

        const clickArea = document.createElement('div');
        clickArea.className = "trip-click-area";
        clickArea.style.flexGrow = "1";
        clickArea.style.cursor = "pointer";

        const dateSpan = document.createElement('span');
        dateSpan.className = "trip-date";
        dateSpan.style.borderLeft = `4px solid ${color}`;
        dateSpan.style.paddingLeft = "6px";
        dateSpan.textContent = dateStr;

        const infoSpan = document.createElement('span');
        infoSpan.className = "trip-info";
        infoSpan.textContent = `📏 ${(t.distance || 0).toFixed(2)} km • 🏔️ +${t.elevationGain || 0} m${durStr}`;

        const noteDiv = document.createElement('div');
        noteDiv.style.fontSize = "11px";
        noteDiv.style.color = "var(--text-sub)";
        noteDiv.style.fontStyle = "italic";
        noteDiv.style.marginTop = "2px";
        noteDiv.textContent = t.note || "";

        clickArea.appendChild(dateSpan);
        clickArea.appendChild(infoSpan);
        if (t.note) clickArea.appendChild(noteDiv);

        const btnArea = document.createElement('div');
        btnArea.style.display = "flex";
        btnArea.style.gap = "5px";

        const btnPlay = document.createElement('button');
        btnPlay.className = "btn-graph-trip";
        btnPlay.style.background = "#e67e22";
        btnPlay.title = "Rejouer l'animation";
        btnPlay.textContent = "▶️";

        const btnElev = document.createElement('button');
        btnElev.className = "btn-graph-trip";
        btnElev.title = "Profil de dénivelé";
        btnElev.textContent = "📈";

        const btnGpx = document.createElement('button');
        btnGpx.className = "btn-graph-trip";
        btnGpx.style.background = "#27ae60";
        btnGpx.title = "Exporter GPX";
        btnGpx.textContent = "🗺️";

        const btnEdit = document.createElement('button');
        btnEdit.className = "btn-delete-trip";
        btnEdit.style.background = "#8e44ad";
        btnEdit.title = "Modifier la note";
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

        clickArea.onclick = () => {
            displaySingleTrip(t, color);
            document.getElementById('history-overlay').classList.add('hidden');
        };

        btnPlay.onclick = () => {
            document.getElementById('history-overlay').classList.add('hidden');
            document.getElementById('replay-controls').classList.remove('hidden');
            startReplay(t);
        };

        btnElev.onclick = () => openElevationModal(t);

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
            if (confirm("Supprimer ce trajet ?")) {
                await deleteFromDB('trips', t.id);
                appState.trips = appState.trips.filter(x => x.id !== t.id);
                updateUserLevel(appState.points, appState.trips);
                openHistory(false);
            }
        };

        div.appendChild(item);
    });

    if (!div.hasChildNodes() || (div.childNodes.length === 1 && div.firstChild === cleanBtn)) {
        const empty = document.createElement('div');
        empty.style.textAlign = 'center';
        empty.style.padding = '25px';
        empty.style.color = 'var(--text-sub)';
        empty.textContent = "Aucun trajet dans cette catégorie.";
        div.appendChild(empty);
    }

    document.getElementById('history-overlay').classList.remove('hidden');
    if (shouldCloseMenu) toggleMenuIfMobile();
}

async function confirmSaveTripNote() {
    if (currentEditingTripId) {
        const trip = appState.trips.find(t => t.id === currentEditingTripId);
        if (trip) {
            trip.note = document.getElementById('edit-trip-note').value;
            await saveToDB('trips', trip);
            document.getElementById('modal-edit-trip').classList.add('hidden');
            if (!document.getElementById('history-overlay').classList.contains('hidden')) {
                openHistory(false);
            }
            showToast("Note du trajet enregistrée ✅");
        }
    }
}

function openElevationModal(trip) {
    if (!trip || !trip.points || trip.points.length < 2) {
        showToast("Pas assez de données d'altitude");
        return;
    }
    document.getElementById('modal-elevation').classList.remove('hidden');
    setTimeout(() => drawElevationProfile(trip.points), 80);
}

function drawElevationProfile(pts) {
    const canvas = document.getElementById('elevation-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    const alts = pts.map(p => p[2] || 0);
    const min = Math.min(...alts);
    const max = Math.max(...alts);
    const rng = max - min || 1;

    document.getElementById('elev-min').textContent = `Min : ${Math.round(min)} m`;
    document.getElementById('elev-max').textContent = `Max : ${Math.round(max)} m`;

    ctx.beginPath();
    ctx.moveTo(0, h);
    const step = w / (alts.length - 1);

    alts.forEach((a, i) => {
        const y = h - ((a - min) / rng * (h - 24)) - 12;
        ctx.lineTo(i * step, y);
    });

    ctx.lineTo(w, h);
    ctx.closePath();

    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgba(46, 204, 113, 0.75)");
    g.addColorStop(1, "rgba(46, 204, 113, 0.08)");
    ctx.fillStyle = g;
    ctx.fill();

    ctx.strokeStyle = "#27ae60";
    ctx.lineWidth = 2.5;
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
        showToast(`GPX importé : ${(parsed.distance).toFixed(2)} km, +${parsed.elevationGain} m 🥾`);
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
// --- STATISTIQUES GLOBALES D'EXPLORATION ---
// ============================================================

function openStatsModal() {
    const points = appState.points || [];
    const trips = appState.trips || [];
    const plants = appState.begoledex || [];
    const cadStats = computeCadastreAnalytics();

    const totalPoints = points.length;
    const totalTrips = trips.length;
    const totalDist = trips.reduce((acc, t) => acc + (t.distance || 0), 0);
    const totalElev = trips.reduce((acc, t) => acc + (t.elevationGain || 0), 0);
    const totalDurationMs = trips.reduce((acc, t) => acc + (t.duration || 0), 0);
    const maxTripDist = trips.length > 0 ? Math.max(...trips.map(t => t.distance || 0)) : 0;
    const maxTripElev = trips.length > 0 ? Math.max(...trips.map(t => t.elevationGain || 0)) : 0;

    // Top emojis de points
    const emojiCounts = {};
    points.forEach(p => {
        const em = p.emoji || '📍';
        emojiCounts[em] = (emojiCounts[em] || 0) + 1;
    });
    const topEmojis = Object.entries(emojiCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    const emojiBarsHtml = topEmojis.length === 0
        ? `<div style="font-size:12px; color:var(--text-sub); text-align:center; padding:10px;">Aucun point enregistré pour le moment.</div>`
        : topEmojis.map(([em, cnt]) => {
            const pct = Math.round((cnt / totalPoints) * 100);
            return `
                <div class="cad-bar-item">
                    <div class="cad-bar-header">
                        <span><b style="font-size:15px;">${em}</b> Repères</span>
                        <span><b>${cnt}</b> (${pct}%)</span>
                    </div>
                    <div class="cad-bar-track">
                        <div class="cad-bar-fill" style="width:${pct}%; background:#2ecc71;"></div>
                    </div>
                </div>
            `;
        }).join('');

    const html = `
        <div class="stats-grid-modern">
            <div class="stat-card-modern">
                <div class="stat-val" style="color:#2ecc71;">${totalPoints}</div>
                <div class="stat-lbl">📍 Points</div>
            </div>
            <div class="stat-card-modern">
                <div class="stat-val" style="color:#e67e22;">${totalTrips}</div>
                <div class="stat-lbl">🥾 Trajets</div>
            </div>
            <div class="stat-card-modern">
                <div class="stat-val" style="color:#3498db;">${totalDist.toFixed(1)} <small>km</small></div>
                <div class="stat-lbl">📏 Distance</div>
            </div>
            <div class="stat-card-modern">
                <div class="stat-val" style="color:#27ae60;">+${Math.round(totalElev)} <small>m</small></div>
                <div class="stat-lbl">⛰️ Dénivelé D+</div>
            </div>
            <div class="stat-card-modern">
                <div class="stat-val" style="color:#16a085;">${plants.length}</div>
                <div class="stat-lbl">🌿 Bégoledex</div>
            </div>
            <div class="stat-card-modern">
                <div class="stat-val" style="color:#f39c12;">${cadStats.totalCadastral.haShort} <small>ha</small></div>
                <div class="stat-lbl">🏛️ ${cadStats.totalParcels} Parcelles</div>
            </div>
        </div>

        <div class="cad-section-card" style="margin-top:12px;">
            <div class="cad-section-header">🏅 Records de Randonnée</div>
            <div class="records-list">
                <div class="record-row"><span>Plus longue sortie</span><b>${maxTripDist.toFixed(2)} km</b></div>
                <div class="record-row"><span>Plus fort dénivelé</span><b>+${Math.round(maxTripElev)} m</b></div>
                <div class="record-row"><span>Temps total enregistré</span><b>${formatDuration(totalDurationMs)}</b></div>
            </div>
        </div>

        <div class="cad-section-card" style="margin-top:12px;">
            <div class="cad-section-header">🍄 Top Catégories de Points</div>
            <div class="cad-bars-container">
                ${emojiBarsHtml}
            </div>
        </div>

        <button type="button" id="btn-stats-jump-cadastre" class="btn-confirm" style="width:100%; margin-top:12px; padding:12px; border-radius:12px; border:none; font-weight:700; cursor:pointer; background:linear-gradient(135deg, #e67e22, #d35400); color:white;">
            📊 Ouvrir les Statistiques Détaillées du Cadastre
        </button>
    `;

    const container = document.getElementById('stats-content');
    if (container) {
        container.innerHTML = html;
        container.querySelector('#btn-stats-jump-cadastre')?.addEventListener('click', () => {
            document.getElementById('stats-overlay').classList.add('hidden');
            openCadastreStatsModal('overview');
        });
    }
    document.getElementById('stats-overlay').classList.remove('hidden');
    toggleMenuIfMobile();
}

// ============================================================
// --- GESTION DES MODALES DE POINTS ---
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
    if (!tempLatLng) return;

    const newPoint = {
        id: Date.now(),
        lat: tempLatLng.lat,
        lng: tempLatLng.lng,
        note: document.getElementById('input-note').value.trim(),
        emoji: document.getElementById('input-emoji').value.trim() || "📍",
        date: new Date().toLocaleDateString(),
        weather: appState.currentEnv.fullString,
        history: []
    };

    await saveToDB('points', newPoint);
    appState.points.push(newPoint);
    populateYearFilter();
    applyFilters(false);
    renderMenuCadastreSummary();
    closeModal();
    showToast("📍 Point enregistré sur la carte !");

    updateUserLevel(appState.points, appState.trips);
}

function openEditPointModal(index) {
    currentEditingIndex = index;
    const p = appState.points[index];
    if (!p) return;

    document.getElementById('edit-emoji').value = p.emoji;
    document.getElementById('edit-note').value = p.note;

    renderPointHistory(p.history);
    updateModalEnvInfo();

    document.getElementById('modal-edit-point').classList.remove('hidden');
}

async function savePointEdits() {
    if (currentEditingIndex > -1) {
        const p = appState.points[currentEditingIndex];
        p.emoji = document.getElementById('edit-emoji').value.trim() || "📍";
        p.note = document.getElementById('edit-note').value.trim();

        await saveToDB('points', p);
        applyFilters(false);
        document.getElementById('modal-edit-point').classList.add('hidden');
        showToast("Modifications enregistrées ✅");
    }
}

async function deleteCurrentPoint() {
    if (currentEditingIndex > -1 && confirm("Supprimer ce point définitivement ?")) {
        const p = appState.points[currentEditingIndex];
        await deleteFromDB('points', p.id);

        appState.points.splice(currentEditingIndex, 1);
        populateYearFilter();
        applyFilters(false);
        renderMenuCadastreSummary();
        updateUserLevel(appState.points, appState.trips);
        document.getElementById('modal-edit-point').classList.add('hidden');
        showToast("Point supprimé 🗑️");
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
    document.querySelectorAll('.quick-filter-chip').forEach(c => c.classList.remove('active'));
    applyFilters(false);
    showToast("Filtres réinitialisés ✨");
}

// ============================================================
// --- WIDGETS & MENU ---
// ============================================================

export function toggleMenu() {
    const menu = document.getElementById('menu-items');
    const btn = document.getElementById('menu-toggle');
    if (!menu) return;
    const isHidden = menu.classList.toggle('hidden-mobile');
    if (btn) {
        btn.innerHTML = isHidden ? '☰ Menu' : '✕ Fermer';
    }
}

export function updateDashboard(alt, speed, dist) {
    document.getElementById('dash-alt').textContent = alt ? Math.round(alt) : "--";
    document.getElementById('dash-speed').textContent = speed ? Math.round(speed * 3.6) : 0;
    document.getElementById('dash-dist').textContent = dist.toFixed(2);
}

function updateModalEnvInfo() {
    const el1 = document.getElementById('point-env-info');
    const el2 = document.getElementById('history-env-info');
    const info = appState.currentEnv.fullString ? "Conditions : " + appState.currentEnv.fullString : "";

    if (el1) el1.textContent = info;
    if (el2) el2.textContent = info;
}

function toggleFullScreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => showToast("Plein écran non supporté"));
    } else {
        if (document.exitFullscreen) document.exitFullscreen();
    }
    toggleMenuIfMobile();
}

function togglePocketMode() {
    const el = document.getElementById('pocket-overlay');
    el.classList.toggle('hidden-poche');
    if (!el.classList.contains('hidden-poche')) {
        toggleMenuIfMobile();
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
    const dmsText = `${toDMS(lat, true)} • ${toDMS(lng, false)}`;
    const accText = acc ? `Précision GPS : ±${acc} m` : "Précision GPS : Estimée (Centre Bégole)";

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
            showToast("Coordonnées copiées dans le presse-papier 📋");
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
        showToast("🧭 Boussole activée");

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
        if (userMarker && userMarker.getElement()) {
            const av = userMarker.getElement().querySelector('.user-avatar-marker');
            if (av) av.style.transform = '';
        }
    }
}

function handleOrientation(e) {
    if (!isCompassMode || !userMarker || !userMarker.getElement()) return;
    let h = e.webkitCompassHeading || (e.alpha ? 360 - e.alpha : 0);
    const btn = document.getElementById('btn-compass');
    if (btn) btn.style.transform = `rotate(${-h}deg)`;
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
        userMarker = L.marker([lat, lng], { icon: customIcon, zIndexOffset: 1000 }).addTo(mapInstance);
        userAccuracyCircle = L.circle([lat, lng], { radius: acc, color: '#3498db', fillOpacity: 0.15 }).addTo(mapInstance);
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
    if (el) el.classList.add('selected');

    document.querySelectorAll('.avatar-option').forEach(opt => {
        opt.addEventListener('click', (e) => {
            const type = e.currentTarget.id.replace('av-', '');
            localStorage.setItem('begole_avatar', type);
            initAvatarSelection();
            if (appState.userPosition) {
                updateUserMarker(
                    appState.userPosition.lat,
                    appState.userPosition.lng,
                    appState.userPosition.acc,
                    appState.userPosition.heading
                );
            }
            showToast("Avatar mis à jour !");
        });
    });
}

// --- HISTORIQUE & CARNET DE BORD ---

function addHistoryToCurrentPoint() {
    const text = document.getElementById('new-history-entry').value.trim();
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
        updateUserLevel(appState.points, appState.trips);

        renderPointHistory(p.history);
        document.getElementById('new-history-entry').value = "";
        fileInput.value = "";
        document.getElementById('photo-status').style.display = 'none';
        showToast("Entrée ajoutée au carnet 📖");
    };

    processEntry();
}

function renderPointHistory(history) {
    const c = document.getElementById('history-list-container');
    if (!c) return;
    c.innerHTML = "";
    if (!history || !history.length) {
        c.innerHTML = "<small style='color:var(--text-sub);'>Aucune note dans le carnet pour ce lieu.</small>";
        return;
    }

    [...history].reverse().forEach((e, revIndex) => {
        const realIndex = history.length - 1 - revIndex;

        const div = document.createElement('div');
        div.className = "history-item";

        const header = document.createElement('div');
        header.className = "history-header";

        const spanText = document.createElement('span');
        spanText.textContent = `${e.date} : ${e.text || ""}`;

        const btnDel = document.createElement('button');
        btnDel.className = "btn-history-delete-row";
        btnDel.textContent = "🗑️";

        header.appendChild(spanText);
        header.appendChild(btnDel);
        div.appendChild(header);

        if (e.weather) {
            const wDiv = document.createElement('div');
            wDiv.style.fontSize = "10px";
            wDiv.style.color = "#8e44ad";
            wDiv.textContent = e.weather;
            div.appendChild(wDiv);
        }

        if (e.photo) {
            const img = document.createElement('img');
            img.src = e.photo;
            img.className = "history-img-thumb";
            div.appendChild(img);

            img.onclick = () => {
                const lbImg = document.getElementById('lightbox-img');
                const lbOv = document.getElementById('lightbox-overlay');
                if (lbImg && lbOv) {
                    lbImg.src = e.photo;
                    lbOv.classList.remove('hidden');
                    lbOv.onclick = () => lbOv.classList.add('hidden');
                }
            };
        }

        btnDel.onclick = async () => {
            if (confirm("Effacer cette note du carnet ?")) {
                appState.points[currentEditingIndex].history.splice(realIndex, 1);
                await saveToDB('points', appState.points[currentEditingIndex]);
                renderPointHistory(appState.points[currentEditingIndex].history);
            }
        };

        c.appendChild(div);
    });
}

// --- SYSTÈME EXPORT / IMPORT ---

function exportData() {
    const d = {
        points: appState.points,
        trips: appState.trips,
        parcels: appState.parcels,
        begoledex: appState.begoledex
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(d)], { type: 'application/json' }));
    a.download = `Begole_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    showToast("Sauvegarde téléchargée 💾");
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
            showToast(`${importedCount} éléments restaurés ! Rechargement...`);
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
        setTimeout(() => { if (!isActive) container.innerHTML = ''; }, 2000);
    }
}

export function triggerWeatherEffect(desc) {
    const container = document.getElementById('weather-overlay');
    if (!container) return;
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
    if (!userMarker) showToast("Recherche du signal GPS...");
    else {
        const mapInstance = getMapInstance();
        if (mapInstance) mapInstance.setView(userMarker.getLatLng(), 16);
        toggleMenuIfMobile();
    }
}

function openPlantNetModal() {
    resetPlantNetUI();
    document.getElementById('modal-plantnet').classList.remove('hidden');
    toggleMenuIfMobile();
}

function toggleMenuIfMobile() {
    const menu = document.getElementById('menu-items');
    const btn = document.getElementById('menu-toggle');
    if (menu && !menu.classList.contains('hidden-mobile')) {
        menu.classList.add('hidden-mobile');
        if (btn) btn.innerHTML = '☰ Menu';
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
        for (let i = 0; i < 36; i++) {
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

// --- SLIDER SWIPE GÉNÉRIQUE ---
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

        if (diffX < 0) diffX = 0;
        if (diffX > maxTravel) diffX = maxTravel;

        thumb.style.transform = `translateX(${diffX}px)`;
        if (text) text.style.opacity = 1 - (diffX / maxTravel);
    };

    const endDrag = () => {
        if (!isDragging) return;
        isDragging = false;

        thumb.style.transition = 'transform 0.3s ease';

        const transform = thumb.style.transform;
        const match = transform.match(/translateX\((.*)px\)/);
        const diffX = match ? parseFloat(match[1]) : 0;

        if (diffX > maxTravel * 0.85) {
            onActionCallback();
        }

        thumb.style.transform = `translateX(0px)`;
        if (text) text.style.opacity = 1;
    };

    thumb.addEventListener('mousedown', startDrag);
    thumb.addEventListener('touchstart', startDrag, { passive: true });

    document.addEventListener('mousemove', drag);
    document.addEventListener('touchmove', drag, { passive: true });
    document.addEventListener('mouseup', endDrag);
    document.addEventListener('touchend', endDrag);
}
