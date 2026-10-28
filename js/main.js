// =========================================
// POINT D'ENTRÉE PRINCIPAL - BÉGOLE MAP PRO
// =========================================

import { initDB, loadAllFromDB, checkStorageUsage } from './db.js';
import { initMap, setVillageData, refreshMap, displayParcels } from './map.js';
import { initEventListeners, populateYearFilter } from './ui.js';
import { setPoints, setTrips, setParcels, setBegoledex, setVillageGeoJson } from './state.js';
import { updateAstroWidget, updateWeatherWidget } from './modules/weather.js';
import { renderMenuCadastreSummary } from './cadastre.js';
import { initAudio } from './audio.js';
import { updateUserLevel, initDailyTrophy } from './gamification.js';
import { checkCrashRecovery, initTracking } from './tracking.js';
import { cleanDuplicates } from './utils.js';
import { APP_VERSION } from './config.js';

async function startApp() {
    console.log(`🚀 Démarrage de Bégole Map v${APP_VERSION} (Outdoor & Cadastre Pro)...`);

    try {
        // 1. Initialisation de la Base de Données IndexedDB
        await initDB();

        // 2. Chargement parallèle des données locales
        const [points, parcels, trips, begoledex] = await Promise.all([
            loadAllFromDB('points'),
            loadAllFromDB('parcels'),
            loadAllFromDB('trips'),
            loadAllFromDB('begoledex')
        ]);

        console.log(`📊 Données : ${points.length} pts, ${parcels.length} parcelles, ${trips.length} trajets, ${begoledex.length} plantes.`);

        // Nettoyage des doublons éventuels
        await cleanDuplicates(points);

        // 3. Centralisation dans l'état réactif
        setPoints(points);
        setTrips(trips);
        setParcels(parcels);
        setBegoledex(begoledex);

        // 4. Initialisation de la Carte Leaflet
        const map = initMap();

        // 5. Chargement du périmètre de la commune de Bégole (JSON)
        try {
            const response = await fetch('village.json');
            if (response.ok) {
                const villageGeoJson = await response.json();
                setVillageGeoJson(villageGeoJson);
                setVillageData(villageGeoJson);
                initDailyTrophy(map, villageGeoJson);
            } else {
                console.warn("⚠️ Fichier village.json introuvable.");
            }
        } catch (e) {
            console.error("Erreur chargement village.json", e);
        }

        // 6. Affichage initial sur la carte
        refreshMap(points);
        displayParcels(parcels);

        // 7. Initialisation de l'Interface Utilisateur
        initEventListeners(map);
        populateYearFilter();
        renderMenuCadastreSummary();

        // 8. Widgets Météo, Astro & Audio
        updateAstroWidget();
        updateWeatherWidget();
        initAudio();
        checkStorageUsage();

        // 9. Gamification
        updateUserLevel(points, trips);

        // 10. Suivi GPS & Récupération après incident
        initTracking(map);
        checkCrashRecovery(map);

        // 11. Détection de secousse (Shake to Point)
        initShakeListener(map);

    } catch (err) {
        console.error("🔥 Erreur critique :", err);
        alert("Erreur de chargement : " + err.message);
    }
}

// --- SHAKE TO POINT ---
function initShakeListener(map) {
    let lastShakeX = 0, lastShakeY = 0, lastShakeZ = 0;
    let lastShakeTime = 0;
    const SHAKE_THRESHOLD = 25;

    if (window.DeviceMotionEvent) {
        window.addEventListener('devicemotion', (e) => {
            const acc = e.accelerationIncludingGravity;
            if (!acc) return;

            const currTime = Date.now();
            if ((currTime - lastShakeTime) > 2000) {
                const diff = Math.abs(acc.x + acc.y + acc.z - lastShakeX - lastShakeY - lastShakeZ);
                if (diff > SHAKE_THRESHOLD) {
                    import('./ui.js').then(module => module.openModalForShake(map));
                    lastShakeTime = currTime;
                }
                lastShakeX = acc.x; lastShakeY = acc.y; lastShakeZ = acc.z;
            }
        }, false);
    }
}

// --- SERVICE WORKER ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(() => console.log('✅ Service Worker enregistré'))
            .catch(err => console.log('❌ Erreur SW :', err));
    });
}

// --- LANCEMENT ---
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
} else {
    startApp();
}
