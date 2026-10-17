const hayJuego = (juegoEnX11) => {
  try {
    return !!juegoEnX11();
  } catch {
    return false;
  }
};

export function creaEligeFuente({ plataforma, env, juegoEnX11, listaFuentes }) {
  const sesionWayland = plataforma === "linux" && String(env.XDG_SESSION_TYPE || "").startsWith("wayland");
  const conXwayland = sesionWayland && !!env.DISPLAY;
  let motor = null;

  const pideFuentes = async (m) => {
    if (m !== "x11") return listaFuentes();
    const sesion = env.XDG_SESSION_TYPE;
    env.XDG_SESSION_TYPE = "x11";
    try {
      return await listaFuentes();
    } finally {
      env.XDG_SESSION_TYPE = sesion;
    }
  };

  return async function eligeFuente() {
    let fuentes;
    if (motor) {
      fuentes = await listaFuentes();
    } else {
      const m = conXwayland && hayJuego(juegoEnX11) ? "x11" : "sistema";
      fuentes = await pideFuentes(m);
      console.log(`[captura] motor ${m}`);
      motor = m;
    }
    if (!fuentes?.length) return null;
    const wf = fuentes.find((f) => f.name === "Warframe");
    if (wf) return wf;
    if (motor === "sistema" && sesionWayland) {
      return fuentes.find((f) => f.id.startsWith("screen:")) || fuentes[0];
    }
    return null;
  };
}
