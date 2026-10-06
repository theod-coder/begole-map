/**
 * Affiche une notification temporaire (Toast) en bas de l'écran
 * @param {string} message - Le texte à afficher
 * @param {number} duration - Durée en ms (défaut: 3000)
 */
export function showToast(message, duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast-msg'; // Assurez-vous d'avoir ce style dans CSS
    toast.innerText = message;
    
    // Style par défaut si pas dans le CSS
    if (!toast.classList.contains('toast-msg')) {
        Object.assign(toast.style, {
            background: 'rgba(0,0,0,0.8)',
            color: 'white',
            padding: '12px 24px',
            borderRadius: '25px',
            marginTop: '10px',
            boxShadow: '0 4px 10px rgba(0,0,0,0.3)',
            animation: 'fadeIn 0.3s forwards',
            fontSize: '14px',
            backdropFilter: 'blur(4px)'
        });
    }

    container.appendChild(toast);

    // Suppression automatique
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.5s ease';
        setTimeout(() => toast.remove(), 500);
    }, duration);
}

/**
 * Déclenche un retour haptique (vibration)
 * @param {string} type - 'success', 'warning', 'error', 'start'
 */
export function triggerHaptic(type) {
    if (!navigator.vibrate) return;

    switch (type) {
        case 'success':
            navigator.vibrate([50, 50, 50]); // Deux petits coups
            break;
        case 'warning':
            navigator.vibrate(200); // Un coup moyen
            break;
        case 'error':
            navigator.vibrate([100, 50, 100, 50, 100]); // Trois coups
            break;
        case 'start':
            navigator.vibrate([50, 100, 200]); // Montée en puissance
            break;
        default:
            navigator.vibrate(50); // Touche simple
    }
}

/**
 * Ajoute un zéro devant les chiffres < 10 (ex: 9 -> "09")
 * @param {number} n 
 * @returns {string}
 */
export function pad(n) {
    return n < 10 ? '0' + n : n;
}

/**
 * Formate une durée en millisecondes vers MM:SS ou HH:MM:SS
 * @param {number} ms 
 * @returns {string}
 */
export function formatDuration(ms) {
    if (!ms || ms < 0) return "00:00";
    
    let seconds = Math.floor(ms / 1000);
    let minutes = Math.floor(seconds / 60);
    let hours = Math.floor(minutes / 60);

    seconds = seconds % 60;
    minutes = minutes % 60;

    if (hours > 0) {
        return `${hours}h ${pad(minutes)}m`;
    } else {
        return `${pad(minutes)}:${pad(seconds)}`;
    }
}

/**
 * Retourne une couleur CSS en fonction de la vitesse (pour les tracés)
 * @param {number} speedMs - Vitesse en m/s
 * @returns {string} Code couleur Hex
 */
export function getSpeedColor(speedMs) {
    if (speedMs === null || speedMs === undefined) return '#95a5a6'; // Gris
    
    const speedKmh = speedMs * 3.6;

    if (speedKmh < 1) return '#bdc3c7'; // À l'arrêt (Gris clair)
    if (speedKmh < 4) return '#3498db'; // Marche lente (Bleu)
    if (speedKmh < 7) return '#2ecc71'; // Marche active (Vert)
    if (speedKmh < 15) return '#f1c40f'; // Course (Jaune)
    if (speedKmh < 30) return '#e67e22'; // Vélo (Orange)
    return '#e74c3c'; // Rapide / Voiture (Rouge)
}

/**
 * Compresse une image avant stockage (Redimensionnement + JPEG)
 * Indispensable pour ne pas saturer le stockage IndexedDB
 * @param {File} file - Fichier image input
 * @param {number} maxWidth - Largeur max (ex: 800px)
 * @param {number} quality - Qualité JPEG (0 à 1)
 * @returns {Promise<string>} DataURL (base64)
 */
export function compressImage(file, maxWidth = 800, quality = 0.7) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                // Redimensionnement proportionnel
                if (width > maxWidth) {
                    height = (height * maxWidth) / width;
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                // Export en JPEG compressé
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            
            img.onerror = (err) => reject(err);
        };
        
        reader.onerror = (err) => reject(err);
    });
}

/**
 * Nettoie les doublons dans une liste d'objets basés sur l'ID
 * @param {Array} items 
 * @returns {Promise<void>} (Modifie le tableau en place ou renvoie nettoyé si besoin)
 */
export async function cleanDuplicates(items) {
    const seen = new Set();
    const duplicates = [];
    
    // Identification
    for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (seen.has(item.id)) {
            duplicates.push(i);
        } else {
            seen.add(item.id);
        }
    }

    // Suppression
    duplicates.forEach(index => {
        items.splice(index, 1);
    });

    if (duplicates.length > 0) {
        console.log(`🧹 Nettoyage : ${duplicates.length} doublons supprimés.`);
    }
}

/**
 * Génère une couleur aléatoire (Hex)
 * @returns {string}
 */
export function getRandomColor() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

// Fonction de nettoyage (anti-XSS)
export function escapeHtml(text) {
    if (!text) return "";
    return text
        .toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Calcule la distance orthodromique (Haversine) en mètres entre 2 coordonnées
 */
export function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Rayon Terre en mètres
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

/**
 * Calcule le cap (azimut) en degrés (0-360°)
 */
export function calculateBearing(lat1, lon1, lat2, lon2) {
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) -
              Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    const θ = Math.atan2(y, x);
    return (θ * 180 / Math.PI + 360) % 360;
}

