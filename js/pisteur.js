import { showToast, triggerHaptic, playAudioCue } from './utils.js';
import { appState } from './state.js';
import { saveToDB } from './db.js';
import { refreshMap, getMapInstance } from './map.js';
import { updateUserLevel } from './gamification.js';

// Base de données enrichie du Pisteur Pyrénéen
const TRACKS_DB = [
    { id: 'boar', name: 'Sanglier', icon: '🐗', track: '·· ··', desc: 'Empreinte à 2 doigts + 2 gardes arrière bien marqués. Sol retourné (boutis), bauges boueuses.', sound: 'nature' },
    { id: 'deer', name: 'Chevreuil', icon: '🦌', track: '♡', desc: 'Petite empreinte en cœur (4-5 cm). Pas de gardes visibles sauf boue profonde. Frottis sur les arbrisseaux.', sound: 'nature' },
    { id: 'stag', name: 'Cerf Élégant', icon: '🦌', track: '♡ ♡', desc: 'Grande empreinte (8-10 cm), robuste. Présence de coulées larges dans les sous-bois.', sound: 'nature' },
    { id: 'fox', name: 'Renard', icon: '🦊', track: '🐾', desc: 'Ressemble à un petit chien mais plus allongé et symétrique. Pelote fécale souvent perchée sur un monticule.', sound: 'nature' },
    { id: 'badger', name: 'Blaireau', icon: '🦡', track: '🖐️', desc: '5 doigts alignés avec de longues griffes fouisseuses. Gueules de terrier avec terre rejetée.', sound: 'nature' },
    { id: 'genet', name: 'Genette', icon: '🐈', track: '🐾', desc: 'Petites empreintes semi-digitigrades très discrètes. Crottiers réguliers en hauteur sur des rochers ou troncs.', sound: 'nature' },
    { id: 'hare', name: 'Lièvre', icon: '🐇', track: 'Y', desc: 'Pattes arrière longues déposées devant les pattes avant, formant un motif en Y caractéristique.', sound: 'nature' },
    { id: 'squirrel', name: 'Écureuil', icon: '🐿️', track: '::', desc: '4 doigts à l\'avant, 5 à l\'arrière. Traces de cônes et noisettes rongées au pied des arbres.', sound: 'nature' },
    { id: 'owl', name: 'Chouette Hulotte', icon: '🦉', track: 'Ψ', desc: 'Chasse de nuit. Indices : fientes blanches sur troncs et pelotes de réjection contenant des os de micromammifères.', sound: 'nature' },
    { id: 'bird', name: 'Buse / Rapace', icon: '🦅', track: 'Ψ', desc: 'Grandes serres avec doigt postérieur opposé. Présence fréquente sur les piquets de clôture de Bégole.', sound: 'nature' },
    { id: 'mushroom', name: 'Cèpe de Bordeaux', icon: '🍄', track: 'O', desc: 'Pousse sous les chênes, hêtres et châtaigniers 8 à 12 jours après de fortes pluies tièdes et lune montante.', sound: 'ping' },
    { id: 'morel', name: 'Morille / Girolle', icon: '🍄‍🟫', track: 'o', desc: 'Lisières de bois, frênes et vergers moussus au printemps. Chapeau alvéolé caractéristique.', sound: 'ping' }
];

/**
 * Ouvre la modale du guide du pisteur et génère le contenu interactif
 */
