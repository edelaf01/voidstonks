// --- CONFIGURACIÓN ---
const WORKER_URL = "https://wf-tool-proxy-worker.edelamf0.workers.dev/";

const REQUEST_QUEUE = [];
let isProcessingQueue = false;
let debounceTimer;

// --- ESTADO ---
let currentActiveSet = null; 
let allRivenNames = [];
let activeSetParts = []; 
let completedParts = new Set(); 
let currentLang = 'es';
let itemsDatabase = {}; 
let relicsDatabase = {};
let relicStatusDB = {};
let activeResurgenceList = new Set();
let allRelicNames = []; 
let selectedRelic = "";
let playerCount = 1;
let weaponMap = {}; 

const TIER_URLS = {
    'Lith': 'https://wiki.warframe.com/images/LithRelicIntact.png?ee7d7',
    'Meso': 'https://wiki.warframe.com/images/MesoRelicIntact.png?a9b4a',
    'Neo':  'https://wiki.warframe.com/images/NeoRelicIntact.png?6dc86',
    'Axi':  'https://wiki.warframe.com/images/AxiRelicIntact.png?6cadf',
    'Requiem': 'https://wiki.warframe.com/images/RequiemRelicIntact.png?03821'
};

const WEAPON_SOURCES = [
    'https://cdn.jsdelivr.net/gh/WFCD/warframe-items@master/data/json/Primary.json',
    'https://cdn.jsdelivr.net/gh/WFCD/warframe-items@master/data/json/Secondary.json',
    'https://cdn.jsdelivr.net/gh/WFCD/warframe-items@master/data/json/Melee.json',
    'https://cdn.jsdelivr.net/gh/WFCD/warframe-items@master/data/json/Arch-Gun.json'
];

const RIVEN_STATS = [
    { slug: "critical_chance", name_en: "Crit Chance", name_es: "Prob. Crítica" },
    { slug: "critical_damage", name_en: "Crit Damage", name_es: "Daño Crítico" },
    { slug: "multishot", name_en: "Multishot", name_es: "Multidisparo" },
    { slug: "base_damage_/_melee_damage", name_en: "Damage", name_es: "Daño Base" },
    { slug: "fire_rate_/_attack_speed", name_en: "Fire Rate / Attack Speed", name_es: "Cadencia / Vel. Ataque" },
    { slug: "status_chance", name_en: "Status Chance", name_es: "Prob. Estado" },
    { slug: "toxin_damage", name_en: "Toxin", name_es: "Toxina" },
    { slug: "heat_damage", name_en: "Heat", name_es: "Calor" },
    { slug: "electric_damage", name_en: "Electric", name_es: "Electricidad" },
    { slug: "cold_damage", name_en: "Cold", name_es: "Frío" },
    { slug: "weapon_recoil", name_en: "Recoil", name_es: "Retroceso" },
    { slug: "range", name_en: "Range", name_es: "Alcance" },
    { slug: "magazine_capacity", name_en: "Magazine Cap", name_es: "Cargador" },
    { slug: "reload_speed", name_en: "Reload Speed", name_es: "Vel. Recarga" },
    { slug: "damage_vs_grineer", name_en: "Dmg Grineer", name_es: "Daño Grineer" },
    { slug: "damage_vs_corpus", name_en: "Dmg Corpus", name_es: "Daño Corpus" },
    { slug: "damage_vs_infested", name_en: "Dmg Infested", name_es: "Daño Infestado" }
];

