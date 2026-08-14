/**
 * Kubrow Color Parser UI Component
 * Una sola vía: subir el EE.log -> lee el último conjunto de KubrowPetColor cargado
 * y lo traduce a nombres reales, rankeados por rareza. Incluye una explicación de
 * cómo forzar el registro del color (Arsenal -> Apariencia -> cambiar color) y el
 * guardado opcional de kubrows (nombre + raza) en localStorage.
 * Bilingüe: todo texto de UI sale de I18N[state.currentLang].
 */

import { state } from '../state.js';
import { translateColor, translateColorTier, getColorRarity, KUBROW_RARITY_LEVELS } from '../utils/vision/kubrow_translations.js';
import { COLOR_DESCRIPTIONS, PALETA_WARFRAME } from '../utils/vision/kubrow_color_extractor.js';

const SAVED_KEY = 'voidStonks_kubrows';

/** Escapa texto para inyección segura en innerHTML (el nombre lo teclea el usuario). */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Razas disponibles al guardar (valor interno estable; la etiqueta se muestra tal cual).
const BREEDS = ['Chesa', 'Huras', 'Sahasa', 'Raksa', 'Sunika', 'Helminth Charger', 'Kavat'];

/** Lee los kubrows guardados de localStorage. Nunca lanza. */
function loadSavedKubrows() {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** Persiste los kubrows guardados en localStorage. */
function persistSavedKubrows(list) {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('[KubrowUI] No se pudo guardar en localStorage:', e);
  }
}

// Nombre real -> hex, para la muestra de color junto a cada fila. La paleta usa
// algunos nombres con matiz entre paréntesis ("Shadow Grey (Cream)"), así que
// indexamos también por el nombre base sin ese sufijo.
const COLOR_HEX_BY_NAME = {};
for (const [name, hex] of Object.entries(PALETA_WARFRAME)) {
  COLOR_HEX_BY_NAME[name] = hex;
  const base = name.replace(/\s*\(.*\)\s*$/, '').trim();
  if (base && !(base in COLOR_HEX_BY_NAME)) COLOR_HEX_BY_NAME[base] = hex;
}

