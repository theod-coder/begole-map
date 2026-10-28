import { VILLAGE_COORDS, DEFAULT_ZOOM, SECRET_EMOJIS, PARCEL_COLOR_CATEGORIES } from './config.js';
import { showToast, triggerHaptic, getSpeedColor, calculateBearing, formatCadastralArea, calculateGeoJSONPerimeter } from './utils.js';

// --- Variables Globales du Module ---
let map = null;
let markersLayer = null;
let cadastreLayer = null;
let parcelsLayer = null;
let highlightParcelLayer = null;
let villageLayer = null;
let heatLayer = null;
let tracksLayer = null;
let radarLayer = null;
let begoledexLayer = null;
let measureLayer = null;

// Index des couches parcelles par ID pour focus rapide
const parcelLayersById = new Map();

// Variables Mesure
let isMeasuring = false;
let measurePoints = [];

// Variables Replay
let replayTimer = null;
let replayMarker = null;
let replayTraceLayer = null;
let replayBgPolyline = null;
let replaySpeedMultiplier = 1;
let isReplayPaused = false;
let replayCurrentTrip = null;
let replayCurrentIndex = 0;
let replayStepIncrement = 1;
let replayDelay = 50;

// Callbacks pour communiquer avec l'UI (évite les dépendances circulaires)
let uiCallbacks = {
    onEditPoint: () => console.warn("Callback onEditPoint non défini"),
    onParcelFound: () => console.warn("Callback onParcelFound non défini"),
    onEditSavedParcel: () => console.warn("Callback onEditSavedParcel non défini"),
    onDeleteParcel: () => console.warn("Callback onDeleteParcel non défini"),
    onReplayFinished: () => {}
};

/**
 * Enregistre les fonctions de l'UI nécessaires à la carte
 */
export function registerMapCallbacks(callbacks) {
    uiCallbacks = { ...uiCallbacks, ...callbacks };
}

/**
 * Initialise la carte Leaflet
 */
export function initMap() {
    // 1. Calques de fond
    const satelliteLayer = L.tileLayer('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg', {
        maxZoom: 19,
        attribution: '© IGN Géoportail'
    });

    const ignPlanLayer = L.tileLayer('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png', {
        maxZoom: 19,
        attribution: '© IGN Plan'
    });

    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap'
    });

    cadastreLayer = L.tileLayer('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=CADASTRALPARCELS.PARCELS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png', {
        maxZoom: 20,
        attribution: '© IGN Cadastre'
    });

    // 2. Carte
    map = L.map('map', {
        center: VILLAGE_COORDS,
        zoom: DEFAULT_ZOOM,
        layers: [satelliteLayer],
        zoomControl: false
    });

    // 3. Contrôles
    const baseMaps = {
        "Satellite IGN 🛰️": satelliteLayer,
        "Plan Topo IGN ⛰️": ignPlanLayer,
        "Plan Route OSM 🗺️": osmLayer
    };
    const overlayMaps = {
        "Cadastre (Traits) 🏠": cadastreLayer
    };
    L.control.layers(baseMaps, overlayMaps, { position: 'bottomright' }).addTo(map);
    L.control.scale({ imperial: false, metric: true, position: 'bottomleft' }).addTo(map);

    // 4. Groupes de Calques
    markersLayer = L.markerClusterGroup({
        maxClusterRadius: 48,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        iconCreateFunction: function(cluster) {
            const count = cluster.getChildCount();
            const maxVal = 20;
            let hue = (1 - Math.min(count, maxVal) / maxVal) * 120;
            if (count > 50) hue = 0;

            return L.divIcon({
                html: `<div class="cluster-badge" style="background-color: hsla(${hue}, 85%, 42%, 0.92);">${count}</div>`,
                className: 'marker-cluster-custom',
                iconSize: L.point(40, 40)
            });
        }
    });
    map.addLayer(markersLayer);

    tracksLayer = L.layerGroup().addTo(map);
    parcelsLayer = L.layerGroup();
    highlightParcelLayer = L.layerGroup().addTo(map);
    radarLayer = L.layerGroup().addTo(map);
    begoledexLayer = L.layerGroup();
    measureLayer = L.layerGroup().addTo(map);

    // 5. Clics sur la carte
    map.on('click', (e) => {
        if (isMeasuring) {
            handleMeasureClick(e.latlng);
            return;
        }

        const isCadastreActive = map.hasLayer(cadastreLayer) && document.getElementById('cadastre-mode-toggle')?.checked;

        if (isCadastreActive) {
            fetchParcelAt(e.latlng);
        } else {
            const event = new CustomEvent('map-click-point', { detail: { latlng: e.latlng } });
            document.dispatchEvent(event);
        }
    });

    return map;
}

