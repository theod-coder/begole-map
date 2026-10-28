// =========================================
// MODULE CADASTRE & STATISTIQUES FONCIÈRES
// =========================================

import { PARCEL_COLOR_CATEGORIES } from './config.js';
import { appState } from './state.js';
import { saveToDB, deleteFromDB } from './db.js';
import {
    showToast, triggerHaptic, playAudioCue, escapeHtml,
    formatCadastralArea, calculateGeoJSONPerimeter, isLatLngInGeometry
} from './utils.js';
import {
    displayParcels, toggleSavedParcels, focusOnParcel,
    calculateGeoJSONArea, getParcelAreaM2, clearParcelHighlight
} from './map.js';
import { updateUserLevel } from './gamification.js';

// État local d'édition de parcelle
let currentParcelGeoJSON = null;
let currentEditingParcelId = null;
let selectedParcelColor = '#2ecc71';
let activeStatsTab = 'overview';
let parcelSearchQuery = '';
let parcelSortBy = 'area-desc';
let parcelColorFilter = 'all';

/**
 * Calcule l'ensemble des statistiques et analyses sur les parcelles cadastrales
 */
export function computeCadastreAnalytics() {
    const parcels = appState.parcels || [];
    const points = appState.points || [];
    const plants = appState.begoledex || [];

    // Surface totale de la commune de Bégole (depuis village.json ou valeur officielle ~615 ha)
    let villageAreaM2 = 6150000;
    if (appState.villageGeoJson) {
        const calcVillage = calculateGeoJSONArea(appState.villageGeoJson);
        if (calcVillage > 100000) villageAreaM2 = calcVillage;
    }

    let totalAreaM2 = 0;
    let totalPerimeterM = 0;
    const byCategoryMap = {};
    const bySectionMap = {};
    const byOwnerMap = {};
    const sizeBrackets = [
        { id: 'small', label: 'Petites (< 0,1 ha)', sub: '< 1 000 m²', min: 0, max: 1000, count: 0, areaM2: 0, color: '#3498db' },
        { id: 'medium', label: 'Moyennes (0,1 - 0,5 ha)', sub: '1 000 - 5 000 m²', min: 1000, max: 5000, count: 0, areaM2: 0, color: '#2ecc71' },
        { id: 'large', label: 'Grandes (0,5 - 2 ha)', sub: '5 000 - 20 000 m²', min: 5000, max: 20000, count: 0, areaM2: 0, color: '#f1c40f' },
        { id: 'xlarge', label: 'Très grandes (> 2 ha)', sub: '> 20 000 m²', min: 20000, max: Infinity, count: 0, areaM2: 0, color: '#e67e22' }
    ];

    let totalPoisInParcels = 0;

    const enrichedParcels = parcels.map(p => {
        const feature = p.geoJSON || {};
        const props = feature.properties || {};
        const geometry = feature.geometry || null;

        const areaM2 = getParcelAreaM2(p);
        const perimeterM = calculateGeoJSONPerimeter(geometry);
        const cadastral = formatCadastralArea(areaM2);
        const color = p.color || '#95a5a6';
        const catInfo = PARCEL_COLOR_CATEGORIES[color] || { label: 'Autre / Non classé', icon: '📐', color };

        const section = (props.section || 'N/A').toString().trim();
        const numero = (props.numero || 'N/A').toString().trim();
        const ref = `${section} ${numero}`.trim();
        const commune = props.nom_com || 'Bégole';
        const note = (p.note || '').trim();
        const ownerGroup = note || 'Sans note / Non attribué';

        // Recherche spatiale des POIs et plantes situés dans la parcelle
        const poisInside = geometry
            ? points.filter(pt => isLatLngInGeometry(pt.lat, pt.lng, geometry))
            : [];
        const plantsInside = geometry
            ? plants.filter(pl => pl.lat && pl.lng && isLatLngInGeometry(pl.lat, pl.lng, geometry))
            : [];

        totalPoisInParcels += poisInside.length + plantsInside.length;
        totalAreaM2 += areaM2;
        totalPerimeterM += perimeterM;

        // Par catégorie (couleur)
        if (!byCategoryMap[color]) {
            byCategoryMap[color] = {
                color,
                label: catInfo.label,
                icon: catInfo.icon,
                count: 0,
                areaM2: 0,
                perimeterM: 0
            };
        }
        byCategoryMap[color].count++;
        byCategoryMap[color].areaM2 += areaM2;
        byCategoryMap[color].perimeterM += perimeterM;

        // Par section cadastrale
        if (!bySectionMap[section]) {
            bySectionMap[section] = {
                section,
                count: 0,
                areaM2: 0,
                parcels: []
            };
        }
        bySectionMap[section].count++;
        bySectionMap[section].areaM2 += areaM2;

        // Par propriétaire / note
        if (!byOwnerMap[ownerGroup]) {
            byOwnerMap[ownerGroup] = {
                owner: ownerGroup,
                isUnassigned: !note,
                count: 0,
                areaM2: 0,
                colors: new Set()
            };
        }
        byOwnerMap[ownerGroup].count++;
        byOwnerMap[ownerGroup].areaM2 += areaM2;
        byOwnerMap[ownerGroup].colors.add(color);

        // Par tranche de superficie
        const bracket = sizeBrackets.find(b => areaM2 >= b.min && areaM2 < b.max);
        if (bracket) {
            bracket.count++;
            bracket.areaM2 += areaM2;
        }

        return {
            id: p.id,
            raw: p,
            section,
            numero,
            ref,
            commune,
            note,
            ownerGroup,
            color,
            catInfo,
            areaM2,
            cadastral,
            perimeterM,
            poisInside,
            plantsInside
        };
    });

    const count = enrichedParcels.length;
    const avgAreaM2 = count > 0 ? Math.round(totalAreaM2 / count) : 0;

    // Médiane, Min, Max
    const sortedByArea = [...enrichedParcels].sort((a, b) => b.areaM2 - a.areaM2);
    const maxParcel = sortedByArea.length > 0 ? sortedByArea[0] : null;
    const minParcel = sortedByArea.length > 0 ? sortedByArea[sortedByArea.length - 1] : null;

    let medianAreaM2 = 0;
    if (count > 0) {
        const mid = Math.floor(count / 2);
        medianAreaM2 = count % 2 !== 0
            ? sortedByArea[mid].areaM2
            : Math.round((sortedByArea[mid - 1].areaM2 + sortedByArea[mid].areaM2) / 2);
    }

    const byCategory = Object.values(byCategoryMap)
        .map(c => ({
            ...c,
            cadastral: formatCadastralArea(c.areaM2),
            percent: totalAreaM2 > 0 ? (c.areaM2 / totalAreaM2) * 100 : 0
        }))
        .sort((a, b) => b.areaM2 - a.areaM2);

    const bySection = Object.values(bySectionMap)
        .map(s => ({
            ...s,
            cadastral: formatCadastralArea(s.areaM2),
            percent: totalAreaM2 > 0 ? (s.areaM2 / totalAreaM2) * 100 : 0
        }))
        .sort((a, b) => b.areaM2 - a.areaM2);

    const byOwner = Object.values(byOwnerMap)
        .map(o => ({
            ...o,
            colors: Array.from(o.colors),
            cadastral: formatCadastralArea(o.areaM2),
            percent: totalAreaM2 > 0 ? (o.areaM2 / totalAreaM2) * 100 : 0
        }))
        .sort((a, b) => b.areaM2 - a.areaM2);

    const villageCoveragePercent = villageAreaM2 > 0 ? (totalAreaM2 / villageAreaM2) * 100 : 0;
    const footballFieldsEq = (totalAreaM2 / 7140).toFixed(1);

    return {
        totalParcels: count,
        totalAreaM2,
        totalCadastral: formatCadastralArea(totalAreaM2),
        totalPerimeterM,
        avgAreaM2,
        avgCadastral: formatCadastralArea(avgAreaM2),
        medianAreaM2,
        medianCadastral: formatCadastralArea(medianAreaM2),
        maxParcel,
        minParcel,
        sectionsCount: bySection.length,
        villageAreaM2,
        villageCoveragePercent,
        footballFieldsEq,
        totalPoisInParcels,
        byCategory,
        bySection,
        byOwner,
        sizeBrackets,
        parcels: enrichedParcels
    };
}