// Ilustración SVG de la cabeza de kubrow (frontal, simétrica) usada como cabecera de
// la ventana. Animaciones (respiración, tic de orejas, ojos y marca de Lotus) en
// styles.css bajo el prefijo .kubrow-svg-*. El cian de los ojos usa el de la app.
const KUBROW_SVG = `
  <svg class="kubrow-hero-svg" viewBox="0 0 500 500" xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="kb-fur" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#4a3b32"/>
        <stop offset="100%" stop-color="#140f0c"/>
      </linearGradient>
      <linearGradient id="kb-accent" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#d6c5b4"/>
        <stop offset="100%" stop-color="#735e4d"/>
      </linearGradient>
      <linearGradient id="kb-inner-ear" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#5e353b"/>
        <stop offset="100%" stop-color="#241315"/>
      </linearGradient>
      <filter id="kb-glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="4" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    </defs>

    <g class="kubrow-svg-head">
      <path d="M 120,280 Q 250,550 380,280 Q 320,420 250,450 Q 180,420 120,280 Z" fill="url(#kb-fur)"/>
      <path d="M 250,110 L 160,170 L 130,280 L 250,410 L 370,280 L 340,170 Z" fill="url(#kb-fur)"/>

      <g class="kubrow-svg-ear-left">
        <path d="M 160,170 Q 110,60 40,30 Q 90,140 130,280 Q 145,225 160,170 Z" fill="url(#kb-fur)"/>
        <path d="M 152,175 Q 105,75 55,45 Q 95,135 135,255 Q 145,215 152,175 Z" fill="url(#kb-inner-ear)"/>
      </g>
      <g class="kubrow-svg-ear-right">
        <path d="M 340,170 Q 390,60 460,30 Q 410,140 370,280 Q 355,225 340,170 Z" fill="url(#kb-fur)"/>
        <path d="M 348,175 Q 395,75 445,45 Q 405,135 365,255 Q 355,215 348,175 Z" fill="url(#kb-inner-ear)"/>
      </g>

      <path d="M 250,110 L 200,190 L 250,250 L 300,190 Z" fill="url(#kb-accent)"/>
      <path d="M 130,280 Q 160,340 210,310 Q 180,260 170,210 Z" fill="url(#kb-accent)"/>
      <path d="M 370,280 Q 340,340 290,310 Q 320,260 330,210 Z" fill="url(#kb-accent)"/>
      <path d="M 195,245 Q 250,265 305,245 Q 310,320 250,385 Q 190,320 195,245 Z" fill="url(#kb-accent)"/>
      <path d="M 220,255 L 250,350 L 280,255 Q 250,270 220,255 Z" fill="url(#kb-fur)"/>

      <path d="M 233,375 Q 250,362 267,375 L 250,398 Z" fill="#0c0c0c"/>
      <path d="M 248,375 L 252,375 L 250,390 Z" fill="#333"/>
      <path d="M 220,390 Q 250,425 280,390 Q 250,405 220,390 Z" fill="#241c19"/>

      <g class="kubrow-svg-lotus">
        <path d="M 250,125 Q 242,145 250,155 Q 258,145 250,125 Z"/>
        <path d="M 235,140 Q 225,155 245,165 Q 245,150 235,140 Z"/>
        <path d="M 265,140 Q 275,155 255,165 Q 255,150 265,140 Z"/>
        <path d="M 245,168 Q 250,172 255,168 Q 250,164 245,168 Z"/>
      </g>

      <path class="kubrow-svg-eye" d="M 175,235 Q 200,245 215,260 Q 190,255 175,235 Z" filter="url(#kb-glow)"/>
      <path class="kubrow-svg-eye" d="M 325,235 Q 300,245 285,260 Q 310,255 325,235 Z" filter="url(#kb-glow)"/>
    </g>
  </svg>
`;

