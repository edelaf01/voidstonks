import { state } from "../state.js";
import { TEXTS } from "../config.js";
import { escapeHTML } from "../utils/escape_html.js";
import { exposeGlobals } from "../utils/global_registry.js";
import { aplicaMotor, estadoMotor, MOTOR_PRECISO } from "../services/scanner/ocr_engine.service.js";
import { avisaContexto } from "./ui_scanner_coach.js";

export const ScannerHUD = {
    updateContext(contextType) {
        const clave = `${contextType}|${state.squadRun ? 1 : 0}|${state.currentLang}`;
        if (clave === this._ultimoContexto) return;
        this._ultimoContexto = clave;
        const sh = TEXTS[state.currentLang].scannerHUD;
        const hud = document.getElementById("inv-hud");
        const badge = document.getElementById("hud-context-badge");
        this._ultimoTipo = contextType;
        this._muestraBloques();
        avisaContexto(state.squadRun && contextType !== "INVENTORY" ? "SQUAD" : contextType);

        if (contextType === "INVENTORY") {
            if (hud) hud.style.display = "block";
            this.setUIBadge(badge, sh.statusInventory, "#f1c40f", "rgba(241,196,15,0.4)", "rgba(241,196,15,0.1)");
            const msgEl = document.getElementById("live-inv-msg");
            if (msgEl) msgEl.innerText = sh.statusIdle;
        } else if (state.squadRun) {
            // in a mission the context is UNKNOWN, so without this branch the HUD hid again
            if (hud) hud.style.display = "block";
            this.setUIBadge(badge, sh.statusSquad, "#00e5ff", "rgba(0,229,255,0.4)", "rgba(0,229,255,0.1)");
        } else {
            if (hud) hud.style.display = "none";
            if (contextType === "INVENTORY_MODS") {
                this.setUIBadge(badge, "MODS", "#d060ff", "rgba(208,96,255,0.4)", "rgba(208,96,255,0.1)");
            } else if (contextType === "RELICS") {
                this.setUIBadge(badge, sh.statusRelics, "#00e5ff", "rgba(0,229,255,0.3)", "rgba(0,229,255,0.1)");
            } else if (contextType === "REWARD") {
                this.setUIBadge(badge, sh.statusReward, "#a0ff80", "rgba(160,255,128,0.3)", "rgba(160,255,128,0.08)");
            }
        }
    },

    _ultimoTipo: "UNKNOWN",
    _detectados: 0,

    _muestraBloques() {
        const inventario = this._ultimoTipo === "INVENTORY";
        for (const id of ["hud-actions", "hud-subactions"]) {
            const bloque = document.getElementById(id);
            if (bloque) bloque.style.display = inventario ? "" : "none";
        }
        const conLista = inventario || this._detectados > 0;
        for (const id of ["lbl-detected-items", "live-inventory-items-list"]) {
            const bloque = document.getElementById(id);
            if (bloque) bloque.style.display = conLista ? "" : "none";
        }
    },

    setUIBadge(badgeElement, text, color, borderColor, background) {
        if (!badgeElement) return;
        badgeElement.textContent = text;
        badgeElement.style.color = color;
        badgeElement.style.borderColor = borderColor;
        badgeElement.style.background = background;
    },

    updateFrameCounter(count) {
        const counter = document.getElementById("hud-scan-counter");
        if (!counter) return;
        const lbl = TEXTS[state.currentLang]?.scannerHUD?.lblFrame || "FRAME";
        counter.textContent = count > 0 ? `${lbl} ${count}` : "";
    },

    isDebugOpen() {
        return document.getElementById("live-debug-snapshot")?.style.display === "block";
    },

    updateDebugSnapshot(dataUrl) {
        const img = document.getElementById("live-debug-snapshot-img");
        if (img) {
            img.src = dataUrl;
            img.style.display = "block";
        }
    },

    debugSelectedIndex: 0,

    updateDebugHistory(history) {
        this.debugSelectedIndex = 0;
        this._renderDebugHistory(history);
        this.selectDebugEntry(history, 0);
    },

    _renderDebugHistory(history) {
        const strip = document.getElementById("live-debug-history");
        if (!strip) return;
        strip.innerHTML = "";
        history.forEach((entry, i) => {
            if (!entry.img) return;
            const th = document.createElement("img");
            th.src = entry.img;
            th.title = `[${entry.time}] ${entry.summary}`;
            th.style.cssText =
                "width:64px;height:36px;object-fit:cover;border-radius:3px;cursor:pointer;flex-shrink:0;" +
                `border:1px solid ${entry.warning ? "rgba(255,30,80,0.85)" : "rgba(0,229,255,0.35)"};` +
                (i === this.debugSelectedIndex ? "outline:2px solid #f1c40f;" : "");
            th.addEventListener("click", () => {
                this.debugSelectedIndex = i;
                this._renderDebugHistory(history);
                this.selectDebugEntry(history, i);
            });
            strip.appendChild(th);
        });
    },

    selectDebugEntry(history, i) {
        const entry = history[i];
        if (!entry?.img) return;
        this.updateDebugSnapshot(entry.img);
        const sum = document.getElementById("live-debug-summary");
        if (sum) {
            sum.textContent = `[${entry.time}] ${entry.summary}`;
            sum.style.color = entry.warning ? "#ff5252" : "#8ca0b8";
        }
    },

    updateScrollStatus(status, count = 0) {
        const scrollGuide = document.getElementById("live-scroll-guide");
        if (!scrollGuide) return;
        const clave = `${status}|${count}|${state.currentLang}`;
        if (clave === this._ultimoScroll) return;
        this._ultimoScroll = clave;
        const sh = TEXTS[state.currentLang]?.scannerHUD;

        if (status === "detected") {
            scrollGuide.innerHTML = `<div style="color:#f1c40f;font-weight:800;font-size:1.25em;letter-spacing:0.3px;">${sh.autoScanDetected}</div><div style="color:#607590;font-size:0.95em;margin-top:5px;">${sh.autoScanDetectedDesc}</div>`;
        } else if (status === "scanning") {
            scrollGuide.innerHTML = `<div style="color:#00e5ff;font-weight:800;font-size:1.25em;letter-spacing:0.3px;">${sh.autoScanScanning}</div><div style="color:#607590;font-size:0.95em;margin-top:5px;">${sh.autoScanScanningDesc}</div>`;
        } else if (status === "done") {
            const doneDesc = sh.autoScanDoneDesc.replace("{count}", count);
            scrollGuide.innerHTML = `<div style="color:#00ff78;font-weight:800;font-size:1.25em;letter-spacing:0.3px;">${sh.autoScanDone}</div><div style="color:#607590;font-size:0.95em;margin-top:5px;">${doneDesc}</div>`;
        }
    },

    updateDetectedItems(sessionInventory, sessionRelics = null) {
        const listContainer = document.getElementById("live-inventory-items-list");
        const countEl = document.getElementById("live-inv-count");
        const hud = document.getElementById("inv-hud");
        const sh = TEXTS[state.currentLang]?.scannerHUD;

        const relicCount = sessionRelics ? sessionRelics.size : 0;
        const totalCount = sessionInventory.size + relicCount;

        if (countEl) countEl.innerText = totalCount;
        if (!listContainer) return;

        if (totalCount > 0 && hud && hud.style.display === "none") {
            hud.style.display = "block";
        }

        if (relicCount > sessionInventory.size) {
            const badge = document.getElementById("hud-context-badge");
            this.setUIBadge(badge, sh?.statusRelics || "RELIQUIAS", "#00e5ff", "rgba(0,229,255,0.4)", "rgba(0,229,255,0.1)");
            this._ultimoContexto = null;
        }
        this._detectados = totalCount;
        this._muestraBloques();

        if (totalCount === 0) {
            listContainer.innerHTML = `<div class="hud-empty">${escapeHTML(sh?.lblEmpty || "PRESS SCAN TO START")}</div>`;
            return;
        }

        const fila = (name, qty, clase, corto) => `<div class="hud-item ${clase}" title="${escapeHTML(name)}">
            <span class="hud-item-name">${escapeHTML(corto)}</span>
            <span class="hud-item-qty">×${escapeHTML(String(qty))}</span>
          </div>`;
        const orden = (mapa) => [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0]));
        const seccion = (titulo, entradas, clase, acorta = (n) => n) => entradas.length
            ? `<div class="hud-group"><span>${escapeHTML(titulo)}</span><span class="hud-group-n">${entradas.length}</span></div>`
              + entradas.map(([name, qty]) => fila(name, qty, clase, acorta(name))).join("")
            : "";

        // label "PRIME" is in almost every name and steals width, the full name stays in the title
        const html = seccion(sh?.lblParts || "PRIME", orden(sessionInventory), "is-part",
            (n) => n.replace(/PRIME/gi, "").replace(/\s+/g, " ").trim() || n)
            + seccion(sh?.lblRelicsDetected || "RELICS", relicCount ? orden(sessionRelics) : [], "is-relic");
        if (html !== this._ultimaLista) {
            this._ultimaLista = html;
            listContainer.innerHTML = html;
        }
    }
};

