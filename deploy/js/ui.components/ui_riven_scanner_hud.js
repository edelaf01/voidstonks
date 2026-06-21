import { state } from "../state.js";
import { TEXTS } from "../config.js";

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
        let dragging = false;
        let offX = 0;
        let offY = 0;

        this.container.addEventListener("mousedown", (e) => {
            const handle = e.target.closest(".riven-hud-header");
            if (!handle || e.target.classList.contains("close-btn")) return;

            dragging = true;
            offX = e.clientX - this.container.getBoundingClientRect().left;
            offY = e.clientY - this.container.getBoundingClientRect().top;
            handle.style.cursor = "grabbing";
            e.preventDefault();
        });

        document.addEventListener("mousemove", (e) => {
            if (!dragging) return;
            this.container.style.left = e.clientX - offX + "px";
            this.container.style.top = e.clientY - offY + "px";
            this.container.style.right = "auto";
        });

        document.addEventListener("mouseup", () => {
            if (!dragging) return;
            dragging = false;
            const handle = this.container.querySelector(".riven-hud-header");
            if (handle) handle.style.cursor = "grab";
        });
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

        // If both cards are detected, it's a roll comparison (cycling screen)
        if (parsedL && parsedR) {
            await this._renderComparison(parsedL, parsedR);
        } else {
            // Otherwise, render the single card detected
            const activeCard = parsedL || parsedR;
            await this._renderSingle(activeCard);
        }

        this.container.style.display = "block";
        const handle = this.container.querySelector(".riven-hud-header");
        if (handle) handle.style.cursor = "grab";
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
        // Una sola carta -> ancho normal (la comparación lo ensancha a 460px).
        if (this.container) this.container.style.width = "330px";
        const t = TEXTS[globalThis.currentLanguage || "en"]?.rivenHud || TEXTS.en.rivenHud;
        // Unified valuation: single shared appraisal used by the riven tab, this HUD and the
        // comparison view, so a riven is always priced identically everywhere.
        const { calculateRivenGrade } = await import("../utils/riven_logic.js");
        const { appraiseParsedRiven } = await import("./ui_rivens.js");

        const appraisal = appraiseParsedRiven(riven.weaponName, riven.stats);
        const meta = appraisal?.meta;
        let tierHtml = "";
        let estimateHtml = "";
        let scoreHtml = "";

        if (appraisal) {
            const tiers = appraisal.tiers;
            const prediction = appraisal.prediction;

            const platIcon = '<img src="assets/relic_contents/platinum.webp" style="width: 14px; vertical-align: middle; margin-bottom: 2px;">';
            tierHtml = `
                <div class="riven-hud-tiers">
                    <div><span>TRASH</span><strong>~${tiers.trash}${platIcon}</strong></div>
                    <div><span>GOOD</span><strong>~${tiers.goodReroll}${platIcon}</strong></div>
                    <div><span>GODROLL</span><strong>~${tiers.godroll}${platIcon}</strong></div>
                </div>
            `;

            estimateHtml = `
                <div class="riven-hud-estimate">
                    <span class="lbl">ESTIMATED VALUE</span>
                    <span class="val">${prediction.estimatedValue}${platIcon}</span>
                    <span class="range">(${prediction.suggestedMin} - ${prediction.suggestedMax}${platIcon})</span>
                </div>
            `;

            scoreHtml = `
                <div class="riven-hud-score">
                    <span class="lbl">ROLL SCORE</span>
                    <span class="val">${prediction.adjustedScore}/100</span>
                </div>
            `;
        }

        const posCount = riven.stats.filter(x => x.isPositive).length;
        const hasNeg = riven.stats.some(x => !x.isPositive);
        const statsHtml = riven.stats.map(s => {
            const prefix = s.isPositive ? "+" : "-";
            const textColor = s.isPositive ? "#00ff88" : "#ff6b6b";

            // Deseabilidad: qué tan bueno es ESE stat en ESTA arma (Multishot vs Status Duration).
            const des = this._statDesirability(meta, s.name, s.isPositive);
            const desBadge = des
                ? `<span style="font-weight:700; font-size:0.7em; letter-spacing:0.5px; padding:1px 7px; border-radius:999px; background:${des.color}22; color:${des.color}; border:1px solid ${des.color}66;">${des.label}</span>`
                : "";

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
                <div class="riven-hud-stat" style="display:flex; align-items:center; gap:6px; background:rgba(255,255,255,0.04); border:1px solid ${borderC}55; border-radius:14px; padding:4px 10px; margin:4px 0;">
                    <span style="color:${textColor}; font-weight:600; flex:1; min-width:0;">${prefix}${s.value}% ${s.name}</span>
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
                ⚙️ OPEN IN GRADING
            </button>
        `;

        const cropImgHtml = this.lastCaptureDataURL ? `
            <div style="position: relative; margin-bottom: 12px; border-radius: 6px; overflow: hidden; border: 1px solid rgba(255, 255, 255, 0.08); box-shadow: inset 0 0 20px rgba(0,0,0,0.8);">
                <img src="${this.lastCaptureDataURL}" style="width: 100%; display: block; filter: contrast(1.15) brightness(1.05);" />
                <div style="position: absolute; top: 8px; left: 8px; background: rgba(0,0,0,0.7); color: #fff; padding: 2px 6px; font-size: 0.65em; border-radius: 3px; border: 1px solid rgba(255,255,255,0.15); font-family: monospace; letter-spacing: 0.5px;">${t.captured}</div>
            </div>
        ` : "";

        this.container.innerHTML = `
            <div class="riven-hud-card">
                <div class="riven-hud-header" ondblclick="globalThis.RivenScannerHUD.toggleCollapse()">
                    <span class="dot"></span>
                    <span class="title">RIVEN DETECTED</span>
                    <div style="margin-left: auto; display: flex; gap: 4px;">
                        <button class="close-btn" style="width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.1); border: none; border-radius: 4px; color: white; cursor: pointer;" onclick="globalThis.RivenScannerHUD.toggleCollapse()">_</button>
                        <button class="close-btn" style="width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; background: rgba(255,50,50,0.2); border: none; border-radius: 4px; color: white; cursor: pointer;" onclick="globalThis.RivenScannerHUD.dismiss()">✕</button>
                    </div>
                </div>
                <div class="riven-hud-body">
                    <div class="riven-weapon-row">
                        <span class="weapon-name">${title}</span>
                        ${rollsInfo}
                    </div>
                    
                    ${cropImgHtml}
                    
                    <div class="riven-hud-stats-list">
                        ${statsHtml}
                    </div>

                    ${tierHtml}
                    ${estimateHtml}
                    ${scoreHtml}

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
        const { RivenOCRService } = await import("../services/riven_ocr.service.js?v=2");
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
                const prefix = s.isPositive ? "+" : "-";
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
                return `<div style="display:flex; align-items:center; gap:5px; font-size:0.72em; margin:3px 0; padding:3px 8px; border:1px solid ${borderC}55; border-radius:12px; background:rgba(255,255,255,0.04);"><span style="color:${textColor}; flex:1; min-width:0;">${prefix}${s.value}% ${s.name}</span><span style="display:flex; gap:5px; flex-shrink:0;">${desBadge}${gradeBadge}</span></div>`;
            }).join("");
        };

        const lang = globalThis.currentLanguage || 'en';
        const t = TEXTS[lang]?.rivenHud || TEXTS['en'].rivenHud;
        const platIcon = '<img src="assets/relic_contents/platinum.webp" style="width: 14px; vertical-align: middle; margin-bottom: 2px;">';

        // La comparación necesita más ancho que la vista de una carta (dos columnas de cápsulas).
        if (this.container) this.container.style.width = "460px";

        const winIdx = comparison.winner;
        const winnerText = winIdx === 1 ? t.new : t.current;

        const actionBtnHtml = `
            <button class="action-btn" onclick="globalThis.RivenScannerHUD.openCalculator(0)" style="flex: 1; border-color: rgba(255, 215, 0, 0.3); color: #ffd700; background: rgba(255, 215, 0, 0.05);">
                ⚙️ ${t.gradeActual}
            </button>
            <button class="action-btn primary" onclick="globalThis.RivenScannerHUD.openCalculator(1)" style="flex: 1; border-color: rgba(0, 229, 255, 0.3); color: #00e5ff; background: rgba(0, 229, 255, 0.05);">
                ⚙️ ${t.gradeNuevo}
            </button>
        `;

        const cropImgHtml = this.lastCaptureDataURL ? `
            <div style="position: relative; margin-bottom: 12px; border-radius: 6px; overflow: hidden; border: 1px solid rgba(0, 229, 255, 0.08); box-shadow: inset 0 0 20px rgba(0,0,0,0.8);">
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
                    </div>

                    ${cropImgHtml}

                    <div style="display: flex; gap: 10px; margin-top: 10px;">
                        <div class="comp-col ${winIdx === 0 ? 'winner' : ''}" style="flex:1 1 0; min-width:0;">
                            <div class="col-title">${t.current}</div>
                            <div class="col-stats">${formatRollStats(rollA)}</div>
                            <div class="col-score">${t.score}: <strong>${comparison.scoreA}</strong></div>
                            <div class="col-price">${t.est}: <strong>${comparison.priceA}${platIcon}</strong></div>
                        </div>
                        <div class="comp-col ${winIdx === 1 ? 'winner' : ''}" style="flex:1 1 0; min-width:0;">
                            <div class="col-title">${t.new}</div>
                            <div class="col-stats">${formatRollStats(rollB)}</div>
                            <div class="col-score">${t.score}: <strong>${comparison.scoreB}</strong></div>
                            <div class="col-price">${t.est}: <strong>${comparison.priceB}${platIcon}</strong></div>
                        </div>
                    </div>

                    <div class="comp-verdict" style="text-align: center; font-size: 1.1em; font-weight: bold; margin: 15px 0; color: #00e5ff; text-shadow: 0 0 8px rgba(0, 229, 255, 0.5);">
                        <div class="verdict-title">${winnerText} ${t.verdictBetter}</div>
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