const I18N = {
  es: {
    title: 'Rareza de Colores de Kubrow',
    intro: 'Sube tu <strong>EE.log</strong> para leer los colores de pelaje de tu kubrow y ver su rareza. Los colores más raros suelen valer más.',
    howTitle: 'Cómo conseguir los colores de tu kubrow',
    howSteps: [
      'En el juego, entra al <strong>Arsenal</strong> y abre la vista de tu <strong>kubrow</strong> (companion). Con solo verlo, el juego ya registra sus colores.',
      'Vuelve al orbitador o abre otro menú para forzar el guardado del <strong>EE.log</strong>.',
      'Sube aquí ese EE.log: se leen los colores del último kubrow mostrado y su rareza.',
    ],
    howLogPath: 'El EE.log está en <code>%LOCALAPPDATA%\\\\Warframe\\\\EE.log</code> (Windows).',
    howNote: 'Si los colores no cambian al volver a subir: el juego tarda unos segundos en escribir el EE.log. Vuelve al orbitador o abre otro menú para forzar el guardado, y comprueba la fecha del archivo antes de subirlo.',
    logTitle: 'Subir EE.log',
    logDesc: 'Lee el <strong>último conjunto de KubrowPetColor</strong> cargado en el log y lo traduce a nombres reales.',
    dropHere: 'Arrastra tu EE.log aquí o haz clic para seleccionarlo',
    maxSize: 'Tamaño máximo: 100MB',
    selectLog: 'Seleccionar EE.log',
    parseLog: 'Analizar EE.log',
    fileTooBig: 'El archivo supera el límite de 100MB',
    fileSelected: (name, mb, when) => `Archivo seleccionado: ${name} (${mb} MB)${when ? ` · modificado ${when}` : ''}`,
    analyzing: 'Analizando archivo...',
    analyzed: 'Análisis completado',
    noColorInLog: 'No se encontró ningún KubrowPetColor en el log',
    readError: (msg) => `Error al leer archivo: ${msg}`,
    noColors: 'Sin colores detectados',
    rankHeading: 'Colores detectados (ordenados por rareza)',
    source: 'Rareza según el colour chart de la comunidad de criadores de kubrows.',
    saveHeading: 'Guardar este kubrow (opcional)',
    saveName: 'Nombre',
    saveNamePh: 'Ej: Void Prime (opcional)',
    saveBreed: 'Raza',
    saveBreedNone: '-- Sin especificar --',
    saveBtn: 'Guardar kubrow',
    saveNothing: 'Detecta colores primero para poder guardar.',
    saved: 'Kubrow guardado',
    savedHeading: 'Kubrows guardados',
    savedEmpty: 'Aún no has guardado ningún kubrow.',
    savedNoName: 'Sin nombre',
    savedDelete: 'Borrar',
    savedClear: 'Borrar todos',
    savedConfirmClear: '¿Borrar todos los kubrows guardados?',
  },
  en: {
    title: 'Kubrow Color Rarity',
    intro: 'Upload your <strong>EE.log</strong> to read your kubrow\'s fur colors and see their rarity. Rarer colors tend to be worth more.',
    howTitle: 'How to get your kubrow colors',
    howSteps: [
      'In game, open the <strong>Arsenal</strong> and view your <strong>kubrow</strong> (companion). Just viewing it makes the game log its colors.',
      'Return to the orbiter or open another menu to force the <strong>EE.log</strong> to save.',
      'Upload that EE.log here: it reads the colors of the last kubrow shown and their rarity.',
    ],
    howLogPath: 'The EE.log lives at <code>%LOCALAPPDATA%\\\\Warframe\\\\EE.log</code> (Windows).',
    howNote: 'If the colors do not change when you re-upload: the game takes a few seconds to write the EE.log. Return to the orbiter or open another menu to force the save, and check the file date before uploading.',
    logTitle: 'Upload EE.log',
    logDesc: 'Reads the <strong>last KubrowPetColor set</strong> loaded in the log and translates it to real names.',
    dropHere: 'Drag your EE.log here or click to select it',
    maxSize: 'Max size: 100MB',
    selectLog: 'Select EE.log',
    parseLog: 'Parse EE.log',
    fileTooBig: 'File exceeds the 100MB limit',
    fileSelected: (name, mb, when) => `Selected file: ${name} (${mb} MB)${when ? ` · modified ${when}` : ''}`,
    analyzing: 'Parsing file...',
    analyzed: 'Parsing complete',
    noColorInLog: 'No KubrowPetColor found in the log',
    readError: (msg) => `Error reading file: ${msg}`,
    noColors: 'No colors detected',
    rankHeading: 'Detected colors (sorted by rarity)',
    source: 'Rarity based on the community kubrow breeders colour chart.',
    saveHeading: 'Save this kubrow (optional)',
    saveName: 'Name',
    saveNamePh: 'e.g. Void Prime (optional)',
    saveBreed: 'Breed',
    saveBreedNone: '-- Unspecified --',
    saveBtn: 'Save kubrow',
    saveNothing: 'Detect colors first to be able to save.',
    saved: 'Kubrow saved',
    savedHeading: 'Saved kubrows',
    savedEmpty: 'You have not saved any kubrow yet.',
    savedNoName: 'Unnamed',
    savedDelete: 'Delete',
    savedClear: 'Delete all',
    savedConfirmClear: 'Delete all saved kubrows?',
  },
};

// Máx. de slots de color de pelaje que aplica un kubrow (primario, secundario,
// terciario, emisivo/energía). Un set del jugador cabe en pocos códigos.
const MAX_KUBROW_COLOR_SLOTS = 6;
// Un set real de kubrow trae su slot de OJOS + varios de pelaje en el MISMO frame de
// carga (idéntico timestamp). Si el frame tiene MÁS colores que esto, es el CATÁLOGO
// que el juego precarga (decenas de colores de todas las razas), no una selección.
const CATALOG_FRAME_THRESHOLD = 8;