export function toggleScannerHud() {
    const body = document.getElementById("inv-hud-body");
    const btn = document.getElementById("hud-collapse-btn");
    if (!body) return;
    const open = body.style.display === "none";
    body.style.display = open ? "flex" : "none";
    if (btn) {
        btn.textContent = open ? "▾" : "▸";
        btn.setAttribute("aria-expanded", String(open));
    }
}

export function renderOcrEngine() {
    const sh = TEXTS[state.currentLang].scannerHUD;
    const { decidido, elegido, listo } = estadoMotor();
    const preciso = elegido === MOTOR_PRECISO;
    const titulo = document.getElementById("lbl-ocr-engine");
    if (titulo) titulo.innerText = decidido ? sh.lblEngine : sh.engineAsk;
    const clasico = document.getElementById("btn-engine-classic");
    const red = document.getElementById("btn-engine-neural");
    if (clasico) {
        clasico.innerText = decidido ? sh.engineClassic : sh.engineDecline;
        clasico.dataset.active = decidido && !preciso ? "1" : "0";
    }
    if (red) {
        red.innerText = decidido ? sh.engineNeural : sh.engineAccept;
        red.dataset.active = decidido && preciso ? "1" : "0";
    }
    const hint = document.getElementById("lbl-ocr-engine-hint");
    if (hint) {
        hint.innerText = decidido
            ? (preciso ? (listo ? sh.hintNeural : sh.hintNeuralLoading) : sh.hintClassic)
            : sh.hintAsk;
    }
}

function setOcrEngine(motor) {
    aplicaMotor(motor);
    renderOcrEngine();
    if (motor === MOTOR_PRECISO) setTimeout(renderOcrEngine, 2500);
}

exposeGlobals({ toggleScannerHud, setOcrEngine }, "ui.components/ui_scanner_hud.js");
