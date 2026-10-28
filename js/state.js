// =========================================
// ÉTAT GLOBAL DE L'APPLICATION BÉGOLE MAP
// =========================================

export const appState = {
    points: [],
    trips: [],
    parcels: [],
    begoledex: [],
    villageGeoJson: null,
    bonusXp: parseInt(localStorage.getItem('begole_bonus_xp') || '0', 10),
    radarActive: false,
    radarRadius: 40, // 40m, 100m, 200m
    measureMode: false,
    cadastreMode: false,
    showBegoledexOnMap: false,
    currentEnv: {
        moon: "",
        temp: "--",
        weather: "",
        wind: 0,           // km/h
        windSpeed: 0,      // alias km/h
        windDir: 0,        // degrés (0-360)
        isDay: true,       // Jour/Nuit API
        sunrise: null,     // Heure lever ISO
        sunset: null,      // Heure coucher ISO
        fullString: ""
    },
    userPosition: null // { lat, lng, acc, heading }
};

// Metteurs à jour simples (Setters)
export function setPoints(data) { appState.points = data || []; }
export function setTrips(data) { appState.trips = data || []; }
export function setParcels(data) { appState.parcels = data || []; }
export function setBegoledex(data) { appState.begoledex = data || []; }
export function setVillageGeoJson(data) { appState.villageGeoJson = data; }

export function addBonusXp(amount) {
    appState.bonusXp = (appState.bonusXp || 0) + amount;
    localStorage.setItem('begole_bonus_xp', appState.bonusXp);
}

// Met à jour l'environnement et construit la chaîne descriptive
export function updateEnv(key, value) {
    if (appState.currentEnv[key] !== undefined) {
        appState.currentEnv[key] = value;
    }

    const tempStr = appState.currentEnv.temp !== "--" ? `${appState.currentEnv.temp}°C` : "";
    const windVal = appState.currentEnv.wind || appState.currentEnv.windSpeed || 0;
    const windStr = windVal > 20 ? "💨 Vent" : "";

    appState.currentEnv.fullString = `${appState.currentEnv.weather} ${tempStr} ${windStr} • ${appState.currentEnv.moon}`.trim();
}