/**
 * Met à jour le résumé Cadastre dans l'onglet Cadastre du menu principal
 */
export function renderMenuCadastreSummary() {
    const container = document.getElementById('menu-cadastre-summary');
    if (!container) return;

    const stats = computeCadastreAnalytics();

    if (stats.totalParcels === 0) {
        container.innerHTML = `
            <div class="cadastre-mini-empty">
                <div style="font-size:26px; margin-bottom:4px;">🏛️</div>
                <div style="font-weight:700; font-size:13px; color:var(--text-main);">Aucune parcelle enregistrée</div>
                <div style="font-size:11px; color:var(--text-sub); margin-top:2px;">
                    Activez le <b>Mode Cadastre</b> ci-dessous puis touchez une parcelle sur la carte pour l'inspecter et la sauvegarder.
                </div>
            </div>
        `;
        return;
    }

    const topParcels = [...stats.parcels].sort((a, b) => b.areaM2 - a.areaM2).slice(0, 3);

    let listHtml = topParcels.map(p => `
        <div class="mini-parcel-row" data-parcel-id="${p.id}">
            <span class="mini-parcel-dot" style="background:${p.color};"></span>
            <div class="mini-parcel-info">
                <div class="mini-parcel-title">${escapeHtml(p.note || `Parcelle ${p.ref}`)}</div>
                <div class="mini-parcel-sub">Sect. ${escapeHtml(p.section)} N°${escapeHtml(p.numero)} • ${p.cadastral.formatted}</div>
            </div>
            <span class="mini-parcel-ha">${p.cadastral.haShort} ha</span>
        </div>
    `).join('');

    container.innerHTML = `
        <div class="cadastre-mini-kpis">
            <div class="cadastre-mini-kpi">
                <span class="kpi-val">${stats.totalCadastral.haShort} <small>ha</small></span>
                <span class="kpi-lbl">${stats.totalCadastral.formatted}</span>
            </div>
            <div class="cadastre-mini-kpi">
                <span class="kpi-val">${stats.totalParcels}</span>
                <span class="kpi-lbl">Parcelle${stats.totalParcels > 1 ? 's' : ''} (${stats.sectionsCount} sect.)</span>
            </div>
        </div>
        <div class="mini-parcel-list">
            <div class="mini-list-header">Principales parcelles (touchez pour localiser)</div>
            ${listHtml}
        </div>
    `;

    container.querySelectorAll('.mini-parcel-row').forEach(row => {
        row.addEventListener('click', () => {
            const id = Number(row.dataset.parcelId);
            const menu = document.getElementById('menu-items');
            if (menu) menu.classList.add('hidden-mobile');
            focusOnParcel(id);
        });
    });
}