/**
 * Affiche les limites du village (JSON)
 */
export function setVillageData(geoJsonData) {
    if (villageLayer) map.removeLayer(villageLayer);

    villageLayer = L.geoJSON(geoJsonData, {
        style: {
            color: '#ef4444',
            weight: 3.5,
            opacity: 0.85,
            fillColor: '#ef4444',
            fillOpacity: 0.03,
            dashArray: '8, 8'
        },
        interactive: false
    });

    if (document.getElementById('borders-toggle')?.checked) {
        villageLayer.addTo(map);
    }
}

/**
 * Rafraîchit l'affichage des points (SÉCURISÉ)
 */
export function refreshMap(points, filters = {}) {
    if (!markersLayer) return;
    markersLayer.clearLayers();

    points.forEach((p, index) => {
        if (!filters.intruderMode && SECRET_EMOJIS.includes(p.emoji)) return;
        if (filters.emoji && p.emoji !== filters.emoji) return;
        if (filters.text && !(p.note || "").toLowerCase().includes(filters.text)) return;

        const parts = (p.date || "").split('/');
        if (parts.length === 3) {
            const [, month, year] = parts;
            if (filters.year && filters.year !== 'all' && year !== filters.year) return;
            if (filters.month && filters.month !== 'all' && parseInt(month, 10) !== parseInt(filters.month, 10)) return;
        }

        const delay = Math.min(0.25, (index % 10) * 0.025);
        const customHtml = `<div class="marker-bubble" style="animation-delay: ${delay}s">${p.emoji}</div>`;

        const marker = L.marker([p.lat, p.lng], {
            icon: L.divIcon({
                className: 'emoji-icon',
                html: customHtml,
                iconSize: [36, 36],
                iconAnchor: [18, 18]
            })
        });

        // Construction sécurisée de la Popup
        const popupDiv = document.createElement('div');
        popupDiv.className = 'custom-popup-card';

        const title = document.createElement('div');
        title.className = 'popup-title';
        title.textContent = `${p.emoji} ${p.note || 'Point sans nom'}`;
        popupDiv.appendChild(title);

        const metaRow = document.createElement('div');
        metaRow.className = 'popup-meta';
        const histCount = p.history ? p.history.length : 0;
        metaRow.textContent = `📅 ${p.date || '--'} • 📖 ${histCount} note${histCount > 1 ? 's' : ''}`;
        popupDiv.appendChild(metaRow);

        if (p.weather) {
            const weatherBadge = document.createElement('div');
            weatherBadge.className = 'popup-weather-badge';
            weatherBadge.textContent = p.weather;
            popupDiv.appendChild(weatherBadge);
        }

        const btnContainer = document.createElement('div');
        btnContainer.className = 'popup-actions';

        const btnGo = document.createElement('a');
        btnGo.href = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
        btnGo.target = '_blank';
        btnGo.rel = 'noopener';
        btnGo.className = 'popup-btn-go';
        btnGo.textContent = '🚀 Y aller (GPS)';
        btnContainer.appendChild(btnGo);

        const btnEdit = document.createElement('button');
        btnEdit.className = 'btn-popup-edit';
        btnEdit.textContent = '📝 Carnet & Détails';
        btnEdit.onclick = () => {
            uiCallbacks.onEditPoint(p, index);
            map.closePopup();
        };
        btnContainer.appendChild(btnEdit);

        popupDiv.appendChild(btnContainer);

        marker.bindPopup(popupDiv);
        markersLayer.addLayer(marker);
    });
}