// Máximo salto (segundos, timestamp del EE.log) entre dos líneas de color consecutivas
// para considerarlas parte del MISMO spot-build (evento de "ver kubrow" en el Arsenal).
const MAX_COLOR_FRAME_GAP_SECONDS = 0.05;
// Categoría del slot ignorando el sufijo de color (MidD -> Mid, VibrantF -> Vibrant).
const CATEGORY_RE = /^(Mundane|Mid|Vibrant|Accent|Eyes)/;

/**
 * MÉTODO MÁS RÁPIDO Y FIABLE (verificado contra EE.log reales):
 *
 * Al ENTRAR a la pantalla del companion en el Arsenal, el juego "construye" el kubrow
 * equipado y escribe sus colores en spot-builds consecutivos separados por milisegundos
 * -a veces cruzando el límite de un timestamp a otro (127.581 -> 127.582)-, así que
 * agrupamos por VENTANA de proximidad temporal en vez de exigir el mismo timestamp
 * exacto. No hace falta cambiar ningún color ni abrir Apariencia: basta con abrir la
 * vista del kubrow.
 *
 * El juego tampoco reescribe SIEMPRE el set completo: si un slot (Mundane/Mid/
 * Vibrant/Accent/Eyes) ya está cacheado en memoria de una visita anterior, ese
 * spot-building no se repite y el log solo registra los slots que cambiaron (a veces
 * uno solo, aunque hayan pasado minutos desde la visita anterior). Por eso ACUMULAMOS
 * frames consecutivos, dejando que cada categoría nueva SUSTITUYA a la anterior del
 * mismo tipo (refresco de slot cacheado, mismo kubrow). Un frame con slot Eyes SIEMPRE
 * se recarga al ver un companion (es la señal más fiable de "el jugador está viendo un
 * kubrow ahora"), así que ese frame cierra el set anterior y abre uno nuevo.
 *
 * Distinguimos el CATÁLOGO (precarga masiva al arrancar) porque el frame de un kubrow
 * real:
 *   - tiene POCAS líneas (<= CATALOG_FRAME_THRESHOLD), y
 *   - es 100% KubrowPet (el catálogo mezcla colores de Catbrow en el mismo frame).
 *
 * Devuelve TODOS los sets acumulados hallados (uno por kubrow visto), del más antiguo
 * al más reciente, cada uno como { codes: string[], ts, line }.
 * NO se deduplica dentro de un set: un kubrow puede repetir color en dos categorías.
 */
