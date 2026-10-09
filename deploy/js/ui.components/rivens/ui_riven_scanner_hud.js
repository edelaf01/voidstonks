import { state } from "../../state.js";
import { TEXTS } from "../../config.js";
import { escapeHTML } from "../ui_components.js";
import { consejoCicloHtml, combinarOverlay, combinarCartaHtml, objetivoDelArma, objetivoFusionHtml, NEG_INOFENSIVOS } from "./ui_riven_cycling.js";
import { objetivoFusion, fijaObjetivoFusion } from "../../utils/rivens/riven_objetivo_fusion.js";
import { claveStat, tipoDeArma, esFusionado, pesoFusionado } from "../../utils/rivens/riven_cycling.js";
import { textoDelStat } from "../../utils/rivens/riven_stat_display.js";
import { statsBuscadosDelArma } from "../../services/rivens/riven_appraisal.service.js";
import { avisa, escucha } from "../../utils/ganchos.js";

const CALIDAD_POSITIVO = { S: ["TOP", "TOP", "oro"], A: ["BUENO", "GOOD", "naranja"], B: ["MEDIO", "MID", "cian"] };

function calidadDelStat(ge, isEs) {
    if (!ge) return null;
    if (!ge.isPositive) return { texto: ge.label, tono: ge.badness < 0.4 ? "verde" : ge.badness < 0.7 ? "naranja" : "rojo" };
    const [es, en, tono] = CALIDAD_POSITIVO[ge.tier] || ["FLOJO", "WEAK", "gris"];
    return { texto: isEs ? es : en, tono };
}

const AVISO_BANDA = {
    trash: {
        es: "Roll de gama baja: precio orientativo (usa la banda, no el valor único).",
        en: "Low-end roll: ballpark price (use the band, not the single value).",
    },
    pocosDatos: {
        es: "Pocos datos del arma: precio orientativo.",
        en: "Little data for this weapon: ballpark price.",
    },
};