/**
 * Extrait la surface (m²) d'une parcelle sauvegardée ou d'une feature GeoJSON
 */
export function getParcelAreaM2(parcelOrFeature) {
    const feature = parcelOrFeature.geoJSON || parcelOrFeature;
    if (!feature) return 0;
    if (feature.properties && feature.properties.contenance) {
        const parsed = parseInt(feature.properties.contenance, 10);
        if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return Math.round(calculateGeoJSONArea(feature.geometry));
}

/**
 * Affiche les parcelles sauvegardées (SÉCURISÉ & ENRICHI)
 */
export function displayParcels(savedParcels = []) {
    if (!parcelsLayer) return;
    parcelsLayer.clearLayers();
    parcelLayersById.clear();

    savedParcels.forEach(p => {
        if (!p || !p.geoJSON) return;

        const area = getParcelAreaM2(p);
        const cadFormat = formatCadastralArea(area);
        const perim = calculateGeoJSONPerimeter(p.geoJSON.geometry);
        const props = p.geoJSON.properties || {};
        const refStr = (props.section || props.numero)
            ? `Section ${props.section || '?'} • N° ${props.numero || '?'}`
            : 'Parcelle cadastrale';
        const catInfo = PARCEL_COLOR_CATEGORIES[p.color] || { label: 'Parcelle', icon: '📐' };

        const geoLayer = L.geoJSON(p.geoJSON, {
            style: {
                color: p.color || '#2ecc71',
                weight: 2.5,
                fillColor: p.color || '#2ecc71',
                fillOpacity: 0.45
            },
            onEachFeature: (feature, layer) => {
                const div = document.createElement('div');
                div.className = 'custom-popup-card';

                const catBadge = document.createElement('div');
                catBadge.className = 'popup-parcel-badge';
                catBadge.style.backgroundColor = p.color || '#95a5a6';
                catBadge.textContent = `${catInfo.icon} ${catInfo.label}`;
                div.appendChild(catBadge);

                const title = document.createElement('div');
                title.className = 'popup-title';
                title.textContent = p.note || refStr;
                div.appendChild(title);

                const subRef = document.createElement('div');
                subRef.className = 'popup-meta';
                subRef.textContent = `${refStr}${props.nom_com ? ' (' + props.nom_com + ')' : ''}`;
                div.appendChild(subRef);

                const metricsBox = document.createElement('div');
                metricsBox.className = 'popup-parcel-metrics';
                metricsBox.innerHTML = `
                    <div class="metric-main">${cadFormat.haShort} ha</div>
                    <div class="metric-sub">${cadFormat.formatted} • ${cadFormat.m2Formatted}</div>
                    ${perim > 0 ? `<div class="metric-sub">Périmètre : ~${perim} m</div>` : ''}
                `;
                div.appendChild(metricsBox);

                const actionsDiv = document.createElement('div');
                actionsDiv.className = 'popup-actions';

                const btnEdit = document.createElement('button');
                btnEdit.className = 'btn-popup-edit';
                btnEdit.textContent = '✏️ Modifier';
                btnEdit.onclick = () => {
                    map.closePopup();
                    uiCallbacks.onEditSavedParcel(p);
                };
                actionsDiv.appendChild(btnEdit);

                const btnDelete = document.createElement('button');
                btnDelete.className = 'btn-popup-delete';
                btnDelete.textContent = '🗑️ Supprimer';
                btnDelete.onclick = () => {
                    uiCallbacks.onDeleteParcel(p.id);
                };
                actionsDiv.appendChild(btnDelete);

                div.appendChild(actionsDiv);
                layer.bindPopup(div);
            }
        }).addTo(parcelsLayer);

        parcelLayersById.set(p.id, geoLayer);
    });
}

/**
 * Centre la carte sur une parcelle enregistrée et ouvre sa popup
 */
export function focusOnParcel(parcelId) {
    if (!map) return;

    // Active l'affichage des parcelles si ce n'est pas déjà fait
    const showToggle = document.getElementById('show-parcels-toggle');
    if (showToggle && !showToggle.checked) {
        showToggle.checked = true;
        toggleSavedParcels(true);
    } else if (!map.hasLayer(parcelsLayer)) {
        map.addLayer(parcelsLayer);
    }

    const geoLayer = parcelLayersById.get(parcelId);
    if (geoLayer) {
        const bounds = geoLayer.getBounds();
        if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [60, 60], maxZoom: 18 });
            setTimeout(() => {
                geoLayer.eachLayer(l => {
                    if (l.openPopup) l.openPopup();
                });
            }, 350);
        }
    }
}

