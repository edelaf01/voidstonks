export const VENDER_YA = {
    VOLUMEN_MIN: 1,
    CAIDA_MIN: 0.15,
    VC_VIGENCIA_DIAS: 21,
    MUCHOS_VENDEDORES: 5,
};

const DIA_MS = 86400000;

function diasDesde(fecha, hoy) {
    const t = Date.parse(fecha);
    return Number.isFinite(t) ? (hoy - t) / DIA_MS : null;
}

function vcVigente(vc, hoy) {
    if (!vc?.t) return null;
    const dias = diasDesde(vc.d, hoy);
    return dias !== null && dias <= VENDER_YA.VC_VIGENCIA_DIAS ? vc.t : null;
}

export function veredictoVenta({ precio, tendencia, vendedores, hoy = Date.now() } = {}) {
    const t = tendencia || {};
    const volumen = Number.isFinite(t.v) ? t.v : null;
    const extra = (volumen ? Math.min(volumen, 20) / 40 : 0)
        + (vendedores >= VENDER_YA.MUCHOS_VENDEDORES ? 0.5 : 0);
    const r = (urgente, motivo, score) => ({ urgente, motivo, score: Math.round(score * 100) / 100 });

    const vc = vcVigente(t.vc, hoy);
    if (vc === "vault") return r(false, "vault", 0);
    if (vc === "resurgence_actual") return r(false, "resurgenciaActual", 0);
    if (vc === "resurgence_proxima") return r(true, "resurgenciaProxima", 2 + extra);

    const actual = precio > 0 ? precio : t.p;
    if (!(actual > 0) || !(t.p7 > 0)) return r(false, "sinDatos", 0);
    const caida = (t.p7 - actual) / t.p7;
    if (caida < VENDER_YA.CAIDA_MIN) return r(false, "estable", 0);
    if (volumen !== null && volumen < VENDER_YA.VOLUMEN_MIN) return r(false, "pocoVolumen", 0);
    return r(true, "bajando", 1 + caida + extra);
}