/**
 * Ouvre la modale complète des Statistiques & Gestion du Cadastre
 */
export function openCadastreStatsModal(initialTab = null) {
    if (initialTab) activeStatsTab = initialTab;
    renderCadastreStatsModal();
    const modal = document.getElementById('modal-cadastre-stats');
    if (modal) modal.classList.remove('hidden');

    const menu = document.getElementById('menu-items');
    if (menu && !menu.classList.contains('hidden-mobile')) {
        menu.classList.add('hidden-mobile');
    }
}

/**
 * Génère l'intégralité du contenu de la modale Statistiques Cadastre
 */
export function renderCadastreStatsModal() {
    const container = document.getElementById('cadastre-stats-content');
    if (!container) return;

    const stats = computeCadastreAnalytics();

    // Navigation par onglets internes
    const tabsHtml = `
        <div class="cad-tabs-bar">
            <button type="button" class="cad-tab-btn ${activeStatsTab === 'overview' ? 'active' : ''}" data-tab="overview">
                📊 Synthèse
            </button>
            <button type="button" class="cad-tab-btn ${activeStatsTab === 'sections' ? 'active' : ''}" data-tab="sections">
                🏛️ Sections & Proprios
            </button>
            <button type="button" class="cad-tab-btn ${activeStatsTab === 'list' ? 'active' : ''}" data-tab="list">
                📋 Parcelles (${stats.totalParcels})
            </button>
        </div>
    `;

    if (stats.totalParcels === 0) {
        container.innerHTML = `
            ${tabsHtml}
            <div class="cad-empty-state">
                <div class="cad-empty-icon">📐</div>
                <h4>Aucune parcelle cadastrale enregistrée</h4>
                <p>Explorez le cadastre de Bégole pour calculer automatiquement vos superficies en hectares, ares, centiares, analyser les sections et localiser vos trouvailles par parcelle.</p>
                <button type="button" id="btn-empty-activate-cadastre" class="btn-confirm" style="margin-top:12px; padding:12px 20px; border-radius:14px; border:none; font-weight:700; cursor:pointer;">
                    🏠 Activer l'inspection Cadastre sur la carte
                </button>
            </div>
        `;
        const btnAct = container.querySelector('#btn-empty-activate-cadastre');
        if (btnAct) {
            btnAct.onclick = () => {
                document.getElementById('modal-cadastre-stats').classList.add('hidden');
                const toggle = document.getElementById('cadastre-mode-toggle');
                if (toggle) {
                    toggle.checked = true;
                    toggle.dispatchEvent(new Event('change'));
                }
                showToast("🏠 Mode Cadastre activé : touchez une parcelle !");
            };
        }
        return;
    }

    let bodyHtml = '';
    if (activeStatsTab === 'overview') {
        bodyHtml = buildOverviewTabHtml(stats);
    } else if (activeStatsTab === 'sections') {
        bodyHtml = buildSectionsAndOwnersTabHtml(stats);
    } else {
        bodyHtml = buildParcelsDirectoryTabHtml(stats);
    }

    container.innerHTML = tabsHtml + `<div class="cad-tab-panel">${bodyHtml}</div>`;

    // Attacher les événements des onglets
    container.querySelectorAll('.cad-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            activeStatsTab = btn.dataset.tab;
            renderCadastreStatsModal();
        });
    });

    // Si on est sur l'onglet Synthèse, dessiner le graphique Donut
    if (activeStatsTab === 'overview') {
        setTimeout(() => drawCadastreDonutChart(stats.byCategory, stats.totalCadastral.haShort), 30);
        bindOverviewEvents(container);
    } else if (activeStatsTab === 'sections') {
        bindSectionsTabEvents(container);
    } else if (activeStatsTab === 'list') {
        bindDirectoryTabEvents(container, stats);
    }
}

/**
 * Onglet 1 : Synthèse, KPIs, Donut Chart & Distribution des tailles
 */