/**
 * Nettoie la surbrillance temporaire d'une parcelle inspectée
 */
export function clearParcelHighlight() {
    if (highlightParcelLayer) highlightParcelLayer.clearLayers();
}

// --- Fonctions Cadastre ---

export function toggleCadastreMode(isActive) {
    if (!map) return;
    if (isActive) {
        if (isMeasuring) {
            toggleMeasureTool(false);
        }
        if (!map.hasLayer(cadastreLayer)) map.addLayer(cadastreLayer);
        if (map.hasLayer(markersLayer)) map.removeLayer(markersLayer);
        map.getContainer().style.cursor = 'pointer';
    } else {
        clearParcelHighlight();
        const showParcels = document.getElementById('show-parcels-toggle')?.checked;
        if (!showParcels && map.hasLayer(cadastreLayer)) map.removeLayer(cadastreLayer);
        if (!map.hasLayer(markersLayer)) map.addLayer(markersLayer);
        if (!isMeasuring) map.getContainer().style.cursor = '';
    }
    document.dispatchEvent(new CustomEvent('mode-changed', {
        detail: { cadastre: isActive, measure: isMeasuring }
    }));
}

export function toggleSavedParcels(isActive) {
    if (!map) return;
    if (isActive) {
        if (!map.hasLayer(parcelsLayer)) map.addLayer(parcelsLayer);
        if (!map.hasLayer(cadastreLayer)) map.addLayer(cadastreLayer);
    } else {
        if (map.hasLayer(parcelsLayer)) map.removeLayer(parcelsLayer);
        const cadastreMode = document.getElementById('cadastre-mode-toggle')?.checked;
        if (!cadastreMode && map.hasLayer(cadastreLayer)) map.removeLayer(cadastreLayer);
    }
}

export function updateCadastreOpacity(val) {
    if (cadastreLayer) cadastreLayer.setOpacity(val);
}

function fetchParcelAt(latlng) {
    document.body.style.cursor = 'wait';
    const lng = Number(latlng.lng).toFixed(6);
    const lat = Number(latlng.lat).toFixed(6);
    const url = `https://apicarto.ign.fr/api/cadastre/parcelle?geom={"type":"Point","coordinates":[${lng},${lat}]}`;

    fetch(url)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
            document.body.style.cursor = 'default';
            if (data && data.features && data.features.length > 0) {
                triggerHaptic('success');
                const feature = data.features[0];
                clearParcelHighlight();
                L.geoJSON(feature, {
                    style: {
                        color: '#f39c12',
                        weight: 3,
                        dashArray: '6, 4',
                        fillColor: '#f1c40f',
                        fillOpacity: 0.35
                    }
                }).addTo(highlightParcelLayer);

                uiCallbacks.onParcelFound(feature);
            } else {
                showToast("Aucune parcelle cadastrale trouvée ici");
            }
        })
        .catch(() => {
            document.body.style.cursor = 'default';
            showToast("Erreur de connexion à l'API Cadastre IGN");
        });
}

