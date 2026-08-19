let cache = null;

/**
 * Curiosidades de mercado que genera `curiosidades_gen.py` a diario.
 *
 * Un fallo NO se memoriza: si la primera carga se cruza con un despliegue del JSON, la
 * siguiente vuelve a intentarlo. Memorizar el `null` dejaría el carrusel vacío hasta recargar
 * la página entera.
 *
 * Devuelve `null` cuando no hay datos —no un objeto vacío— para que quien lo pinte distinga
 * "todavía no ha llegado" de "hoy no hubo movimientos".
 */
export async function getCuriosidades() {
  if (cache) return cache;
  try {
    const r = await fetch("assets/ml/curiosidades.json");
    if (!r.ok) return null;
    cache = await r.json();
  } catch { return null; }
  return cache;
}