function buildOverviewTabHtml(stats) {
    const perimKm = stats.totalPerimeterM >= 1000
        ? `${(stats.totalPerimeterM / 1000).toFixed(2)} km`
        : `${stats.totalPerimeterM} m`;

    const catLegendHtml = stats.byCategory.map(cat => `
        <div class="cad-legend-row">
            <div class="cad-legend-left">
                <span class="cad-color-dot" style="background:${cat.color};"></span>
                <div>
                    <div class="cad-legend-title">${cat.icon} ${escapeHtml(cat.label)} <span class="cad-badge-count">${cat.count}</span></div>
                    <div class="cad-legend-sub">${cat.cadastral.formatted} (${cat.cadastral.m2Formatted})</div>
                </div>
            </div>
            <div class="cad-legend-right">
                <div class="cad-legend-ha">${cat.cadastral.haDecimal} ha</div>
                <div class="cad-legend-pct">${cat.percent.toFixed(1)}%</div>
            </div>
        </div>
    `).join('');

    const maxBracketCount = Math.max(1, ...stats.sizeBrackets.map(b => b.count));
    const sizeDistHtml = stats.sizeBrackets.map(b => {
        const widthPct = Math.round((b.count / maxBracketCount) * 100);
        const haStr = (b.areaM2 / 10000).toFixed(2);
        return `
            <div class="cad-bar-item">
                <div class="cad-bar-header">
                    <span><b>${escapeHtml(b.label)}</b> <small>(${escapeHtml(b.sub)})</small></span>
                    <span><b>${b.count}</b> parc. • ${haStr} ha</span>
                </div>
                <div class="cad-bar-track">
                    <div class="cad-bar-fill" style="width:${widthPct}%; background:${b.color};"></div>
                </div>
            </div>
        `;
    }).join('');

    return `
        <!-- Hero Banner Cadastral -->
        <div class="cad-hero-card">
            <div class="cad-hero-top">
                <div>
                    <div class="cad-hero-eyebrow">SUPERFICIE TOTALE ENREGISTRÉE</div>
                    <div class="cad-hero-main-val">${stats.totalCadastral.haDecimal} <span>ha</span></div>
                    <div class="cad-hero-official">📐 ${stats.totalCadastral.formatted}</div>
                    <div class="cad-hero-m2">${stats.totalCadastral.m2Formatted}</div>
                </div>
                <div class="cad-hero-badges">
                    <div class="cad-pill-stat">🏠 <b>${stats.totalParcels}</b> parcelle${stats.totalParcels > 1 ? 's' : ''}</div>
                    <div class="cad-pill-stat">🗂️ <b>${stats.sectionsCount}</b> section${stats.sectionsCount > 1 ? 's' : ''}</div>
                    <div class="cad-pill-stat">📏 Périmètre : <b>${perimKm}</b></div>
                </div>
            </div>
            <div class="cad-village-bar-wrap">
                <div class="cad-village-bar-labels">
                    <span>Emprise sur la commune de Bégole (~615 ha)</span>
                    <b>${stats.villageCoveragePercent.toFixed(2)}% du village</b>
                </div>
                <div class="cad-village-bar-track">
                    <div class="cad-village-bar-fill" style="width:${Math.min(100, Math.max(1.5, stats.villageCoveragePercent))}%;"></div>
                </div>
            </div>
        </div>

        <!-- 4 Cartes KPIs -->
        <div class="cad-kpi-grid">
            <div class="cad-kpi-card">
                <div class="cad-kpi-icon">⚖️</div>
                <div class="cad-kpi-label">Surface Moyenne</div>
                <div class="cad-kpi-val">${stats.avgCadastral.haShort} ha</div>
                <div class="cad-kpi-sub">${stats.avgCadastral.formatted}<br>Médiane : ${stats.medianCadastral.haShort} ha</div>
            </div>

            <div class="cad-kpi-card clickable-kpi" data-locate-id="${stats.maxParcel ? stats.maxParcel.id : ''}" title="Toucher pour voir sur la carte">
                <div class="cad-kpi-icon">🏆</div>
                <div class="cad-kpi-label">Plus Grande Parcelle</div>
                <div class="cad-kpi-val">${stats.maxParcel ? stats.maxParcel.cadastral.haShort + ' ha' : '--'}</div>
                <div class="cad-kpi-sub">
                    ${stats.maxParcel ? `<b>${escapeHtml(stats.maxParcel.ref)}</b> ${stats.maxParcel.note ? '(' + escapeHtml(stats.maxParcel.note) + ')' : ''}<br>🎯 Voir sur la carte` : '--'}
                </div>
            </div>

            <div class="cad-kpi-card clickable-kpi" data-locate-id="${stats.minParcel ? stats.minParcel.id : ''}" title="Toucher pour voir sur la carte">
                <div class="cad-kpi-icon">🔹</div>
                <div class="cad-kpi-label">Plus Petite Parcelle</div>
                <div class="cad-kpi-val">${stats.minParcel ? stats.minParcel.cadastral.m2Formatted : '--'}</div>
                <div class="cad-kpi-sub">
                    ${stats.minParcel ? `<b>${escapeHtml(stats.minParcel.ref)}</b> (${stats.minParcel.cadastral.formatted})<br>🎯 Voir sur la carte` : '--'}
                </div>
            </div>

            <div class="cad-kpi-card">
                <div class="cad-kpi-icon">🌿</div>
                <div class="cad-kpi-label">Équivalence & Repères</div>
                <div class="cad-kpi-val">⚽ ${stats.footballFieldsEq}</div>
                <div class="cad-kpi-sub">terrains de foot<br>📍 <b>${stats.totalPoisInParcels}</b> point(s)/plante(s) dedans</div>
            </div>
        </div>

        <!-- Répartition par Catégorie / Couleur (Donut + Légende) -->
        <div class="cad-section-card">
            <div class="cad-section-header">🎨 Répartition par Usage / Catégorie</div>
            <div class="cad-chart-layout">
                <div class="cad-donut-wrap">
                    <canvas id="cadastre-donut-canvas" width="180" height="180"></canvas>
                </div>
                <div class="cad-legend-list">
                    ${catLegendHtml}
                </div>
            </div>
        </div>

        <!-- Distribution par Tranche de Taille -->
        <div class="cad-section-card">
            <div class="cad-section-header">📐 Distribution par Taille de Parcelle</div>
            <div class="cad-bars-container">
                ${sizeDistHtml}
            </div>
        </div>

        <!-- Actions d'export rapide -->
        <div class="cad-export-bar">
            <button type="button" id="btn-export-cadastre-csv" class="cad-export-btn">
                📊 Exporter Tableau CSV
            </button>
            <button type="button" id="btn-export-cadastre-geojson" class="cad-export-btn secondary">
                🗺️ Exporter GeoJSON
            </button>
        </div>
    `;
}

