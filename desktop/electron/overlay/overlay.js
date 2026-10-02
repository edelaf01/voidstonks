import { htmlPanel, coloca } from "./paneles.js";

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

function pinta({ grupo, paneles, mismoAncho }) {
  const el = grupoDe(grupo);
  el.innerHTML = paneles.map(htmlPanel).join("");
  const nodos = [...el.children];
  const anchos = nodos.map((n) => n.getBoundingClientRect().width);
  coloca(paneles, anchos, vista(), mismoAncho).forEach((pos, i) => {
    Object.assign(nodos[i].style, { left: `${pos.left}px`, top: `${pos.top}px`, width: `${pos.width}px` });
    nodos[i].classList.add("listo");
  });
}

const ultimos = new Map();

globalThis.overlay.alRecibir((msg) => {
  if (msg.tipo === "grupo") {
    ultimos.set(msg.grupo, msg);
    pinta(msg);
  } else if (msg.tipo === "quita") {
    ultimos.delete(msg.grupo);
    capa.querySelector(`section[data-grupo="${msg.grupo}"]`)?.remove();
  }
});

addEventListener("resize", () => {
  escala();
  for (const msg of ultimos.values()) pinta(msg);
});

escala();
globalThis.overlay.listo();