// --- Heatmap & Borders ---

/**
 * Affiche une Heatmap basée sur la densité des TRAJETS
 */
export function toggleHeatmap(isActive, trips) {
    if (heatLayer) {
        map.removeLayer(heatLayer);
        heatLayer = null;
    }

    if (isActive) {
        let heatData = [];

        if (!trips || trips.length === 0) {
            showToast("Aucun trajet enregistré pour la Heatmap");
            const toggle = document.getElementById('heatmap-toggle');
            if (toggle) toggle.checked = false;
            return;
        }

        trips.forEach(trip => {
            if (trip.points && trip.points.length > 0) {
                trip.points.forEach(pt => {
                    heatData.push([pt[0], pt[1], 0.2]);
                });
            }
        });

        if (heatData.length === 0) {
            showToast("Données de trajets vides");
            return;
        }

        heatLayer = L.heatLayer(heatData, {
            radius: 12,
            blur: 15,
            maxZoom: 16,
            minOpacity: 0.05,
            gradient: {
                0.2: 'blue',
                0.4: 'lime',
                0.6: 'yellow',
                0.8: 'orange',
                1.0: 'red'
            }
        }).addTo(map);

        showToast(`Heatmap générée : ${trips.length} trajet${trips.length > 1 ? 's' : ''} 🔥`);
    }
}

export function toggleBorders(isActive) {
    if (!map || !villageLayer) return;
    if (isActive) villageLayer.addTo(map);
    else map.removeLayer(villageLayer);
}

// ============================================================
// --- LOGIQUE REPLAY & AFFICHAGE TRAJET ---
// ============================================================

export function displaySingleTrip(trip, colorCode = '#e74c3c') {
    if (!trip || !trip.points || trip.points.length < 2) return;

    tracksLayer.clearLayers();
    if (replayTraceLayer) map.removeLayer(replayTraceLayer);
    if (replayMarker) map.removeLayer(replayMarker);
    if (replayBgPolyline) map.removeLayer(replayBgPolyline);

    if (map.hasLayer(markersLayer)) map.removeLayer(markersLayer);

    const pathCoords = trip.points.map(p => [p[0], p[1]]);

    const polyline = L.polyline(pathCoords, {
        color: colorCode,
        weight: 6,
        opacity: 0.9,
        lineJoin: 'round'
    }).addTo(tracksLayer);

    map.fitBounds(polyline.getBounds(), { padding: [50, 50] });
    showToast("Trajet affiché sur la carte 🗺️");
}

export function startReplay(trip, speedMultiplier = 1) {
    if (!trip || !trip.points || trip.points.length < 2) return;

    replayCurrentTrip = trip;
    replaySpeedMultiplier = speedMultiplier;
    isReplayPaused = false;
    replayCurrentIndex = 0;

    tracksLayer.clearLayers();
    if (map.hasLayer(markersLayer)) map.removeLayer(markersLayer);
    if (replayTraceLayer) map.removeLayer(replayTraceLayer);
    if (replayMarker) map.removeLayer(replayMarker);
    if (replayBgPolyline) map.removeLayer(replayBgPolyline);

    replayBgPolyline = L.polyline(trip.points.map(p => [p[0], p[1]]), {
        color: '#bdc3c7', weight: 4, opacity: 0.5, dashArray: '5, 10'
    }).addTo(map);
    map.fitBounds(replayBgPolyline.getBounds(), { padding: [50, 50] });

    replayTraceLayer = L.layerGroup().addTo(map);

    const startPt = trip.points[0];
    const hikerIcon = L.divIcon({
        className: 'hiker-icon-marker',
        html: '🚶',
        iconSize: [30, 30],
        iconAnchor: [15, 28]
    });
    replayMarker = L.marker([startPt[0], startPt[1]], { icon: hikerIcon, zIndexOffset: 1000 }).addTo(map);

    const TARGET_DURATION = 20000;
    const totalPoints = trip.points.length;
    replayDelay = (TARGET_DURATION / totalPoints) / replaySpeedMultiplier;
    replayStepIncrement = 1;
    const MIN_DELAY = 12;

    if (replayDelay < MIN_DELAY) {
        replayStepIncrement = Math.ceil(MIN_DELAY / replayDelay);
        replayDelay = MIN_DELAY;
    }

    runReplayLoop();
}

