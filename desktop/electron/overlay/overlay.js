import { htmlPanel, coloca, zonasEnPixeles } from "./paneles.js";

const capa = document.getElementById("capa");
const vista = () => ({ ancho: innerWidth, alto: innerHeight });

function escala() {
  document.documentElement.style.fontSize = `${(innerHeight / 1440) * 16}px`;
}

function grupoDe(nombre) {
  let el = capa.querySelector(`section[data-grupo="${nombre}"]`);
  if (!el) {
    el = document.createElement("section");
    el.dataset.grupo = nombre;
    capa.appendChild(el);
  }
  return el;
}

let dentro = false;

function avisaRaton(ahora) {
  if (ahora === dentro) return;
  dentro = ahora;
  globalThis.overlay.raton(dentro);
}

function avisaZonas() {
  const rects = [...capa.querySelectorAll(".panel.interactivo")].map((n) => n.getBoundingClientRect());
  globalThis.overlay.zonas(zonasEnPixeles(rects, devicePixelRatio));
}

function pinta({ grupo, paneles, mismoAncho }) {
  const el = grupoDe(grupo);
  el.classList.toggle("igual", !!mismoAncho);
  el.innerHTML = paneles.map(htmlPanel).join("");
  const nodos = [...el.children];
  const anchos = nodos.map((n) => n.getBoundingClientRect().width);
  coloca(paneles, anchos, vista(), mismoAncho).forEach((pos, i) => {
    Object.assign(nodos[i].style, { left: `${pos.left}px`, top: `${pos.top}px`, width: `${pos.width}px` });
    nodos[i].classList.add("listo");
  });
  if (mismoAncho) {
    const alto = Math.max(...nodos.map((n) => n.getBoundingClientRect().height));
    for (const n of nodos) n.style.minHeight = `${alto}px`;
  }
  for (const n of el.querySelectorAll(".panel.interactivo")) {
    n.addEventListener("pointerenter", () => avisaRaton(true));
    n.addEventListener("pointerleave", () => avisaRaton(false));
  }
  if (!el.querySelector(".panel.interactivo:hover")) avisaRaton(false);
  avisaZonas();
}

capa.addEventListener("error", (e) => {
  if (e.target instanceof HTMLImageElement) e.target.remove();
}, true);

capa.addEventListener("click", (e) => {
  const boton = e.target.closest("[data-accion]");
  const grupo = boton?.closest("section[data-grupo]")?.dataset.grupo;
  if (boton && grupo) globalThis.overlay.accion(grupo, boton.dataset.accion);
});

const ultimos = new Map();

globalThis.overlay.alRecibir((msg) => {
  if (msg.tipo === "grupo") {
    ultimos.set(msg.grupo, msg);
    pinta(msg);
  } else if (msg.tipo === "quita") {
    ultimos.delete(msg.grupo);
    capa.querySelector(`section[data-grupo="${msg.grupo}"]`)?.remove();
    if (!capa.querySelector(".panel.interactivo:hover")) avisaRaton(false);
    avisaZonas();
  }
});

addEventListener("resize", () => {
  escala();
  for (const msg of ultimos.values()) pinta(msg);
});

escala();
globalThis.overlay.listo();