const TEXTS = {
    es: {
        tab1: "1. Reliquia", tab2: "2. Set / Item", tab3: "3. Riven 🟣", tab4: "4. Perfil 👤",
        lblRelic: "Nombre de Reliquia", phRelic: "Ej: Lith A1...",
        lblItem: "Buscar Item (Ej: Xaku)", phItem: "Ej: Xaku, Protea...",
        lblRef: "Refinamiento", lblMiss: "Faltan",
        btnCopy: "Copiar Mensaje", btnPrice: "💲 Precio", msgCopied: "¡COPIADO!",
        noStock: "Sin datos", countMsg: "items",
        defaultRelic: "RELIQUIA", 
        errLoad: "Error de conexión.",
        errFetch: "Error de red.",
        common: "Común", uncommon: "Poco Común", rare: "Raro",
        setInfo: "Set Completo",
        notFound: "No encontrado en Reliquias.",
        active: "ACTIVA",
        vaulted: "VAULTED",
        aya: "AYA (Varzia)",
        lblRivenW: "Arma del Riven", phRivenW: "Ej: Bramma, Nikana...", lblRivenS: "Estadísticas (Opcional)",
        headerTitle: "VOIDSTONKS",
        headerSub: "Optimización de Farm y Mercado",
        lblProfit: "Rentabilidad (Media)",
        lblContent: "Contenido:",
        footerData: "Datos provistos por:",
        contactLabel: "¿Tienes ideas para mejorar la app?",
        contactLink: "w/Parcialsobriedad",
        rivenSearch: "🔎 BUSCAR PRECIO",
        refs: { rad: "Radiante", intact: "Intact", flawless: "Perfecta", exceptional: "Excepcional" },
        rarityAbbr: { common: "C", uncommon: "PC", rare: "R" },
        trackerTitle: "Progreso del Set",
        markDone: "✅ Ya lo tengo",
        markUndo: "Desmarcar",
        lblUser: "Nombre de Usuario (PC)",
        btnCheck: "Check",
        lblDailyFocus: "Foco Diario",
        lblStanding: "Reputación Restante",
        lblTraces: "Max Vestigios",
        lblRelicFor: "Reliquias para: ",
        lblRivenNeg: "- Negativa (Opcional)",
        lblMrCalc: "Si la API falla, calcula por MR:",
        disclaimer: "VoidStonks no está afiliado, respaldado ni patrocinado por Digital Extremes Ltd.<br>Warframe™ es una marca registrada de Digital Extremes Ltd."
    },
    en: {
        tab1: "1. Relic", tab2: "2. Set / Item", tab3: "3. Riven 🟣", tab4: "4. Profile 👤",
        lblRelic: "Relic Name", phRelic: "e.g. Lith A1...",
        lblItem: "Search Item (e.g. Xaku)", phItem: "e.g. Xaku, Protea...",
        lblRef: "Refinement", lblMiss: "Need",
        btnCopy: "Copy Message", btnPrice: "💲 Precio", msgCopied: "COPIED!",
        noStock: "No Data", countMsg: "items",
        defaultRelic: "RELIC",
        errLoad: "Connection Error.",
        errFetch: "Network Error.",
        common: "Common", uncommon: "Uncommon", rare: "Rare",
        setInfo: "Full Set",
        notFound: "Not found in Relics.",
        active: "ACTIVE",
        vaulted: "VAULTED",
        aya: "AYA (Varzia)",
        lblRivenW: "Riven Weapon", phRivenW: "e.g. Bramma, Nikana...", lblRivenS: "Stats (Optional)",
        headerTitle: "VOIDSTONKS",
        headerSub: "Farm & Market Optimization Tool",
        lblProfit: "Profitability (Avg)",
        lblContent: "Contents:",
        footerData: "Data provided by:",
        contactLabel: "Got ideas to improve the app?",
        contactLink: "w/Parcialsobriedad",
        rivenSearch: "🔎 CHECK PRICE",
        refs: { rad: "Radiant", intact: "Intact", flawless: "Flawless", exceptional: "Exceptional" },
        rarityAbbr: { common: "C", uncommon: "UC", rare: "R" },
        trackerTitle: "Set Progress",
        markDone: "✅ Got it",
        markUndo: "Unmark",
        lblUser: "Username (PC)",
        btnCheck: "Check",
        lblDailyFocus: "Daily Focus",
        lblStanding: "Daily Standing",
        lblTraces: "Max Void Traces",
        lblRelicFor: "Relics for: ",
        lblRivenNeg: "- Negative (Optional)",
        lblMrCalc: "If API fails, calc by MR:",
        disclaimer: "VoidStonks is not affiliated, endorsed, or sponsored by Digital Extremes Ltd.<br>Warframe™ is a registered trademark of Digital Extremes Ltd.",
        
    }
};

async function init() {
    populateRivenSelects();
    changeLanguage();
    await downloadRelics(); 
    fetchRivenWeapons();
}

// --- UTILS ---
function getSlug(itemName) {
    return itemName.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9 ]/g, '').trim().replace(/\s+/g, '_');
}

function getRivenSlug(weaponName) {
    let slug = getSlug(weaponName);
    return slug.replace(/_prime$/, '').replace(/_vandal$/, '').replace(/_wraith$/, '').replace(/_kuva$/, '').replace(/_tenet$/, '');
}

function showToast(message) {
    const toast = document.getElementById('error-toast');
    toast.innerText = message;
    toast.classList.add('visible');
    setTimeout(() => { toast.classList.remove('visible'); }, 3000);
}

function clearLocalCache() {
    alert("La caché del servidor se limpia automáticamente cada 30 min. Recargando...");
    location.reload();
}


async function getPriceValue(itemName, slug) {
    if (!itemName || itemName === "Forma Blueprint") return 0; 
    
    const url = `${WORKER_URL}?type=price&q=${slug}`;
    
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error("Worker Error");
        const data = await res.json();
        
        const realData = data.payload ? data.payload : data;
        const sells = realData.orders || realData.data?.sell || []; 
        const active = sells.filter(o => o.user.status === 'ingame' || o.user.status === 'online');
        active.sort((a, b) => a.platinum - b.platinum);
        const p = active.length > 0 ? active[0].platinum : 0;
        return p;
    } catch (e) { 
        return 0; 
    }
}

async function addToQueue(itemName, element) {
    if (!itemName || itemName === "Forma Blueprint") return;
    const slug = getSlug(itemName);
    REQUEST_QUEUE.push({ name: itemName, slug: slug, el: element });
    processQueue();
}

async function processQueue() {
    if (isProcessingQueue || REQUEST_QUEUE.length === 0) return;
    isProcessingQueue = true;
    while (REQUEST_QUEUE.length > 0) {
        const task = REQUEST_QUEUE.shift();
        const price = await getPriceValue(task.name, task.slug);
        updatePriceUI(task.el, price);
        await new Promise(r => setTimeout(r, 50)); 
    }
    isProcessingQueue = false;
}

async function fetchUserProfile() {
    const username = document.getElementById('usernameInput').value.trim();
    if(!username) return alert("Please enter username");
    
    const container = document.getElementById('profile-data');
    container.innerHTML = '<div class="price-badge loading" style="width:100%">Loading...</div>';

    try {
        const url = `${WORKER_URL}?type=profile&q=${encodeURIComponent(username)}`;
        const res = await fetch(url);
        
        if(!res.ok) throw new Error("API Blocked or User Not Found");
        const data = await res.json();

        if(data && typeof data.masteryRank !== 'undefined') {
            document.getElementById('mrInput').value = data.masteryRank;
            renderProfileStats(data.masteryRank, data.dailyFocus || 0, data.dailyStanding || {});
        } else {
            throw new Error("Invalid Data");
        }
    } catch(e) {
        container.innerHTML = '<div style="color:orange; font-size:0.9em; padding:10px;">Perfil no encontrado o privado.<br>Usando calculadora manual.</div>';
        calculateCaps();
    }
}

