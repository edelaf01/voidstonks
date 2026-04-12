import { state } from "./state.js";

let pipWindow = null;

const PIP_W = 480;
const PIP_H_IDLE = 48;
const PIP_H_ACTIVE = 320;

function isSupported() {
    return "documentPictureInPicture" in globalThis;
}

function cloneStyles(targetDoc) {
    document.querySelectorAll("link[rel='stylesheet'], style").forEach((node) => {
        targetDoc.head.appendChild(node.cloneNode(true));
    });
}

function buildPipContent(targetDoc) {
    const style = targetDoc.createElement("style");
    style.textContent = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: transparent; overflow: hidden; font-family: "Segoe UI", system-ui, sans-serif; }

    #pip-root {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
    }

    /* Header — oculto por defecto, aparece al hover */
    #pip-header {
      background: rgba(8,10,18,0.88);
      border-bottom: 1px solid rgba(0,229,255,0.18);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
      font-size: 9px;
      font-weight: 800;
      letter-spacing: 2px;
      color: #00e5ff;
      opacity: 0;
      height: 0;
      overflow: hidden;
      transition: opacity 0.2s, height 0.2s;
      cursor: default;
      user-select: none;
    }
    #pip-root:hover #pip-header {
      opacity: 1;
      height: 28px;
    }

    #pip-status-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: #00e5ff; box-shadow: 0 0 6px #00e5ff;
      flex-shrink: 0;
    }

    /* Badges area */
    #pip-badges {
      flex: 1;
      display: flex;
      flex-wrap: wrap;
      align-items: flex-start;
      gap: 8px;
      padding: 8px;
      overflow-y: auto;
      background: rgba(6,8,14,0.92);
    }

    /* Idle state: fixed pequeño */
    #pip-idle {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      height: 40px;
      color: rgba(0,229,255,0.3);
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 2px;
      background: rgba(6,8,14,0.92);
      border-top: 1px solid rgba(0,229,255,0.08);
    }
    #pip-idle span.dot {
      width: 5px; height: 5px; border-radius: 50%;
      background: rgba(0,229,255,0.25);
      animation: pulse 2s infinite;
    }
    @keyframes pulse { 0%,100%{opacity:0.3;} 50%{opacity:1;} }

    /* Badge card — idéntico al modal del scanner */
    .pip-badge {
      background: linear-gradient(135deg, rgba(10,12,26,0.97) 0%, rgba(14,18,36,0.97) 100%);
      border: 1px solid rgba(0,229,255,0.18);
      border-radius: 10px;
      padding: 10px 12px 8px;
      min-width: 140px;
      flex: 1 1 140px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      position: relative;
      cursor: pointer;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .pip-badge:hover {
      border-color: rgba(0,229,255,0.5);
      box-shadow: 0 0 12px rgba(0,229,255,0.15);
    }
    .pip-badge.best-pl { border-color: rgba(221,169,56,0.6); }
    .pip-badge.best-duc { border-color: rgba(33,150,243,0.6); }
    .pip-badge.set-finisher { border-color: rgba(0,255,120,0.6); }
    .pip-badge.selected { border-color: #00ff78; box-shadow: 0 0 14px rgba(0,255,120,0.3); }

    .pip-badge-tags {
      display: flex; flex-wrap: wrap; gap: 3px;
    }
    .pip-tag {
      font-size: 7px; font-weight: 900; letter-spacing: 1px;
      padding: 1px 5px; border-radius: 3px; text-transform: uppercase;
    }
    .pip-tag.pl { background: rgba(221,169,56,0.18); color: #daa520; border: 1px solid rgba(221,169,56,0.4); }
    .pip-tag.duc { background: rgba(33,150,243,0.15); color: #2196f3; border: 1px solid rgba(33,150,243,0.4); }
    .pip-tag.set { background: rgba(0,255,120,0.12); color: #00ff78; border: 1px solid rgba(0,255,120,0.35); }

    .pip-badge-name {
      font-size: 10px; font-weight: 800; color: #fff;
      letter-spacing: 0.5px; text-transform: uppercase;
      line-height: 1.2;
    }

    .pip-badge-meta {
      display: flex; align-items: center; gap: 4px;
      font-size: 9px; font-weight: 700; color: rgba(0,229,255,0.6);
    }

    .pip-badge-prices {
      display: flex; gap: 10px; align-items: center; margin-top: 2px;
    }
    .pip-price, .pip-ducats {
      display: flex; align-items: center; gap: 3px;
      font-size: 12px; font-weight: 900;
    }
    .pip-price { color: #daa520; }
    .pip-ducats { color: #2196f3; }
    .pip-price img, .pip-ducats img {
      width: 12px; height: 12px; object-fit: contain;
    }

    .pip-badge-add {
      font-size: 8px; font-weight: 800; letter-spacing: 1px;
      color: rgba(0,229,255,0.4); text-transform: uppercase;
      border-top: 1px solid rgba(0,229,255,0.1);
      padding-top: 4px; margin-top: 2px;
      transition: color 0.2s;
    }
    .pip-badge:hover .pip-badge-add { color: #00e5ff; }
  `;
    targetDoc.head.appendChild(style);

    const root = targetDoc.createElement("div");
    root.id = "pip-root";

    const header = targetDoc.createElement("div");
    header.id = "pip-header";
    header.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;">
      <span id="pip-status-dot"></span>
      <span>VOIDSTONKS OVERLAY</span>
    </div>
    <span id="pip-item-count" style="color:rgba(0,229,255,0.5);font-size:8px;"></span>
  `;
    root.appendChild(header);

    const badges = targetDoc.createElement("div");
    badges.id = "pip-badges";
    badges.style.display = "none";
    root.appendChild(badges);

    const idle = targetDoc.createElement("div");
    idle.id = "pip-idle";
    idle.innerHTML = `<span class="dot"></span><span>ESPERANDO ESCANEO</span><span class="dot"></span>`;
    root.appendChild(idle);

    targetDoc.body.appendChild(root);
}

function getLang() {
    return state.currentLang === "en" ? "en" : "es";
}

function makeBadgeEl(doc, item) {
    const { name, price, ducats, owned, appOwned, isBestPl, isBestEff, isCompletingSet, isSelected } = item;
    const lang = getLang();
    const t = lang === "en"
        ? { add: "CLICK TO ADD", inv: "OWNED", owned: "SEEN" }
        : { add: "CLIC PARA AÑADIR", inv: "PROPIO", owned: "VISTO" };

    const isForma = name.toUpperCase().includes("FORMA");

    const card = doc.createElement("div");
    card.className = `pip-badge${isBestPl ? " best-pl" : ""}${isBestEff ? " best-duc" : ""}${isCompletingSet ? " set-finisher" : ""}${isSelected ? " selected" : ""}`;

    const tags = [];
    if (isBestPl) tags.push(`<span class="pip-tag pl">BEST PLAT</span>`);
    if (isBestEff && !isForma) tags.push(`<span class="pip-tag duc">BEST DUC</span>`);
    if (isCompletingSet) tags.push(`<span class="pip-tag set">COMPLETES SET</span>`);

    const ducatHtml = ducats > 0
        ? `<div class="pip-ducats"><img src="assets/Ducats.webp"> ${ducats}</div>`
        : "";

    card.innerHTML = `
    ${tags.length ? `<div class="pip-badge-tags">${tags.join("")}</div>` : ""}
    <div class="pip-badge-name">${name.toUpperCase()}</div>
    <div class="pip-badge-meta">
      ${t.owned}: <strong style="color:#00ff78">${Math.max(owned || 0, 0)}</strong>
      &nbsp;|&nbsp;
      ${t.inv}: <strong style="color:#00e5ff">${appOwned || 0}</strong>
    </div>
    <div class="pip-badge-prices">
      <div class="pip-price"><img src="assets/relic_contents/platinum.webp"> ${price > 0 ? price : "—"}</div>
      ${ducatHtml}
    </div>
    ${isForma ? "" : `<div class="pip-badge-add">${t.add}</div>`}
  `;

    if (!isForma) {
        card.addEventListener("click", () => {
            if (typeof globalThis.selectRewardToInventory === "function") {
                globalThis.selectRewardToInventory(name);
            }
        });
    }

    return card;
}

function setIdleMode(doc) {
    const badges = doc.getElementById("pip-badges");
    const idle = doc.getElementById("pip-idle");
    if (badges) badges.style.display = "none";
    if (idle) idle.style.display = "flex";
    const pipWin = globalThis.documentPictureInPicture?.window;
    if (pipWin?.resizeTo) pipWin.resizeTo(PIP_W, PIP_H_IDLE);
}

function setActiveMode(doc, count) {
    const badges = doc.getElementById("pip-badges");
    const idle = doc.getElementById("pip-idle");
    const counter = doc.getElementById("pip-item-count");
    if (badges) badges.style.display = "flex";
    if (idle) idle.style.display = "none";
    if (counter) counter.textContent = `${count} ITEM${count !== 1 ? "S" : ""}`;
    const pipWin = globalThis.documentPictureInPicture?.window;
    if (pipWin?.resizeTo) pipWin.resizeTo(PIP_W, PIP_H_ACTIVE);
}

export async function openPiP() {
    if (!isSupported()) {
        alert(getLang() === "es"
            ? "Tu navegador no soporta Document PiP. Usa Chrome/Edge actualizado."
            : "Your browser does not support Document PiP. Use updated Chrome/Edge.");
        return;
    }

    if (pipWindow && !pipWindow.closed) {
        pipWindow.close();
        pipWindow = null;
        return;
    }

    try {
        pipWindow = await globalThis.documentPictureInPicture.requestWindow({
            width: PIP_W,
            height: PIP_H_IDLE,
        });

        cloneStyles(pipWindow.document);
        buildPipContent(pipWindow.document);

        pipWindow.addEventListener("pagehide", () => {
            pipWindow = null;
            updatePiPButton(false);
        });

        updatePiPButton(true);
    } catch (e) {
        console.error("[PiP] Failed to open overlay:", e);
    }
}

function updatePiPButton(active) {
    const btn = document.getElementById("btn-pip-toggle");
    if (!btn) return;
    btn.textContent = active ? "PIP OFF" : "PIP";
    btn.style.color = active ? "#00e5ff" : "#f39c12";
    btn.style.borderColor = active ? "rgba(0,229,255,0.4)" : "rgba(243,156,18,0.4)";
}

/**
 * Renders a list of full item objects in the PiP window, mirroring modal badges.
 * @param {Array<{name, price, ducats, owned, appOwned, isBestPl, isBestEff, isCompletingSet, isSelected}>} items
 */
export function renderItemsInPiP(items) {
    if (!pipWindow || pipWindow.closed) return;
    const doc = pipWindow.document;
    const area = doc.getElementById("pip-badges");
    if (!area) return;

    area.innerHTML = "";

    if (!items || items.length === 0) {
        setIdleMode(doc);
        return;
    }

    items.forEach((item) => area.appendChild(makeBadgeEl(doc, item)));
    setActiveMode(doc, items.length);
}

export function clearPiPBadges() {
    if (!pipWindow || pipWindow.closed) return;
    const doc = pipWindow.document;
    const area = doc.getElementById("pip-badges");
    if (area) area.innerHTML = "";
    setIdleMode(doc);
}

export function isPiPActive() {
    return !!pipWindow && !pipWindow.closed;
}

export function initPiP() {
    const btn = document.getElementById("btn-pip-toggle");
    if (!btn) return;
    if (isSupported()) btn.style.display = "inline-block";
}
