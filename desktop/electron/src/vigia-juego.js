export function creaVigiaDelJuego({ estado, cadaMs = 1000 }) {
  const vigias = new Map();
  const para = (id) => {
    clearInterval(vigias.get(id));
    vigias.delete(id);
  };
  return {
    sigue(wc) {
      para(wc.id);
      let ultimo;
      const mira = () => {
        if (wc.isDestroyed()) return para(wc.id);
        const ahora = estado();
        if (ahora !== ultimo) wc.send("vs:juego", (ultimo = ahora));
      };
      mira();
      vigias.set(wc.id, setInterval(mira, cadaMs));
    },
    para,
    paraTodos() {
      for (const id of [...vigias.keys()]) para(id);
    },
  };
}
