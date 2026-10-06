import { saveToDB, deleteFromDB } from './db.js';
import { appState } from './state.js';
import { showToast, triggerHaptic, playAudioCue, escapeHtml } from './utils.js';
import { getMapInstance, toggleBegoledexOnMap } from './map.js';
import { updateUserLevel } from './gamification.js';

/**
 * Tente d'ajouter une plante au Bégoledex
 * @param {Object} plantData { name, sciName, image, score, lat, lng }
 */
export async function tryAddToBegoledex(plantData) {
    // Vérification doublon
    const exists = appState.begoledex.find(p => p.sciName === plantData.sciName);
    
    if (exists) {
        showToast(`Déjà dans le Bégoledex : ${plantData.name} 📒`);
        return;
    }

    const newEntry = {
        id: Date.now(),
        name: plantData.name,
        sciName: plantData.sciName,
        image: plantData.image, 
        date: new Date().toLocaleDateString(),
        score: plantData.score,
        lat: plantData.lat || null,
        lng: plantData.lng || null
    };

    await saveToDB('begoledex', newEntry);
    appState.begoledex.push(newEntry);
    
    triggerHaptic('success');
    playAudioCue('nature');
    showToast(`✨ Nouveau : ${plantData.name} ajouté au Bégoledex ! (+30 XP)`);

    // Mise à jour de l'XP
    updateUserLevel(appState.points, appState.trips);

    // Si les plantes sont affichées sur la carte, on actualise
    if (appState.showBegoledexOnMap) {
        toggleBegoledexOnMap(true, appState.begoledex);
    }
}

/**
 * Ouvre la modale et génère la grille d'affichage
 */
export function openBegoledexModal() {
    const grid = document.getElementById('begoledex-grid');
    const modal = document.getElementById('modal-begoledex');
    const countEl = document.getElementById('begoledex-count');

    if (!grid || !modal) return;
    
    renderBegoledexItems("");

    modal.classList.remove('hidden');
    const menu = document.getElementById('menu-items');
    if (menu) menu.classList.add('hidden-mobile');
}

