const esWayland = (plataforma, env) =>
  plataforma === "linux" && !!env.DISPLAY && String(env.XDG_SESSION_TYPE || "").startsWith("wayland");

const hayJuego = (juegoEnX11) => {
  try {
    return !!juegoEnX11();
  } catch {
    return false;
  }
};

export function creaEligeFuente({ plataforma, env, juegoEnX11, listaFuentes }) {
  let decidido = false;

  const primeraLista = async () => {
    if (!esWayland(plataforma, env) || !hayJuego(juegoEnX11)) return { motor: "sistema", fuentes: await listaFuentes() };
    const sesion = env.XDG_SESSION_TYPE;
    env.XDG_SESSION_TYPE = "x11";
    try {
      return { motor: "x11", fuentes: await listaFuentes() };
    } finally {
      env.XDG_SESSION_TYPE = sesion;
    }
  };

  return async function eligeFuente() {
    let fuentes;
    if (decidido) {
      fuentes = await listaFuentes();
    } else {
      const primera = await primeraLista();
      console.log(`[captura] motor ${primera.motor}`);
      decidido = true;
      fuentes = primera.fuentes;
    }
    if (!fuentes?.length) return null;
    return fuentes.find((f) => f.name === "Warframe") || fuentes.find((f) => f.id.startsWith("screen:")) || fuentes[0];
  };
}