export function openPisteurModal() {
    const grid = document.getElementById('pisteur-grid');
    const modal = document.getElementById('modal-pisteur');
    
    if (!grid || !modal) {
        showToast("Erreur : Modale introuvable");
        return;
    }

    // Badge vu
    localStorage.setItem('begole_pisteur_viewed', 'true');

    // Génération du contenu HTML
    grid.innerHTML = "";
    
    TRACKS_DB.forEach(animal => {
        const card = document.createElement('div');
        card.className = 'badge-card unlocked'; 
        card.style.cursor = "pointer";
        card.style.display = "flex";
        card.style.flexDirection = "column";
        card.style.alignItems = "center";
        card.style.height = "auto";
        card.style.transition = "all 0.2s ease";
        
        card.innerHTML = `
            <div style="text-align:center; padding-bottom:5px; width:100%;">
                <span class="badge-icon" style="font-size:32px; display:block;">${animal.icon}</span>
                <span class="badge-title" style="font-size:14px; font-weight:bold;">${animal.name}</span>
                <div class="expand-hint" style="font-size:10px; color:#aaa; margin-top:2px;">▼ Infos & Marquer</div>
            </div>
            
            <div class="pisteur-details" style="display:none; margin-top:8px; border-top:1px dashed #ccc; padding-top:8px; width:100%; text-align:center;">
                <div style="font-size:22px; color:#8e44ad; font-weight:bold; letter-spacing:2px; margin-bottom:5px;">${animal.track}</div>
                <div style="font-size:11px; color:#555; line-height:1.4; text-align:left; margin-bottom:10px;">${animal.desc}</div>
                
                <div style="display:flex; gap:6px; justify-content:center; flex-wrap:wrap;">
                    <button class="btn-drop-track" style="background:#27ae60; color:white; border:none; padding:6px 10px; border-radius:15px; font-size:11px; font-weight:bold; cursor:pointer;">
                        📍 Poser ce repère ici
                    </button>
                    <button class="btn-sound-track" style="background:#34495e; color:white; border:none; padding:6px 10px; border-radius:15px; font-size:11px; font-weight:bold; cursor:pointer;">
                        🔊 Cri / Bruit
                    </button>
                </div>
            </div>
        `;
        
        // Bouton marquer sur carte
        const btnDrop = card.querySelector('.btn-drop-track');
        btnDrop.addEventListener('click', async (e) => {
            e.stopPropagation();
            let targetCoords = null;
            if (appState.userPosition && appState.userPosition.lat) {
                targetCoords = { lat: appState.userPosition.lat, lng: appState.userPosition.lng };
            } else {
                const map = getMapInstance();
                if (map) targetCoords = map.getCenter();
            }

            if (!targetCoords) {
                showToast("Position inconnue");
                return;
            }

            const newPoint = {
                id: Date.now(),
                lat: targetCoords.lat,
                lng: targetCoords.lng,
                emoji: animal.icon,
                note: `Trace : ${animal.name}`,
                date: new Date().toLocaleDateString(),
                weather: appState.currentEnv.fullString,
                history: [{
                    date: new Date().toLocaleDateString(),
                    text: `Repéré via le Guide du Pisteur : ${animal.name}`,
                    photo: null
                }]
            };

            await saveToDB('points', newPoint);
            appState.points.push(newPoint);
            refreshMap(appState.points);
            updateUserLevel(appState.points, appState.trips);
            
            triggerHaptic('success');
            playAudioCue('nature');
            modal.classList.add('hidden');
            showToast(`📍 Repère ${animal.icon} ${animal.name} placé sur la carte !`);
        });

        // Bouton son
        const btnSound = card.querySelector('.btn-sound-track');
        btnSound.addEventListener('click', (e) => {
            e.stopPropagation();
            playAudioCue('nature');
            triggerHaptic('success');
        });

        // Toggle déploiement carte
        card.onclick = () => {
            const details = card.querySelector('.pisteur-details');
            const hint = card.querySelector('.expand-hint');
            
            if (details.style.display === "none") {
                details.style.display = "block";
                hint.innerText = "▲ Fermer";
                card.style.backgroundColor = "#fff9c4";
                card.style.borderColor = "#f1c40f";
            } else {
                details.style.display = "none";
                hint.innerText = "▼ Infos & Marquer";
                card.style.backgroundColor = "";
                card.style.borderColor = "";
            }
        };

        grid.appendChild(card);
    });

    modal.classList.remove('hidden');
    const menu = document.getElementById('menu-items');
    if (menu) menu.classList.add('hidden-mobile');
}