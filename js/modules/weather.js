import { VILLAGE_COORDS } from '../config.js';
import { appState, updateEnv } from '../state.js';
import { updateAudioWeather } from '../audio.js';
import { triggerWeatherEffect, updateWindVisuals } from '../ui.js';
import { pad } from '../utils.js';

// --- LOGIQUE ASTRO (LUNE & SOLEIL) ---
export function updateAstroWidget() {
    const date = new Date();

    // Calcul Phase de Lune
    let year = date.getFullYear(), month = date.getMonth(), day = date.getDate();
    let m = month, y = year;
    if (m < 3) { y--; m += 12; }
    ++m;
    let c = 365.25 * y, e = 30.6 * m, jd = c + e + day - 694039.09;
    jd /= 29.5305882;
    let b = parseInt(jd, 10); jd -= b; b = Math.round(jd * 8);
    if (b >= 8) b = 0;

    const moons = ['🌑 Nouv.', '🌒 Crois.', '🌓 Premier', '🌔 Gib.', '🌕 Pleine', '🌖 Gib.', '🌗 Dernier', '🌘 Crois.'];
    const moonString = `Lune : ${moons[b]} ${(jd * 100).toFixed(0)}%`;

    updateEnv('moon', moonString);

    const moonEl = document.getElementById('astro-moon');
    if (moonEl) moonEl.innerText = moonString;

    if (appState.currentEnv.sunrise && appState.currentEnv.sunset) {
        updateSunUI();
    }
}

function updateSunUI() {
    const now = new Date();
    const sunrise = new Date(appState.currentEnv.sunrise);
    const sunset = new Date(appState.currentEnv.sunset);
    const sunEl = document.getElementById('astro-sun');
    const topSunEl = document.getElementById('top-sun-text');

    let sunStr = "☀️ --h--";
    let isAlert = false;

    if (now < sunrise) {
        const diff = (sunrise - now) / (1000 * 60 * 60);
        sunStr = `🌅 Aube ds ${Math.max(0, Math.round(diff))}h`;
    } else if (now < sunset) {
        const diff = (sunset - now) / (1000 * 60 * 60);
        const h = Math.floor(diff);
        const m = Math.floor((diff - h) * 60);
        sunStr = `☀️ Reste ${h}h${pad(m)}`;
        isAlert = diff < 1;
    } else {
        sunStr = "🌑 Nuit";
    }

    if (sunEl) {
        sunEl.innerText = sunStr;
        sunEl.classList.toggle('sun-alert', isAlert);
    }
    if (topSunEl) {
        topSunEl.innerText = sunStr;
        topSunEl.classList.toggle('sun-alert', isAlert);
    }
}

// --- LOGIQUE API MÉTÉO ---
export function updateWeatherWidget() {
    let lat = VILLAGE_COORDS[0], lng = VILLAGE_COORDS[1];
    if (appState.userPosition && appState.userPosition.lat) {
        lat = appState.userPosition.lat;
        lng = appState.userPosition.lng;
    }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=temperature_2m,precipitation,weather_code,wind_speed_10m,wind_direction_10m,is_day&daily=sunrise,sunset&timezone=auto`;

    fetch(url)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
            if (!data || !data.current) return;

            const temp = Math.round(data.current.temperature_2m);
            const code = data.current.weather_code;
            const wind = Math.round(data.current.wind_speed_10m || 0);
            const windDir = Math.round(data.current.wind_direction_10m || 0);
            const isDay = data.current.is_day === 1;

            const sunrise = data.daily.sunrise[0];
            const sunset = data.daily.sunset[0];

            let desc = "☀️ Calme";
            let icon = "☀️";
            if (code === 0) { desc = "☀️ Soleil"; icon = "☀️"; }
            else if (code <= 3) { desc = "⛅ Nuageux"; icon = "⛅"; }
            else if (code >= 45 && code <= 48) { desc = "🌫️ Brouillard"; icon = "🌫️"; }
            else if (code >= 51 && code <= 67) { desc = "🌧️ Pluie"; icon = "🌧️"; }
            else if (code >= 71 && code <= 77) { desc = "❄️ Neige"; icon = "❄️"; }
            else if (code >= 95) { desc = "⚡ Orage"; icon = "⚡"; }

            const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
            const cardIndex = Math.round(windDir / 45) % 8;
            const cardStr = cardinals[cardIndex];

            updateEnv('temp', temp);
            updateEnv('weather', desc);
            updateEnv('wind', wind);
            updateEnv('windSpeed', wind);
            updateEnv('windDir', windDir);
            updateEnv('isDay', isDay);
            updateEnv('sunrise', sunrise);
            updateEnv('sunset', sunset);

            const widget = document.getElementById('weather-widget-btn');
            if (widget) {
                widget.innerHTML = `
                    <div class="env-row" style="margin:0; width: 100%; justify-content: space-around; display:flex;">
                        <div id="weather-desc" style="font-size:11px;">${desc}</div>
                        <div id="weather-temp" style="font-size:12px;">🌡️ ${temp}°C</div>
                    </div>
                    <div id="weather-wind" style="font-size:10px; width: 100%; text-align:center; border-top:1px solid rgba(255,255,255,0.25); margin-top:3px; padding-top:2px;">
                        💨 ${wind} km/h (${cardStr} ${windDir}°)
                    </div>
                `;
            }

            const topWeatherText = document.getElementById('top-weather-text');
            if (topWeatherText) {
                topWeatherText.innerText = `${icon} ${temp}°C • 💨 ${wind}km/h`;
            }

            updateAudioWeather(desc);

            applyDynamicTheme(sunrise, sunset, isDay);
            triggerWeatherEffect(desc);
            updateWindVisuals();

            document.dispatchEvent(new CustomEvent('weather-updated', {
                detail: { temp, desc, wind, windDir, isDay }
            }));

            updateAstroWidget();
        })
        .catch(console.error);
}

function applyDynamicTheme(sunriseIso, sunsetIso, isDayApi) {
    const now = new Date();
    const sunrise = new Date(sunriseIso);
    const sunset = new Date(sunsetIso);
    const transitionDuration = 45;

    const minFromSunrise = (now - sunrise) / 60000;
    const minToSunset = (sunset - now) / 60000;

    document.body.classList.remove('theme-dawn', 'theme-golden', 'theme-dark');

    if (minFromSunrise > -30 && minFromSunrise < transitionDuration) {
        document.body.classList.add('theme-dawn');
        toggleDeepNightUI(false);
    } else if (minToSunset > 0 && minToSunset < 60) {
        document.body.classList.add('theme-golden');
        toggleDeepNightUI(false);
    } else if (!isDayApi || minToSunset <= 0) {
        document.body.classList.add('theme-dark');
        toggleDeepNightUI(true);
    } else {
        toggleDeepNightUI(false);
    }
}

function toggleDeepNightUI(autoActive) {
    const deepPref = localStorage.getItem('begole_deep_night_pref');
    const isActive = (deepPref !== null) ? (deepPref === 'true') : autoActive;

    const toggle = document.getElementById('deep-night-toggle');
    if (toggle) toggle.checked = isActive;

    if (isActive) document.body.classList.add('deep-night-active');
    else document.body.classList.remove('deep-night-active');
}
