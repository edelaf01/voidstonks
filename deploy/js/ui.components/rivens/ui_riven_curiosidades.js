import { state } from "../../state.js";
import { escapeHTML } from "../../utils/escape_html.js";
import { getWeaponImagePath } from "../../utils/rivens/weapon_image.js";
import { extractFamilyName } from "../../utils/rivens/riven_family.js";
import { getCuriosidades } from "../../services/rivens/curiosidades.service.js";
import { seEstaMirando } from "../../utils/shell.js";

// local copy so the render functions stay synchronous
let _curioCache = null;   // { globales:[], eventos:[] }

// Market curiosities carousel, from curiosidades_gen.py: a global one on the index and one per weapon on
// its page when that weapon moved.
let _curioIdx = 0;
let _curioTimer = null;

const CURIO_TIPOS = {
  subida_venta: { es: "Se revaloriza", en: "Gaining value", clase: "curio-t-sube" },
  bajada_venta: { es: "Pierde valor", en: "Losing value", clase: "curio-t-baja" },
  volatil: { es: "Precios dispersos", en: "Scattered prices", clase: "curio-t-humo" },
  global_weekly: { es: "Tabla de DE", en: "DE weekly", clase: "curio-t-global" },
  global_prima: { es: "Dato del mercado", en: "Market fact", clase: "curio-t-global" },
  global_cara: { es: "La más cara", en: "Top price", clase: "curio-t-global" },
};

export function _curioVisible(e) {
  if (!e || !Object.hasOwn(CURIO_TIPOS, e.tipo)) return false;
  return e.tipo.startsWith("global_") || (e.fuente === "de" && Number.isFinite(e.pct));
}

// curiosidades.json stores the weapon in lowercase: show the catalogue spelling
export function _curioEventosDe(weaponName) {
  if (!_curioCache || !Array.isArray(_curioCache.eventos)) return [];
  const nl = String(weaponName || "").toLowerCase();
  const fam = extractFamilyName(String(weaponName || "")).toLowerCase();
  return _curioCache.eventos.filter(e => {
    const a = String(e.arma || "").toLowerCase();
    return (a === nl || a === fam) && _curioVisible(e);
  });
}

function _curioNombre(bruto) {
  const n = String(bruto || "");
  const k = state.weaponMap
    ? Object.keys(state.weaponMap).find(x => x.toLowerCase() === n.toLowerCase()) : null;
  return k || n;
}

export function _curioFrase(e, isEs) {
  const arma = `<span class="curio-arma">${escapeHTML(_curioNombre(e.arma))}</span>`;
  const num = (v) => `${v > 0 ? "+" : ""}${v}%`;
  const pinta = (v) => `<span class="${v > 0 ? "curio-sube" : "curio-baja"}">${num(v)}</span>`;
  switch (e.tipo) {
    case "global_weekly":
      return isEs
        ? `En la última tabla semanal de DE la mediana de venta de rivens sin ciclar subió en <b>${e.suben}</b> armas y bajó en <b>${e.bajan}</b>.`
        : `In DE's latest weekly data the median sale of uncycled rivens rose for <b>${e.suben}</b> weapons and fell for <b>${e.bajan}</b>.`;
    case "global_prima":
      return isEs
        ? `Según las ventas de DE, un riven ya ciclado se paga de mediana <b>${e.valor}×</b> lo que uno sin ciclar del mismo arma (${e.armas} armas).`
        : `In DE's sales data a rolled riven sells for a median <b>${e.valor}×</b> an uncycled one of the same weapon (${e.armas} weapons).`;
    case "global_cara":
      return isEs
        ? `${arma} tiene la mediana de venta sin ciclar más alta de la tabla semanal de DE: <b>${e.valor}p</b>.`
        : `${arma} has the highest uncycled median sale in DE's weekly data: <b>${e.valor}p</b>.`;
    case "subida_venta":
    case "bajada_venta":
      return isEs
        ? `En la tabla semanal de DE, la mediana de venta de un riven de ${arma} sin ciclar pasó de ${e.de}p a ${e.a}p (${pinta(e.pct)}).`
        : `In DE's weekly data, the median sale of an uncycled ${arma} riven went from ${e.de}p to ${e.a}p (${pinta(e.pct)}).`;
    case "volatil":
      return isEs
        ? `En la tabla semanal de DE, las ventas de ${arma} sin ciclar se dispersaron: la desviación subió a <b>${e.a}×</b> la mediana (antes ${e.de}×). Hubo ventas muy lejos del precio habitual.`
        : `In DE's weekly data, uncycled ${arma} sales spread out: the deviation rose to <b>${e.a}×</b> the median (was ${e.de}×). Some sales landed far from the usual price.`;
    default:
      return arma;
  }
}

