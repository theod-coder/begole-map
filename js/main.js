// --- IMPORTS ---
import { initDB, loadAllFromDB, checkStorageUsage } from './db.js';
import { initMap, setVillageData, refreshMap, displayParcels } from './map.js';
import { initEventListeners } from './ui.js';
// Nouveaux imports suite à la refactorisation
import { setPoints, setTrips, setParcels, setBegoledex } from './state.js'; // <-- AJOUTÉ
import { updateAstroWidget, updateWeatherWidget } from './modules/weather.js';

import { initAudio } from './audio.js';
import { updateUserLevel, initDailyTrophy } from './gamification.js';
import { checkCrashRecovery, initTracking } from './tracking.js';
import { cleanDuplicates } from './utils.js';
import { APP_VERSION } from './config.js';

// --- DÉMARRAGE DE L'APPLICATION ---

async function startApp() {
    console.log(`🚀 Démarrage de Bégole Map v${APP_VERSION} (Outdoor Pro Edition)...`);

    try {
        // 1. Initialisation de la Base de Données
        await initDB();

        // 2. Chargement des données locales
        // On charge aussi le 'begoledex' maintenant
        const [points, parcels, trips, begoledex] = await Promise.all([
            loadAllFromDB('points'),
            loadAllFromDB('parcels'),
            loadAllFromDB('trips'),
            loadAllFromDB('begoledex')
        ]);

        console.log(`📊 Données : ${points.length} pts, ${parcels.length} parcelles, ${trips.length} trajets, ${begoledex.length} plantes.`);

        // Nettoyage doublons
        await cleanDuplicates(points);

        // --- NOUVEAU : Centralisation des données dans le State ---
        // On remplit le "cerveau" de l'app ici
        setPoints(points);
        setTrips(trips);
        setParcels(parcels);
        setBegoledex(begoledex); // <-- Stockage en mémoire vive

        // 3. Initialisation de la Carte
        const map = initMap();

        // 4. Chargement du périmètre du village (JSON)
        try {
            const response = await fetch('village.json');
            if (response.ok) {
                const villageGeoJson = await response.json();
                
                // On passe les données au module Map pour l'affichage des bordures
                setVillageData(villageGeoJson); 
                
                // On initialise le trophée du jour
                initDailyTrophy(map, villageGeoJson);
            } else {
                console.warn("⚠️ Fichier village.json introuvable.");
            }
        } catch (e) {
            console.error("Erreur chargement village.json", e);
        }

        // 5. Affichage initial
        refreshMap(points);       
        displayParcels(parcels);  

        // 6. Interface Utilisateur
        // MODIFIÉ : On ne passe plus les données (points, trips...), ui.js utilisera appState
        initEventListeners(map);

        // 7. Widgets et Environnement (Via le nouveau module weather.js)
        updateAstroWidget();
        updateWeatherWidget();
        
        initAudio();
        checkStorageUsage();

        // 8. Gamification
        updateUserLevel(points, trips);

        // 9. Tracking & Recovery
        initTracking(map);
        checkCrashRecovery(map);

        // 10. Shake
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
            .then(reg => console.log('✅ Service Worker OK'))
            .catch(err => console.log('❌ Erreur SW :', err));
    });
}

// --- LANCEMENT ---
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
} else {
    startApp();
}