function calculateCaps() {
    const mr = parseInt(document.getElementById('mrInput').value) || 0;
    const focusCap = 250000 + (5000 * mr);
    const standingCap = 16000 + (500 * mr);
    const mockStanding = { Ostron: standingCap, Solaris: standingCap, Entrati: standingCap, Cavia: standingCap, Simaris: standingCap };
    renderProfileStats(mr, focusCap, mockStanding, true);
}

function renderProfileStats(mr, focus, standingObj, isCalc = false) {
    const container = document.getElementById('profile-data');
    const t = TEXTS[currentLang];
    const tracesCap = 100 + (50 * mr);
    let standingHtml = '';
    if(standingObj) {
        for (const [faction, amount] of Object.entries(standingObj)) {
            if(typeof amount === 'number' && amount >= 0) {
                standingHtml += `<div class="standing-item"><div style="font-size:0.8em;color:#aaa">${faction}</div><div class="standing-val">${amount.toLocaleString()}</div></div>`;
            }
        }
    }
    container.innerHTML = `
        <div style="display:flex; gap:10px; margin-bottom:15px;">
            <div class="profile-stat-box" style="flex:1">
                <div class="profile-stat-title">Mastery Rank</div>
                <div class="profile-stat-val" style="color:#gold">${mr}</div>
            </div>
            <div class="profile-stat-box" style="flex:1">
                <div class="profile-stat-title">${t.lblTraces}</div>
                <div class="profile-stat-val">${tracesCap}</div>
            </div>
        </div>
        <div class="profile-stat-box">
            <div class="profile-stat-title">${t.lblDailyFocus} ${isCalc ? '(Max)' : '(Remaining)'}</div>
            <div class="profile-stat-val" style="color:var(--wf-riven)">${focus.toLocaleString()}</div>
        </div>
        <div style="margin-top:15px; font-weight:bold; color:var(--wf-blue); text-align:center;">${t.lblStanding}</div>
        <div class="standing-grid">${standingHtml}</div>
    `;
}

async function fetchActiveResurgence() {
    try {
        const res = await fetch(`${WORKER_URL}?type=aya`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.PrimeVaultTraders && Array.isArray(data.PrimeVaultTraders)) {
            data.PrimeVaultTraders.forEach(trader => {
                if (!trader.Closed && trader.Manifest) {
                    trader.Manifest.forEach(item => {
                        if (item.ItemType && item.ItemType.includes("Projections")) {
                            
                            const rawName = item.ItemType.split('/').pop();
                            
                            let tier = "";
                            if(rawName.startsWith("T1")) tier = "Lith";
                            else if(rawName.startsWith("T2")) tier = "Meso";
                            else if(rawName.startsWith("T3")) tier = "Neo";
                            else if(rawName.startsWith("T4")) tier = "Axi";
                            else if(rawName.startsWith("T5")) tier = "Requiem";

                            let code = rawName.replace(/T\d+VoidProjection/, "");
                            if (code.length === 1 && code.match(/[A-Z]/)) code += "1";

                            if (tier && code) {
                                const cleanName = `${tier} ${code}`.toUpperCase();
                                activeResurgenceList.add(cleanName);
                            }
                        }
                    });
                }
            });
        }
    } catch (e) {
        console.warn("Aya Fetch Error:", e);
    }
}

async function downloadRelics() {
const loadEl = document.getElementById('loading');
    loadEl.style.display = 'flex';
    
    await fetchActiveResurgence();

    const CACHE_KEY = 'voidstonks_relics_v1';
    const CACHE_TIME = 30 * 24 * 60 * 60 * 1000; 
    
    const localData = localStorage.getItem(CACHE_KEY);
    let rawData = null;

    if (localData) {
        try {
            const parsed = JSON.parse(localData);
            if (Date.now() - parsed.timestamp < CACHE_TIME) {
                console.log("Cargando reliquias desde caché local...");
                rawData = parsed.data;
            }
        } catch(e) { localStorage.removeItem(CACHE_KEY); }
    }

    try {
        if (!rawData) {
            const response = await fetch(`${WORKER_URL}?type=relics`);
            if (!response.ok) throw new Error("Worker Error");
            rawData = await response.json();
            
            try {
                localStorage.setItem(CACHE_KEY, JSON.stringify({
                    timestamp: Date.now(),
                    data: rawData
                }));
            } catch(e) { console.warn("Quota exceeded for localStorage"); }
        }
        
        let relicsArray = (rawData.relics && Array.isArray(rawData.relics)) ? rawData.relics : [];
        let tempDB = {};
        let tempRelicDB = {};
        let tempStatusDB = {};
        let tempNamesSet = new Set(); 

        relicsArray.forEach(entry => {
            if (entry.state !== 'Intact') return;

            const fullName = `${entry.tier} ${entry.relicName}`;
            
            if (tempNamesSet.has(fullName)) return;
            tempNamesSet.add(fullName);

            const cleanNameUpper = fullName.toUpperCase(); 

            if (!tempRelicDB[fullName]) tempRelicDB[fullName] = [];

            let status = 'vaulted';
            if (activeResurgenceList.has(cleanNameUpper)) {
                status = 'aya';
            }
            else {
                 status = 'active'; 
            }

            tempStatusDB[fullName] = status;

            if (entry.rewards && Array.isArray(entry.rewards)) {
                entry.rewards.forEach(reward => {
                    const itemName = reward.itemName;
                    if (!itemName) return;
                    if (!tempDB[itemName]) tempDB[itemName] = [];
                    tempDB[itemName].push({ 
                        relic: fullName, tier: entry.tier, chance: reward.chance 
                    });
                    tempRelicDB[fullName].push({
                        name: itemName, chance: reward.chance, rarity: reward.rarity
                    });
                });
            }
        });

        const tempNames = Array.from(tempNamesSet).sort();
        itemsDatabase = tempDB;
        relicsDatabase = tempRelicDB;
        relicStatusDB = tempStatusDB;
        allRelicNames = tempNames;
        finishLoading();
    } catch (error) {
        console.error(error);
        document.getElementById('loadingText').innerText = TEXTS[currentLang].errLoad;
        showToast(TEXTS[currentLang].errLoad);
    }
}

