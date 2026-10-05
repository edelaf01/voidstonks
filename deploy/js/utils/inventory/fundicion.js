export function piezasDeConstruccion(nombre, setsDatabase, requeridas = () => 1) {
  const norm = (s) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const nombreBuscado = norm(nombre);

  for (const [set, piezas] of Object.entries(setsDatabase)) {
    if (norm(set) === nombreBuscado) {
      const resultado = [];
      const planoPrincipal = `${set} Blueprint`;
      if (piezas.includes(planoPrincipal)) {
        resultado.push({ name: planoPrincipal, qty: 1 });
      }
      for (const pieza of piezas) {
        if (pieza !== planoPrincipal && !pieza.endsWith(" Blueprint")) {
          resultado.push({ name: pieza, qty: requeridas(set, pieza) });
        }
      }
      return resultado;
    }
  }

  const planoBuscado = `${nombreBuscado} blueprint`;
  for (const piezas of Object.values(setsDatabase)) {
    for (const pieza of piezas) {
      if (norm(pieza) === planoBuscado) {
        return [{ name: pieza, qty: 1 }];
      }
    }
  }

  return [];
}