// the move is measured over a 7 day window, so the span is shown, not a single day
function _curioTramo(e, isEs) {
  if (!e.fecha) return "";
  const mes = (iso) => {
    const [, m, d] = String(iso).split("-");
    const M = isEs
      ? ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"]
      : ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return { d: String(Number(d)), m: M[Number(m) - 1] || "" };
  };
  const b = mes(e.fecha);
  if (!e.desde) return `<span class="curio-fecha">${b.d} ${b.m}</span>`;
  const a = mes(e.desde);
  // same month: "10-17 jun", otherwise "28 jun - 5 jul"
  const txt = a.m === b.m ? `${a.d}-${b.d} ${b.m}` : `${a.d} ${a.m} - ${b.d} ${b.m}`;
  return `<span class="curio-fecha">${escapeHTML(txt)}</span>`;
}

function _curioLista() {
  if (!_curioCache) return [];
  const g = (_curioCache.globales || []).filter(_curioVisible);
  const ev = (_curioCache.eventos || []).filter(_curioVisible);
  const out = [];
  for (let i = 0; i < Math.max(g.length, ev.length); i++) {
    if (i < g.length) out.push(g[i]);
    for (let k = 0; k < 3 && i * 3 + k < ev.length; k++) out.push(ev[i * 3 + k]);
  }
  return out;
}

// DE publishes its weekly table on Mondays: placing the move against it tells a reaction from noise
function _curioWeekly(e, isEs) {
  const d = e.dias_tras_weekly;
  if (d == null || d > 2) return "";
  const txt = d === 0
    ? (isEs ? "el día del weekly" : "on weekly day")
    : (isEs ? `${d}d tras el weekly` : `${d}d after weekly`);
  return `<span class="curio-weekly">${txt}</span>`;
}