async function fetchRivenWeapons() {
    try {
        const responses = await Promise.all(WEAPON_SOURCES.map(url => fetch(url).then(r => r.json())));
        const allWeapons = responses.flat();
        const unique = new Set();
        
        allWeapons.forEach(item => {
            if (item.name && !unique.has(item.name)) {
                unique.add(item.name);
                weaponMap[item.name] = getRivenSlug(item.name);
            }
        });
        
        allRivenNames = Array.from(unique).sort();
        
    } catch(e) { console.warn("Riven list failed", e); }
}

function handleRivenInput() {
    const val = document.getElementById('rivenWeaponInput').value;
    if (weaponMap[val]) {
        fetchRivenAverage(val);
    } else {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            if(val.length > 2) fetchRivenAverage(val);
        }, 800);
    }
}

async function fetchRivenAverage(weaponName) {
    if(!weaponName) return;
    let slug = getRivenSlug(weaponName);
    
    const fullUrl = `https://api.warframe.market/v1/auctions/search?type=riven&weapon_url_name=${slug}&sort_by=price_asc&buyout_policy=direct`; 
    
    const box = document.getElementById('riven-avg-box');
    const valSpan = document.getElementById('riven-avg-value');
    box.style.display = 'block';
    valSpan.innerText = '...';
    
    try {
        const res = await fetch(`${WORKER_URL}?type=riven&q=${slug}`);        
        if(!res.ok) throw new Error("Worker Error");
        
        const data = await res.json();
        
        const auctions = data.payload?.auctions || [];
        
        const prices = auctions
            .filter(a => a.visible && a.buyout_price > 0 && a.owner.status !== 'offline')
            .map(a => a.buyout_price);

        if(prices.length > 0) {
            prices.sort((a,b) => a - b);
            const subset = prices.slice(0, 20);
            const mid = Math.floor(subset.length / 2);
            const median = subset.length % 2 !== 0 ? subset[mid] : (subset[mid - 1] + subset[mid]) / 2;
            
            valSpan.innerText = Math.round(median);
        } else {
            valSpan.innerText = "N/A";
        }
    } catch(e) {
        console.error("Riven Fetch Error:", e);
        valSpan.innerText = "?";
    }
}

function populateRivenSelects() {
    const selects = document.querySelectorAll('.riven-stat-select');
    const isSpanish = (currentLang === 'es');
    selects.forEach(sel => { 
        while (sel.options.length > 1) { sel.remove(1); }
        RIVEN_STATS.forEach(stat => { 
            let opt = document.createElement('option'); 
            opt.value = stat.slug; 
            opt.innerText = isSpanish ? stat.name_es : stat.name_en; 
            sel.appendChild(opt); 
        }); 
    });
}

function openRivenMarket() {
    const inputVal = document.getElementById('rivenWeaponInput').value.trim();
    if(!inputVal) return alert("Please enter a weapon name");
    let slug = getRivenSlug(inputVal);
    let url = `https://warframe.market/auctions/search?type=riven&weapon_url_name=${slug}&polarity=any&sort_by=price_asc`;
    const stat1 = document.getElementById('rivenStat1').value;
    const stat2 = document.getElementById('rivenStat2').value;
    const stat3 = document.getElementById('rivenStat3').value;
    const statNeg = document.getElementById('rivenStatNeg').value;
    
    let positives = [];
    if(stat1) positives.push(stat1);
    if(stat2) positives.push(stat2);
    if(stat3) positives.push(stat3);
    
    if(positives.length > 0) url += `&positive_stats=${positives.join(',')}`;
    if(statNeg) url += `&negative_stats=${statNeg}`;
    
    window.open(url, '_blank');
}

function finishLoading() {
    document.getElementById('loading').style.display = 'none';
    
    document.getElementById('relicCount').innerText = `${allRelicNames.length} reliquias`;
    
    document.getElementById('mode-relic').classList.remove('hidden');
}

function handleRelicTyping() { 
    clearTimeout(debounceTimer); 
    currentActiveSet = null;
    document.getElementById('set-tracker').style.display = 'none';
    debounceTimer = setTimeout(() => { manualRelicUpdate(); }, 600); 
}

function handleSetTyping() { clearTimeout(debounceTimer); debounceTimer = setTimeout(() => { searchSet(); }, 1200); }

function updatePriceUI(element, price) {
    if (!element) return;
    element.classList.remove('loading');
    element.innerHTML = `${price}<span style="font-size:0.7em">pl</span>`;
    if(document.getElementById('relic-profit-display')) updateRelicTotal(); 
}

