import { state } from "../../state.js";
import { escapeHTML } from "../../utils/escape_html.js";
import { getWeaponImagePath } from "../../utils/rivens/weapon_image.js";
import { extractFamilyName } from "../../utils/rivens/riven_family.js";
import { getCuriosidades } from "../../services/rivens/curiosidades.service.js";

// Copia local de lo que devuelve el service, para que las funciones de pintado sean síncronas:
// el gráfico de hitos se construye al vuelo dentro de un render y no puede esperar a un await.
let _curioCache = null;   // { globales:[], eventos:[] }

// ---- Carrusel de curiosidades de mercado -------------------------------------------------
// Datos que genera curiosidades_gen.py a diario. Dos usos: el carrusel GLOBAL del índice (mezcla
// datos de todo el mercado con movimientos concretos) y uno POR ARMA en su ficha, que solo aparece
// si esa arma tuvo algún movimiento.
let _curioIdx = 0;
let _curioTimer = null;

// Chip + color por tipo. El color es la señal rápida: verde sube de verdad, rojo cae, ámbar humo.
const CURIO_TIPOS = {
  especulacion: { es: "Solo humo", en: "Just hype", clase: "curio-t-humo" },
  subida_venta: { es: "Se revaloriza", en: "Gaining value", clase: "curio-t-sube" },
  bajada_venta: { es: "Pierde valor", en: "Losing value", clase: "curio-t-baja" },
  desplome_ask: { es: "Burbuja pinchada", en: "Bubble popped", clase: "curio-t-pincha" },
  convergencia: { es: "Se paga más", en: "Paying more", clase: "curio-t-sube" },
  global_brecha: { es: "Dato del mercado", en: "Market fact", clase: "curio-t-global" },
  global_tendencia: { es: "Esta semana", en: "This week", clase: "curio-t-global" },
  global_actividad: { es: "Ahora mismo", en: "Right now", clase: "curio-t-global" },
  global_saturada: { es: "Más competencia", en: "Most crowded", clase: "curio-t-global" },
};

// curiosidades.json guarda el arma en minúsculas (viene del CSV); para mostrarla se busca la grafía
// real del catálogo, que es la que el usuario reconoce ("Riot-848", no "riot-848").
// Lee de la caché ya cargada: el gráfico se pinta al vuelo y no debe esperar a un fetch.
export function _curioEventosDe(weaponName) {
  if (!_curioCache || !Array.isArray(_curioCache.eventos)) return [];
  const nl = String(weaponName || "").toLowerCase();
  const fam = extractFamilyName(String(weaponName || "")).toLowerCase();
  return _curioCache.eventos.filter(e => {
    const a = String(e.arma || "").toLowerCase();
    return a === nl || a === fam;
  });
}

function _curioNombre(bruto) {
  const n = String(bruto || "");
  const k = state.weaponMap
    ? Object.keys(state.weaponMap).find(x => x.toLowerCase() === n.toLowerCase()) : null;
  return k || n;
}

function _curioFrase(e, isEs) {
  const arma = `<span class="curio-arma">${escapeHTML(_curioNombre(e.arma))}</span>`;
  const num = (v) => `${v > 0 ? "+" : ""}${v}%`;
  const pinta = (v) => `<span class="${v > 0 ? "curio-sube" : "curio-baja"}">${num(v)}</span>`;
  switch (e.tipo) {
    case "global_brecha":
      // Se dice "rolados" y "estimado" a propósito: la venta de rolados no se observa directamente
      // (DE solo publica la de sin rolar), se deduce del premium por ciclar. Sin ese matiz la frase
      // afirmaría un dato medido que no lo es.
      return isEs
        ? `Por un riven ya rolado se PIDEN ${e.ask}p de media y se PAGAN unos ${e.venta}p: <b>${e.valor}× de diferencia</b>. Fíjate en lo que se vende, no en el escaparate.`
        : `For an already-rolled riven sellers ASK ${e.ask}p on average while buyers PAY around ${e.venta}p: <b>a ${e.valor}× gap</b>. Watch what sells, not the shop window.`;
    case "global_tendencia":
      return isEs
        ? `El mercado de rivens se movió ${pinta(e.valor)} esta semana (mediana ${e.de}p → ${e.a}p).`
        : `The riven market moved ${pinta(e.valor)} this week (median ${e.de}p → ${e.a}p).`;
    case "global_actividad":
      return isEs
        ? `Hoy hay <b>${e.valor}</b> de ${e.total} armas con mercado activo. El resto tardarán en venderse.`
        : `<b>${e.valor}</b> of ${e.total} weapons have an active market today. The rest will be slow to sell.`;
    case "global_saturada":
      return isEs
        ? `${arma} es donde más competencia tienes ahora: <b>${e.valor} ofertas</b> vivas a la vez.`
        : `${arma} is the most crowded right now: <b>${e.valor} live listings</b> at once.`;
    case "especulacion":
      return isEs
        ? `Los vendedores de ${arma} subieron lo que piden ${pinta(e.ask_pct)} (${e.ask_de}p → ${e.ask_a}p) y las ventas reales no se movieron. <span class="curio-quieto">Piden más, pero nadie paga más.</span>`
        : `${arma} sellers raised asks ${pinta(e.ask_pct)} (${e.ask_de}p → ${e.ask_a}p) while real sales stood still. <span class="curio-quieto">They ask more, nobody pays more.</span>`;
    case "subida_venta":
      return isEs
        ? `${arma} se está pagando ${pinta(e.venta_pct)} más que hace una semana (${e.venta_de}p → ${e.venta_a}p en ventas reales).`
        : `${arma} is selling ${pinta(e.venta_pct)} higher than a week ago (${e.venta_de}p → ${e.venta_a}p in real sales).`;
    case "bajada_venta":
      return isEs
        ? `${arma} se paga ${pinta(e.venta_pct)} respecto a la semana pasada (${e.venta_de}p → ${e.venta_a}p). Si lo tienes, no esperes.`
        : `${arma} is selling ${pinta(e.venta_pct)} versus last week (${e.venta_de}p → ${e.venta_a}p). If you hold one, do not wait.`;
    case "desplome_ask":
      return isEs
        ? `Lo que piden por ${arma} cayó ${pinta(e.ask_pct)} (${e.ask_de}p → ${e.ask_a}p): los precios de escaparate se están ajustando.`
        : `Asking prices for ${arma} fell ${pinta(e.ask_pct)} (${e.ask_de}p → ${e.ask_a}p): shop-window prices are correcting.`;
    case "convergencia":
      return isEs
        ? `En ${arma} sube lo que se PAGA (${pinta(e.venta_pct)}) sin que suba lo que se pide: la brecha se cierra.`
        : `On ${arma} what people PAY is rising (${pinta(e.venta_pct)}) while asks hold: the gap is closing.`;
    default:
      return arma;
  }
}