function extractKubrowColorSets(text) {
  if (!text) return [];

  // 1. Recolectar apariciones de color. Contamos por separado Kubrow y Catbrow: un
  //    frame con Catbrow es catálogo, no un set.
  const reTs = /^\s*([\d.]+)\s/;
  const reKubrow = /\/KubrowPet\/Colors\/KubrowPetColor([A-Za-z]+)/;
  const reCatbrow = /\/CatbrowPet\/Colors\//;
  const reAnyPetColor = /\/(?:Kubrow|Catbrow)Pet\/Colors\//;

  const lines = text.split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!reAnyPetColor.test(line)) continue;
    const tsM = line.match(reTs);
    const ts = tsM ? parseFloat(tsM[1]) : NaN;
    const isCatbrow = reCatbrow.test(line);
    const km = isCatbrow ? null : line.match(reKubrow);
    hits.push({ line: i, ts, isCatbrow, code: km ? 'KubrowPetColor' + km[1] : null, suffix: km ? km[1] : null });
  }
  if (!hits.length) return [];

  // 2. Agrupar en frames por ventana temporal corta (gap <= MAX_COLOR_FRAME_GAP_SECONDS
  //    entre hits consecutivos). Sin timestamp (NaN) cada hit va en su propio frame.
  const frames = []; // [{ kubrow: [{code,isEyes,category,line}], catbrow: n, total: n, line, lastTs }]
  let current = null;
  for (const h of hits) {
    const gapOk = current && !Number.isNaN(h.ts) && !Number.isNaN(current.lastTs)
      ? (h.ts - current.lastTs) <= MAX_COLOR_FRAME_GAP_SECONDS
      : false;
    if (!current || !gapOk) {
      current = { kubrow: [], catbrow: 0, total: 0, line: h.line, lastTs: h.ts };
      frames.push(current);
    }
    current.total++;
    current.lastTs = Number.isNaN(h.ts) ? current.lastTs : h.ts;
    if (h.isCatbrow) { current.catbrow++; continue; }
    if (h.code) {
      current.kubrow.push({
        code: h.code,
        isEyes: /Eyes/i.test(h.code),
        category: (h.suffix.match(CATEGORY_RE) || [null, h.suffix])[1],
        line: h.line,
      });
      current.line = h.line; // último line del frame, para el orden temporal
    }
  }

  // 3. Descartar catálogo (frames grandes o que mezclan Catbrow).
  const validFrames = frames.filter((f) => f.total <= CATALOG_FRAME_THRESHOLD && f.catbrow === 0 && f.kubrow.length > 0);
  if (!validFrames.length) return [];

  // 4. Acumular frames válidos consecutivos en sets: cada categoría nueva SUSTITUYE
  //    a la anterior del mismo tipo (mismo kubrow, slot refrescado). Un frame con
  //    Eyes marca "kubrow nuevo visto": cierra el set anterior y abre uno nuevo.
  const sets = [];
  let slots = new Map(); // category -> {code, isEyes, line}
  const flush = () => {
    if (!slots.size) return;
    const codes = [...slots.values()]
      .filter((h) => !h.isEyes)
      .sort((a, b) => a.line - b.line)
      .map((h) => h.code)
      .slice(0, MAX_KUBROW_COLOR_SLOTS);
    const line = [...slots.values()].reduce((max, h) => Math.max(max, h.line), 0);
    if (codes.length) sets.push({ codes, ts: line, line });
    slots = new Map();
  };
  for (const f of validFrames) {
    if (f.kubrow.some((h) => h.isEyes)) flush();
    for (const h of f.kubrow) slots.set(h.category, { code: h.code, isEyes: h.isEyes, line: h.line });
  }
  flush();

  sets.sort((a, b) => a.line - b.line);
  return sets;
}

/** Colores del kubrow más reciente construido en el log (o [] si no hay ninguno). */
function extractLatestColorCodes(text) {
  const sets = extractKubrowColorSets(text);
  return sets.length ? sets[sets.length - 1].codes : [];
}

export class EELogParserUI {
  constructor(containerId) {
    this.containerId = containerId;
    // logCodes = últimos códigos KubrowPetColor leídos del EE.log; se conservan como
    // datos crudos para poder re-renderizar al cambiar de idioma sin perderlos.
    this.logCodes = null;
    this.saved = loadSavedKubrows();
    this.init();
  }

  get t() {
    return I18N[state.currentLang] || I18N.es;
  }

  get lang() {
    return state.currentLang === 'en' ? 'en' : 'es';
  }

  init() {
    this.createUI();
    this.setupEventListeners();
    // Re-render on language change (labels + already-detected color rows).
    state.subscribe('currentLang', () => this.setLanguage());
  }

  /** Re-monta la UI en el idioma actual, conservando los resultados detectados. */
  setLanguage() {
    if (!document.getElementById(this.containerId)) return;
    this.createUI();
    this.setupEventListeners();
    if (this.logCodes) this.renderColorsFromCodes('logColors', this.logCodes);
  }