function runReplayLoop() {
    if (!replayCurrentTrip) return;

    if (isReplayPaused) {
        replayTimer = setTimeout(runReplayLoop, 200);
        return;
    }

    if (replayCurrentIndex >= replayCurrentTrip.points.length) {
        stopReplay();
        uiCallbacks.onReplayFinished();
        return;
    }

    const pt = replayCurrentTrip.points[replayCurrentIndex];
    const latLng = [pt[0], pt[1]];
    if (replayMarker) replayMarker.setLatLng(latLng);

    if (replayCurrentIndex > 0) {
        let prevIndex = replayCurrentIndex - replayStepIncrement;
        if (prevIndex < 0) prevIndex = 0;
        const prevPt = replayCurrentTrip.points[prevIndex];
        const speed = pt[3] || 0;
        const color = getSpeedColor(speed);

        if (replayTraceLayer) {
            L.polyline([[prevPt[0], prevPt[1]], latLng], {
                color: color, weight: 5, opacity: 0.9, lineCap: 'round'
            }).addTo(replayTraceLayer);
        }
    }

    const progressPercent = Math.min(100, Math.round((replayCurrentIndex / replayCurrentTrip.points.length) * 100));
    document.dispatchEvent(new CustomEvent('replay-progress', { detail: { percent: progressPercent } }));

    replayCurrentIndex += replayStepIncrement;
    replayTimer = setTimeout(runReplayLoop, replayDelay);
}

export function setReplaySpeed(multiplier) {
    replaySpeedMultiplier = multiplier;
    if (replayCurrentTrip) {
        const totalPoints = replayCurrentTrip.points.length;
        replayDelay = (20000 / totalPoints) / replaySpeedMultiplier;
        if (replayDelay < 12) {
            replayStepIncrement = Math.ceil(12 / replayDelay);
            replayDelay = 12;
        } else {
            replayStepIncrement = 1;
        }
    }
}

export function toggleReplayPause() {
    isReplayPaused = !isReplayPaused;
    return isReplayPaused;
}

export function stopReplay() {
    if (replayTimer) { clearTimeout(replayTimer); replayTimer = null; }
    replayCurrentTrip = null;
    isReplayPaused = false;
    replayCurrentIndex = 0;

    if (replayMarker) { map.removeLayer(replayMarker); replayMarker = null; }
    if (replayBgPolyline) { map.removeLayer(replayBgPolyline); replayBgPolyline = null; }
    if (replayTraceLayer) { map.removeLayer(replayTraceLayer); replayTraceLayer = null; }
}

export function clearTracksAndShowPoints() {
    if (tracksLayer) tracksLayer.clearLayers();
    stopReplay();

    const isCadastreActive = document.getElementById('cadastre-mode-toggle')?.checked;
    if (!isCadastreActive) {
        if (!map.hasLayer(markersLayer)) map.addLayer(markersLayer);
    }

    showToast("Carte nettoyée ✨");
}

// ============================================================
// --- GESTION DU RADAR VISUEL ---
// ============================================================

let radarCircle = null;
let radarPulseCircle = null;