export const RivenScannerHUD = {
    container: null,
    lastL: null,
    lastR: null,
    lastCapture: null, // crop canvas: the PNG is only encoded when opened

    init() {
        if (this.container) return;

        this.container = document.createElement("div");
        this.container.id = "riven-appraisal-hud";
        this.container.style.cssText = `
            display: none;
            position: fixed;
            top: 60px;
            right: 20px;
            width: 320px;
            z-index: 2147483647;
            font-family: "Segoe UI", system-ui, sans-serif;
            user-select: none;
            color: #e0e0e0;
        `;
        document.body.appendChild(this.container);
        globalThis.RivenScannerHUD = this;

        this._initDragEvents();
        escucha("overlay-riven", (accion) => {
            const [clave, valor] = String(accion).split(":");
            if (clave === "fusion") this.fijaFusion(valor, true).catch(console.warn);
        });
    },

    async fijaFusion(valor, alternar = false) {
        const arma = (this.lastL || this.lastR)?.weaponName;
        if (!arma) return;
        const indice = valor === "" || valor == null ? null : Number(valor);
        fijaObjetivoFusion(arma, alternar && indice === objetivoFusion(arma) ? null : indice);
        if (this.lastL && this.lastR) await this._renderComparison(this.lastL, this.lastR);
        else await this._renderSingle(this.lastL || this.lastR);
    },

    toggleCollapse() {
        if (!this.container) return;
        const body = this.container.querySelector(".riven-hud-body");
        if (body) {
            body.style.display = body.style.display === "none" ? "block" : "none";
        }
    },

    _initDragEvents() {
        // drag with translate3d and requestAnimationFrame: moving left/top reflows the blurred panel on every
        // move. Mouse and touch
        let dragging = false;
        let startX = 0, startY = 0;     // pointer at start
        let baseLeft = 0, baseTop = 0;  // panel corner at start
        let curX = 0, curY = 0;         // last pointer
        let rafId = null;

        const onFrame = () => {
            rafId = null;
            if (!dragging) return;
            this.container.style.transform = `translate3d(${curX - startX}px, ${curY - startY}px, 0)`;
        };
        const schedule = () => { if (rafId === null) rafId = requestAnimationFrame(onFrame); };

        const start = (clientX, clientY, target) => {
            const handle = target && target.closest && target.closest(".riven-hud-header");
            if (!handle || (target.classList && target.classList.contains("close-btn"))) return false;
            const rect = this.container.getBoundingClientRect();
            baseLeft = rect.left; baseTop = rect.top;
            startX = curX = clientX; startY = curY = clientY;
            // pin left/top so the transform has a stable origin
            this.container.style.left = baseLeft + "px";
            this.container.style.top = baseTop + "px";
            this.container.style.right = "auto";
            this.container.style.willChange = "transform";
            dragging = true;
            handle.style.cursor = "grabbing";
            return true;
        };
        const move = (clientX, clientY) => {
            if (!dragging) return;
            curX = clientX; curY = clientY;
            schedule();
        };
        const end = () => {
            if (!dragging) return;
            dragging = false;
            this.container.style.left = (baseLeft + (curX - startX)) + "px";
            this.container.style.top = (baseTop + (curY - startY)) + "px";
            this.container.style.transform = "";
            this.container.style.willChange = "";
            const handle = this.container.querySelector(".riven-hud-header");
            if (handle) handle.style.cursor = "grab";
        };

        this.container.addEventListener("mousedown", (e) => { if (start(e.clientX, e.clientY, e.target)) e.preventDefault(); });
        document.addEventListener("mousemove", (e) => move(e.clientX, e.clientY));
        document.addEventListener("mouseup", end);
        this.container.addEventListener("touchstart", (e) => {
            const t = e.touches[0];
            if (t && start(t.clientX, t.clientY, e.target)) e.preventDefault();
        }, { passive: false });
        document.addEventListener("touchmove", (e) => {
            if (!dragging) return;
            const t = e.touches[0];
            if (t) { move(t.clientX, t.clientY); e.preventDefault(); }
        }, { passive: false });
        document.addEventListener("touchend", end);
    },

    dismiss() {
        if (this.container) {
            this.container.style.display = "none";
        }
        avisa("riven", null);
        this.lastL = null;
        this.lastR = null;
        this.lastCapture = null;
        if (globalThis.ScannerService) {
            globalThis.ScannerService.lastParsedL = null;
            globalThis.ScannerService.lastParsedR = null;
            globalThis.ScannerService.lastHashL = null;
        }
    },

    async show(parsedL, parsedR, captura) {
        this.init();
        this.lastL = parsedL;
        this.lastR = parsedR;
        this.lastCapture = captura;

        // the weekly history feeds calculateHybridTiers and the ML hist_* features: first pass without it,
        // re-render when it arrives
        this._ensureHistory((parsedL || parsedR)?.weaponName);

        if (parsedL && parsedR) {
            await this._renderComparison(parsedL, parsedR);
        } else {
            // no parsed card (OCR failed this frame): keep what is shown and wait for the next frame
            const activeCard = parsedL || parsedR;
            if (!activeCard) return;
            await this._renderSingle(activeCard);
        }

        this.container.style.display = "block";
        const handle = this.container.querySelector(".riven-hud-header");
        if (handle) handle.style.cursor = "grab";
    },

    async _ensureHistory(weaponName) {
        if (!weaponName) return;
        const cur = state.currentWeaponHistory;
        if (cur && cur.weaponName === weaponName) return; // already loaded or loading
        state.currentWeaponHistory = { weaponName, data: [], loading: true };
        try {
            const { fetchWeaponHistory } = await import("../../repositories/riven.repository.js");
            const data = await fetchWeaponHistory(weaponName);
            if (state.currentWeaponHistory?.weaponName !== weaponName) return; // the user switched weapons
            state.currentWeaponHistory = { weaponName, data: data || [], loading: false };
            const stillShown = this.lastL?.weaponName === weaponName || this.lastR?.weaponName === weaponName;
            if (stillShown && this.container && this.container.style.display !== "none") {
                if (this.lastL && this.lastR) await this._renderComparison(this.lastL, this.lastR);
                else if (this.lastL || this.lastR) await this._renderSingle(this.lastL || this.lastR);
            }
        } catch (e) {
            console.warn("[HUD] no se pudo cargar el historial de " + weaponName, e);
            if (state.currentWeaponHistory?.weaponName === weaponName) {
                state.currentWeaponHistory.loading = false;
            }
        }
    },

    toggleCapture() {
        if (!this.container) return;
        const cap = this.container.querySelector(".hud-capture");
        if (cap) {
            const img = cap.querySelector("img");
            if (img && !img.getAttribute("src") && this.lastCapture) img.src = this.lastCapture.toDataURL("image/png");
            cap.style.display = cap.style.display === "none" ? "block" : "none";
        }
    },

    downloadCapture() {
        if (!this.lastCapture) return;
        const a = document.createElement("a");
        a.href = this.lastCapture.toDataURL("image/png");
        a.download = `riven_capture_${Date.now()}.png`;
        a.click();
    },

    // how wanted the stat is on this weapon, regardless of the roll. Positive: TOP/GOOD/MID/WEAK by
    // weight. Negative: NEG OK or BRICK
    _statDesirability(meta, name, isPositive) {
        if (!meta) return null;
        const nl = (name || "").toLowerCase();
        const typeIdx = tipoDeArma(meta.t);
        const clave = claveStat(name, typeIdx);
        const match = (m) => {
            // the scanner reads "Crit Chance" and the meta says "Critical Chance"
            if (clave) return claveStat(m, typeIdx) === clave;
            const ml = (m || "").toLowerCase();
            if (ml === "damage") return nl === "damage" || nl.includes("base damage") || nl.includes("melee damage");
            return nl.includes(ml) || ml.includes(nl);
        };
        if (!isPositive) {
            const brick = (Array.isArray(meta.pos) && meta.pos.some(match)) || (Array.isArray(meta.midPos) && meta.midPos.some(match));
            if (brick) return { label: "BRICK", color: "#ff4d4d" };
            const harmless = (Array.isArray(meta.neg) && meta.neg.some(match))
                || NEG_INOFENSIVOS.some(t => nl.includes(t.toLowerCase()));
            if (harmless) return { label: "NEG OK", color: "#00d18f" };
            return { label: "NEG", color: "#ff8c00" };
        }
        let w = esFusionado(name, typeIdx)
            ? pesoFusionado(name, meta.dynamic_weights, typeIdx)
                ?? pesoFusionado(name, Object.fromEntries([
                    ...(Array.isArray(meta.midPos) ? meta.midPos : []).map((m) => [m, 0.5]),
                    ...(Array.isArray(meta.pos) ? meta.pos : []).map((m) => [m, 0.9]),
                ]), typeIdx)
                ?? 0.1
            : null;
        if (w === null && meta.dynamic_weights) {
            const k = Object.keys(meta.dynamic_weights).find(match);
            if (k) w = parseFloat(meta.dynamic_weights[k]);
        }
        if (w === null || isNaN(w)) {
            if (Array.isArray(meta.pos) && meta.pos.some(match)) w = 0.9;
            else if (Array.isArray(meta.midPos) && meta.midPos.some(match)) w = 0.5;
            else w = 0.1;
        }
        if (w >= 0.70) return { label: "TOP", color: "#00ff88" };
        if (w >= 0.40) return { label: "GOOD", color: "#00e5ff" };
        if (w >= 0.15) return { label: "MID", color: "#a879ec" };
        return { label: "WEAK", color: "#ff6b6b" };
    },

    // what to lock before cycling (Update 44)
    _cicloDatos(riven, meta, calculateRivenGrade) {
        if (!meta || !riven?.stats?.length) return null;
        const tipo = meta.t || state.weaponMap?.[riven.weaponName]?.t;
        const { buscados, negOk, pesos } = objetivoDelArma(meta, tipo, statsBuscadosDelArma(meta, riven.weaponName));
        const posCount = riven.stats.filter(x => x.isPositive).length;
        const hasNeg = riven.stats.some(x => !x.isPositive);
        const stats = riven.stats.map(s => ({
            ...s, calidad: calculateRivenGrade(meta, s.name, s.value, !s.isPositive, posCount, hasNeg)?.pct,
        }));
        return { stats, rolls: riven.rolls, tipo, buscados, negOk, pesos };
    },

    _cicloHtml(riven, meta, calculateRivenGrade, isEs, rotulo = "") {
        const datos = this._cicloDatos(riven, meta, calculateRivenGrade);
        return datos ? consejoCicloHtml({ ...datos, isEs, rotulo, conCombinar: false }) : "";
    },

    _combinarOverlay(riven, meta, calculateRivenGrade, isEs) {
        if (!riven?.stats?.length) return null;
        const datos = this._cicloDatos(riven, meta, calculateRivenGrade)
            || { stats: riven.stats, rolls: riven.rolls, tipo: state.weaponMap?.[riven.weaponName]?.t, buscados: [], negOk: [] };
        return combinarOverlay({ ...datos, isEs, objetivo: objetivoFusion(riven.weaponName) });
    },

    async _renderSingle(riven) {
        // the inline width overrides the CSS, so the mobile clamp lives here
        if (this.container) this.container.style.width = "min(330px, calc(100vw - 16px))";
        const isEs = state.currentLang === "es";
        const t = TEXTS[state.currentLang]?.rivenHud || TEXTS.en.rivenHud;
        // one shared appraisal for the riven tab, this HUD and the comparison, so a riven prices the same
        // everywhere
        const { calculateRivenGrade } = await import("../../utils/rivens/riven_logic.js");
        const { appraiseParsedRiven } = await import("../../services/rivens/riven_appraisal.service.js");

        const appraisal = appraiseParsedRiven(riven.weaponName, riven.stats);
        const meta = appraisal?.meta;
        const typeIdx = tipoDeArma(meta?.t || state.weaponMap?.[riven.weaponName]?.t);
        let heroHtml = "";
        let metricsHtml = "";
        let gradeStats = null;
        const espejo = { arma: riven.weaponName };

        if (appraisal) {
            const tiers = appraisal.tiers;
            const prediction = appraisal.prediction;
            Object.assign(espejo, { valor: prediction.estimatedValue, min: prediction.suggestedMin, max: prediction.suggestedMax });

            const platIcon = '<img src="assets/relic_contents/platinum.webp" style="width: 14px; vertical-align: middle; margin-bottom: 2px;">';
            let mlChip = "";
            let gradeHero = "";

            // ML appraisal, anchored to the robust band (DE history)
            try {
                const ML = await import("../../utils/rivens/riven_ml.js");
                const itemAttributes = appraisal?.itemAttributes || [];
                const _w = meta || { name: riven.weaponName };
                const _bq = await ML.predictRivenMLBand(_w, itemAttributes, meta, riven.rolls || 0, appraisal?.prediction?.adjustedScore);
                prediction.mlEstimate = _bq.p50;
                prediction.mlBand = _bq;
                const _warn = _bq.confianza === "baja" ? " !" : "";
                const _mlTitle = (isEs
                    ? `Según la IA: venta rápida ~${_bq.p25}p · precio justo ~${_bq.p50}p · godroll ~${_bq.p95}p`
                    : `Per the AI: quick sale ~${_bq.p25}p · fair price ~${_bq.p50}p · godroll ~${_bq.p95}p`)
                    + (_bq.aviso ? ` · ${AVISO_BANDA[_bq.aviso][isEs ? "es" : "en"]}` : "");
                mlChip = `
                    <div class="hud-chip ml" title="${_mlTitle}">
                        <span>${isEs ? "IA" : "AI"}${_warn}</span>
                        <strong>~${_bq.p50}${platIcon}</strong>
                        <em>(${_bq.p25}–${_bq.p95})</em>
                    </div>
                `;
                const _g = await ML.gradeRiven(riven.weaponName, riven.stats);
                gradeStats = _g.stats;
                Object.assign(espejo, { grado: _g.grade, score: _g.score });
                const _gc = _g.grade === "S" ? "#ffd700" : _g.grade === "A" ? "#ff8c00" : _g.grade === "B" ? "#00e5ff" : _g.grade === "C" ? "#a879ec" : "#ff4d4d";
                gradeHero = `
                    <div class="hud-hero-grade" style="--gc:${_gc};" title="${isEs ? "Grado (arma)" : "Grade (weapon)"}">
                        <span class="letter">${_g.grade}</span>
                        <span class="sub">${_g.score}/100</span>
                    </div>
                `;
            } catch (e) { console.warn("[ML hud] error:", e); }

            const histLoading = state.currentWeaponHistory?.weaponName === riven.weaponName && state.currentWeaponHistory.loading;
            const histHint = histLoading
                ? `<span title="${isEs ? "Actualizando con historial de precios…" : "Updating with price history…"}" style="cursor:help;"> ⏳</span>`
                : "";
            heroHtml = `
                <div class="hud-hero">
                    <div class="hud-hero-price">
                        <span class="lbl">${isEs ? "VALOR ESTIMADO" : "ESTIMATED VALUE"}${histHint}</span>
                        <span class="val">${prediction.estimatedValue}${platIcon}</span>
                        <span class="range">(${prediction.suggestedMin} - ${prediction.suggestedMax}${platIcon})</span>
                    </div>
                    ${gradeHero}
                </div>
            `;

            metricsHtml = `
                <div class="hud-metrics-row">
                    <div class="hud-chip" title="${isEs ? "Lo que vale si el roll es malo (para fusionar o revender barato)." : "What it's worth if the roll is bad (fusion fodder / cheap resale)."}"><span>TRASH</span><strong>~${tiers.trash}${platIcon}</strong></div>
                    <div class="hud-chip" title="${isEs ? "Precio normal de un roll decente ya rerolleado en esta arma." : "Typical price of a decent rerolled roll on this weapon."}"><span>GOOD</span><strong>~${tiers.goodReroll}${platIcon}</strong></div>
                    <div class="hud-chip" title="${isEs ? "Techo realista de esta arma con el roll perfecto (ventas reales, no asks troll)." : "Realistic ceiling for this weapon with the perfect roll (real sales, not troll asks)."}"><span>GODROLL</span><strong>~${tiers.godroll}${platIcon}</strong></div>
                    ${mlChip}
                    <div class="hud-chip score" title="${isEs ? "Nota global de ESTE roll de 0 a 100: combina qué stats tiene y cómo de altos salieron." : "Overall score of THIS roll from 0 to 100: combines which stats it has and how high they rolled."}"><span>ROLL</span><strong>${prediction.adjustedScore}/100</strong></div>
                </div>
            `;
        }

        const combinar = this._combinarOverlay(riven, meta, calculateRivenGrade, isEs);
        const posCount = riven.stats.filter(x => x.isPositive).length;
        const hasNeg = riven.stats.some(x => !x.isPositive);
        const statsHtml = riven.stats.map((s, i) => {
            const texto = textoDelStat(s, typeIdx);
            const textColor = s.isPositive ? "#00ff88" : "#ff6b6b";

            const des = this._statDesirability(meta, s.name, s.isPositive);
            const desFallback = des
                ? `<span style="font-weight:700; font-size:0.7em; letter-spacing:0.5px; padding:1px 7px; border-radius:999px; background:${des.color}22; color:${des.color}; border:1px solid ${des.color}66;">${des.label}</span>`
                : "";

            let desBadge = desFallback;
            const ge = gradeStats && gradeStats[i];
            if (ge) {
                if (ge.isPositive) {
                    const c = ge.tier === "S" ? "#ffd700" : ge.tier === "A" ? "#ff8c00" : ge.tier === "B" ? "#00e5ff" : "#888";
                    const lbl = ge.tier === "S" ? "TOP" : ge.tier === "A" ? (isEs ? "BUENO" : "GOOD") : ge.tier === "B" ? (isEs ? "MEDIO" : "MID") : (isEs ? "FLOJO" : "WEAK");
                    const popTitle = isEs ? `Popularidad en ${escapeHTML(riven.weaponName)}: ${ge.weight}` : `Popularity on ${escapeHTML(riven.weaponName)}: ${ge.weight}`;
                    desBadge = `<span title="${popTitle}" style="font-weight:700; font-size:0.7em; letter-spacing:0.5px; padding:1px 7px; border-radius:999px; background:${c}22; color:${c}; border:1px solid ${c}66;">${lbl}</span>`;
                } else {
                    const c = ge.badness < 0.40 ? "#00ff88" : ge.badness < 0.70 ? "#ff8c00" : "#ff4d4d";
                    const dmgTitle = isEs ? `Daño en ${escapeHTML(riven.weaponName)}: ${ge.badness}` : `Damage on ${escapeHTML(riven.weaponName)}: ${ge.badness}`;
                    desBadge = `<span title="${dmgTitle}" style="font-weight:700; font-size:0.7em; letter-spacing:0.5px; padding:1px 7px; border-radius:999px; background:${c}22; color:${c}; border:1px solid ${c}66;">${ge.label}</span>`;
                }
            }

            let gradeBadge = "";
            if (meta) {
                const gradeData = calculateRivenGrade(meta, s.name, s.value, !s.isPositive, posCount, hasNeg);
                if (gradeData) {
                    let color = "#fff";
                    if (gradeData.grade.startsWith("S")) color = "#ffd700";
                    else if (gradeData.grade.startsWith("A")) color = "#ff8c00";
                    else if (gradeData.grade.startsWith("B")) color = "#00e5ff";
                    else if (gradeData.grade.startsWith("C")) color = "#a879ec";
                    else if (gradeData.grade.startsWith("F")) color = "#ff4d4d";
                    gradeBadge = `<span style="font-weight:900; font-size:0.8em; padding:1px 7px; border-radius:999px; background:rgba(0,0,0,0.45); color:${color}; border:1px solid ${color}55;">${gradeData.grade}${Number.isFinite(gradeData.pct) ? ` · p${Math.round(gradeData.pct)}` : ""}</span>`;
                }
            }

            const borderC = des ? des.color : "rgba(255,255,255,0.12)";
            return `
                <div class="riven-hud-stat" style="display:flex; align-items:center; gap:6px; background:rgba(255,255,255,0.04); border:1px solid ${borderC}55; border-radius:14px; padding:2px 8px; margin:2px 0; font-size:0.78em;">
                    <span title="${texto}" style="color:${textColor}; font-weight:600; flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${texto}</span>
                    <span style="display:flex; gap:6px; align-items:center; flex-shrink:0;">${desBadge}${gradeBadge}</span>
                </div>
            `;
        }).join("");

        const title = riven.rivenName || (riven.weaponName ? `${riven.weaponName} Riven` : "Unknown Riven");
        const rollsInfo = riven.rolls !== null ? `<span class="rolls-badge">${riven.rolls} ROLLS</span>` : "";

        const actionBtnHtml = `
            <button class="action-btn primary" onclick="globalThis.RivenScannerHUD.openCalculator(0)" style="
                margin-top: 8px;
                border-color: rgba(255, 215, 0, 0.3);
                color: #ffd700;
                background: rgba(255, 215, 0, 0.05);
            ">
                ${isEs ? "ABRIR EN TASACIÓN" : "OPEN IN GRADING"}
            </button>
        `;

        const capBtnHtml = this.lastCapture
            ? `<button class="hud-cap-btn" title="${t.captured}" onclick="globalThis.RivenScannerHUD.toggleCapture()">IMG</button>`
            : "";
        const cropImgHtml = this.lastCapture ? `
            <div class="hud-capture" style="display: none; position: relative; margin-bottom: 10px; border-radius: 6px; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.08); box-shadow: inset 0 0 20px rgba(0,0,0,0.8);">
                <img alt="" style="width: 100%; display: block; filter: contrast(1.15) brightness(1.05);" />
                <div style="position: absolute; top: 8px; left: 8px; background: rgba(0,0,0,0.7); color: #fff; padding: 2px 6px; font-size: 0.65em; border-radius: 3px; border: 1px solid rgba(255,255,255,0.15); font-family: monospace; letter-spacing: 0.5px;">${t.captured}</div>
            </div>
        ` : "";

        this.container.innerHTML = `
            <div class="riven-hud-card">
                <div class="riven-hud-header" ondblclick="globalThis.RivenScannerHUD.toggleCollapse()">
                    <span class="dot"></span>
                    <span class="title">${isEs ? "RIVEN DETECTADO" : "RIVEN DETECTED"}</span>
                    <div style="margin-left: auto; display: flex; gap: 4px;">
                        <button class="close-btn" style="width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.1); border: none; border-radius: 4px; color: white; cursor: pointer;" onclick="globalThis.RivenScannerHUD.toggleCollapse()">_</button>
                        <button class="close-btn" style="width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; background: rgba(255,50,50,0.2); border: none; border-radius: 4px; color: white; cursor: pointer;" onclick="globalThis.RivenScannerHUD.dismiss()">✕</button>
                    </div>
                </div>
                <div class="riven-hud-body">
                    ${heroHtml}

                    <div class="riven-weapon-row">
                        <span class="weapon-name">${escapeHTML(title)}</span>
                        <span style="display:flex; gap:6px; align-items:center;">${rollsInfo}${capBtnHtml}</span>
                    </div>

                    ${cropImgHtml}

                    <div class="riven-hud-stats-list">
                        ${statsHtml}
                    </div>
                    ${combinarCartaHtml(combinar)}

                    ${metricsHtml}

                    ${this._cicloHtml(riven, meta, calculateRivenGrade, isEs)}
                    ${objetivoFusionHtml(combinar, isEs)}

                    <div class="riven-hud-actions" style="display: flex; flex-direction: column;">
                        ${actionBtnHtml}
                    </div>
                </div>
            </div>
        `;
        avisa("riven", { tipo: "tirada", datos: {
            ...espejo, stats: this._statsOverlay(riven, meta, calculateRivenGrade, gradeStats),
            combinar,
            rotulos: { valor: isEs ? "VALOR" : "VALUE", grado: isEs ? "GRADO" : "GRADE", atributo: TEXTS[state.currentLang].scannerHUD.rivenColStat, tirada: TEXTS[state.currentLang].scannerHUD.rivenColRoll },
        } });
    },

    _statsOverlay(roll, meta, calculateRivenGrade, gradeStats = null) {
        const posCount = roll.stats.filter((x) => x.isPositive).length;
        const hasNeg = roll.stats.some((x) => !x.isPositive);
        const isEs = state.currentLang === "es";
        const typeIdx = tipoDeArma(meta?.t || state.weaponMap?.[roll.weaponName]?.t);
        return roll.stats.map((s, i) => {
            const g = meta ? calculateRivenGrade(meta, s.name, s.value, !s.isPositive, posCount, hasNeg) : null;
            return {
                texto: textoDelStat(s, typeIdx), positivo: s.isPositive, grado: g?.grade || null, pct: g?.pct,
                calidad: calidadDelStat(gradeStats?.[i], isEs),
            };
        });
    },

    async _renderComparison(rollA, rollB) {
        const { RivenOCRService } = await import("../../services/rivens/riven_ocr.service.js?v=3");
        const comparison = await RivenOCRService.compareRolls(rollA, rollB);

        if (!comparison) {
            await this._renderSingle(rollA);
            return;
        }

        const { getMetaStats } = await import("../../services/rivens/riven_market.service.js");
        const { calculateRivenGrade } = await import("../../utils/rivens/riven_logic.js");
        
        const meta = getMetaStats(rollA.weaponName) || getMetaStats(rollB.weaponName);

        const formatRollStats = (roll) => {
            const posCount = roll.stats.filter(x => x.isPositive).length;
            const hasNeg = roll.stats.some(x => !x.isPositive);
            const typeIdx = tipoDeArma(meta?.t || state.weaponMap?.[roll.weaponName]?.t);
            return roll.stats.map(s => {
                const texto = textoDelStat(s, typeIdx);
                const textColor = s.isPositive ? "#00ff78" : "#ff6b6b";
                const des = this._statDesirability(meta, s.name, s.isPositive);
                const desBadge = des
                    ? `<span style="font-weight:700; font-size:0.85em; padding:0 5px; border-radius:999px; background:${des.color}22; color:${des.color}; border:1px solid ${des.color}66;">${des.label}</span>`
                    : "";
                let gradeBadge = "";
                if (meta) {
                    const gradeData = calculateRivenGrade(meta, s.name, s.value, !s.isPositive, posCount, hasNeg);
                    if (gradeData) {
                        let gColor = "#fff";
                        if (gradeData.grade.startsWith("S")) gColor = "#ffd700";
                        else if (gradeData.grade.startsWith("A")) gColor = "#ff8c00";
                        else if (gradeData.grade.startsWith("B")) gColor = "#00e5ff";
                        else if (gradeData.grade.startsWith("C")) gColor = "#a879ec";
                        else if (gradeData.grade.startsWith("F")) gColor = "#ff4d4d";
                        gradeBadge = `<span style="font-weight:bold; color:${gColor};">[${gradeData.grade}]</span>`;
                    }
                }
                const borderC = des ? des.color : "rgba(255,255,255,0.12)";
                return `<div style="display:flex; align-items:center; gap:5px; font-size:0.68em; margin:2px 0; padding:2px 6px; border:1px solid ${borderC}55; border-radius:12px; background:rgba(255,255,255,0.04);"><span title="${texto}" style="color:${textColor}; flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${texto}</span><span style="display:flex; gap:5px; flex-shrink:0;">${desBadge}${gradeBadge}</span></div>`;
            }).join("");
        };

        const isEs = state.currentLang === "es";
        const combinarAB = [rollA, rollB].map((r) => this._combinarOverlay(r, meta, calculateRivenGrade, isEs));
        const t = TEXTS[state.currentLang]?.rivenHud || TEXTS.en.rivenHud;
        const platIcon = '<img src="assets/relic_contents/platinum.webp" style="width: 14px; vertical-align: middle; margin-bottom: 2px;">';

        if (this.container) this.container.style.width = "min(460px, calc(100vw - 16px))";

        const winIdx = comparison.winner;
        const winnerText = winIdx === 1 ? t.new : t.current;

        const actionBtnHtml = `
            <button class="action-btn" onclick="globalThis.RivenScannerHUD.openCalculator(0)" style="flex: 1; border-color: rgba(255, 215, 0, 0.3); color: #ffd700; background: rgba(255, 215, 0, 0.05);">
                ${t.gradeActual}
            </button>
            <button class="action-btn primary" onclick="globalThis.RivenScannerHUD.openCalculator(1)" style="flex: 1; border-color: rgba(0, 229, 255, 0.3); color: #00e5ff; background: rgba(0, 229, 255, 0.05);">
                ${t.gradeNuevo}
            </button>
        `;

        const capBtnHtml = this.lastCapture
            ? `<button class="hud-cap-btn" title="${t.sideCurrent} / ${t.sideNew}" onclick="globalThis.RivenScannerHUD.toggleCapture()">IMG</button>`
            : "";
        const cropImgHtml = this.lastCapture ? `
            <div class="hud-capture" style="display: none; position: relative; margin-bottom: 10px; border-radius: 6px; overflow: hidden; border: 1px solid rgba(0, 229, 255, 0.08); box-shadow: inset 0 0 20px rgba(0,0,0,0.8);">
                <img alt="" style="width: 100%; display: block; filter: contrast(1.15) brightness(1.05);" />
                <div style="position: absolute; top: 8px; left: 8px; background: rgba(0,0,0,0.75); color: #fff; padding: 2px 6px; font-size: 0.65em; border-radius: 3px; border: 1px solid rgba(255,255,255,0.15); font-family: monospace; letter-spacing: 0.5px;">${t.sideCurrent}</div>
                <div style="position: absolute; top: 8px; right: 8px; background: rgba(0, 229, 255, 0.85); color: #000; padding: 2px 6px; font-size: 0.65em; border-radius: 3px; font-weight: bold; font-family: monospace; letter-spacing: 0.5px;">${t.sideNew}</div>
            </div>
        ` : "";

        this.container.innerHTML = `
            <div class="riven-hud-card comparison">
                <div class="riven-hud-header" ondblclick="globalThis.RivenScannerHUD.toggleCollapse()">
                    <span class="dot comp"></span>
                    <span class="title">${t.compareTitle}</span>
                    <div style="margin-left: auto; display: flex; gap: 4px;">
                        <button class="close-btn" style="width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; background: rgba(0, 229, 255, 0.1); border: none; border-radius: 4px; color: #00e5ff; cursor: pointer;" onclick="globalThis.RivenScannerHUD.toggleCollapse()">_</button>
                        <button class="close-btn" style="width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; background: rgba(255,50,50,0.2); border: none; border-radius: 4px; color: white; cursor: pointer;" onclick="globalThis.RivenScannerHUD.dismiss()">✕</button>
                    </div>
                </div>
                <div class="riven-hud-body">
                    <div class="riven-weapon-row">
                        <span class="weapon-name">${rollA.weaponName}</span>
                        <span style="display:flex; gap:6px; align-items:center;">
                            <span class="comp-verdict-chip">${winnerText} ${t.verdictBetter}</span>
                            ${capBtnHtml}
                        </span>
                    </div>

                    ${cropImgHtml}

                    <div style="display: flex; gap: 10px; margin-top: 6px;">
                        <div class="comp-col ${winIdx === 0 ? 'winner' : ''}" style="flex:1 1 0; min-width:0;">
                            <div class="col-title">${t.current}</div>
                            <div class="col-hero">
                                <span class="col-price-big">~${comparison.priceA}${platIcon}</span>
                                <span class="col-score-sm">${t.score}: <strong>${comparison.scoreA}</strong></span>
                            </div>
                            <div class="col-stats">${formatRollStats(rollA)}</div>
                            ${combinarCartaHtml(combinarAB[0])}
                        </div>
                        <div class="comp-col ${winIdx === 1 ? 'winner' : ''}" style="flex:1 1 0; min-width:0;">
                            <div class="col-title">${t.new}</div>
                            <div class="col-hero">
                                <span class="col-price-big">~${comparison.priceB}${platIcon}</span>
                                <span class="col-score-sm">${t.score}: <strong>${comparison.scoreB}</strong></span>
                            </div>
                            <div class="col-stats">${formatRollStats(rollB)}</div>
                            ${combinarCartaHtml(combinarAB[1])}
                        </div>
                    </div>

                    ${this._cicloHtml(winIdx === 1 ? rollB : rollA, meta, calculateRivenGrade, isEs, winIdx === 1 ? t.new : t.current)}
                    ${objetivoFusionHtml(combinarAB, isEs)}

                    <div class="riven-hud-actions" style="display: flex; gap: 8px;">
                        ${actionBtnHtml}
                    </div>
                </div>
            </div>
        `;
        avisa("riven", { tipo: "comparacion", datos: {
            arma: rollA.weaponName, ganador: winIdx,
            tiradas: [
                { rotulo: t.current, precio: comparison.priceA, score: comparison.scoreA, stats: this._statsOverlay(rollA, meta, calculateRivenGrade), combinar: combinarAB[0] },
                { rotulo: t.new, precio: comparison.priceB, score: comparison.scoreB, stats: this._statsOverlay(rollB, meta, calculateRivenGrade), combinar: combinarAB[1] },
            ],
            rotulos: { mejor: t.verdictBetter, atributo: TEXTS[state.currentLang].scannerHUD.rivenColStat, tirada: TEXTS[state.currentLang].scannerHUD.rivenColRoll },
        } });
    },

    async openCalculator(rollIndex) {
        globalThis.activeGradingRolls = {
            rollL: this.lastL,
            rollR: this.lastR,
            activeIndex: rollIndex
        };

        const { openGradingModal } = await import("./ui_rivens.js");
        openGradingModal();
    },

};
