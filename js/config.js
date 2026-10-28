// =========================================
// CONFIGURATION GLOBALE - BÉGOLE MAP PRO
// =========================================

export const VILLAGE_COORDS = [43.1565, 0.3235];
export const DEFAULT_ZOOM = 14;
export const DB_NAME = "BegoleMapDB";
export const SECRET_EMOJIS = ["🍄", "🍄‍🟫", "🤫", "💎"];
export const APP_VERSION = "6.0.0";

// Paramètres Radar & Détection
export const DEFAULT_RADAR_RADIUS = 40; // mètres

// Catégories de couleurs pour le Cadastre
export const PARCEL_COLOR_CATEGORIES = {
    '#2ecc71': { label: 'Forêt / Bois', icon: '🌲', color: '#2ecc71' },
    '#f1c40f': { label: 'Prairie / Culture', icon: '🌾', color: '#f1c40f' },
    '#e74c3c': { label: 'Bâti / Terrain', icon: '🏠', color: '#e74c3c' },
    '#3498db': { label: 'Eau / Ruisseau', icon: '💧', color: '#3498db' },
    '#9b59b6': { label: 'Propriété / Famille', icon: '🔑', color: '#9b59b6' },
    '#e67e22': { label: 'Châtaigneraie / Verger', icon: '🌰', color: '#e67e22' },
    '#95a5a6': { label: 'Autre / À vérifier', icon: '📐', color: '#95a5a6' }
};

// Clé API PlantNet (Créez un compte sur my.plantnet.org pour avoir la vôtre)
export const PLANTNET_API_KEY = "2b10FAmoTbTZwVvtpZFrsy9su";
export const PLANTNET_API_URL = `https://my-api.plantnet.org/v2/identify/all?api-key=${PLANTNET_API_KEY}`;
