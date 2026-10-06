const cargas = new Map();

export function cargaScript(url, doc = document) {
  if (!cargas.has(url)) {
    cargas.set(url, new Promise((resolve, reject) => {
      const script = doc.createElement("script");
      script.src = url;
      script.onload = () => resolve();
      script.onerror = () => {
        cargas.delete(url);
        script.remove();
        reject(new Error(`failed to load ${url}`));
      };
      doc.head.appendChild(script);
    }));
  }
  return cargas.get(url);
}
