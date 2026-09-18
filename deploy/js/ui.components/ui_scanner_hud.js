import { state } from "../state.js";
import { TEXTS } from "../config.js";
import { escapeHTML } from "../utils/escape_html.js";
import { exposeGlobals } from "../utils/global_registry.js";
import { aplicaMotor, estadoMotor, MOTOR_PRECISO } from "../services/scanner/ocr_engine.service.js";
import { avisaContexto } from "./ui_scanner_coach.js";

/**
 * Component for the Scanner HUD (status badges, counters, scroll guides).
 */
export const ScannerHUD = {
    updateContext(contextType) {
        // Mismo motivo que updateScrollStatus: corre por frame y casi siempre repinta lo mismo.
        // La clave lleva todo lo que lee la función; updateDetectedItems la invalida cuando pisa
        // el badge, para que el siguiente frame lo restaure como hacía antes.
        const clave = `${contextType}|${state.squadRun ? 1 : 0}|${state.currentLang}`;
        if (clave === this._ultimoContexto) return;
        this._ultimoContexto = clave;
        const sh = TEXTS[state.currentLang].scannerHUD;
        const hud = document.getElementById("inv-hud");
        const badge = document.getElementById("hud-context-badge");
        this._ultimoTipo = contextType;
        this._muestraBloques();
        // La primera vez que aparece cada pantalla, una línea de qué está pasando. Va aquí
        // porque la guarda de arriba ya garantiza que esto solo corre cuando el contexto CAMBIA.
        avisaContexto(state.squadRun && contextType !== "INVENTORY" ? "SQUAD" : contextType);

        // The VOIDSCANNER inventory HUD is only for item scanning. The mod/riven context
        // (INVENTORY_MODS) uses the separate riven appraisal HUD, so keep this one hidden there.
        if (contextType === "INVENTORY") {
            if (hud) hud.style.display = "block";
            this.setUIBadge(badge, sh.statusInventory, "#f1c40f", "rgba(241,196,15,0.4)", "rgba(241,196,15,0.1)");
            const msgEl = document.getElementById("live-inv-msg");
            if (msgEl) msgEl.innerText = sh.statusIdle;
        } else if (state.squadRun) {
            // El panel del run vive DENTRO de este HUD, y esta función corre en cada frame:
            // durante una misión el contexto es UNKNOWN, así que sin esta rama el HUD se
            // volvía a esconder al frame siguiente de leer las reliquias del squad y el
            // panel no llegaba a verse nunca.
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

    /** Contexto y nº de detectados actuales, que es lo que decide qué bloques del HUD sobran. */
    _ultimoTipo: "UNKNOWN",
    _detectados: 0,

    /**
     * Escanear/guardar/rehacer rejilla solo hacen algo en el inventario, y la lista de
     * detectados con su rótulo ocupa media pantalla para decir "pulsa escanear" cuando estás
     * mirando el run de la escuadra. Se ocultan salvo que sirvan de algo.
     */
    _muestraBloques() {
        const inventario = this._ultimoTipo === "INVENTORY";
        for (const id of ["hud-actions", "hud-subactions"]) {
            const bloque = document.getElementById(id);
            if (bloque) bloque.style.display = inventario ? "" : "none";
        }
        // La lista sí se queda si YA hay algo detectado: esconderla perdería lo escaneado de vista.
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

    /** ¿Está abierto el panel de debug? Quien produzca imágenes caras debe preguntarlo antes. */
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

    // ── Historial de escaneos de debug ──────────────────────────────────────
    // history = ScannerService.debugHistory (más reciente primero). Cada nuevo
    // escaneo selecciona automáticamente la entrada 0; clicar una miniatura fija
    // esa entrada (imagen grande + summary) y COPY LOG copia SU log.
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
            // Las entradas grabadas con el panel cerrado no llevan imagen (ver el porqué en
            // scanner.service.js): sin esto el <img> se quedaba con src="null".
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
        // El escáner llama a esto en CADA frame (300 ms en inventario), casi siempre con el mismo
        // estado: reescribir el innerHTML idéntico obliga al navegador a reparsear y recrear los
        // dos <div> tres veces por segundo mientras la pantalla ni se mueve.
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

    // sessionRelics es opcional (Map relicName->qty) — reliquias detectadas en el mismo grid
    // de inventario vía el fallback de OCRService.getRelicMatch. Se pintan aparte (acento cian)
    // porque se persisten en un sitio distinto (state.inventory, no primeInventory).
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

        // El nombre va escapado aunque hoy salga de un catálogo cerrado: si mañana cambia de
        // origen, la defensa ya está puesta (misma regla que el resto de innerHTML del repo).
        const fila = (name, qty, clase, corto) => `<div class="hud-item ${clase}" title="${escapeHTML(name)}">
            <span class="hud-item-name">${escapeHTML(corto)}</span>
            <span class="hud-item-qty">×${escapeHTML(qty === null ? "?" : String(qty))}</span>
          </div>`;
        const orden = (mapa) => [...mapa.entries()].sort((a, b) => a[0].localeCompare(b[0]));
        const seccion = (titulo, entradas, clase, acorta = (n) => n) => entradas.length
            ? `<div class="hud-group"><span>${escapeHTML(titulo)}</span><span class="hud-group-n">${entradas.length}</span></div>`
              + entradas.map(([name, qty]) => fila(name, qty, clase, acorta(name))).join("")
            : "";

        // "PRIME" sale en casi todos los nombres y roba el ancho que necesita la pieza; el
        // nombre entero se queda en el title.
        const html = seccion(sh?.lblParts || "PRIME", orden(sessionInventory), "is-part",
            (n) => n.replace(/PRIME/gi, "").replace(/\s+/g, " ").trim() || n)
            + seccion(sh?.lblRelicsDetected || "RELICS", relicCount ? orden(sessionRelics) : [], "is-relic");
        // Se repinta una vez por página escaneada; si nada cambió, no se toca el DOM.
        if (html !== this._ultimaLista) {
            this._ultimaLista = html;
            listContainer.innerHTML = html;
        }
    }
};

/**
 * Pliega/despliega el cuerpo del HUD. Antes era una IIFE de ocho líneas dentro del
 * onclick del propio botón, así que ni el lint ni los tests la veían.
 */
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

/**
 * Pinta la elección de motor: la pregunta si no se ha contestado, y si ya se contestó,
 * qué quedó elegido y qué implica.
 *
 * El aviso de "preparando" no es decorativo: el motor preciso tarda en bajar su modelo y hasta
 * que está se lee con el clásico. Sin decirlo, el usuario ve que ha elegido uno y que los
 * resultados son los del otro, y parece que el botón no hace nada.
 */
export function renderOcrEngine() {
    const sh = TEXTS[state.currentLang].scannerHUD;
    const { decidido, elegido, listo } = estadoMotor();
    const preciso = elegido === MOTOR_PRECISO;
    // Sin contestar no hay opción que resaltar: es una pregunta, no un estado.
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
    // El preciso tarda en cargar; se repinta cuando ya puede leer para que el aviso desaparezca.
    if (motor === MOTOR_PRECISO) setTimeout(renderOcrEngine, 2500);
}

exposeGlobals({ toggleScannerHud, setOcrEngine }, "ui.components/ui_scanner_hud.js");
