// Localiza la fila de tarjetas por el brillo del arte. El umbral es relativo
// (percentil) para no depender del tema ni de la resolución. colaRotulo alarga
// la banda hacia abajo porque el rótulo de la recompensa queda bajo el arte.

import { connectedComponents } from "./mission_complete_grid.js";

export function detectCardRow(img, { percentil = 0.97, minLado = 0.03, colaRotulo = 1.4, tolAncho = 0.25 } = {}) {
  const { data, width: W, height: H } = img;
  const lum = new Float32Array(W * H);
  for (let i = 0, p = 0; p < W * H; p++, i += 4) lum[p] = 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2];
  const orden = Float32Array.from(lum).sort();
  const corte = orden[Math.floor(orden.length * percentil)];
  const mask = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) if (lum[p] >= corte) mask[p] = 1;
  const comps = connectedComponents({ mask, w: W, h: H })
    .filter((c) => c.w >= W * minLado && c.h >= H * minLado);
  if (comps.length < 2) return null;
  // Las tarjetas son cajas del MISMO ancho en una fila. Sin exigir eso ganaba el arte del
  // fondo, que es más grande: en una captura, siluetas de 86, 51 y 30 px de ancho tapaban las
  // dos tarjetas de 61 y 62. Y gana el grupo con MÁS miembros, no el de más masa: dos manchas
  // del fondo pueden parecerse por azar, cuatro tarjetas iguales en fila no.
  const usados = new Set(); let mejor = null;
  for (const s of [...comps].sort((a, b) => b.area - a.area)) {
    if (usados.has(s)) continue;
    const g = comps.filter((c) => !usados.has(c) && c.y < s.y + s.h && c.y + c.h > s.y
      && Math.abs(c.w - s.w) <= s.w * tolAncho);
    if (g.length < 2) continue;
    for (const c of g) usados.add(c);
    const masa = g.reduce((a, c) => a + c.area, 0);
    if (!mejor || g.length > mejor.g.length || (g.length === mejor.g.length && masa > mejor.masa)) {
      mejor = { g, masa };
    }
  }
  if (!mejor) return null;
  const g = mejor.g;
  const y0 = Math.min(...g.map((c) => c.y)), y1 = Math.max(...g.map((c) => c.y + c.h));
  // La banda empieza DONDE ACABA el arte: el rótulo va debajo. Incluyéndolo, el recorte que
  // llega al OCR tenía 12.369 px de arte contra 3.283 de texto y Tesseract no leía nada.
  //
  // colaRotulo 1.4 y no 0.6 porque el rótulo puede ser de DOS líneas y su alto no escala con el
  // arte: con iconos pequeños la banda se quedaba corta y "Zephyr Prime Neuroptics Blueprint"
  // se leía como "Zephyr Prime Blueprint", que es otra pieza. Medido sobre cuatro capturas: con
  // 0.6 una da 3 ítems y uno mal; con 1.4 las cuatro dan 4 correctos.
  const alto = y1 - y0;
  // `columnas` en fracción del ancho: una palabra fuera de una tarjeta no puede ser el nombre
  // de una recompensa, y eso es lo único que separa "LOVOS"->LAVOS (bueno) de "FRONT"->FROST
  // (basura del HUD), que por texto son idénticas: un glifo y corrección única.
  //
  // La columna es la TARJETA, no la mancha de arte: el arte ocupa una fracción estrecha del
  // centro y el rótulo es más ancho, así que usar su caja dejaba el nombre fuera de su propia
  // columna (medido: cubrían el 27% del recorte). El ancho sale del PASO entre manchas.
  const columnas = columnasDesdeCentros(g.map((c) => c.x + c.w / 2), W,
    Math.max(...g.map((c) => c.w)) * 2);
  return { x: 0, w: W, y: y1, h: Math.round(Math.min(H - y1, alto * colaRotulo)), cardCount: g.length, columnas };
}

/**
 * Columnas (fracción del ancho) a partir de los centros de las manchas de una fila de cards.
 *
 * El ancho sale del PASO entre centros y no de la caja de cada mancha: la mancha —arte o
 * bloque de nombre— ocupa una fracción estrecha de su tarjeta, así que su caja deja el rótulo
 * fuera de su propia columna (medido: cubrían el 27% del recorte).
 *
 * @param {number} pasoFallback  ancho a usar con un solo centro, donde no hay salto que medir.
 */
export function columnasDesdeCentros(centros, W, pasoFallback = 0) {
  const cs = [...(centros || [])].sort((a, b) => a - b);
  if (!cs.length || !W) return undefined;
  const saltos = cs.slice(1).map((v, i) => v - cs[i]);
  const orden = [...saltos].sort((a, b) => a - b);
  const paso = orden.length ? orden[orden.length >> 1] : pasoFallback;
  if (!paso) return undefined;
  // Guarda de plausibilidad, por el mismo motivo que la de la banda: unas columnas basura
  // ganan siempre a no tenerlas, porque quien las recibe se las cree. Y aquí hacen daño ACTIVO,
  // no solo se pierden los rescates por tarjeta: el radio de dedup sale del ancho de columna,
  // así que un paso enano lo encoge y la misma tarjeta se devuelve dos veces (medido: dos
  // piezas de Zephyr en la misma columna).
  //
  // Dos condiciones, las dos con una medida detrás:
  //  - El PASO. Una tarjeta ocupa ~12,6 % del ancho del frame (WFInfo lo fija en 968/4 px sobre
  //    1920, y nuestras capturas dan 12,6-13,0 %), y la escala de UI del juego va del 50 al
  //    100 %, así que por debajo del 5 % no es una fila de tarjetas. Medido: las dos capturas
  //    que fallaban daban 1,6 % y 0,97 %.
  //  - La REGULARIDAD. Las tarjetas están equiespaciadas; unas manchas de arte cualesquiera no.
  //    Sin esto, tres centros pegados con uno lejos colaban un paso "mediano" plausible.
  const PASO_MIN = W * 0.05, PASO_MAX = W * 0.35;
  if (paso < PASO_MIN || paso > PASO_MAX) return undefined;
  if (saltos.some((g) => Math.abs(g - paso) > paso * 0.3)) return undefined;
  return cs.map((cx) => ({ x0: (cx - paso / 2) / W, x1: (cx + paso / 2) / W }));
}

