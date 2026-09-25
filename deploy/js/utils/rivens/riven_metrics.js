export function nivelVolatilidad(meta) {
    const cv = meta?.volatility_index > 0 ? meta.volatility_index / 10
        : meta?.official_median > 0 && meta?.official_stddev > 0 ? meta.official_stddev / meta.official_median
            : null;
    if (cv === null) return null;
    return cv < 0.5 ? "baja" : cv <= 1.2 ? "media" : "alta";
}

const NIVELES = {
    baja: { color: "#00ff78", riesgo: ["ESTABLE", "STABLE"], tooltip: [
        "El precio de este Riven es predecible y seguro. Casi todo el mundo lo compra y vende por la misma cantidad de platino.",
        "The price of this Riven is predictable and safe. Almost everyone buys and sells it for the same amount of platinum."] },
    media: { color: "#ffb300", riesgo: ["MODERADO", "MODERATE"], tooltip: [
        "El precio fluctúa bastante. Dependiendo de las estadísticas o del comprador, puedes ganar o perder mucho margen de platino.",
        "The price fluctuates quite a bit. Depending on the stats or the buyer, you can gain or lose a lot of platinum margin."] },
    alta: { color: "#ff4444", riesgo: ["EXTREMO", "EXTREME"], tooltip: [
        "No hay un precio fijo. Algunos jugadores pagan auténticas fortunas por él, mientras que otros lo malvenden. Entra bajo tu propio riesgo.",
        "There is no fixed price. Some players pay absolute fortunes for it, while others quick-sell it. Enter at your own risk."] },
};
const SIN_DATOS = { color: "#8a8a93", riesgo: ["SIN DATOS", "NO DATA"], tooltip: [
    "No hay ventas suficientes para medir cuánto varía el precio.",
    "Not enough sales to measure how much the price varies."] };

export function etiquetaVolatilidad(nivel, isEs) {
    const n = NIVELES[nivel] || SIN_DATOS, i = isEs ? 0 : 1;
    return { riesgo: n.riesgo[i], color: n.color, tooltip: n.tooltip[i] };
}

// rerolled_premium_ratio is rolled / unrolled, so 1.38 is +38%
export function textoExtraPorCiclar(ratio, isEs) {
    if (!(ratio > 0)) return isEs ? "sin datos" : "no data";
    const pct = Math.round((ratio - 1) * 100);
    return `${pct >= 0 ? "+" : ""}${pct}%`;
}
