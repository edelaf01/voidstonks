import { state } from "../state.js";
import { TEXTS } from "../config.js";
import { escapeHTML } from "./ui_components.js";

/**
 * HUD Component for displaying live Riven Mod appraisals and roll comparisons.
 */
export const RivenScannerHUD = {
    container: null,
    lastL: null,
    lastR: null,
    lastCaptureDataURL: null,

    /**
     * Initializes the appraisal HUD container element.
     */
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
    },

    /**
     * Toggles the visibility of the HUD body to collapse/expand it.
     */
    toggleCollapse() {
        if (!this.container) return;
        const body = this.container.querySelector(".riven-hud-body");
        if (body) {
            body.style.display = body.style.display === "none" ? "block" : "none";
        }
    },

    /**
     * Initializes drag-and-drop mechanics for the HUD overlay.
     */
    _initDragEvents() {
        // Drag con transform + requestAnimationFrame: mover por `left/top` reflow-ea el panel (con sus
        // blur/gradientes) en cada mousemove y se siente a tirones; `translate3d` solo recompone en GPU,
        // y el rAF agrupa los eventos a 1 por frame. Soporta ratón y táctil.
        let dragging = false;
        let startX = 0, startY = 0;     // puntero al iniciar
        let baseLeft = 0, baseTop = 0;  // esquina del panel al iniciar
        let curX = 0, curY = 0;         // último puntero
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
            // Fija el panel en left/top para que el transform sea relativo a un origen estable.
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
            // Consolida el desplazamiento en left/top y limpia el transform.
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
        // Táctil (móvil/tablet)
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

    /**
     * Dismisses and hides the Riven appraisal HUD overlay.
     */
    dismiss() {
        if (this.container) {
            this.container.style.display = "none";
        }
        this.lastL = null;
        this.lastR = null;
        this.lastCaptureDataURL = null;
        if (globalThis.ScannerService) {
            globalThis.ScannerService.detectionLocked = false;
            globalThis.ScannerService.lastParsedL = null;
            globalThis.ScannerService.lastParsedR = null;
            globalThis.ScannerService.lastHashL = null;
            globalThis.ScannerService.lastHashR = null;
        }
    },

    /**
     * Displays Riven details or side-by-side comparison.
     */
    async show(parsedL, parsedR, screenshotDataURL) {
        this.init();
        this.lastL = parsedL;
        this.lastR = parsedR;
        this.lastCaptureDataURL = screenshotDataURL;

        // El historial semanal del arma alimenta calculateHybridTiers y las features hist_* del
        // ML; sin este fetch el escáner tasaba con historial nulo o del arma anterior (el único
        // sitio que lo cargaba era el modal de grading). Fire-and-forget: primera pasada rápida
        // sin historial y re-render automático al llegar (mismo patrón que el modal).
        this._ensureHistory((parsedL || parsedR)?.weaponName);

        // If both cards are detected, it's a roll comparison (cycling screen)
        if (parsedL && parsedR) {
            await this._renderComparison(parsedL, parsedR);
        } else {
            // Otherwise, render the single card detected. Si NO hay ninguna carta parseada
            // (ambas null: el OCR falló en este frame) NO se renderiza: _renderSingle
            // desreferencia riven.weaponName y lanzaba un TypeError que abortaba el render a
            // medias, dejando el HUD con el contenido del frame anterior — el usuario veía
            // "a veces solo se lee un riven". Se conserva lo mostrado y se espera al siguiente
            // frame, que es justo lo que hace el consenso temporal.
            const activeCard = parsedL || parsedR;
            if (!activeCard) return;
            await this._renderSingle(activeCard);
        }

        this.container.style.display = "block";
        const handle = this.container.querySelector(".riven-hud-header");
        if (handle) handle.style.cursor = "grab";
    },

    /**
     * Garantiza que state.currentWeaponHistory corresponde al arma escaneada. Si no, lanza el
     * fetch y re-renderiza el HUD al resolverse para que la tasación incorpore el historial.
     */
    async _ensureHistory(weaponName) {
        if (!weaponName) return;
        const cur = state.currentWeaponHistory;
        if (cur && cur.weaponName === weaponName) return; // ya cargado o en curso
        state.currentWeaponHistory = { weaponName, data: [], loading: true };
        try {
            const { fetchWeaponHistory } = await import("../repositories/riven.repository.js");
            const data = await fetchWeaponHistory(weaponName);
            if (state.currentWeaponHistory?.weaponName !== weaponName) return; // el usuario cambió de arma
            state.currentWeaponHistory = { weaponName, data: data || [], loading: false };
            // Re-tasar solo si el HUD sigue visible mostrando esta arma.
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

    /**
     * Toggles the captured frame crop visibility (hidden by default to save vertical space).
     */
    toggleCapture() {
        if (!this.container) return;
        const cap = this.container.querySelector(".hud-capture");
        if (cap) {
            cap.style.display = cap.style.display === "none" ? "block" : "none";
        }
    },

    /**
     * Trigger a local PNG image download of the captured frame crop.
     */
    downloadCapture() {
        if (!this.lastCaptureDataURL) return;
        const a = document.createElement("a");
        a.href = this.lastCaptureDataURL;
        a.download = `riven_capture_${Date.now()}.png`;
        a.click();
    },

    // Deseabilidad del stat según el meta del arma (qué tan buscado es ESE stat en ESTA arma),
    // independiente de cuánto rolleó. Positiva: TOP/GOOD/MID/WEAK por peso. Negativa: NEG OK vs BRICK.
    _statDesirability(meta, name, isPositive) {
        if (!meta) return null;
        const nl = (name || "").toLowerCase();
        const match = (m) => {
            const ml = (m || "").toLowerCase();
            if (ml === "damage") return nl === "damage" || nl.includes("base damage") || nl.includes("melee damage");
            return nl.includes(ml) || ml.includes(nl);
        };
        if (!isPositive) {
            const brick = (Array.isArray(meta.pos) && meta.pos.some(match)) || (Array.isArray(meta.midPos) && meta.midPos.some(match));
            if (brick) return { label: "BRICK", color: "#ff4d4d" };
            const harmless = (Array.isArray(meta.neg) && meta.neg.some(match))
                || ["zoom", "recoil", "ammo maximum", "status duration", "magazine capacity", "finisher", "impact", "puncture"].some(t => nl.includes(t));
            if (harmless) return { label: "NEG OK", color: "#00d18f" };
            return { label: "NEG", color: "#ff8c00" };
        }
        let w = null;
        if (meta.dynamic_weights) {
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

    /**
     * Renders a single Riven card appraisal view.
     */
    async _renderSingle(riven) {
        // Una sola carta -> ancho normal (la comparación lo ensancha). En móvil nunca más ancho
        // que el viewport: el ancho inline pisa al CSS, así que el clamp debe vivir aquí.
        if (this.container) this.container.style.width = "min(330px, calc(100vw - 16px))";
        const isEs = state.currentLang === "es";
        const t = TEXTS[state.currentLang]?.rivenHud || TEXTS.en.rivenHud;
        // Unified valuation: single shared appraisal used by the riven tab, this HUD and the
        // comparison view, so a riven is always priced identically everywhere.
        const { calculateRivenGrade } = await import("../utils/riven_logic.js");
        const { appraiseParsedRiven } = await import("./ui_rivens.js");

        const appraisal = appraiseParsedRiven(riven.weaponName, riven.stats);
        const meta = appraisal?.meta;
        let heroHtml = "";
        let metricsHtml = "";
        let gradeStats = null;  // grade por stat (popularidad data-driven por arma)

        if (appraisal) {
            const tiers = appraisal.tiers;
            const prediction = appraisal.prediction;

            const platIcon = '<img src="assets/relic_contents/platinum.webp" style="width: 14px; vertical-align: middle; margin-bottom: 2px;">';
            let mlChip = "";
            let gradeHero = "";

            // EXPERIMENTAL: tasación del modelo XGBoost slim, anclada a la banda robusta (histórico DE).
            try {
                const ML = await import("../utils/riven_ml.js");
                const itemAttributes = appraisal?.itemAttributes || [];
                const _w = meta || { name: riven.weaponName };
                const _bq = await ML.predictRivenMLBand(_w, itemAttributes, meta, riven.rolls || 0, appraisal?.prediction?.adjustedScore);
                prediction.mlEstimate = _bq.p50;
                prediction.mlBand = _bq;
                const _warn = _bq.confianza === "baja" ? " !" : "";
                const _mlTitle = (isEs
                    ? `Según la IA: venta rápida ~${_bq.p25}p · precio justo ~${_bq.p50}p · godroll ~${_bq.p95}p`
                    : `Per the AI: quick sale ~${_bq.p25}p · fair price ~${_bq.p50}p · godroll ~${_bq.p95}p`)
                    + (_bq.aviso ? ` · ${_bq.aviso}` : "");
                mlChip = `
                    <div class="hud-chip ml" title="${_mlTitle}">
                        <span>${isEs ? "IA" : "AI"}${_warn}</span>
                        <strong>~${_bq.p50}${platIcon}</strong>
                        <em>(${_bq.p25}–${_bq.p95})</em>
                    </div>
                `;
                // Calificación per-arma (popularidad de stats): cada positivo por lo deseado que es
                // en ESTA arma, cada negativa por su daño. Grado S/A/B/C/F data-driven.
                const _g = await ML.gradeRiven(riven.weaponName, riven.stats);
                gradeStats = _g.stats;
                const _gc = _g.grade === "S" ? "#ffd700" : _g.grade === "A" ? "#ff8c00" : _g.grade === "B" ? "#00e5ff" : _g.grade === "C" ? "#a879ec" : "#ff4d4d";
                gradeHero = `
                    <div class="hud-hero-grade" style="--gc:${_gc};" title="${isEs ? "Grado (arma)" : "Grade (weapon)"}">
                        <span class="letter">${_g.grade}</span>
                        <span class="sub">${_g.score}/100</span>
                    </div>
                `;
            } catch (e) { console.warn("[ML hud] error:", e); }

            // Hero co-dominante: precio estimado + grado del arma al mismo nivel visual.
            // ⏳ mientras llega el historial semanal: la primera pasada tasa sin él y se re-renderiza.
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

            // Métricas secundarias en una sola fila de chips: tiers de referencia, IA y roll score.
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

        const posCount = riven.stats.filter(x => x.isPositive).length;
        const hasNeg = riven.stats.some(x => !x.isPositive);
        const statsHtml = riven.stats.map((s, i) => {
            // El recoil es un stat invertido: el juego muestra el BUFF con signo negativo
            // ("-89.5% Weapon Recoil" = menos retroceso). Mostramos el signo tal y como lo ve el
            // usuario en la carta, pero el color/tratamiento sigue al flag isPositive (buff/curse).
            const displayInverted = /^recoil$/i.test(s.name);
            const prefix = (s.isPositive !== displayInverted) ? "+" : "-";
            const textColor = s.isPositive ? "#00ff88" : "#ff6b6b";

            // Deseabilidad: qué tan bueno es ESE stat en ESTA arma (Multishot vs Status Duration).
            const des = this._statDesirability(meta, s.name, s.isPositive);
            const desFallback = des
                ? `<span style="font-weight:700; font-size:0.7em; letter-spacing:0.5px; padding:1px 7px; border-radius:999px; background:${des.color}22; color:${des.color}; border:1px solid ${des.color}66;">${des.label}</span>`
                : "";

            // POPULARIDAD data-driven de ESTE stat en ESTA arma (de stat_weights.json, histórico).
            // Positivo: TOP/BUENO/MEDIO/FLOJO según peso. Negativa: INOFENSIVA/MEDIA/RUINOSA según daño.
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

            // Grado del roll: cuánto rolleó dentro de su rango ideal.
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
                    gradeBadge = `<span style="font-weight:900; font-size:0.8em; padding:1px 7px; border-radius:999px; background:rgba(0,0,0,0.45); color:${color}; border:1px solid ${color}55;">${gradeData.grade}</span>`;
                }
            }

            // Cada stat en una cápsula de UNA línea: texto a la izquierda, deseabilidad + grado a la derecha.
            const borderC = des ? des.color : "rgba(255,255,255,0.12)";
            return `
                <div class="riven-hud-stat" style="display:flex; align-items:center; gap:6px; background:rgba(255,255,255,0.04); border:1px solid ${borderC}55; border-radius:14px; padding:2px 8px; margin:2px 0; font-size:0.78em;">
                    <span title="${prefix}${s.value}% ${s.name}" style="color:${textColor}; font-weight:600; flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${prefix}${s.value}% ${s.name}</span>
                    <span style="display:flex; gap:6px; align-items:center; flex-shrink:0;">${desBadge}${gradeBadge}</span>
                </div>
            `;
        }).join("");

        const title = riven.rivenName || (riven.weaponName ? `${riven.weaponName} Riven` : "Unknown Riven");
        const rollsInfo = riven.rolls !== null ? `<span class="rolls-badge">${riven.rolls} ROLLS</span>` : "";

        // Render the action button
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

        // La captura va plegada por defecto (recupera ~150px de alto); se abre con el botón de captura.
        const capBtnHtml = this.lastCaptureDataURL
            ? `<button class="hud-cap-btn" title="${t.captured}" onclick="globalThis.RivenScannerHUD.toggleCapture()">IMG</button>`
            : "";
        const cropImgHtml = this.lastCaptureDataURL ? `
            <div class="hud-capture" style="display: none; position: relative; margin-bottom: 10px; border-radius: 6px; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.08); box-shadow: inset 0 0 20px rgba(0,0,0,0.8);">
                <img src="${this.lastCaptureDataURL}" style="width: 100%; display: block; filter: contrast(1.15) brightness(1.05);" />
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

                    ${metricsHtml}

                    <div class="riven-hud-actions" style="display: flex; flex-direction: column;">
                        ${actionBtnHtml}
                    </div>
                </div>
            </div>
        `;
    },

    /**
     * Renders a roll comparison view side-by-side.
     */
    async _renderComparison(rollA, rollB) {
        const { RivenOCRService } = await import("../services/riven_ocr.service.js?v=3");
        const comparison = await RivenOCRService.compareRolls(rollA, rollB);

        if (!comparison) {
            await this._renderSingle(rollA);
            return;
        }

        const { getMetaStats } = await import("../services/riven_market.service.js");
        const { calculateRivenGrade } = await import("../utils/riven_logic.js");
        
        const meta = getMetaStats(rollA.weaponName) || getMetaStats(rollB.weaponName);

        const formatRollStats = (roll) => {
            const posCount = roll.stats.filter(x => x.isPositive).length;
            const hasNeg = roll.stats.some(x => !x.isPositive);
            
            return roll.stats.map(s => {
                // Recoil invertido: signo como en la carta del juego (buff en negativo), color por buff/curse.
                const displayInverted = /^recoil$/i.test(s.name);
                const prefix = (s.isPositive !== displayInverted) ? "+" : "-";
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
                return `<div style="display:flex; align-items:center; gap:5px; font-size:0.68em; margin:2px 0; padding:2px 6px; border:1px solid ${borderC}55; border-radius:12px; background:rgba(255,255,255,0.04);"><span title="${prefix}${s.value}% ${s.name}" style="color:${textColor}; flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${prefix}${s.value}% ${s.name}</span><span style="display:flex; gap:5px; flex-shrink:0;">${desBadge}${gradeBadge}</span></div>`;
            }).join("");
        };

        const isEs = state.currentLang === "es";
        const t = TEXTS[state.currentLang]?.rivenHud || TEXTS.en.rivenHud;
        const platIcon = '<img src="assets/relic_contents/platinum.webp" style="width: 14px; vertical-align: middle; margin-bottom: 2px;">';

        // La comparación necesita más ancho que la vista de una carta (dos columnas de cápsulas),
        // pero nunca más que el viewport en móvil (el ancho inline pisa al CSS).
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

        // Captura plegada por defecto también en comparación (duplica lo que ya se ve en pantalla).
        const capBtnHtml = this.lastCaptureDataURL
            ? `<button class="hud-cap-btn" title="${t.sideCurrent} / ${t.sideNew}" onclick="globalThis.RivenScannerHUD.toggleCapture()">IMG</button>`
            : "";
        const cropImgHtml = this.lastCaptureDataURL ? `
            <div class="hud-capture" style="display: none; position: relative; margin-bottom: 10px; border-radius: 6px; overflow: hidden; border: 1px solid rgba(0, 229, 255, 0.08); box-shadow: inset 0 0 20px rgba(0,0,0,0.8);">
                <img src="${this.lastCaptureDataURL}" style="width: 100%; display: block; filter: contrast(1.15) brightness(1.05);" />
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
                        </div>
                        <div class="comp-col ${winIdx === 1 ? 'winner' : ''}" style="flex:1 1 0; min-width:0;">
                            <div class="col-title">${t.new}</div>
                            <div class="col-hero">
                                <span class="col-price-big">~${comparison.priceB}${platIcon}</span>
                                <span class="col-score-sm">${t.score}: <strong>${comparison.scoreB}</strong></span>
                            </div>
                            <div class="col-stats">${formatRollStats(rollB)}</div>
                        </div>
                    </div>

                    <div class="riven-hud-actions" style="display: flex; gap: 8px;">
                        ${actionBtnHtml}
                    </div>
                </div>
            </div>
        `;
    },

    /**
     * Launch the Orokin Grade Riven calculator prefilled with selected roll data.
     */
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
