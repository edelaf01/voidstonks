import { state } from "../../state.js";
import { extractFamilyName } from "../../utils/rivens/riven_family.js";

const MELEE_ONLY_STATS = new Set([
  "range", "initial combo", "combo duration", "chance to gain extra combo count",
  "heavy attack efficiency", "heavy attack damage", "finisher damage",
  "critical chance on slide attack", "slide crit chance", "combo count chance",
]);
const RANGED_ONLY_STATS = new Set([
  "multishot", "punch through", "recoil", "weapon recoil", "magazine capacity",
  "ammo maximum", "reload speed", "projectile speed", "projectile flight speed", "zoom",
]);

export function metaConPesosDeFamilia(meta, weaponName) {
  if (!meta) return meta;

  const familia = extractFamilyName(String(weaponName || meta.name || ""));
  if (!familia) return meta;
  const tabla = globalThis.dynamicMetaStats || {};
  const fl = familia.toLowerCase();
  const clave = Object.keys(tabla).find(k => k.toLowerCase() === fl);
  const fam = clave ? tabla[clave] : null;
  if (!fam) return meta;

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

export function pesosFinosDeArma(weaponName, tipo = "pos") {
  const tabla = state.rivenStatWeights;
  if (!tabla || typeof tabla !== "object") return null;
  const candidatos = [String(weaponName || ""), extractFamilyName(String(weaponName || ""))];
  for (const nombre of candidatos) {
    if (!nombre) continue;
    const nl = nombre.toLowerCase();
    const clave = Object.keys(tabla).find(k => k.toLowerCase() === nl);
    // in neg a high weight means a harmless curse, so higher = better for both groups
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