/**
 * Onglet 2 : Répartition par Section Cadastrale & par Propriétaire / Note
 */
function buildSectionsAndOwnersTabHtml(stats) {
    const sectionsHtml = stats.bySection.map(sec => `
        <div class="cad-bar-item">
            <div class="cad-bar-header">
                <span>
                    <span class="cad-section-pill">Section ${escapeHtml(sec.section)}</span>
                    <b>${sec.count}</b> parcelle${sec.count > 1 ? 's' : ''}
                </span>
                <span><b>${sec.cadastral.haDecimal} ha</b> (${sec.percent.toFixed(1)}%)</span>
            </div>
            <div class="cad-bar-sub">${sec.cadastral.formatted} • ${sec.cadastral.m2Formatted}</div>
            <div class="cad-bar-track">
                <div class="cad-bar-fill" style="width:${Math.max(3, sec.percent)}%; background: linear-gradient(90deg, #e67e22, #f39c12);"></div>
            </div>
        </div>
    `).join('');

    const ownersHtml = stats.byOwner.map(own => {
        const dots = own.colors.map(c => `<span class="cad-mini-dot" style="background:${c};"></span>`).join('');
        return `
            <div class="cad-owner-card" data-owner="${escapeHtml(own.owner)}">
                <div class="cad-owner-left">
                    <div class="cad-owner-name">
                        ${dots}
                        <span>${escapeHtml(own.owner)}</span>
                    </div>
                    <div class="cad-owner-meta">
                        ${own.count} parcelle${own.count > 1 ? 's' : ''} • ${own.cadastral.formatted} (${own.cadastral.m2Formatted})
                    </div>
                </div>
                <div class="cad-owner-right">
                    <div class="cad-owner-ha">${own.cadastral.haDecimal} ha</div>
                    <div class="cad-owner-pct">${own.percent.toFixed(1)}% du total</div>
                </div>
            </div>
        `;
    }).join('');

    return `
        <div class="cad-section-card">
            <div class="cad-section-header">🗺️ Répartition par Section Cadastrale (${stats.sectionsCount})</div>
            <p class="cad-section-desc">Cumul des surfaces enregistrées pour chaque section officielle du cadastre.</p>
            <div class="cad-bars-container">
                ${sectionsHtml}
            </div>
        </div>

        <div class="cad-section-card">
            <div class="cad-section-header">👤 Parcelles par Propriétaire / Note (${stats.byOwner.length})</div>
            <p class="cad-section-desc">Touchez un groupe pour afficher ses parcelles dans le répertoire.</p>
            <div class="cad-owners-list">
                ${ownersHtml}
            </div>
        </div>
    `;
}

/**
 * Onglet 3 : Répertoire Interactif des Parcelles (Recherche, Tri, Localisation, Édition, Suppression)
 */