// El movimiento se mide sobre una ventana de 7 días, así que se muestra el TRAMO. Fingir un día
// exacto sería más limpio visualmente y menos cierto.
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
  // Mismo mes: "10-17 jun". Distinto: "28 jun - 5 jul".
  const txt = a.m === b.m ? `${a.d}-${b.d} ${b.m}` : `${a.d} ${a.m} - ${b.d} ${b.m}`;
  return `<span class="curio-fecha">${escapeHTML(txt)}</span>`;
}

// Global = datos del mercado primero (orientan) y luego los movimientos, intercalados.
function _curioLista() {
  if (!_curioCache) return [];
  const g = _curioCache.globales || [];
  const ev = _curioCache.eventos || [];
  const out = [];
  for (let i = 0; i < Math.max(g.length, ev.length); i++) {
    if (i < g.length) out.push(g[i]);
    for (let k = 0; k < 3 && i * 3 + k < ev.length; k++) out.push(ev[i * 3 + k]);
  }
  return out;
}

// DE publica su tabla semanal los lunes y mueve ~380 armas de golpe. Situar el movimiento respecto
// a esa fecha distingue una reacción al dato nuevo de un vaivén cualquiera, que es justo lo que hace
// que el dato sea curioso y no anecdótico.
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
  // Reutiliza los nodos en vez de rehacer el innerHTML entero: al reemplazarlo, el <img> del icono
  // se recreaba y volvía a cargar, y eso era el parpadeo. Solo se toca el src cuando cambia el arma.
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
  void frase.offsetWidth;            // fuerza reflow para reiniciar la animación de entrada
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
  // Arranca por el principio y NO al azar: el generador ordena por fecha descendente, así que la
  // primera tarjeta es el movimiento más reciente. Los repintados posteriores respetan la posición
  // actual (renderRivenIndexList corre en cada orden/búsqueda y no debe reiniciar la rotación).
  _pintaCurio(cont, lista, _curioIdx);

  const mueve = (paso) => {
    _curioIdx = (_curioIdx + paso + lista.length) % lista.length;
    _pintaCurio(cont, lista, _curioIdx);
    if (_curioTimer) { clearInterval(_curioTimer); _curioTimer = setInterval(() => mueve(1), 9000); }
  };
  if (!cont.dataset.listo) {
    cont.querySelector("[data-curio-prev]")?.addEventListener("click", () => mueve(-1));
    cont.querySelector("[data-curio-next]")?.addEventListener("click", () => mueve(1));
    // Pausa al pasar por encima: si estás leyendo, no debe cambiar bajo el cursor.
    cont.addEventListener("mouseenter", () => { clearInterval(_curioTimer); _curioTimer = null; });
    cont.addEventListener("mouseleave", () => { if (!_curioTimer) _curioTimer = setInterval(() => mueve(1), 9000); });
    cont.dataset.listo = "1";
  }
  if (!_curioTimer) _curioTimer = setInterval(() => mueve(1), 9000);
}

/** Carrusel de la ficha del arma: solo sale si ESA arma tuvo movimientos. */
export async function renderCuriosidadesArma(weaponName) {
  const cont = document.getElementById("rivenCuriosidadesArma");
  if (!cont) return;
  cont.classList.add("hidden");
  const d = await _cargaCurios();
  if (!d) return;
  const nl = String(weaponName || "").toLowerCase();
  // También por familia: el riven es el mismo para todas las variantes.
  const fam = extractFamilyName(String(weaponName || "")).toLowerCase();
  const suyos = (d.eventos || []).filter(e => {
    const a = String(e.arma || "").toLowerCase();
    return a === nl || a === fam;
  });
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
  // Sin auto-avance aquí: son 1-2 eventos y el usuario está mirando la ficha, no paseando.
  cont.querySelectorAll("[data-curio-prev],[data-curio-next]").forEach(b => {
    b.style.display = suyos.length > 1 ? "" : "none";
  });
}