  createUI() {
    const container = document.getElementById(this.containerId);
    if (!container) return;
    const t = this.t;

    container.innerHTML = `
      <div class="ee-log-parser-container">
        <div class="ee-log-header">
          <div class="kubrow-hero">${KUBROW_SVG}</div>
          <h2>${t.title}</h2>
          <p>${t.intro}</p>
        </div>

        <!-- CÓMO CONSEGUIR LOS COLORES -->
        <div class="kubrow-option-card kubrow-how-card">
          <h3 class="kubrow-option-title">${t.howTitle}</h3>
          <ol class="kubrow-how-steps">
            ${t.howSteps.map((s) => `<li>${s}</li>`).join('')}
          </ol>
          <p class="kubrow-how-path">${t.howLogPath}</p>
          <p class="kubrow-how-note">${t.howNote}</p>
        </div>

        <!-- SUBIR EE.LOG -->
        <div class="kubrow-option-card">
          <div class="kubrow-option-head">
            <div class="kubrow-option-heads">
              <h3 class="kubrow-option-title">${t.logTitle}</h3>
              <p class="kubrow-option-desc">${t.logDesc}</p>
            </div>
          </div>
          <div class="upload-area" id="uploadArea">
            <svg class="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            <h3>${t.dropHere}</h3>
            <p>${t.maxSize}</p>
            <input type="file" id="fileInput" accept=".log" style="display: none;">
          </div>
          <div class="upload-controls">
            <button id="selectFileBtn" class="btn btn-ghost">${t.selectLog}</button>
            <button id="parseBtn" class="btn btn-primary" ${this.selectedFile ? '' : 'disabled'}>${t.parseLog}</button>
          </div>
          <div class="upload-status" id="uploadStatus" style="display: none;">
            <div class="status-content">
              <span id="statusText"></span>
              <div id="progressBar" class="progress-bar" style="display: none;">
                <div class="progress-fill" id="progressFill"></div>
              </div>
            </div>
          </div>
          <div id="logColors" class="kubrow-colors-result"></div>
        </div>

        <!-- KUBROWS GUARDADOS -->
        <div class="kubrow-option-card">
          <div class="kubrow-saved-head">
            <h3 class="kubrow-option-title">${t.savedHeading}</h3>
            <button id="kubrowClearBtn" class="btn btn-ghost kubrow-clear-btn" ${this.saved.length ? '' : 'style="display:none;"'}>${t.savedClear}</button>
          </div>
          <div id="savedKubrows" class="kubrow-saved-list"></div>
        </div>
      </div>
    `;

    this.renderSaved();
  }