function buildParcelsDirectoryTabHtml(stats) {
    // Options de filtre par couleur
    const colorOptionsHtml = Object.entries(PARCEL_COLOR_CATEGORIES).map(([hex, info]) => `
        <option value="${hex}" ${parcelColorFilter === hex ? 'selected' : ''}>${info.icon} ${info.label}</option>
    `).join('');

    // Filtrage
    let filtered = stats.parcels.filter(p => {
        if (parcelColorFilter !== 'all' && p.color !== parcelColorFilter) return false;
        if (parcelSearchQuery) {
            const q = parcelSearchQuery.toLowerCase();
            const matchRef = p.ref.toLowerCase().includes(q);
            const matchNote = p.note.toLowerCase().includes(q);
            const matchCat = p.catInfo.label.toLowerCase().includes(q);
            return matchRef || matchNote || matchCat;
        }
        return true;
    });

    // Tri
    filtered.sort((a, b) => {
        if (parcelSortBy === 'area-desc') return b.areaM2 - a.areaM2;
        if (parcelSortBy === 'area-asc') return a.areaM2 - b.areaM2;
        if (parcelSortBy === 'ref-asc') return a.ref.localeCompare(b.ref, 'fr', { numeric: true });
        if (parcelSortBy === 'note-asc') return (a.note || 'zzz').localeCompare(b.note || 'zzz', 'fr');
        return b.id - a.id; // plus récent
    });

    const filteredAreaM2 = filtered.reduce((sum, p) => sum + p.areaM2, 0);
    const filteredCad = formatCadastralArea(filteredAreaM2);

    const cardsHtml = filtered.length === 0
        ? `<div style="text-align:center; padding:25px; color:var(--text-sub); font-style:italic;">Aucune parcelle ne correspond à ce filtre.</div>`
        : filtered.map(p => {
            const poiBadges = [
                ...p.poisInside.map(pt => `<span class="cad-poi-chip" title="${escapeHtml(pt.note)}">${pt.emoji} ${escapeHtml(pt.note || 'Point')}</span>`),
                ...p.plantsInside.map(pl => `<span class="cad-poi-chip plant">🌿 ${escapeHtml(pl.name)}</span>`)
            ].join('');

            return `
                <div class="cad-parcel-item" style="border-left-color: ${p.color};">
                    <div class="cad-parcel-top">
                        <div>
                            <div class="cad-parcel-badges">
                                <span class="cad-ref-badge">Sect. ${escapeHtml(p.section)} • N° ${escapeHtml(p.numero)}</span>
                                <span class="cad-cat-chip" style="background:${p.color}22; color:${p.color}; border:1px solid ${p.color}55;">
                                    ${p.catInfo.icon} ${escapeHtml(p.catInfo.label)}
                                </span>
                            </div>
                            <div class="cad-parcel-title">${escapeHtml(p.note || `Parcelle ${p.ref}`)}</div>
                        </div>
                        <div class="cad-parcel-area-box">
                            <div class="cad-parcel-ha">${p.cadastral.haDecimal} ha</div>
                            <div class="cad-parcel-aca">${p.cadastral.formatted}</div>
                        </div>
                    </div>

                    <div class="cad-parcel-details-row">
                        <span>📐 ${p.cadastral.m2Formatted}</span>
                        <span>📏 Périmètre : ~${p.perimeterM} m</span>
                        <span>📍 ${escapeHtml(p.commune)}</span>
                    </div>

                    ${poiBadges ? `<div class="cad-parcel-pois">Sur cette parcelle : ${poiBadges}</div>` : ''}

                    <div class="cad-parcel-actions">
                        <button type="button" class="cad-btn-action locate" data-id="${p.id}">
                            🎯 Carte
                        </button>
                        <button type="button" class="cad-btn-action edit" data-id="${p.id}">
                            ✏️ Modifier
                        </button>
                        <button type="button" class="cad-btn-action delete" data-id="${p.id}">
                            🗑️
                        </button>
                    </div>
                </div>
            `;
        }).join('');

    return `
        <div class="cad-directory-Controls">
            <input type="text" id="cad-search-input" class="cad-search-input" placeholder="🔍 Rechercher réf (ex: A 124), propriétaire, note..." value="${escapeHtml(parcelSearchQuery)}">
            <div class="cad-filters-row">
                <select id="cad-color-filter" class="cad-select">
                    <option value="all" ${parcelColorFilter === 'all' ? 'selected' : ''}>🎨 Toutes catégories</option>
                    ${colorOptionsHtml}
                </select>
                <select id="cad-sort-select" class="cad-select">
                    <option value="area-desc" ${parcelSortBy === 'area-desc' ? 'selected' : ''}>⬇️ Surface ( + grande )</option>
                    <option value="area-asc" ${parcelSortBy === 'area-asc' ? 'selected' : ''}>⬆️ Surface ( + petite )</option>
                    <option value="ref-asc" ${parcelSortBy === 'ref-asc' ? 'selected' : ''}>🔤 Référence (Section)</option>
                    <option value="note-asc" ${parcelSortBy === 'note-asc' ? 'selected' : ''}>👤 Propriétaire / Note</option>
                    <option value="recent" ${parcelSortBy === 'recent' ? 'selected' : ''}>🕒 Plus récentes</option>
                </select>
            </div>
            <div class="cad-filter-summary">
                Affichage : <b>${filtered.length}</b> parcelle${filtered.length > 1 ? 's' : ''} • Cumul : <b>${filteredCad.haDecimal} ha</b> (${filteredCad.formatted})
            </div>
        </div>

        <div class="cad-parcels-list">
            ${cardsHtml}
        </div>
    `;
}

/**
 * Dessine un graphique en anneau (Donut Chart) propre sur Canvas
 */
function drawCadastreDonutChart(categories, totalHaText) {
    const canvas = document.getElementById('cadastre-donut-canvas');
    if (!canvas || !categories || categories.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const size = 180;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    const outerR = 76;
    const innerR = 48;

    let currentAngle = -Math.PI / 2;
    const totalArea = categories.reduce((acc, c) => acc + c.areaM2, 0) || 1;

    categories.forEach(cat => {
        const sliceAngle = (cat.areaM2 / totalArea) * (Math.PI * 2);
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, currentAngle, currentAngle + sliceAngle);
        ctx.arc(cx, cy, innerR, currentAngle + sliceAngle, currentAngle, true);
        ctx.closePath();

        ctx.fillStyle = cat.color;
        ctx.fill();

        ctx.lineWidth = 2;
        ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--card-bg').trim() || '#ffffff';
        ctx.stroke();

        currentAngle += sliceAngle;
    });

    // Texte central
    const textMain = getComputedStyle(document.body).getPropertyValue('--text-main').trim() || '#2c3e50';
    const textSub = getComputedStyle(document.body).getPropertyValue('--text-sub').trim() || '#7f8c8d';

    ctx.fillStyle = textMain;
    ctx.font = '800 18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${totalHaText}`, cx, cy - 7);

    ctx.fillStyle = textSub;
    ctx.font = '700 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.fillText('HECTARES', cx, cy + 12);
}