export function updateRadarDisplay(latlng, radius = 40, isAlert = false) {
    if (!map) return;
    if (!radarLayer) radarLayer = L.layerGroup().addTo(map);

    const strokeColor = isAlert ? '#e74c3c' : '#3498db';
    const fillColor = isAlert ? '#e74c3c' : '#2980b9';

    if (!radarCircle) {
        radarCircle = L.circle(latlng, {
            radius: radius,
            color: strokeColor,
            weight: 2,
            dashArray: '5, 5',
            fillColor: fillColor,
            fillOpacity: isAlert ? 0.25 : 0.12,
            className: 'radar-ring'
        }).addTo(radarLayer);

        radarPulseCircle = L.circle(latlng, {
            radius: radius * 0.75,
            color: strokeColor,
            weight: 1,
            fillColor: fillColor,
            fillOpacity: 0.08,
            className: 'radar-pulse'
        }).addTo(radarLayer);
    } else {
        radarCircle.setLatLng(latlng);
        radarCircle.setRadius(radius);
        radarCircle.setStyle({
            color: strokeColor,
            fillColor: fillColor,
            fillOpacity: isAlert ? 0.25 : 0.12
        });

        if (radarPulseCircle) {
            radarPulseCircle.setLatLng(latlng);
            radarPulseCircle.setRadius(radius * 0.75);
            radarPulseCircle.setStyle({ color: strokeColor, fillColor: fillColor });
        }
    }
}

export function removeRadarDisplay() {
    if (radarLayer) {
        radarLayer.clearLayers();
        radarCircle = null;
        radarPulseCircle = null;
    }
}

// ============================================================
// --- BÉGOLEDEX SUR CARTE ---
// ============================================================

export function toggleBegoledexOnMap(isActive, plants = []) {
    if (!begoledexLayer) begoledexLayer = L.layerGroup();

    if (isActive) {
        begoledexLayer.clearLayers();
        let placedCount = 0;

        plants.forEach(plant => {
            if (plant.lat && plant.lng) {
                placedCount++;
                const icon = L.divIcon({
                    className: 'begoledex-map-marker',
                    html: `<div class="begoledex-marker-bubble">🌿</div>`,
                    iconSize: [32, 32],
                    iconAnchor: [16, 16]
                });

                const marker = L.marker([plant.lat, plant.lng], { icon });
                const popupContent = document.createElement('div');
                popupContent.className = 'custom-popup-card';

                const img = document.createElement('img');
                img.src = plant.image;
                img.style.cssText = 'width:100%; height:95px; object-fit:cover; border-radius:8px; margin-bottom:6px;';
                popupContent.appendChild(img);

                const nameEl = document.createElement('div');
                nameEl.className = 'popup-title';
                nameEl.style.color = '#27ae60';
                nameEl.textContent = plant.name || 'Plante';
                popupContent.appendChild(nameEl);

                const sciEl = document.createElement('div');
                sciEl.style.cssText = 'font-style:italic; font-size:11px; color:#777; margin-bottom:4px;';
                sciEl.textContent = plant.sciName || '';
                popupContent.appendChild(sciEl);

                const metaEl = document.createElement('div');
                metaEl.className = 'popup-meta';
                metaEl.textContent = `📅 ${plant.date} • Confiance ${plant.score}%`;
                popupContent.appendChild(metaEl);

                marker.bindPopup(popupContent);
                begoledexLayer.addLayer(marker);
            }
        });

        if (!map.hasLayer(begoledexLayer)) begoledexLayer.addTo(map);
        showToast(`Bégoledex : ${placedCount} plante${placedCount > 1 ? 's' : ''} sur la carte 🌱`);
    } else {
        if (map.hasLayer(begoledexLayer)) map.removeLayer(begoledexLayer);
    }
}

// ============================================================
// --- OUTIL DE MESURE DE DISTANCE (RÈGLE / TÉLÉMÈTRE) ---
// ============================================================