function _pintaCurio(cont, lista, idx) {
  const txt = cont.querySelector("[data-curio-texto]");
  const dots = cont.querySelector("[data-curio-dots]");
  if (!txt || !lista.length) return;
  const isEs = state.currentLang === "es";
  const e = lista[idx % lista.length];
  // reuses the nodes: replacing the innerHTML reloaded the icon and flickered
  let icono = txt.querySelector(".curio-icon");
  let cuerpo = txt.querySelector(".curio-cuerpo");
  if (!cuerpo) {
    txt.innerHTML = `<img class="curio-icon" alt="" loading="lazy">
      <div class="curio-cuerpo"><div class="curio-cab"></div><div class="curio-frase"></div></div>`;
    icono = txt.querySelector(".curio-icon");
    cuerpo = txt.querySelector(".curio-cuerpo");
    icono.onerror = () => { icono.style.visibility = "hidden"; };
  }
  const src = e.arma ? getWeaponImagePath(_curioNombre(e.arma), null) : "";
  if (src && icono.getAttribute("src") !== src) {
    icono.setAttribute("src", src);
    icono.style.visibility = "visible";
  } else if (!src) {
    icono.removeAttribute("src");
    icono.style.visibility = "hidden";
  }
  const meta = CURIO_TIPOS[e.tipo] || { es: "Mercado", en: "Market", clase: "curio-t-global" };
  cuerpo.querySelector(".curio-cab").innerHTML =
    `<span class="curio-chip ${meta.clase}">${isEs ? meta.es : meta.en}</span>`
    + _curioTramo(e, isEs) + _curioWeekly(e, isEs);
  const frase = cuerpo.querySelector(".curio-frase");
  frase.innerHTML = _curioFrase(e, isEs);
  frase.classList.remove("curio-entra");
  void frase.offsetWidth;            // reflow to restart the entry animation
  frase.classList.add("curio-entra");
  if (e.arma) {
    txt.title = isEs ? `Ver ${_curioNombre(e.arma)}` : `View ${_curioNombre(e.arma)}`;
    txt.onclick = () => {
      const input = document.getElementById("rivenWeaponInput");
      if (!input) return;
      input.value = _curioNombre(e.arma);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    txt.style.cursor = "pointer";
  } else {
    txt.title = ""; txt.onclick = null; txt.style.cursor = "default";
  }
  if (dots) {
    const n = Math.min(lista.length, 8);
    dots.innerHTML = Array.from({ length: n },
      (_, i) => `<span class="${i === (idx % lista.length) % n ? "on" : ""}"></span>`).join("");
  }
}

async function _cargaCurios() {
  _curioCache = await getCuriosidades();
  return _curioCache;
}

export async function renderCuriosidades() {
  const cont = document.getElementById("rivenCuriosidades");
  if (!cont) return;
  const d = await _cargaCurios();
  const lista = _curioLista();
  if (!d || !lista.length) return;
  cont.classList.remove("hidden");
  // starts at the first card (the newest move); later repaints keep the position
  _pintaCurio(cont, lista, _curioIdx);

  const avanza = () => { if (seEstaMirando()) mueve(1); };
  const mueve = (paso) => {
    _curioIdx = (_curioIdx + paso + lista.length) % lista.length;
    _pintaCurio(cont, lista, _curioIdx);
    if (_curioTimer) { clearInterval(_curioTimer); _curioTimer = setInterval(avanza, 9000); }
  };
  if (!cont.dataset.listo) {
    cont.querySelector("[data-curio-prev]")?.addEventListener("click", () => mueve(-1));
    cont.querySelector("[data-curio-next]")?.addEventListener("click", () => mueve(1));
    cont.addEventListener("mouseenter", () => { clearInterval(_curioTimer); _curioTimer = null; });
    cont.addEventListener("mouseleave", () => { if (!_curioTimer) _curioTimer = setInterval(avanza, 9000); });
    cont.dataset.listo = "1";
  }
  if (!_curioTimer) _curioTimer = setInterval(avanza, 9000);
}

export function stopCuriosidades() {
  clearInterval(_curioTimer);
  _curioTimer = null;
}

export async function renderCuriosidadesArma(weaponName) {
  const cont = document.getElementById("rivenCuriosidadesArma");
  if (!cont) return;
  cont.classList.add("hidden");
  const d = await _cargaCurios();
  if (!d) return;
  const suyos = _curioEventosDe(weaponName);
  if (!suyos.length) return;
  cont.classList.remove("hidden");
  let i = 0;
  _pintaCurio(cont, suyos, i);
  if (!cont.dataset.listo) {
    cont.querySelector("[data-curio-prev]")?.addEventListener("click",
      () => _pintaCurio(cont, suyos, (i = (i - 1 + suyos.length) % suyos.length)));
    cont.querySelector("[data-curio-next]")?.addEventListener("click",
      () => _pintaCurio(cont, suyos, (i = (i + 1) % suyos.length)));
    cont.dataset.listo = "1";
  }
  cont.querySelectorAll("[data-curio-prev],[data-curio-next]").forEach(b => {
    b.style.display = suyos.length > 1 ? "" : "none";
  });
}