  setupEventListeners() {
    const fileInput = document.getElementById('fileInput');
    const uploadArea = document.getElementById('uploadArea');
    const selectFileBtn = document.getElementById('selectFileBtn');
    const parseBtn = document.getElementById('parseBtn');

    selectFileBtn?.addEventListener('click', () => {
      // Reset del value: si el usuario reelige EXACTAMENTE el mismo archivo (el mismo
      // EE.log que acaba de actualizar en el juego), el navegador no dispara 'change'
      // salvo que el value se haya limpiado antes. Sin esto, "parece que no se actualiza".
      if (fileInput) fileInput.value = '';
      fileInput.click();
    });
    fileInput?.addEventListener('change', (e) => this.handleFileSelect(e));

    uploadArea?.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadArea.classList.add('dragover');
    });
    uploadArea?.addEventListener('dragleave', () => {
      uploadArea.classList.remove('dragover');
    });
    uploadArea?.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        fileInput.files = files;
        this.handleFileSelect({ target: fileInput });
      }
    });

    parseBtn?.addEventListener('click', () => this.parseFile());

    document.getElementById('kubrowClearBtn')?.addEventListener('click', () => this.clearSaved());
  }

  // ---- Subir EE.log ----

  handleFileSelect(e) {
    const file = e.target.files[0];
    const parseBtn = document.getElementById('parseBtn');
    if (!file) return;

    if (file.size > 100 * 1024 * 1024) {
      this.showStatus(this.t.fileTooBig);
      parseBtn.disabled = true;
      return;
    }
    this.selectedFile = file;
    parseBtn.disabled = false;
    // Mostramos la fecha de modificación para que se note si el EE.log es reciente
    // (el juego bufferiza la escritura; a veces el archivo aún no refleja el cambio).
    const when = file.lastModified ? new Date(file.lastModified).toLocaleString() : '';
    this.showStatus(this.t.fileSelected(file.name, (file.size / 1024 / 1024).toFixed(2), when));
  }

  async parseFile() {
    if (!this.selectedFile) return;
    this.showStatus(this.t.analyzing, true);

    try {
      const text = await this.selectedFile.text();
      const codes = extractLatestColorCodes(text);
      this.logCodes = codes;
      this.showStatus(codes.length ? this.t.analyzed : this.t.noColorInLog);
      this.renderColorsFromCodes('logColors', codes);
    } catch (err) {
      console.error(err);
      this.showStatus(this.t.readError(err.message));
    }
  }

  // ---- Render compartido ----

  /** Renderiza una lista de nombres de color (los que devuelve el extractor de imagen). */
  renderColorsFromCodes(targetId, codes) {
    const items = (codes || []).map((code) => ({
      label: translateColor(code),
      rarity: getColorRarity(code),
      tier: translateColorTier(code, this.lang),
      code,
    }));
    this.paintColors(targetId, items);
  }

  paintColors(targetId, items) {
    const el = document.getElementById(targetId);
    if (!el) return;

    if (!items.length) {
      el.innerHTML = `<div class="no-results">${this.t.noColors}</div>`;
      return;
    }

    // Ranking por rareza descendente (más raro primero).
    items.sort((a, b) => b.rarity - a.rarity);
    const t = this.t;

    el.innerHTML = `
      <h4 class="kubrow-colors-heading">${t.rankHeading}</h4>
      <div class="kubrow-color-list">
        ${items.map((it) => this.colorRow(it)).join('')}
      </div>
      <p class="kubrow-colors-source">${t.source}</p>

      <div class="kubrow-save-form">
        <h5 class="kubrow-save-heading">${t.saveHeading}</h5>
        <div class="kubrow-save-fields">
          <label class="kubrow-save-field">
            <span>${t.saveName}</span>
            <input type="text" class="wf-input kubrow-save-name" placeholder="${t.saveNamePh}" maxlength="40" autocomplete="off">
          </label>
          <label class="kubrow-save-field">
            <span>${t.saveBreed}</span>
            <select class="wf-input kubrow-save-breed">
              <option value="">${t.saveBreedNone}</option>
              ${BREEDS.map((b) => `<option value="${b}">${b}</option>`).join('')}
            </select>
          </label>
          <button class="btn btn-primary kubrow-save-btn">${t.saveBtn}</button>
        </div>
      </div>
    `;

    // Snapshot inmutable de los colores para persistir tal cual al guardar.
    const colorsSnapshot = items.map((it) => ({
      label: it.label,
      rarity: it.rarity,
      tier: it.tier || null,
      code: it.code || null,
    }));

    el.querySelector('.kubrow-save-btn')?.addEventListener('click', () => {
      const name = el.querySelector('.kubrow-save-name')?.value.trim() || '';
      const breed = el.querySelector('.kubrow-save-breed')?.value || '';
      this.saveKubrow({ name, breed, colors: colorsSnapshot });
    });
  }

  // ---- Guardar / listar kubrows ----

  saveKubrow(entry) {
    if (!entry.colors || !entry.colors.length) return;
    const record = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: entry.name || '',
      breed: entry.breed || '',
      colors: entry.colors,
      savedAt: new Date().toISOString(),
    };
    this.saved.unshift(record);
    persistSavedKubrows(this.saved);
    this.renderSaved();

    // Botón "borrar todos" visible en cuanto hay algo guardado.
    const clearBtn = document.getElementById('kubrowClearBtn');
    if (clearBtn) clearBtn.style.display = '';

    globalThis.showToast?.(this.t.saved);
  }

  deleteKubrow(id) {
    this.saved = this.saved.filter((k) => k.id !== id);
    persistSavedKubrows(this.saved);
    this.renderSaved();
    if (!this.saved.length) {
      const clearBtn = document.getElementById('kubrowClearBtn');
      if (clearBtn) clearBtn.style.display = 'none';
    }
  }

  clearSaved() {
    if (!this.saved.length) return;
    if (!globalThis.confirm(this.t.savedConfirmClear)) return;
    this.saved = [];
    persistSavedKubrows(this.saved);
    this.renderSaved();
    const clearBtn = document.getElementById('kubrowClearBtn');
    if (clearBtn) clearBtn.style.display = 'none';
  }

  renderSaved() {
    const el = document.getElementById('savedKubrows');
    if (!el) return;
    const t = this.t;

    if (!this.saved.length) {
      el.innerHTML = `<div class="no-results">${t.savedEmpty}</div>`;
      return;
    }

    el.innerHTML = this.saved.map((k) => this.savedCard(k)).join('');
    el.querySelectorAll('.kubrow-saved-del').forEach((btn) => {
      btn.addEventListener('click', () => this.deleteKubrow(btn.dataset.id));
    });
  }

  savedCard(k) {
    const t = this.t;
    const name = k.name ? escapeHtml(k.name) : `<span class="kubrow-saved-noname">${t.savedNoName}</span>`;
    const breed = k.breed ? `<span class="kubrow-saved-breed">${escapeHtml(k.breed)}</span>` : '';
    const chips = (k.colors || [])
      .slice()
      .sort((a, b) => b.rarity - a.rarity)
      .map((c) => {
        const level = KUBROW_RARITY_LEVELS[c.rarity] || KUBROW_RARITY_LEVELS[0];
        const hex = COLOR_HEX_BY_NAME[c.label];
        const sw = hex ? `<span class="kubrow-color-swatch" style="background:${hex};"></span>` : '';
        return `<span class="kubrow-saved-chip" style="border-color:${level.color};">${sw}${escapeHtml(c.label)}</span>`;
      })
      .join('');

    return `
      <div class="kubrow-saved-card">
        <div class="kubrow-saved-info">
          <div class="kubrow-saved-title">${name} ${breed}</div>
          <div class="kubrow-saved-chips">${chips}</div>
        </div>
        <button class="btn btn-ghost kubrow-saved-del" data-id="${k.id}">${t.savedDelete}</button>
      </div>
    `;
  }

  colorRow(it) {
    const level = KUBROW_RARITY_LEVELS[it.rarity] || KUBROW_RARITY_LEVELS[0];
    const rarityLabel = level[this.lang];
    const desc = COLOR_DESCRIPTIONS[it.label];
    const tier = it.tier ? ` · ${it.tier}` : '';
    const codeTag = it.code ? `<span class="asset-code">${it.code}</span>` : '';
    const hex = COLOR_HEX_BY_NAME[it.label];
    const swatch = hex ? `<span class="kubrow-color-swatch" style="background:${hex};"></span>` : '';
    return `
      <div class="kubrow-color-row" style="border-left-color:${level.color};">
        <div class="kubrow-color-main">
          ${swatch}
          <span class="kubrow-color-name" ${desc ? `title="${desc}"` : ''}>${it.label}${tier}</span>
          ${codeTag}
        </div>
        <span class="kubrow-rarity-badge" style="color:${level.color};border-color:${level.color};">${rarityLabel}</span>
      </div>
    `;
  }

  showStatus(message, showProgress = false) {
    const statusEl = document.getElementById('uploadStatus');
    const statusText = document.getElementById('statusText');
    const progressBar = document.getElementById('progressBar');
    if (statusEl) statusEl.style.display = 'block';
    if (statusText) statusText.textContent = message;
    if (progressBar) progressBar.style.display = showProgress ? 'block' : 'none';
  }
}

export default EELogParserUI;