export function toggleMeasureTool(activate) {
    isMeasuring = (activate !== undefined) ? activate : !isMeasuring;
    if (!measureLayer && map) measureLayer = L.layerGroup().addTo(map);

    if (isMeasuring) {
        const cadToggle = document.getElementById('cadastre-mode-toggle');
        if (cadToggle && cadToggle.checked) {
            cadToggle.checked = false;
            toggleCadastreMode(false);
        }
        clearMeasurement();
        if (map) map.getContainer().style.cursor = 'crosshair';
        showToast("📏 Mode Télémètre : Touchez la carte pour mesurer");
    } else {
        clearMeasurement();
        if (map) map.getContainer().style.cursor = '';
    }

    document.dispatchEvent(new CustomEvent('mode-changed', {
        detail: {
            cadastre: document.getElementById('cadastre-mode-toggle')?.checked || false,
            measure: isMeasuring
        }
    }));

    return isMeasuring;
}

export function clearMeasurement() {
    measurePoints = [];
    if (measureLayer) measureLayer.clearLayers();
}

function handleMeasureClick(latlng) {
    if (!measureLayer) measureLayer = L.layerGroup().addTo(map);
    measurePoints.push(latlng);
    const count = measurePoints.length;

    const marker = L.circleMarker(latlng, {
        radius: 6,
        color: '#e67e22',
        fillColor: '#ffffff',
        fillOpacity: 1,
        weight: 3
    }).addTo(measureLayer);

    if (count > 1) {
        L.polyline(measurePoints, {
            color: '#e67e22',
            weight: 3,
            dashArray: '6, 6'
        }).addTo(measureLayer);

        let totalMeters = 0;
        for (let i = 1; i < count; i++) {
            totalMeters += map.distance(measurePoints[i - 1], measurePoints[i]);
        }

        const segDist = map.distance(measurePoints[count - 2], measurePoints[count - 1]);
        const bearing = calculateBearing(
            measurePoints[count - 2].lat, measurePoints[count - 2].lng,
            measurePoints[count - 1].lat, measurePoints[count - 1].lng
        );

        const totalStr = totalMeters >= 1000 ? `${(totalMeters / 1000).toFixed(2)} km` : `${Math.round(totalMeters)} m`;
        const segStr = segDist >= 1000 ? `${(segDist / 1000).toFixed(2)} km` : `${Math.round(segDist)} m`;

        marker.bindTooltip(`Total : <b>${totalStr}</b><br>Segment : ${segStr} (${Math.round(bearing)}°)`, {
            permanent: true,
            direction: 'top',
            className: 'measure-tooltip'
        }).openTooltip();
    } else {
        marker.bindTooltip("Départ (0 m)", {
            permanent: true,
            direction: 'top',
            className: 'measure-tooltip'
        }).openTooltip();
    }
}

// --- Utilitaires Géométrie ---

function getRingArea(coords) {
    if (!coords || coords.length < 3) return 0;
    let area = 0;
    const DEG_TO_M = 111319;
    const meanLat = coords[0][1] * Math.PI / 180;
    const lonScale = Math.cos(meanLat);

    for (let i = 0; i < coords.length; i++) {
        let p1 = coords[i];
        let p2 = coords[(i + 1) % coords.length];
        area += (p1[0] * DEG_TO_M * lonScale * p2[1] * DEG_TO_M) -
                (p2[0] * DEG_TO_M * lonScale * p1[1] * DEG_TO_M);
    }
    return Math.abs(area / 2.0);
}

export function calculateGeoJSONArea(geometry) {
    if (!geometry) return 0;
    if (geometry.type === "Polygon") return getRingArea(geometry.coordinates[0]);
    if (geometry.type === "MultiPolygon") {
        let total = 0;
        geometry.coordinates.forEach(poly => total += getRingArea(poly[0]));
        return total;
    }
    return 0;
}

// Getters
export function getMapInstance() { return map; }
export function getTracksLayer() { return tracksLayer; }
export function isMeasureActive() { return isMeasuring; }