function updateRelicTotal() {
    if (!selectedRelic || !relicsDatabase[selectedRelic]) return;
    const items = relicsDatabase[selectedRelic];
    const badges = document.querySelectorAll('.price-badge:not(.big)');
    let total = 0; let pending = false;
    badges.forEach(div => {
        const name = div.getAttribute('data-item');
        const itemData = items.find(i => i.name === name);
        const priceText = div.innerText.replace('pl', '');
        if (div.classList.contains('loading')) { pending = true; } 
        else if (itemData) { const p = parseInt(priceText) || 0; total += p * (itemData.chance / 100); }
    });
    const disp = document.getElementById('relic-profit-display');
    disp.innerHTML = `~${total.toFixed(1)}<span style="font-size:0.7em">pl</span>`;
    if(!pending) disp.classList.remove('loading');
}

function activateSetTracker(setName, itemsInSet) {
    currentActiveSet = setName;
    activeSetParts = itemsInSet;
    completedParts = new Set();
    renderSetTracker();
}

function renderSetTracker() {
    const container = document.getElementById('set-tracker');
    const title = document.getElementById('tracker-title');
    const list = document.getElementById('tracker-list');
    const t = TEXTS[currentLang];
    if (!currentActiveSet) { container.style.display = 'none'; return; }
    container.style.display = 'block';
    title.innerText = `${t.trackerTitle}: ${currentActiveSet}`;
    list.innerHTML = '';
    activeSetParts.forEach(partName => {
        const isDone = completedParts.has(partName);
        const row = document.createElement('div');
        row.className = `tracker-item ${isDone ? 'done' : ''}`;
        const nameSpan = document.createElement('span');
        nameSpan.className = 't-name';
        nameSpan.innerText = partName.replace(currentActiveSet, '').trim() || partName; 
        if(partName === currentActiveSet) nameSpan.innerText = "Blueprint"; 
        
        nameSpan.onclick = () => { findRelicForPart(partName); };
        
        const checkBtn = document.createElement('button');
        checkBtn.className = 't-check';
        checkBtn.innerText = isDone ? t.markUndo : t.markDone;
        checkBtn.onclick = (e) => {
            e.stopPropagation();
            if(isDone) completedParts.delete(partName);
            else completedParts.add(partName);
            renderSetTracker();
        };
        row.appendChild(nameSpan);
        row.appendChild(checkBtn);
        list.appendChild(row);
    });
}

function findRelicForPart(partName) {
    const relics = itemsDatabase[partName];
    if (!relics || relics.length === 0) {
        showToast(TEXTS[currentLang].notFound);
        return;
    }

    switchTab('relic');
    
    document.getElementById('relicInput').value = "";
    const profitDisp = document.getElementById('relic-profit-display');
    if(profitDisp) {
        profitDisp.innerHTML = ""; 
        profitDisp.classList.remove('loading');
    }
    
document.getElementById('lbl-content').innerText = TEXTS[currentLang].lblRelicFor + partName;       
    const container = document.getElementById('relic-contents');
    const listDiv = document.getElementById('relic-drops-list');
    container.style.display = 'block';
    listDiv.innerHTML = "";

    relics.sort((a,b) => {
        const sA = relicStatusDB[a.relic] === 'active' ? 2 : (relicStatusDB[a.relic] === 'aya' ? 1 : 0);
        const sB = relicStatusDB[b.relic] === 'active' ? 2 : (relicStatusDB[b.relic] === 'aya' ? 1 : 0);
        if(sA !== sB) return sB - sA;
        return a.relic.localeCompare(b.relic);
    });

    const t = TEXTS[currentLang];
    const abbr = t.rarityAbbr;

    const grid = document.createElement('div');
    grid.className = 'relic-grid';
    
    relics.forEach(r => {
        let rarityLabel = abbr.common;
        let rarityClass = 'common';
        if(r.chance <= 5) { rarityLabel = abbr.rare; rarityClass = 'rare'; }
        else if(r.chance <= 22) { rarityLabel = abbr.uncommon; rarityClass = 'uncommon'; }

        const status = relicStatusDB[r.relic] || 'vaulted';
        const statusTxt = t[status] || t.vaulted;
        const tier = r.tier || r.relic.split(' ')[0];
        const imgUrl = TIER_URLS[tier] || TIER_URLS['Lith'];

        const chip = document.createElement('div');
        chip.className = `relic-chip ${rarityClass}`;
        
        chip.innerHTML = `
            <div class="relic-chip-header">
                <span class="relic-name">${r.relic}</span>
                <img src="${imgUrl}" class="relic-img" alt="${tier}">
            </div>
            <div class="chip-footer">
                <span class="rarity-text ${rarityClass}">${rarityLabel}</span>
                <span class="status-badge ${status}">${statusTxt}</span>
            </div>
        `;

        chip.onclick = () => {
            document.getElementById('relicInput').value = r.relic;
            manualRelicUpdate();
            document.getElementById('lbl-content').innerText = t.lblContent;
        };

        grid.appendChild(chip);
    });
    
    listDiv.appendChild(grid);
}

