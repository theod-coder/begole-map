import { VILLAGE_COORDS, DEFAULT_ZOOM, SECRET_EMOJIS } from './config.js';
import { showToast, triggerHaptic, getSpeedColor, calculateBearing } from './utils.js';

// --- Variables Globales du Module ---
let map = null;
let markersLayer = null;
let cadastreLayer = null;
let parcelsLayer = null;
let villageLayer = null;
let heatLayer = null;
let tracksLayer = null;
let radarLayer = null;
let begoledexLayer = null;
let measureLayer = null;

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
    // 1. Calques
    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
        maxZoom: 19, 
        attribution: '© OpenStreetMap' 
    });
    
    const satelliteLayer = L.tileLayer('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg', { 
        maxZoom: 19, 
        attribution: '© IGN' 
    });
    
    cadastreLayer = L.tileLayer('https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=CADASTRALPARCELS.PARCELS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png', { 
        maxZoom: 20, 
        attribution: '© IGN' 
    });

    // 2. Carte
    map = L.map('map', { 
        center: VILLAGE_COORDS, 
        zoom: DEFAULT_ZOOM, 
        layers: [satelliteLayer], // Satellite par défaut
        zoomControl: false 
    });

    // 3. Contrôles
    const baseMaps = { "Satellite IGN 🇫🇷": satelliteLayer, "Plan Route 🗺️": osmLayer };
    const overlayMaps = { "Cadastre (Traits) 🏠": cadastreLayer };
    L.control.layers(baseMaps, overlayMaps, { position: 'bottomright' }).addTo(map);
    L.control.scale({ imperial: false, metric: true }).addTo(map);

    // 4. Groupes de Calques
    markersLayer = L.markerClusterGroup({
        maxClusterRadius: 50,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        iconCreateFunction: function(cluster) {
            const count = cluster.getChildCount();
            const maxVal = 20;
            let hue = (1 - Math.min(count, maxVal) / maxVal) * 120; 
            if (count > 50) hue = 0;
            
            return L.divIcon({ 
                html: `<div style="background-color: hsla(${hue}, 100%, 40%, 0.9); width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 3px solid rgba(255,255,255,0.5); box-shadow: 0 4px 8px rgba(0,0,0,0.4); color: white; font-weight: bold; font-family: sans-serif; font-size: 14px;">${count}</div>`, 
                className: 'marker-cluster-custom', 
                iconSize: L.point(40, 40) 
            });
        }
    });
    map.addLayer(markersLayer);

    tracksLayer = L.layerGroup().addTo(map);
    parcelsLayer = L.layerGroup();
    radarLayer = L.layerGroup().addTo(map);
    begoledexLayer = L.layerGroup();
    measureLayer = L.layerGroup().addTo(map);

    // 5. Clics
    map.on('click', (e) => {
        if (isMeasuring) {
            handleMeasureClick(e.latlng);
            return;
        }

        const isCadastreActive = map.hasLayer(cadastreLayer) && document.getElementById('cadastre-mode-toggle').checked;
        
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
            color: '#ff3333', 
            weight: 4, 
            opacity: 0.9, 
            fillOpacity: 0.05, 
            dashArray: '10, 10' 
        } 
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
        if (filters.text && !p.note.toLowerCase().includes(filters.text)) return;
        
        const [day, month, year] = p.date.split('/');
        if (filters.year && filters.year !== 'all' && year !== filters.year) return;
        if (filters.month && filters.month !== 'all' && parseInt(month) !== parseInt(filters.month)) return;

        const delay = Math.random() * 0.3;
        const customHtml = `<div class="marker-bubble" style="animation-delay: ${delay}s">${p.emoji}</div>`;
        
        const marker = L.marker([p.lat, p.lng], { 
            icon: L.divIcon({ 
                className: 'emoji-icon', 
                html: customHtml, 
                iconSize: [34, 34], 
                iconAnchor: [17, 17] 
            }) 
        });

        // --- CONSTRUCTION SÉCURISÉE DE LA POPUP ---
        const popupDiv = document.createElement('div');
        popupDiv.style.textAlign = 'center';

        // Titre : Emoji + Note (SÉCURISÉ via textContent)
        const title = document.createElement('b');
        title.style.fontSize = '14px';
        title.textContent = `${p.emoji} ${p.note}`;
        popupDiv.appendChild(title);
        
        popupDiv.appendChild(document.createElement('br'));

        // Date
        const dateSpan = document.createElement('span');
        dateSpan.style.fontSize = '11px';
        dateSpan.style.color = '#555';
        dateSpan.textContent = `📅 ${p.date}`;
        popupDiv.appendChild(dateSpan);
        
        popupDiv.appendChild(document.createElement('br'));

        // Météo
        if (p.weather) {
            const weatherSmall = document.createElement('small');
            weatherSmall.style.color = '#8e44ad';
            weatherSmall.style.fontWeight = 'bold';
            weatherSmall.textContent = p.weather;
            popupDiv.appendChild(weatherSmall);
            popupDiv.appendChild(document.createElement('br'));
        }

        // Compteur Historique
        const historySmall = document.createElement('small');
        historySmall.style.color = '#666';
        const histCount = p.history ? p.history.length : 0;
        historySmall.textContent = `${histCount} entrées carnet`;
        popupDiv.appendChild(historySmall);

        // Conteneur Boutons
        const btnContainer = document.createElement('div');
        btnContainer.style.marginTop = '8px';
        btnContainer.style.display = 'flex';
        btnContainer.style.flexDirection = 'column';
        btnContainer.style.gap = '5px';

        // Bouton GPS
        const btnGo = document.createElement('a');
        btnGo.href = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
        btnGo.target = '_blank';
        btnGo.className = 'popup-btn-go';
        btnGo.textContent = '🚀 Y aller';
        btnContainer.appendChild(btnGo);

        // Bouton Édition
        const btnEdit = document.createElement('button');
        btnEdit.className = 'btn-popup-edit';
        btnEdit.textContent = '📝 Carnet / Modif';
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
 * Affiche les parcelles sauvegardées (SÉCURISÉ)
 */
export function displayParcels(savedParcels) {
    if (!parcelsLayer) return;
    parcelsLayer.clearLayers();

    savedParcels.forEach(p => {
        L.geoJSON(p.geoJSON, {
            style: {
                color: '#333',
                weight: 1,
                fillColor: p.color,
                fillOpacity: 0.6
            },
            onEachFeature: (feature, layer) => {
                const area = feature.properties.contenance 
                    ? parseInt(feature.properties.contenance) 
                    : calculateGeoJSONArea(feature.geometry);
                
                // --- POPUP PARCELLE SÉCURISÉE ---
                const div = document.createElement('div');
                div.style.textAlign = 'center';

                const title = document.createElement('b');
                title.style.fontSize = '14px';
                title.style.color = p.color;
                title.style.textShadow = '0 1px 1px rgba(0,0,0,0.2)';
                title.textContent = p.note || "Parcelle";
                div.appendChild(title);

                div.appendChild(document.createElement('br'));

                const areaSpan = document.createElement('span');
                areaSpan.style.fontSize = '16px';
                areaSpan.style.fontWeight = '800';
                areaSpan.textContent = `${(area / 10000).toFixed(2)} ha`;
                div.appendChild(areaSpan);

                div.appendChild(document.createElement('br'));

                const areaSmall = document.createElement('small');
                areaSmall.style.color = '#666';
                areaSmall.textContent = `(${Math.round(area)} m²)`;
                div.appendChild(areaSmall);

                div.appendChild(document.createElement('br'));

                const btnDelete = document.createElement('button');
                btnDelete.className = 'btn-popup-delete';
                btnDelete.textContent = '🗑️ Supprimer';
                btnDelete.onclick = () => {
                    uiCallbacks.onDeleteParcel(p.id);
                };
                div.appendChild(btnDelete);

                layer.bindPopup(div);
            }
        }).addTo(parcelsLayer);
    });
}

// --- Fonctions Cadastre ---

export function toggleCadastreMode(isActive) {
    if (isActive) {
        if (!map.hasLayer(cadastreLayer)) map.addLayer(cadastreLayer);
        if (map.hasLayer(markersLayer)) map.removeLayer(markersLayer);
    } else {
        const showParcels = document.getElementById('show-parcels-toggle')?.checked;
        if (!showParcels) map.removeLayer(cadastreLayer);
        if (!map.hasLayer(markersLayer)) map.addLayer(markersLayer);
    }
}

export function toggleSavedParcels(isActive) {
    if (isActive) {
        if (!map.hasLayer(parcelsLayer)) map.addLayer(parcelsLayer);
        if (!map.hasLayer(cadastreLayer)) map.addLayer(cadastreLayer);
    } else {
        map.removeLayer(parcelsLayer);
        const cadastreMode = document.getElementById('cadastre-mode-toggle')?.checked;
        if (!cadastreMode) map.removeLayer(cadastreLayer);
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
                uiCallbacks.onParcelFound(data.features[0]);
            } else {
                showToast("Pas de parcelle ici");
            }
        })
        .catch(() => {
            document.body.style.cursor = 'default';
            showToast("Erreur API Cadastre");
        });
}