export function renderBegoledexItems(filterText = "") {
    const grid = document.getElementById('begoledex-grid');
    const countEl = document.getElementById('begoledex-count');
    if (!grid) return;

    const totalPlants = appState.begoledex.length;
    if (countEl) {
        countEl.innerText = `${totalPlants} plante${totalPlants > 1 ? 's' : ''} trouvée${totalPlants > 1 ? 's' : ''}`;
    }

    grid.innerHTML = "";

    // Barre d'outils Bégoledex (Recherche + Toggle Carte)
    const toolbar = document.createElement('div');
    toolbar.style.gridColumn = "1 / -1";
    toolbar.style.display = "flex";
    toolbar.style.gap = "8px";
    toolbar.style.marginBottom = "5px";

    const searchInput = document.createElement('input');
    searchInput.type = "text";
    searchInput.placeholder = "🔍 Filtrer les plantes...";
    searchInput.value = filterText;
    searchInput.style.flex = "1";
    searchInput.style.padding = "8px 12px";
    searchInput.style.borderRadius = "10px";
    searchInput.style.border = "1px solid var(--border-color)";
    searchInput.style.fontSize = "13px";
    searchInput.style.background = "var(--input-bg)";
    searchInput.style.color = "var(--text-main)";

    searchInput.addEventListener('input', (e) => {
        renderBegoledexItems(e.target.value.toLowerCase().trim());
    });

    const btnMapToggle = document.createElement('button');
    btnMapToggle.className = "btn-confirm";
    btnMapToggle.style.fontSize = "12px";
    btnMapToggle.style.padding = "8px 12px";
    btnMapToggle.style.whiteSpace = "nowrap";
    btnMapToggle.style.background = appState.showBegoledexOnMap ? "#e67e22" : "#27ae60";
    btnMapToggle.innerHTML = appState.showBegoledexOnMap ? "🗺️ Masquer Carte" : "🗺️ Voir sur Carte";
    
    btnMapToggle.onclick = () => {
        appState.showBegoledexOnMap = !appState.showBegoledexOnMap;
        toggleBegoledexOnMap(appState.showBegoledexOnMap, appState.begoledex);
        btnMapToggle.innerHTML = appState.showBegoledexOnMap ? "🗺️ Masquer Carte" : "🗺️ Voir sur Carte";
        btnMapToggle.style.background = appState.showBegoledexOnMap ? "#e67e22" : "#27ae60";
    };

    toolbar.appendChild(searchInput);
    toolbar.appendChild(btnMapToggle);
    grid.appendChild(toolbar);

    const filtered = appState.begoledex.filter(p => {
        if (!filterText) return true;
        return (p.name && p.name.toLowerCase().includes(filterText)) ||
               (p.sciName && p.sciName.toLowerCase().includes(filterText));
    });

    if (filtered.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.style.gridColumn = "1 / -1";
        emptyDiv.style.textAlign = "center";
        emptyDiv.style.padding = "30px";
        emptyDiv.style.color = "#888";
        emptyDiv.style.fontStyle = "italic";

        if (totalPlants === 0) {
            emptyDiv.innerHTML = `
                <div style="font-size: 40px; margin-bottom: 10px;">🍃</div>
                Ton herbier est vide...<br>
                <small>Utilise l'outil "Identifier Plante" et obtiens un score > 25% pour collectionner !</small>
            `;
        } else {
            emptyDiv.innerHTML = `Aucune plante ne correspond à "${escapeHtml(filterText)}"`;
        }
        grid.appendChild(emptyDiv);
        return;
    }

    const sorted = [...filtered].sort((a,b) => b.id - a.id);

    sorted.forEach(plant => {
        const card = document.createElement('div');
        card.className = "begoledex-card";
        
        const hasLoc = (plant.lat && plant.lng);
        const locBtnHtml = hasLoc 
            ? `<button class="btn-locate-plant" title="Centrer la carte" style="position:absolute; bottom:5px; right:5px; background:rgba(255,255,255,0.9); border:none; border-radius:50%; width:30px; height:30px; cursor:pointer; box-shadow:0 2px 5px rgba(0,0,0,0.2); font-size:16px;">🗺️</button>`
            : '';

        card.innerHTML = `
            <img src="${plant.image}" loading="lazy" alt="${escapeHtml(plant.name)}">
            <div class="begoledex-info">
                <div class="begoledex-name">${escapeHtml(plant.name)}</div>
                <div class="begoledex-sci">${escapeHtml(plant.sciName)}</div>
                <div class="begoledex-date">📅 ${plant.date} • ${plant.score}%</div>
            </div>
            <button class="btn-del-plant" title="Supprimer">×</button>
            ${locBtnHtml}
        `;

        if (hasLoc) {
            const btnLoc = card.querySelector('.btn-locate-plant');
            if (btnLoc) {
                btnLoc.addEventListener('click', (e) => {
                    e.stopPropagation();
                    document.getElementById('modal-begoledex').classList.add('hidden');
                    const map = getMapInstance();
                    if (map) {
                        map.setView([plant.lat, plant.lng], 18);
                        L.popup()
                            .setLatLng([plant.lat, plant.lng])
                            .setContent(`<b>${escapeHtml(plant.name)}</b><br>Trouvée ici le ${plant.date} 🌱`)
                            .openOn(map);
                    }
                });
            }
        }

        const btnDel = card.querySelector('.btn-del-plant');
        if (btnDel) {
            btnDel.addEventListener('click', async (e) => {
                e.stopPropagation();
                if(confirm(`Retirer ${plant.name} de ta collection définitivement ?`)) {
                    await deleteFromDB('begoledex', plant.id);
                    appState.begoledex = appState.begoledex.filter(p => p.id !== plant.id);
                    updateUserLevel(appState.points, appState.trips);
                    if (appState.showBegoledexOnMap) {
                        toggleBegoledexOnMap(true, appState.begoledex);
                    }
                    renderBegoledexItems(filterText); 
                    showToast("Plante retirée 🗑️");
                }
            });
        }

        card.addEventListener('click', () => {
            const lightboxImg = document.getElementById('lightbox-img');
            const lightboxOverlay = document.getElementById('lightbox-overlay');
            if (lightboxImg && lightboxOverlay) {
                lightboxImg.src = plant.image;
                lightboxOverlay.classList.remove('hidden');
                lightboxOverlay.onclick = () => {
                    lightboxOverlay.classList.add('hidden');
                    lightboxImg.src = "";
                };
            }
        });

        grid.appendChild(card);
    });
}