// Configuration globale

export const VILLAGE_COORDS = [43.1565, 0.3235];
export const DEFAULT_ZOOM = 13;
export const DB_NAME = "BegoleMapDB";
export const SECRET_EMOJIS = ["🍄", "🍄‍🟫", "🤫", "💎"];
export const APP_VERSION = "5.0.0";

// Paramètres Radar & Détection
export const DEFAULT_RADAR_RADIUS = 40; // mètres

// Clé API PlantNet (Créez un compte sur my.plantnet.org pour avoir la vôtre)
// Ceci est une clé de démo, remplacez-la si elle ne marche plus !
export const PLANTNET_API_KEY = "2b10FAmoTbTZwVvtpZFrsy9su"; 
export const PLANTNET_API_URL = `https://my-api.plantnet.org/v2/identify/all?api-key=${PLANTNET_API_KEY}`;