function manualRelicUpdate() { 
    selectedRelic = document.getElementById('relicInput').value; 
    generateMessage(); 
    const container = document.getElementById('relic-contents');
    const listDiv = document.getElementById('relic-drops-list');
    const profitDisplay = document.getElementById('relic-profit-display');
    listDiv.innerHTML = "";
    profitDisplay.innerText = "...";
    profitDisplay.classList.add('loading');
    const abbr = TEXTS[currentLang].rarityAbbr;
    if (selectedRelic && relicsDatabase[selectedRelic]) {
        container.style.display = 'block';
        const items = relicsDatabase[selectedRelic];
        items.sort((a,b) => b.chance - a.chance);
        items.forEach(item => {
            const row = document.createElement('div');
            row.className = 'component-row';
            row.style.display = 'flex'; row.style.justifyContent = 'space-between'; row.style.alignItems = 'center';
            const isForma = item.name === "Forma Blueprint";
            let rarityColor = "var(--wf-common)"; 
            let rarityLabel = abbr.common;
            if (item.chance <= 5) { rarityColor = "var(--wf-rare)"; rarityLabel = abbr.rare; }
            else if (item.chance <= 22) { rarityColor = "var(--wf-uncommon)"; rarityLabel = abbr.uncommon; }
            if (isForma) rarityColor = "var(--wf-forma)";
            let nameDisplay = `<span class="component-name">${item.name}</span>`;
            if(isForma) nameDisplay = `<span style="font-weight:bold; color:var(--wf-forma);"> Forma BP</span>`;
            else {
                const slug = getSlug(item.name);
                const marketUrl = `https://warframe.market/items/${slug}`;
                nameDisplay = `<a href="${marketUrl}" target="_blank" rel="noopener noreferrer" class="market-link">${item.name}<span class="link-icon">↗</span></a>`;
            }
            const badgeContent = isForma ? '0<span style="font-size:0.7em">pl</span>' : '...';
            const badgeClass = isForma ? 'price-badge forma' : 'price-badge loading';
            row.innerHTML = `
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="color:${rarityColor}; font-weight:bold; font-size:0.8em; width:25px;">${rarityLabel}</span>
                    <span style="color:${isForma ? '#aaa' : '#eee'}; font-size:0.9em;">${nameDisplay}</span>
                </div>
                <div class="${badgeClass}" data-item="${item.name.replace(/"/g, '&quot;')}">${badgeContent}</div>
            `;
            listDiv.appendChild(row);
            const badge = row.querySelector('.price-badge');
            if (!isForma) addToQueue(item.name, badge);
        });
        renderSetTracker();
    } else { container.style.display = 'none'; }
}

function searchSet() {
    const query = document.getElementById('setItemInput').value.toLowerCase().trim();
    const container = document.getElementById('setResults');
    container.innerHTML = "";
    if (query.length < 2) return;
    const dbKeys = Object.keys(itemsDatabase);
    const matches = dbKeys.filter(k => k.toLowerCase().includes(query)).sort();
    const groups = {};
    const singles = [];
    matches.forEach(key => {
        let baseName = null;
        if (key.includes("Prime")) { const parts = key.split("Prime"); if (parts.length > 0) baseName = parts[0].trim() + " Prime"; }
        else if (key.includes("Vandal")) baseName = key.split("Vandal")[0].trim() + " Vandal";
        else if (key.includes("Wraith")) baseName = key.split("Wraith")[0].trim() + " Wraith";
        if (baseName) { if (!groups[baseName]) groups[baseName] = []; groups[baseName].push(key); } 
        else { singles.push(key); }
    });
    if (Object.keys(groups).length === 0 && singles.length === 0) {
        container.innerHTML = `<div style="text-align:center;color:#666;margin-top:20px">${TEXTS[currentLang].notFound}</div>`;
        container.style.display = 'block';
        return;
    }
    Object.keys(groups).sort().forEach(setName => {
        const itemsInGroup = groups[setName];
        itemsInGroup.sort((a, b) => {
            if (a.includes("Blueprint") && !b.includes("Blueprint")) return -1;
            if (!a.includes("Blueprint") && b.includes("Blueprint")) return 1;
            return a.localeCompare(b);
        });
        createSetCard(setName, itemsInGroup, container, false);
    });
    singles.slice(0, 10).forEach(itemName => { createSetCard(itemName, [itemName], container, true); });
    container.style.display = 'block';
}

