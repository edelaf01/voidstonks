let cache = null;

/**
 * Market curiosities generated daily by `curiosidades_gen.py`. A failure is not memoized,
 * so the next load retries. Returns null when there is no data.
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