// --- Heatmap & Borders ---

/**
 * Affiche une Heatmap basée sur la densité des TRAJETS
 * @param {boolean} isActive 
 * @param {Array} trips - Liste des trajets (et non plus des points)
 */
export function toggleHeatmap(isActive, trips) {
    // Nettoyage préventif
    if (heatLayer) {
        map.removeLayer(heatLayer);
        heatLayer = null;
    }

    if (isActive) {
        // 1. Extraction de TOUS les points de TOUS les trajets
        let heatData = [];
        
        if (!trips || trips.length === 0) {
            showToast("Aucun trajet enregistré pour la Heatmap");
            // On décoche le bouton pour la cohérence UI
            document.getElementById('heatmap-toggle').checked = false;
            return;
        }

        trips.forEach(trip => {
            if (trip.points && trip.points.length > 0) {
                trip.points.forEach(pt => {
                    // On ajoute chaque point gps enregistré dans la heatmap
                    // [lat, lng, intensité]
                    // Une intensité faible (0.2) permet de voir la "chaleur" monter
                    // seulement quand on repasse souvent au même endroit.
                    heatData.push([pt[0], pt[1], 0.2]); 
                });
            }
        });

        if (heatData.length === 0) {
            showToast("Données de trajets vides");
            return;
        }

        // 2. Création de la couche Heatmap optimisée pour des lignes
        heatLayer = L.heatLayer(heatData, { 
            radius: 12,   // Rayon plus fin pour dessiner des "routes"
            blur: 15,     // Flou pour l'effet chaleur
            maxZoom: 16,  // Zoom où l'intensité est maximale
            minOpacity: 0.05,
            gradient: {
                0.2: 'blue',
                0.4: 'lime',
                0.6: 'yellow',
                0.8: 'orange',
                1.0: 'red'
            }
        }).addTo(map);
        
        showToast(`Heatmap générée : ${trips.length} trajets 👣`);

    } else {
        // Désactivation (déjà géré par le nettoyage au début)
        if (heatLayer) map.removeLayer(heatLayer);
    }
}

