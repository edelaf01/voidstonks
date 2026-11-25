import { state, TABS } from "../state.js";
import { TEXTS } from "../config.js";
import { exposeGlobals } from "./global_registry.js";
import { writeTabHash, readHashState } from "./tab_hash.js";

const MAX_PILA = 8;
const SUBVISTAS = ["bounties", "weapons", "traders"];
const SHARE_TABS = new Set(["relic", "set", "riven"]);
const SHARE_ICON_SVG = '<svg class="deeplink-share-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>';
const pila = [];
const ctxPorTab = {};
let chip = null;
let chipTab = "";
let shareRow = null;
let shareBtn = null;
let shareLabel = null;
let saltando = false;
let inicialPendiente = Boolean(readHashState(TABS)?.ctx);

const textos = () => TEXTS[state.currentLang]?.deeplinks || TEXTS.en.deeplinks;

function etiqueta(tab) {
  const btn = document.getElementById("btn-" + tab);
  if (!btn) return tab;
  const copia = btn.cloneNode(true);
  copia.querySelectorAll(".tab-wip-badge").forEach((n) => n.remove());
  return copia.textContent.trim() || tab;
}

function ctxActual(tab) {
  const h = readHashState(TABS);
  return h && h.tab === tab ? h.ctx : "";
}

function ctxCompartible() {
  const tab = state.activeTab;
  if (!SHARE_TABS.has(tab)) return "";
  return ctxActual(tab);
}

function aplicarTextosCompartir() {
  if (!shareBtn || !shareLabel) return;
  const label = textos().share;
  shareLabel.textContent = label;
  shareBtn.setAttribute("aria-label", label);
  shareBtn.title = label;
}

async function copiarTexto(texto) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {}
  }
  const area = document.createElement("textarea");
  area.value = texto;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  area.setSelectionRange?.(0, texto.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  } finally {
    area.remove();
  }
  return ok;
}

async function copiarEnlaceActual() {
  const ctx = ctxCompartible();
  if (!ctx) return;
  const url = new URL(globalThis.location.href);
  url.hash = `#${state.activeTab}/${encodeURIComponent(ctx)}`;
  const ok = await copiarTexto(url.href);
  const t = textos();
  globalThis.showToast?.(ok ? t.copied : t.copyError, {
    type: ok ? "success" : "error",
    duration: ok ? 2500 : 3500,
    tag: "deeplink-share",
  });
}

function ensureShareBtn() {
  if (shareRow) return shareRow;
  const area = document.querySelector(".content-area");
  if (!area) return null;
  shareRow = document.createElement("div");
  shareRow.className = "deeplink-share-row";
  shareRow.hidden = true;
  shareBtn = document.createElement("button");
  shareBtn.type = "button";
  shareBtn.className = "deeplink-share";
  shareBtn.disabled = true;
  shareBtn.innerHTML = SHARE_ICON_SVG;
  shareLabel = document.createElement("span");
  shareBtn.appendChild(shareLabel);
  shareBtn.addEventListener("click", copiarEnlaceActual);
  shareRow.appendChild(shareBtn);
  const subtitle = document.getElementById("tab-subtitle");
  if (subtitle && subtitle.parentNode === area) {
    subtitle.insertAdjacentElement("afterend", shareRow);
  } else {
    area.prepend(shareRow);
  }
  aplicarTextosCompartir();
  return shareRow;
}

function syncShareBtn() {
  const ctx = ctxCompartible();
  if (!ctx) {
    if (shareRow) shareRow.hidden = true;
    if (shareBtn) shareBtn.disabled = true;
    return;
  }
  if (!ensureShareBtn()) return;
  shareRow.hidden = false;
  shareBtn.disabled = false;
}

export function syncCtxHash(tab, ctx = "") {
  if (!TABS.includes(tab)) return;
  const clean = String(ctx || "").trim();
  ctxPorTab[tab] = clean;
  if (inicialPendiente || state.activeTab !== tab) return;
  writeTabHash(tab, clean, { clear: !clean });
  syncShareBtn();
}

export function aplicarCtx(tab, ctx) {
  if (!ctx) return;
  if (tab === "relic") {
    state.selectedRelic = ctx;
    const input = document.getElementById("relicInput");
    if (input) input.value = ctx;
    globalThis.manualRelicUpdate?.();
  } else if (tab === "set") {
    const input = document.getElementById("setItemInput");
    if (input) input.value = ctx;
    globalThis.searchSet?.();
  } else if (tab === "riven") {
    import("../ui.components/rivens/ui_rivens.js")
      .then((m) => m.selectRivenWeapon(ctx))
      .catch(console.error);
  } else if (tab === "bounties" && SUBVISTAS.includes(ctx)) {
    import("../ui.components/farms/ui_farms.js")
      .then((m) => m.switchFarmsSubview(ctx))
      .catch(console.error);
  }
}

export function aplicarHashInicial() {
  const aplicar = inicialPendiente;
  inicialPendiente = false;
  if (!aplicar) {
    syncShareBtn();
    return;
  }
  const h = readHashState(TABS);
  if (h?.ctx && h.tab === state.activeTab) aplicarCtx(h.tab, h.ctx);
  syncShareBtn();
}

function ocultarChip() {
  pila.length = 0;
  chipTab = "";
  chip?.classList.add("hidden");
}

function mostrarChip(actual) {
  const previo = pila[pila.length - 1];
  if (!previo) return ocultarChip();
  if (!chip) {
    chip = document.createElement("button");
    chip.type = "button";
    chip.className = "deeplink-back hidden";
    chip.addEventListener("click", volver);
    document.body.appendChild(chip);
  }
  chipTab = actual;
  chip.textContent = textos().back.replace("{tab}", etiqueta(previo.tab));
  chip.classList.remove("hidden");
}

function irA(tab, ctx) {
  saltando = true;
  try {
    globalThis.switchTab(tab);
    aplicarCtx(tab, ctx);
    writeTabHash(tab, ctx || ctxPorTab[tab] || "");
  } finally {
    saltando = false;
  }
  syncShareBtn();
}

function volver() {
  const destino = pila.pop();
  if (!destino) return ocultarChip();
  irA(destino.tab, destino.ctx);
  mostrarChip(destino.tab);
}

export function navegarA({ tab, ctx = "" }) {
  if (!TABS.includes(tab)) return;
  const origen = state.activeTab;
  const previo = { tab: origen, ctx: ctxActual(origen) };
  irA(tab, ctx);
  if (origen === tab) return;
  pila.push(previo);
  if (pila.length > MAX_PILA) pila.shift();
  mostrarChip(tab);
}

document.addEventListener("vs:tab", (e) => {
  const mode = e.detail?.mode;
  if (!saltando && chipTab && mode !== chipTab) ocultarChip();
  if (inicialPendiente) {
    const h = readHashState(TABS);
    if (!h?.ctx || h.tab !== mode) inicialPendiente = false;
  }
  if (!saltando && !inicialPendiente && !e.detail?.fromHistory && SHARE_TABS.has(mode) && ctxPorTab[mode]) {
    writeTabHash(mode, ctxPorTab[mode]);
  }
  syncShareBtn();
});

globalThis.addEventListener?.("popstate", syncShareBtn);
globalThis.addEventListener?.("hashchange", syncShareBtn);

state.subscribe("currentLang", () => {
  aplicarTextosCompartir();
  if (chip && !chip.classList.contains("hidden") && pila.length) {
    chip.textContent = textos().back.replace("{tab}", etiqueta(pila[pila.length - 1].tab));
  }
});

exposeGlobals({ navegarA }, "utils/deeplinks.js");