function createSetCard(title, itemNames, parent, isSingle = false) {
    const setContainer = document.createElement('div');
    setContainer.className = 'set-container';
    
    // Header del Set
    const header = document.createElement('div');
    header.className = 'set-header';
    let titleSpan;
    if (!isSingle) {
        const slug = getSlug(title + " Set");
        const marketUrl = `https://warframe.market/items/${slug}`;
        titleSpan = document.createElement('a');
        titleSpan.href = marketUrl;
        titleSpan.target = "_blank";
        titleSpan.rel = "noopener noreferrer";
        titleSpan.className = "market-link";
        titleSpan.innerHTML = `${title} SET<span class="link-icon">↗</span>`;
    } else { titleSpan = document.createElement('span'); titleSpan.innerText = title; }
    header.appendChild(titleSpan);
    
    if (!isSingle) {
        const setPriceSpan = document.createElement('span');
        setPriceSpan.className = 'price-badge loading';
        setPriceSpan.innerText = "...";
        header.appendChild(setPriceSpan);
        addToQueue(title + " Set", setPriceSpan);
    }
    setContainer.appendChild(header);

    // Items del Set
    itemNames.forEach(itemName => {
        if (!isSingle && !itemName.includes(title)) return;
        const relicsInfo = itemsDatabase[itemName] || [];
        
        const itemWrapper = document.createElement('div');
        if(relicsInfo.length > 0) itemWrapper.style.paddingBottom = "10px"; 

        const row = document.createElement('div');
        row.className = 'component-row'; 
        
        const compHeader = document.createElement('div');
        compHeader.className = 'component-header';
        let displayName = itemName;
        if (!isSingle && itemName.startsWith(title)) displayName = itemName.replace(title, "").trim();
        const slug = getSlug(itemName);
        const marketUrl = `https://warframe.market/items/${slug}`;
        compHeader.innerHTML = `<a href="${marketUrl}" target="_blank" rel="noopener noreferrer" class="market-link"><span class="component-name">${displayName}</span><span class="link-icon">↗</span></a>`;
        
        const itemPriceSpan = document.createElement('span');
        itemPriceSpan.className = 'price-badge loading';
        itemPriceSpan.innerText = "...";
        addToQueue(itemName, itemPriceSpan);
        
      row.appendChild(compHeader);
        row.appendChild(itemPriceSpan);
        
        if(relicsInfo.length === 0) {
            const noRelicInfo = document.createElement('div');
            noRelicInfo.style.color = "#666"; noRelicInfo.style.fontSize = "0.8em"; noRelicInfo.style.fontStyle = "italic";
            noRelicInfo.innerText = "Vaulted / Baro";
            row.appendChild(noRelicInfo);
        }

        itemWrapper.appendChild(row);

        if(relicsInfo.length > 0) {
            const grid = document.createElement('div'); 
            grid.className = 'relic-grid';
            grid.style.padding = "0 10px"; 
            
            relicsInfo.sort((a,b) => a.relic.localeCompare(b.relic));
            const abbr = TEXTS[currentLang].rarityAbbr;
            
            relicsInfo.forEach(info => {
                const btn = document.createElement('div'); 
                let rarityClass = 'common'; let rarityLabel = abbr.common;
                if (info.chance) {
                    if (info.chance <= 5) { rarityClass = 'rare'; rarityLabel = abbr.rare; }
                    else if (info.chance <= 22) { rarityClass = 'uncommon'; rarityLabel = abbr.uncommon; }
                }
                const tier = info.tier || info.relic.split(' ')[0];
                const imgUrl = TIER_URLS[tier] || TIER_URLS['Lith'];
                const relicStatus = relicStatusDB[info.relic]; 
                let statusClass = relicStatus || 'vaulted';
                let statusText = TEXTS[currentLang][statusClass] || TEXTS[currentLang].vaulted;
                
                btn.className = `relic-chip ${rarityClass}`;
                btn.innerHTML = `
                    <div class="relic-chip-header">
                        <span class="relic-name">${info.relic}</span>
                        <img src="${imgUrl}" class="relic-img" alt="${tier}">
                    </div>
                    <div class="chip-footer">
                        <span class="rarity-text ${rarityClass}">${rarityLabel}</span>
                        <span class="status-badge ${statusClass}">${statusText}</span>
                    </div>
                `;
                btn.onclick = () => { 
                    if (!isSingle) activateSetTracker(title, itemNames);
                    selectedRelic = info.relic; 
                    document.getElementById('relicInput').value = info.relic;
                    manualRelicUpdate(); 
                    const refSelect = document.getElementById('refinement');
                    if(rarityClass === 'rare') refSelect.value = "Rad";
                    else if(rarityClass === 'uncommon') refSelect.value = "Rad"; 
                    else refSelect.value = "Intact";
                    switchTab('relic'); 
                    generateMessage();
                };
                grid.appendChild(btn);
            });
            itemWrapper.appendChild(grid);
        }
        
        setContainer.appendChild(itemWrapper);
    });
    parent.appendChild(setContainer);
}

function changeCount(n) { playerCount = Math.max(1, Math.min(4, playerCount + n)); document.getElementById('countDisplay').innerText = playerCount; generateMessage(); }
function generateMessage() { 
    const rName = selectedRelic || TEXTS[currentLang].defaultRelic;
    const refVal = document.getElementById('refinement').value;
    const refText = document.querySelector(`#refinement option[value="${refVal}"]`).innerText;
    document.getElementById('finalMessage').innerText = `H [${rName}] ${refText} ${playerCount}/4`; 
}
function copyText() { navigator.clipboard.writeText(document.getElementById('finalMessage').innerText); showToast(TEXTS[currentLang].msgCopied); }

function switchTab(mode) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('btn-' + mode).classList.add('active');
    ['relic', 'set', 'riven', 'profile'].forEach(m => document.getElementById('mode-' + m).classList.add('hidden'));
    document.getElementById('mode-' + mode).classList.remove('hidden');
    document.getElementById('footer-relic').style.display = (mode === 'relic') ? 'block' : 'none';
    
    const card = document.getElementById('main-card');
    card.classList.remove('theme-relic', 'theme-set', 'theme-riven', 'theme-profile');
    card.classList.add('theme-' + mode);
}

