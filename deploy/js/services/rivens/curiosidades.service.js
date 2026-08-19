let cache = null;

export async function getCuriosidades() {
  if (cache) return cache;
  try {
    const r = await fetch("assets/ml/curiosidades.json");
    if (!r.ok) return null;
    cache = await r.json();
  } catch { return null; }
  return cache;
}