function bindOverviewEvents(container) {
    container.querySelectorAll('.clickable-kpi').forEach(card => {
        card.addEventListener('click', () => {
            const id = Number(card.dataset.locateId);
            if (id) {
                document.getElementById('modal-cadastre-stats').classList.add('hidden');
                focusOnParcel(id);
            }
        });
    });

    const btnCsv = container.querySelector('#btn-export-cadastre-csv');
    if (btnCsv) btnCsv.addEventListener('click', exportCadastreToCSV);

    const btnGeo = container.querySelector('#btn-export-cadastre-geojson');
    if (btnGeo) btnGeo.addEventListener('click', exportCadastreToGeoJSON);
}

function bindSectionsTabEvents(container) {
    container.querySelectorAll('.cad-owner-card').forEach(card => {
        card.addEventListener('click', () => {
            const owner = card.dataset.owner;
            parcelSearchQuery = (owner === 'Sans note / Non attribué') ? '' : owner;
            activeStatsTab = 'list';
            renderCadastreStatsModal();
        });
    });
}

function bindDirectoryTabEvents(container, stats) {
    const searchInput = container.querySelector('#cad-search-input');
    const colorSelect = container.querySelector('#cad-color-filter');
    const sortSelect = container.querySelector('#cad-sort-select');

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            parcelSearchQuery = e.target.value;
            const pos = e.target.selectionStart;
            renderCadastreStatsModal();
            const newInput = document.getElementById('cad-search-input');
            if (newInput) {
                newInput.focus();
                newInput.setSelectionRange(pos, pos);
            }
        });
    }

    if (colorSelect) {
        colorSelect.addEventListener('change', (e) => {
            parcelColorFilter = e.target.value;
            renderCadastreStatsModal();
        });
    }

    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            parcelSortBy = e.target.value;
            renderCadastreStatsModal();
        });
    }

    container.querySelectorAll('.cad-btn-action.locate').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = Number(btn.dataset.id);
            document.getElementById('modal-cadastre-stats').classList.add('hidden');
            focusOnParcel(id);
        });
    });

    container.querySelectorAll('.cad-btn-action.edit').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = Number(btn.dataset.id);
            const found = appState.parcels.find(p => p.id === id);
            if (found) {
                openEditSavedParcelModal(found);
            }
        });
    });

    container.querySelectorAll('.cad-btn-action.delete').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = Number(btn.dataset.id);
            await deleteParcelById(id);
        });
    });
}

// ============================================================
// --- AJOUT, ÉDITION ET SUPPRESSION DE PARCELLES ---
// ============================================================

/**
 * Ouvre la modale Parcelle suite à un clic sur la carte en mode Cadastre
 */
export function openParcelModalFromFeature(feature) {
    currentParcelGeoJSON = feature;
    const props = feature.properties || {};

    // Vérifier si cette parcelle existe déjà dans la base (même section + numéro)
    const existing = appState.parcels.find(p => {
        const ep = p.geoJSON?.properties || {};
        return ep.section === props.section && ep.numero === props.numero && props.section && props.numero;
    });

    if (existing) {
        currentEditingParcelId = existing.id;
        selectedParcelColor = existing.color || '#2ecc71';
        document.getElementById('parcel-note').value = existing.note || '';
    } else {
        currentEditingParcelId = null;
        selectedParcelColor = '#2ecc71';
        document.getElementById('parcel-note').value = '';
    }

    populateParcelModalDetails(feature, Boolean(existing));
}

/**
 * Ouvre la modale Parcelle pour modifier une parcelle déjà sauvegardée
 */
export function openEditSavedParcelModal(savedParcel) {
    if (!savedParcel || !savedParcel.geoJSON) return;
    currentParcelGeoJSON = savedParcel.geoJSON;
    currentEditingParcelId = savedParcel.id;
    selectedParcelColor = savedParcel.color || '#2ecc71';

    document.getElementById('parcel-note').value = savedParcel.note || '';
    populateParcelModalDetails(savedParcel.geoJSON, true);
}

function populateParcelModalDetails(feature, isEditing) {
    const props = feature.properties || {};
    const areaM2 = getParcelAreaM2(feature);
    const cad = formatCadastralArea(areaM2);
    const perim = calculateGeoJSONPerimeter(feature.geometry);

    const refEl = document.getElementById('parcel-ref');
    const areaEl = document.getElementById('parcel-area');
    const titleEl = document.getElementById('modal-parcel-title');

    if (titleEl) {
        titleEl.textContent = isEditing ? '✏️ Modifier la Parcelle' : '🏛️ Nouvelle Parcelle Cadastrale';
    }

    if (refEl) {
        refEl.textContent = `Section ${props.section || '?'} • Parcelle N° ${props.numero || '?'}`;
    }

    if (areaEl) {
        areaEl.innerHTML = `
            <div class="parcel-modal-ha">${cad.haDecimal} ha</div>
            <div class="parcel-modal-aca">📐 ${cad.formatted} (${cad.m2Formatted})</div>
            ${perim > 0 ? `<div class="parcel-modal-perim">📏 Périmètre : ~${perim} m • Commune : ${escapeHtml(props.nom_com || 'Bégole')}</div>` : ''}
        `;
    }

    // Mettre à jour la sélection de couleur et le label de catégorie
    syncParcelColorPickerUI(selectedParcelColor);

    document.getElementById('modal-parcel').classList.remove('hidden');
}

