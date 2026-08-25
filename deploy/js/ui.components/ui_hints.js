// help button with a panel and one line tips

let openPanel = null;

function closeOpenPanel() {
  if (!openPanel) return;
  openPanel.classList.remove("open");
  openPanel.__btn?.setAttribute("aria-expanded", "false");
  openPanel = null;
}

document.addEventListener("click", (e) => {
  if (!openPanel) return;
  if (e.target.closest(".vs-help")) return;
  closeOpenPanel();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeOpenPanel();
});

export function createHelpButton({ title = "", body = "", label = "", align = "left" } = {}) {
  const wrap = document.createElement("span");
  wrap.className = "vs-help";

  // <button>, not <span>: a tap on a non interactive element gets lost and joins keyboard order
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "vs-help-btn";
  btn.textContent = "?";
  btn.setAttribute("aria-label", label || title || "?");
  btn.setAttribute("aria-expanded", "false");

  const panel = document.createElement("div");
  panel.className = `vs-help-panel vs-help-${align}`;
  panel.__btn = btn;

  if (title) {
    const h = document.createElement("div");
    h.className = "vs-help-title";
    h.textContent = title;
    panel.appendChild(h);
  }

  for (const para of Array.isArray(body) ? body : [body]) {
    if (!para) continue;
    const p = document.createElement("p");
    p.className = "vs-help-text";
    p.textContent = para;
    panel.appendChild(p);
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const wasOpen = panel === openPanel;
    closeOpenPanel();
    if (!wasOpen) {
      panel.classList.add("open");
      btn.setAttribute("aria-expanded", "true");
      openPanel = panel;
    }
  });

  wrap.appendChild(btn);
  wrap.appendChild(panel);
  return wrap;
}

export function createTip({ text, icon = "👆", storageKey = "", variant = "" } = {}) {
  if (!text) return null;
  if (storageKey && localStorage.getItem(storageKey) === "1") return null;

  const tip = document.createElement("div");
  tip.className = `vs-tip${variant ? ` vs-tip-${variant}` : ""}`;
  tip.setAttribute("role", "note");

  const ico = document.createElement("span");
  ico.className = "vs-tip-icon";
  ico.textContent = icon;
  ico.setAttribute("aria-hidden", "true");

  const txt = document.createElement("span");
  txt.className = "vs-tip-text";
  txt.textContent = text;

  tip.appendChild(ico);
  tip.appendChild(txt);

  if (storageKey) {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "vs-tip-close";
    close.textContent = "×";
    close.setAttribute("aria-label", "OK");
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      localStorage.setItem(storageKey, "1");
      tip.remove();
    });
    tip.appendChild(close);
  }

  return tip;
}

const GUIDE_SECTION = {
  relic: "relic", set: "set", riven: "riven",
  bounties: "farms", lfg: "farms",
  vosfor: "vosfor", ducat: "ducat",
  orders: "context", eelog: "context",
};

export function updateGuideLink(tab, lang) {
  const cta = document.getElementById("txt-header-guide-cta");
  if (!cta) return;
  const seccion = GUIDE_SECTION[tab] || "context";
  cta.href = `guide.html#${lang === "es" ? "e" : "g"}-${seccion}`;
}