export function toggleBorders(isActive) {
    if (isActive && villageLayer) villageLayer.addTo(map);
    else if (villageLayer) map.removeLayer(villageLayer);
}

// ============================================================
// --- LOGIQUE REPLAY & AFFICHAGE TRAJET ---
// ============================================================

/**
 * Affiche un trajet unique en statique sur la carte
 */
export function displaySingleTrip(trip, colorCode = '#e74c3c') {
    if (!trip || !trip.points || trip.points.length < 2) return;

    // 1. Nettoyage
    tracksLayer.clearLayers();
    if(replayTraceLayer) map.removeLayer(replayTraceLayer);
    if(replayMarker) map.removeLayer(replayMarker);
    if(replayBgPolyline) map.removeLayer(replayBgPolyline);
    
    // On cache les points pour la clarté
    if(map.hasLayer(markersLayer)) map.removeLayer(markersLayer);

    // 2. Dessin
    const pathCoords = trip.points.map(p => [p[0], p[1]]);
    
    const polyline = L.polyline(pathCoords, { 
        color: colorCode, 
        weight: 6, 
        opacity: 0.9, 
        lineJoin: 'round'
    }).addTo(tracksLayer);

    // 3. Zoom
    map.fitBounds(polyline.getBounds(), { padding: [50, 50] });
    showToast("Trajet affiché 🗺️");
}

/**
 * Lance l'animation de replay d'un trajet avec contrôle de vitesse
 */
