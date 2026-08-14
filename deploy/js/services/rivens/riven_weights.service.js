import { state } from "../../state.js";
import { extractFamilyName } from "../../utils/rivens/riven_family.js";

/**
 * Resolución de los pesos de stats de un riven: qué atributos valen y cuáles conviene evitar.
 *
 * Vivía dentro de ui_rivens.js, donde no se podía comprobar, y es de lo que más historia de
 * bugs acumula del repo — cada función de aquí abajo lleva el suyo escrito. Todas resuelven el
 * mismo problema de fondo: el endpoint indexa por nombre EXACTO de arma, pero un riven vale para
 * toda la familia, así que hay que caer a los datos del arma base cuando la variante no los trae.
 */

// (p. ej. "Heavy Attack Efficiency" no existe en armas no-melee).
const MELEE_ONLY_STATS = new Set([
  "range", "initial combo", "combo duration", "chance to gain extra combo count",
  "heavy attack efficiency", "heavy attack damage", "finisher damage",
  "critical chance on slide attack", "slide crit chance", "combo count chance",
]);
const RANGED_ONLY_STATS = new Set([
  "multishot", "punch through", "recoil", "weapon recoil", "magazine capacity",
  "ammo maximum", "reload speed", "projectile speed", "projectile flight speed", "zoom",
]);

/**
 * Pesos de stats resolviendo la FAMILIA cuando el arma concreta no los trae.
 *
 * Un riven de Warframe pertenece a la familia, no a la variante: el mismo mod entra en Obex y en
 * Prisma Obex, así que comparten el pool de stats y su valor relativo. Pero los metastats se
 * indexan por nombre exacto, y hay 21 armas sin `dynamic_weights` propios — al mostrar una de ellas
 * salía el aviso "· estimado" mientras su hermana sí se graduaba con datos, para el MISMO riven.
 *
 * @returns {object} el propio meta, o una copia con los dynamic_weights de la familia.
 */
export function metaConPesosDeFamilia(meta, weaponName) {
  if (!meta) return meta;

  const familia = extractFamilyName(String(weaponName || meta.name || ""));
  if (!familia) return meta;
  const tabla = globalThis.dynamicMetaStats || {};
  const fl = familia.toLowerCase();
  const clave = Object.keys(tabla).find(k => k.toLowerCase() === fl);
  const fam = clave ? tabla[clave] : null;
  if (!fam) return meta;

  // Un riven de Warframe sirve para TODA la familia (el mismo mod entra en Obex y en Prisma Obex),
  // así que la guía de atributos tiene que ser idéntica entre variantes. El endpoint las indexa por
  // nombre exacto y devuelve listas curadas DISTINTAS por variante: en Obex, -Combo Duration salía
  // como "peor negativa" y en Prisma Obex como "inocua BEST", para el mismo mod. Se toman del arma
  // base las listas y los pesos, y NADA más: disposición, precios y liquidez sí son de cada variante.
  const salida = { ...meta };
  for (const campo of ["dynamic_weights", "pos", "midPos", "neg", "midNeg", "pos_tier"]) {
    const propio = meta[campo];
    const vacio = !propio || (Array.isArray(propio) ? !propio.length : !Object.keys(propio).length);
    const deFam = fam[campo];
    const famTiene = deFam && (Array.isArray(deFam) ? deFam.length : Object.keys(deFam).length);
    if (famTiene && (vacio || clave.toLowerCase() !== String(weaponName || "").toLowerCase())) {
      salida[campo] = deFam;
    }
  }
  return salida;
}

/**
 * Pesos FINOS por stat del bundle de ML (`stat_weights.json`), aplanando los tiers S/A/B/F.
 *
 * Sirven para ordenar DENTRO de un tier, que es lo que `dynamic_weights` no permite: allí los mejores
 * stats saturan a 1.00 (Torid da CD/CC/Multishot los tres a 1.00) mientras que aquí se ve que
 * Multishot 0.998 manda sobre CD 0.756 y CC 0.754. Busca por nombre exacto y luego por familia.
 */
export function pesosFinosDeArma(weaponName, tipo = "pos") {
  const tabla = state.rivenStatWeights;
  if (!tabla || typeof tabla !== "object") return null;
  // Prisma Obex no está en stat_weights.json pero Obex sí: el riven es el mismo, así que la familia
  // resuelve el hueco igual que en metaConPesosDeFamilia.
  const candidatos = [String(weaponName || ""), extractFamilyName(String(weaponName || ""))];
  for (const nombre of candidatos) {
    if (!nombre) continue;
    const nl = nombre.toLowerCase();
    const clave = Object.keys(tabla).find(k => k.toLowerCase() === nl);
    // En `neg` un peso ALTO significa maldición inocua (Obex: Puncture 1.000 > Impact 0.947), así que
    // el mismo criterio de "más alto = mejor" vale para los dos grupos.
    const grupo = clave && tabla[clave] && tabla[clave][tipo];
    if (!grupo || typeof grupo !== "object") continue;
    const plano = {};
    for (const tier of Object.values(grupo)) {
      if (tier && typeof tier === "object") Object.assign(plano, tier);
    }
    if (Object.keys(plano).length) return plano;
  }
  return null;
}

/**
 * Stats de un arma cuyo peso NO sale de sus propias subastas, sino del prior global.
 *
 * `ML_local` los marca en `baja_confianza`: son stats que nunca aparecieron en un listado de esa
 * arma, así que su peso es una suposición razonable, no evidencia. Sirven para TASAR (si tu riven
 * lleva ese stat hay que ponerle precio igual), pero recomendarlos en la guía sería inventar: le
 * estarías diciendo al usuario "busca este stat" sin que nadie lo haya vendido nunca en esa arma.
 * Mediana del catálogo: 12% de los stats por arma.
 *
 * `grupo` importa: `baja_confianza` solo mira los POSITIVOS del arma, y aplicarla también a las
 * negativas borraba stats con datos de sobra. Torid tiene 561 subastas con -Zoom, pero como
 * +Zoom casi no se lista, Zoom caía en `baja_confianza` y desaparecía de "mejores negativos".
 * `baja_confianza_neg` (mismo cálculo sobre el lado negativo) llega con el próximo reentreno;
 * mientras no esté, las negativas NO se filtran, que es lo correcto: sin lista propia no hay
 * evidencia de que falte el dato.
 */
export function statsSinDatoPropio(weaponName, grupo = "pos") {
  const tabla = state.rivenStatWeights;
  if (!tabla || typeof tabla !== "object") return new Set();
  const campo = grupo === "neg" ? "baja_confianza_neg" : "baja_confianza";
  const candidatos = [String(weaponName || ""), extractFamilyName(String(weaponName || ""))];
  for (const nombre of candidatos) {
    if (!nombre) continue;
    const nl = nombre.toLowerCase();
    const clave = Object.keys(tabla).find(k => k.toLowerCase() === nl);
    const lista = clave && tabla[clave] && tabla[clave][campo];
    if (Array.isArray(lista)) return new Set(lista.map(s => String(s).toLowerCase()));
  }
  return new Set();
}

export function isStatAllowedForWeaponType(statName, weaponType) {
  const n = (statName || "").toLowerCase().trim();
  const t = (weaponType || "").toLowerCase();
  const isMelee = t.includes("melee") || t === "zaw" || t === "glaive";
  return isMelee ? !RANGED_ONLY_STATS.has(n) : !MELEE_ONLY_STATS.has(n);
}