/**
 * Convertit des coordonnées décimales en Degrés Minutes Secondes (DMS)
 */
export function toDMS(deg, isLat) {
    const absolute = Math.abs(deg);
    const degrees = Math.floor(absolute);
    const minutesNotTruncated = (absolute - degrees) * 60;
    const minutes = Math.floor(minutesNotTruncated);
    const seconds = Math.floor((minutesNotTruncated - minutes) * 60);

    const direction = isLat ? (deg >= 0 ? "N" : "S") : (deg >= 0 ? "E" : "O");
    return `${degrees}°${pad(minutes)}'${pad(seconds)}" ${direction}`;
}

/**
 * Exporte un trajet au format GPX 1.1 standard
 * @param {Object} trip - Données du trajet
 */
export function exportTripToGPX(trip) {
    if (!trip || !trip.points || trip.points.length === 0) {
        showToast("Impossible d'exporter un trajet vide");
        return;
    }

    const tripName = trip.note ? `Bégole - ${escapeHtml(trip.note)}` : `Trajet Bégole ${new Date(trip.date).toLocaleDateString()}`;
    const startTime = new Date(trip.date || Date.now()).toISOString();

    let trkpts = "";
    trip.points.forEach((p, idx) => {
        const lat = p[0];
        const lon = p[1];
        const ele = p[2] !== undefined && p[2] !== null ? `<ele>${p[2]}</ele>` : "";
        // Temps estimé si absent
        const ptTime = new Date(new Date(trip.date).getTime() + (idx * 2000)).toISOString();
        trkpts += `      <trkpt lat="${lat}" lon="${lon}">\n        ${ele}\n        <time>${ptTime}</time>\n      </trkpt>\n`;
    });

    const gpxData = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Bégole Map - https://begole-map.app" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${tripName}</name>
    <time>${startTime}</time>
  </metadata>
  <trk>
    <name>${tripName}</name>
    <trkseg>
${trkpts}    </trkseg>
  </trk>
</gpx>`;

    const blob = new Blob([gpxData], { type: 'application/gpx+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeDate = new Date(trip.date).toISOString().slice(0, 10);
    a.href = url;
    a.download = `Begole_Trajet_${safeDate}_${trip.id}.gpx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Fichier GPX téléchargé 🥾");
}

/**
 * Parse un fichier GPX et extrait les points et métadonnées
 * @param {string} xmlText 
 * @returns {Object} { points, distance, elevationGain, name }
 */
export function parseGPX(xmlText) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, "text/xml");
    const trkpts = xmlDoc.querySelectorAll("trkpt");

    if (!trkpts || trkpts.length === 0) {
        throw new Error("Aucun point de trace GPX trouvé");
    }

    const points = [];
    let totalDist = 0;
    let elevGain = 0;
    let lastAlt = null;
    let lastLat = null;
    let lastLng = null;

    trkpts.forEach(node => {
        const lat = parseFloat(node.getAttribute("lat"));
        const lon = parseFloat(node.getAttribute("lon"));
        const eleNode = node.querySelector("ele");
        const ele = eleNode ? parseFloat(eleNode.textContent) : 0;

        if (!isNaN(lat) && !isNaN(lon)) {
            points.push([lat, lon, ele, 0]);

            if (lastLat !== null) {
                const segDist = calculateDistance(lastLat, lastLng, lat, lon) / 1000;
                totalDist += segDist;
            }
            if (lastAlt !== null && ele > lastAlt && (ele - lastAlt) > 2) {
                elevGain += (ele - lastAlt);
            }
            lastLat = lat;
            lastLng = lon;
            lastAlt = ele;
        }
    });

    const nameNode = xmlDoc.querySelector("trk > name, metadata > name");
    const name = nameNode ? nameNode.textContent : "Trace GPX importée";

    return {
        name,
        points,
        distance: totalDist,
        elevationGain: Math.round(elevGain)
    };
}

/**
 * Synthétiseur audio Web Audio API pour les signaux sonores (Radar, Succès, Alertes)
 */
let audioCtx = null;
export function playAudioCue(type = 'ping') {
    try {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }

        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);

        if (type === 'radar') {
            // Sonar sonar ping doux
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, now);
            osc.frequency.exponentialRampToValueAtTime(1760, now + 0.15);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
            osc.start(now);
            osc.stop(now + 0.35);
        } else if (type === 'success') {
            // Fanfare 2 notes
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(523.25, now); // C5
            osc.frequency.setValueAtTime(659.25, now + 0.1); // E5
            osc.frequency.setValueAtTime(783.99, now + 0.2); // G5
            gain.gain.setValueAtTime(0.2, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
            osc.start(now);
            osc.stop(now + 0.55);
        } else if (type === 'nature') {
            // Gazouillis rapide oiseau
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1500, now);
            osc.frequency.exponentialRampToValueAtTime(2800, now + 0.08);
            osc.frequency.exponentialRampToValueAtTime(1900, now + 0.15);
            gain.gain.setValueAtTime(0.12, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
            osc.start(now);
            osc.stop(now + 0.25);
        }
    } catch (e) {
        // Silencieux si audio non autorisé
    }
}