export function setSelectedParcelColor(color) {
    selectedParcelColor = color;
    syncParcelColorPickerUI(color);
}

function syncParcelColorPickerUI(color) {
    document.querySelectorAll('.color-option').forEach(opt => {
        opt.classList.toggle('selected', opt.getAttribute('data-color') === color);
    });
    const catLabelEl = document.getElementById('parcel-color-category-label');
    if (catLabelEl) {
        const info = PARCEL_COLOR_CATEGORIES[color] || { label: 'Autre', icon: '📐' };
        catLabelEl.textContent = `${info.icon} Catégorie : ${info.label}`;
        catLabelEl.style.color = color;
    }
}

/**
 * Confirme la sauvegarde ou la mise à jour d'une parcelle
 */
export async function confirmSaveParcel() {
    if (!currentParcelGeoJSON) return;

    const noteVal = document.getElementById('parcel-note').value.trim();

    if (currentEditingParcelId) {
        const existingIndex = appState.parcels.findIndex(p => p.id === currentEditingParcelId);
        if (existingIndex > -1) {
            appState.parcels[existingIndex].color = selectedParcelColor;
            appState.parcels[existingIndex].note = noteVal;
            await saveToDB('parcels', appState.parcels[existingIndex]);
            showToast("Parcelle mise à jour ✅");
        }
    } else {
        const newParcel = {
            id: Date.now(),
            geoJSON: currentParcelGeoJSON,
            color: selectedParcelColor,
            note: noteVal
        };
        await saveToDB('parcels', newParcel);
        appState.parcels.push(newParcel);
        showToast("Parcelle sauvegardée au cadastre 🏛️");
    }

    const toggle = document.getElementById('show-parcels-toggle');
    if (toggle && !toggle.checked) {
        toggle.checked = true;
        toggleSavedParcels(true);
    }

    clearParcelHighlight();
    displayParcels(appState.parcels);
    renderMenuCadastreSummary();
    updateUserLevel(appState.points, appState.trips);

    // Si la modale de stats cadastre est ouverte en arrière-plan, la rafraîchir
    const statsModal = document.getElementById('modal-cadastre-stats');
    if (statsModal && !statsModal.classList.contains('hidden')) {
        renderCadastreStatsModal();
    }

    document.getElementById('modal-parcel').classList.add('hidden');
    triggerHaptic('success');
}

/**
 * Supprime une parcelle par son ID
 */
export async function deleteParcelById(id) {
    if (!confirm("Supprimer cette parcelle de vos propriétés enregistrées ?")) return;

    await deleteFromDB('parcels', id);
    appState.parcels = appState.parcels.filter(p => p.id !== id);
    displayParcels(appState.parcels);
    renderMenuCadastreSummary();
    updateUserLevel(appState.points, appState.trips);

    const statsModal = document.getElementById('modal-cadastre-stats');
    if (statsModal && !statsModal.classList.contains('hidden')) {
        renderCadastreStatsModal();
    }

    showToast("Parcelle supprimée 🗑️");
}

// ============================================================
// --- EXPORTS CSV & GEOJSON DU CADASTRE ---
// ============================================================

export function exportCadastreToCSV() {
    const stats = computeCadastreAnalytics();
    if (stats.totalParcels === 0) {
        showToast("Aucune parcelle à exporter");
        return;
    }

    const headers = [
        "Section",
        "Numero",
        "Reference",
        "Commune",
        "Categorie",
        "Proprietaire_Note",
        "Surface_m2",
        "Surface_ha",
        "Surface_Cadastrale",
        "Perimetre_m",
        "Points_Interet_Interieurs"
    ];

    const rows = stats.parcels.map(p => [
        `"${p.section}"`,
        `"${p.numero}"`,
        `"${p.ref}"`,
        `"${p.commune}"`,
        `"${p.catInfo.label}"`,
        `"${(p.note || '').replace(/"/g, '""')}"`,
        p.areaM2,
        p.cadastral.haDecimal,
        `"${p.cadastral.formatted}"`,
        p.perimeterM,
        p.poisInside.length + p.plantsInside.length
    ]);

    const csvContent = "\uFEFF" + [headers.join(";"), ...rows.map(r => r.join(";"))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Cadastre_Begole_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("📊 Export CSV Cadastre téléchargé !");
}

export function exportCadastreToGeoJSON() {
    const stats = computeCadastreAnalytics();
    if (stats.totalParcels === 0) {
        showToast("Aucune parcelle à exporter");
        return;
    }

    const featureCollection = {
        type: "FeatureCollection",
        name: "Cadastre_Begole_Map",
        features: stats.parcels.map(p => ({
            type: "Feature",
            properties: {
                ...(p.raw.geoJSON?.properties || {}),
                id: p.id,
                note: p.note,
                color: p.color,
                categorie: p.catInfo.label,
                surface_m2: p.areaM2,
                surface_ha: parseFloat(p.cadastral.haDecimal),
                surface_cadastrale: p.cadastral.formatted,
                perimetre_m: p.perimeterM
            },
            geometry: p.raw.geoJSON?.geometry || null
        }))
    };

    const blob = new Blob([JSON.stringify(featureCollection, null, 2)], { type: "application/geo+json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Cadastre_Begole_${new Date().toISOString().slice(0, 10)}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("🗺️ Fichier GeoJSON Cadastre téléchargé !");
}