function changeLanguage() {
    currentLang = document.getElementById('langSelect').value;
    const t = TEXTS[currentLang];
    document.getElementById('txt-header-title').innerText = t.headerTitle;
    document.getElementById('txt-header-sub').innerText = t.headerSub;
    document.getElementById('lbl-profit').innerText = t.lblProfit;
    document.getElementById('lbl-content').innerText = t.lblContent;
    document.getElementById('txt-footer-data').innerText = t.footerData;
    document.getElementById('txt-contact-label').innerText = t.contactLabel;
    document.getElementById('txt-contact-link').innerText = t.contactLink;
    document.getElementById('btn-relic').innerText = t.tab1;
    document.getElementById('btn-set').innerText = t.tab2;
    document.getElementById('btn-riven').innerText = t.tab3;
    document.getElementById('btn-profile').innerText = t.tab4;
    document.getElementById('lbl-relic-name').innerText = t.lblRelic;
    document.getElementById('relicInput').placeholder = t.phRelic;
    document.getElementById('lbl-search-item').innerText = t.lblItem;
    document.getElementById('setItemInput').placeholder = t.phItem;
    document.getElementById('lbl-refinement').innerText = t.lblRef;
    document.getElementById('lbl-missing').innerText = t.lblMiss;
    document.getElementById('btn-copy').innerText = t.btnCopy;
    document.getElementById('lbl-riven-weapon').innerText = t.lblRivenW;
    document.getElementById('rivenWeaponInput').placeholder = t.phRivenW;
    document.getElementById('lbl-riven-stats').innerText = t.lblRivenS;
    document.getElementById('btn-riven-search').innerText = t.rivenSearch;
    document.getElementById('lbl-username').innerText = t.lblUser;
    document.querySelector('#mode-profile button').innerText = t.btnCheck;
    document.getElementById('txt-disclaimer').innerHTML = t.disclaimer;
    document.getElementById('txt-mr-label').innerText = t.lblMrCalc;
    document.querySelector('#rivenStatNeg option[value=""]').innerText = t.lblRivenNeg;
    const refSel = document.getElementById('refinement');
    Array.from(refSel.options).forEach(opt => {
        const key = opt.getAttribute('data-key');
        if(t.refs[key]) opt.innerText = t.refs[key];
    });
    
    populateRivenSelects();
    
    if (currentActiveSet) renderSetTracker();
    if (selectedRelic) manualRelicUpdate();
    
    generateMessage();
}
function populateRivenSelects() {
    const selects = document.querySelectorAll('.riven-stat-select');
    const isSpanish = (currentLang === 'es');
    
    selects.forEach(sel => { 
        while (sel.options.length > 1) { sel.remove(1); }
        RIVEN_STATS.forEach(stat => { 
            let opt = document.createElement('option'); 
            opt.value = stat.slug; 
            opt.innerText = isSpanish ? stat.name_es : stat.name_en; 
            sel.appendChild(opt); 
        }); 
    });
}
function openRivenMarket() {
    const inputVal = document.getElementById('rivenWeaponInput').value.trim();
    if(!inputVal) return alert("Please enter a weapon name");
    
    let slug = getRivenSlug(inputVal); 
    
    let url = `https://warframe.market/auctions/search?type=riven&weapon_url_name=${slug}&polarity=any&sort_by=price_asc`;
    
    const stat1 = document.getElementById('rivenStat1').value;
    const stat2 = document.getElementById('rivenStat2').value;
    const stat3 = document.getElementById('rivenStat3').value;
    const statNeg = document.getElementById('rivenStatNeg').value;
    
    let positives = [];
    if(stat1) positives.push(stat1);
    if(stat2) positives.push(stat2);
    if(stat3) positives.push(stat3);
    
    if(positives.length > 0) url += `&positive_stats=${positives.join(',')}`;
    if(statNeg) url += `&negative_stats=${statNeg}`;
    
    window.open(url, '_blank');
}
const relicDropdown = document.getElementById('relicDropdown');

function handleRelicTyping() {
    const input = document.getElementById('relicInput');
    const val = input.value.toUpperCase().trim();
    
    if (val.length < 1) {
        relicDropdown.classList.add('hidden');
        return;
    }

    const matches = allRelicNames.filter(name => name.toUpperCase().includes(val)).slice(0, 10);

    if (matches.length > 0) {
        renderRelicDropdown(matches);
    } else {
        relicDropdown.classList.add('hidden');
    }

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(manualRelicUpdate, 600);
}
const rivenDropdown = document.getElementById('rivenDropdown');

function handleRivenInput() {
    const input = document.getElementById('rivenWeaponInput');
    const val = input.value.toUpperCase().trim();
    
    if (val.length < 1) {
        rivenDropdown.classList.add('hidden');
        document.getElementById('riven-avg-box').style.display = 'none';
        return;
    }

    const matches = allRivenNames.filter(name => name.toUpperCase().includes(val)).slice(0, 10);
    
    if (matches.length > 0) {
        renderRivenDropdown(matches);
    } else {
        rivenDropdown.classList.add('hidden');
    }

    if (weaponMap[input.value]) {
        rivenDropdown.classList.add('hidden');
        fetchRivenAverage(input.value); 
    }
}

function selectRivenFromDropdown(name) {
    const input = document.getElementById('rivenWeaponInput');
    input.value = name;
    rivenDropdown.classList.add('hidden');
    
    fetchRivenAverage(name);
}

function renderRivenDropdown(list) {
    rivenDropdown.innerHTML = '';
    rivenDropdown.classList.remove('hidden');
    list.forEach(name => {
        const item = document.createElement('div');
        item.className = 'dropdown-item';
        item.innerText = name;
        item.onclick = () => selectRivenFromDropdown(name);
        rivenDropdown.appendChild(item);
    });
}

function selectRivenFromDropdown(name) {
    const input = document.getElementById('rivenWeaponInput');
    input.value = name;
    rivenDropdown.classList.add('hidden');
    fetchRivenAverage(name); 
}
function renderRelicDropdown(list) {
    relicDropdown.innerHTML = '';
    relicDropdown.classList.remove('hidden');

    list.forEach(name => {
        const item = document.createElement('div');
        item.className = 'dropdown-item';
        item.innerText = name;
        item.onclick = () => selectRelicFromDropdown(name);
        relicDropdown.appendChild(item);
    });
}

function selectRelicFromDropdown(name) {
    const input = document.getElementById('relicInput');
    input.value = name;
    relicDropdown.classList.add('hidden');
    
    manualRelicUpdate();
}

document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-search-container')) {
        document.getElementById('relicDropdown').classList.add('hidden');
        document.getElementById('rivenDropdown').classList.add('hidden');
    }
});
init();