/**
 * Pasa las columnas (fracción del FRAME) al sistema del recorte que ve el OCR, que se come un
 * margen por lado. Sin esto un ancla legítima cae fuera de su propia tarjeta.
 */
export function columnasEnRecorte(columnas, width, cropRect) {
    if (!columnas) return undefined;
    const margen = cropRect ? Math.floor(cropRect.w * 0.06) : Math.floor(width * 0.08);
    const ancho = (cropRect ? cropRect.w : width) - margen * 2;
    // El origen del recorte, no solo el margen: prepareRewardOCRCanvas empieza a dibujar en
    // cropRect.x + margen. Hoy las dos detecciones devuelven x=0, pero una banda ceñida en X
    // desplazaría todas las columnas justo lo que mide ese origen.
    const x0 = (cropRect ? Math.floor(cropRect.x) : 0) + margen;
    const f = (v) => (v * width - x0) / ancho;
    return columnas.map((c) => ({ x0: f(c.x0), x1: f(c.x1) }));
}

/**
 * Radio de dedup: dos candidatos a menos de esto son el MISMO rótulo.
 *
 * Es una fracción del PASO entre tarjetas, no del ancho de la imagen. El 0,1·W de antes
 * estaba calibrado sobre capturas a pantalla completa, donde el paso mide ~0,15·W; en
 * cuanto la fila ocupa menos —foto de móvil a un monitor, webcam, o el recorte a todo el
 * ancho que devuelve la banda detectada— el paso baja de 0,1·W y cada tarjeta se comía a
 * su vecina. Medido sobre 1164 recompensas sintéticas: con paso 0,09·W se leían 581, o
 * sea la mitad exacta, y sin ningún aviso.
 *
 * El tope sigue siendo el 0,1·W histórico y el factor 0,65 lo reproduce a pantalla
 * completa (0,65 × 0,15 ≈ 0,1), así que solo puede ENCOGER: si el paso sale mal medido
 * (dos nombres fundidos en una mancha) se vuelve al comportamiento de siempre.
 */
export function radioDeDedup(itemMatches, imgW, columnas) {
    const MAX = imgW * 0.1;
    const anchos = (columnas || []).map(c => (c.x1 - c.x0) * imgW).filter(v => v > 0).sort((a, b) => a - b);
    // Las columnas son de un paso de ancho por construcción (columnasDesdeCentros).
    const paso = anchos.length ? anchos[anchos.length >> 1] : pasoEntreTarjetas(itemMatches, imgW);
    return paso ? Math.min(MAX, paso * 0.65) : MAX;
}

/**
 * Paso entre tarjetas medido sobre los propios candidatos, para cuando nadie pasó columnas
 * (la vía de FOTO: reward_photo_ocr las deduce DESPUÉS de parsear, cuando el dedup ya se
 * comió las tarjetas). Solo se fía de una fila regular: tres o más centros equiespaciados
 * son tarjetas, dos coincidencias sueltas no distinguen "dos tarjetas" de "dos candidatos
 * del mismo rótulo" y encoger el radio por error duplicaría la recompensa.
 */
export function pasoEntreTarjetas(itemMatches, imgW) {
    const centros = [];
    for (const x of itemMatches.map(m => m.x).sort((a, b) => a - b)) {
        if (!centros.length || x - centros[centros.length - 1] > imgW * 0.03) centros.push(x);
    }
    if (centros.length < 3) return 0;
    const saltos = centros.slice(1).map((v, i) => v - centros[i]);
    const med = [...saltos].sort((a, b) => a - b)[saltos.length >> 1];
    return saltos.every(g => Math.abs(g - med) <= med * 0.3) ? med : 0;
}

/**
 * Las zonas donde hay un rótulo, para buscar tarjetas que no produjeron ninguna coincidencia.
 *
 * Con columnas detectadas son las columnas. Sin ellas —la detección puede no darlas, o darlas
 * implausibles y quedar descartadas— se usan los "PRIME" del recorte: toda pieza prime lo lleva
 * en el rótulo y es de las palabras que mejor lee el OCR, que es justo por lo que la vía de foto
 * ancla su scout ahí (y WFInfo su `findNameRowY`). Sin esto, una tarjeta cuya PRIMERA palabra
 * salió ilegible no tenía por dónde rescatarse: medido, "calisax" por "Caliban" perdía la carta.
 *
 * @param paso  ancho de tarjeta en px del recorte; la ventana es una tarjeta centrada en PRIME.
 */
export function zonasDeRotulo(columnas, palabras, imgW, paso) {
    if (columnas?.length) return columnas.map((c) => ({ x0: c.x0 * imgW, x1: c.x1 * imgW }));
    const ancho = (paso || imgW * 0.15) / 2;
    return palabras.filter((w) => w.text === "PRIME").map((w) => ({ x0: w.x - ancho, x1: w.x + ancho }));
}