export function startReplay(trip, speedMultiplier = 1) {
    if (!trip || !trip.points || trip.points.length < 2) return;

    replayCurrentTrip = trip;
    replaySpeedMultiplier = speedMultiplier;
    isReplayPaused = false;
    replayCurrentIndex = 0;

    // Nettoyage préalable
    tracksLayer.clearLayers();
    if(map.hasLayer(markersLayer)) map.removeLayer(markersLayer);
    if(replayTraceLayer) map.removeLayer(replayTraceLayer);
    if(replayMarker) map.removeLayer(replayMarker);
    if(replayBgPolyline) map.removeLayer(replayBgPolyline);

    // Fond gris (trajet complet)
    replayBgPolyline = L.polyline(trip.points.map(p=>[p[0],p[1]]), { 
        color: '#bdc3c7', weight: 4, opacity: 0.5, dashArray: '5, 10' 
    }).addTo(map);
    map.fitBounds(replayBgPolyline.getBounds(), { padding: [50, 50] });

    // Calque d'animation
    replayTraceLayer = L.layerGroup().addTo(map);
    
    // Marqueur Randonneur
    const startPt = trip.points[0];
    const hikerIcon = L.divIcon({ 
        className: 'hiker-icon-marker', 
        html: '🚶',
        iconSize: [30, 30], 
        iconAnchor: [15, 28] 
    });
    replayMarker = L.marker([startPt[0], startPt[1]], { icon: hikerIcon, zIndexOffset: 1000 }).addTo(map);

    // Paramètres Animation
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

    // Tracé dynamique selon vitesse
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

    // Mise à jour de la progression
    const progressPercent = Math.min(100, Math.round((replayCurrentIndex / replayCurrentTrip.points.length) * 100));
    document.dispatchEvent(new CustomEvent('replay-progress', { detail: { percent: progressPercent } }));

    replayCurrentIndex += replayStepIncrement;
    replayTimer = setTimeout(runReplayLoop, replayDelay);
}

/**
 * Modifie la vitesse de replay en direct
 */
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

/**
 * Met en pause ou reprend le replay
 */
export function toggleReplayPause() {
    isReplayPaused = !isReplayPaused;
    return isReplayPaused;
}

/**
 * Arrête le replay et nettoie les éléments d'animation
 */
export function stopReplay() {
    if (replayTimer) { clearTimeout(replayTimer); replayTimer = null; }
    replayCurrentTrip = null;
    isReplayPaused = false;
    replayCurrentIndex = 0;
    
    if (replayMarker) { map.removeLayer(replayMarker); replayMarker = null; }
    if (replayBgPolyline) { map.removeLayer(replayBgPolyline); replayBgPolyline = null; }
    if (replayTraceLayer) { map.removeLayer(replayTraceLayer); replayTraceLayer = null; }
}

/**
 * Nettoie tous les tracés et réaffiche les points
 */
export function clearTracksAndShowPoints() {
    if (tracksLayer) tracksLayer.clearLayers();
    stopReplay();
    
    const isCadastreActive = document.getElementById('cadastre-mode-toggle')?.checked;
    const isParcelsActive = document.getElementById('show-parcels-toggle')?.checked;
    
    if (!isCadastreActive && !isParcelsActive) {
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
                popupContent.style.textAlign = 'center';
                popupContent.style.minWidth = '160px';

                popupContent.innerHTML = `
                    <img src="${plant.image}" style="width:100%; height:90px; object-fit:cover; border-radius:8px; margin-bottom:5px;">
                    <b style="font-size:13px; color:#27ae60;">${plant.name}</b><br>
                    <small style="font-style:italic; color:#777;">${plant.sciName}</small><br>
                    <span style="font-size:10px; color:#999;">Trouvée le ${plant.date} • Confiance : ${plant.score}%</span>
                `;

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
    if (!measureLayer) measureLayer = L.layerGroup().addTo(map);

    if (isMeasuring) {
        clearMeasurement();
        if (map) map.getContainer().style.cursor = 'crosshair';
        showToast("📏 Mode Mesure : Clique sur la carte pour mesurer");
    } else {
        clearMeasurement();
        if (map) map.getContainer().style.cursor = '';
        showToast("Mode Mesure désactivé");
    }
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

    // Point
    const marker = L.circleMarker(latlng, {
        radius: 6,
        color: '#e67e22',
        fillColor: '#ffffff',
        fillOpacity: 1,
        weight: 3
    }).addTo(measureLayer);

    if (count > 1) {
        // Ligne
        L.polyline(measurePoints, {
            color: '#e67e22',
            weight: 3,
            dashArray: '6, 6'
        }).addTo(measureLayer);

        let totalMeters = 0;
        for (let i = 1; i < count; i++) {
            totalMeters += map.distance(measurePoints[i-1], measurePoints[i]);
        }

        const segDist = map.distance(measurePoints[count-2], measurePoints[count-1]);
        const bearing = calculateBearing(
            measurePoints[count-2].lat, measurePoints[count-2].lng,
            measurePoints[count-1].lat, measurePoints[count-1].lng
        );

        const totalStr = totalMeters >= 1000 ? `${(totalMeters/1000).toFixed(2)} km` : `${Math.round(totalMeters)} m`;
        const segStr = segDist >= 1000 ? `${(segDist/1000).toFixed(2)} km` : `${Math.round(segDist)} m`;

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