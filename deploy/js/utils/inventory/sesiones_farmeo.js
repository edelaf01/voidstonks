export const ESTADO_INICIAL = Object.freeze({ actual: null, mision: null, reliquia: null, cambio: null });

const minutosDe = (s) => {
  if (Number.isFinite(s.inicioT) && Number.isFinite(s.finT) && s.finT >= s.inicioT) return (s.finT - s.inicioT) / 60;
  if (Number.isFinite(s.inicio) && Number.isFinite(s.fin) && s.fin >= s.inicio) return (s.fin - s.inicio) / 60000;
  return null;
};

const cierra = (s, ahora, t) => {
  const fin = { ...s, fin: ahora ?? s.fin, finT: Number.isFinite(t) ? t : s.finT };
  const m = minutosDe(fin);
  return { ...fin, minutos: m === null ? null : Math.round(m * 10) / 10 };
};

const sumaPlat = (items) => items.reduce((acc, i) => acc + (Number(i.qty) || 1) * (Number(i.plat) || 0), 0);

export function siguienteSesion(estado = ESTADO_INICIAL, evento = {}) {
  const e = { ...estado, cambio: null };
  const { tipo, ahora = null, t = null } = evento;
  if (tipo === "mision") {
    const mision = evento.nombre || null;
    const actual = e.actual && !e.actual.mision ? { ...e.actual, mision } : e.actual;
    return { ...e, mision, actual };
  }
  if (tipo === "reliquia") {
    const reliquia = evento.nombre || null;
    const actual = e.actual && !e.actual.reliquia ? { ...e.actual, reliquia } : e.actual;
    return { ...e, reliquia, actual };
  }
  if (tipo === "inicio") {
    const id = `${ahora ?? Date.now()}-${Number.isFinite(t) ? t : 0}`;
    return {
      ...e,
      reliquia: null,
      actual: {
        id, inicio: ahora, inicioT: Number.isFinite(t) ? t : null, fin: null, finT: null,
        minutos: null, mision: e.mision, reliquia: null, items: [], plat: 0, rondas: 0, cerrada: false,
      },
    };
  }
  if (!e.actual) return e;
  if (tipo === "recompensas") {
    const actual = cierra({ ...e.actual, rondas: e.actual.rondas + 1, reliquia: e.actual.reliquia || e.reliquia }, ahora, t);
    return { ...e, actual };
  }
  if (tipo === "confirmadas") {
    const nuevos = (evento.items || []).map((i) => ({ name: i.name, qty: Number(i.qty) || 1, plat: Number(i.plat) || 0 }));
    if (!nuevos.length) return e;
    const items = [...e.actual.items, ...nuevos];
    const actual = { ...e.actual, items, plat: sumaPlat(items), reliquia: e.actual.reliquia || e.reliquia };
    const conFin = actual.fin === null ? cierra(actual, ahora, null) : actual;
    return { ...e, actual: conFin, cambio: conFin };
  }
  if (tipo === "cierre") {
    const actual = { ...cierra(e.actual, ahora, t), cerrada: true, reliquia: e.actual.reliquia || e.reliquia };
    return { ...e, actual, cambio: actual };
  }
  return e;
}
