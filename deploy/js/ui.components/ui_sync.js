import { state } from "../state.js";
import { TEXTS } from "../config.js";
import { showToast } from "./ui_components.js";
import { sendSyncMessage, getSyncMessage } from "../repositories/api.repository.js";

let syncInterval = null;
let timeoutTimer = null;

export function initSyncPanel() {
  let syncDiv = document.getElementById("cloud-sync-container");
  const t = TEXTS[state.currentLang];

  if (!syncDiv) {
      syncDiv = document.createElement("div");
      syncDiv.id = "cloud-sync-container";
      syncDiv.className = "side-panel-container";
      document.body.appendChild(syncDiv);
  }

  syncDiv.innerHTML = `
    <div id="sync-toggle-btn" class="side-toggle-btn" onclick="toggleSyncPanel()">
       <span style="font-size:1.5em;">☁️</span>
    </div>
    
    <div class="panel-main-header">
       <span id="txt-sync-title">${t.sync.title}</span>
       <span class="info-icon" data-tooltip="${t.sync.helpTooltip}">ℹ️</span>
    </div>
    
    <div class="sync-content-area">
       
       <div class="sync-tabs">
          <button id="tab-sync-receive" class="sync-tab active" onclick="switchSyncTab('receive')">${t.sync.btnReceive}</button>
          <button id="tab-sync-send" class="sync-tab" onclick="switchSyncTab('send')">${t.sync.btnSend}</button>
       </div>

       <div id="panel-receive" class="sync-pane">
          <p class="sync-instruction">${t.sync.lblCode}</p>
          <div id="sync-code-display" class="big-code">----</div>
          <div id="sync-status-msg" class="sync-status">${t.sync.waiting}</div>
          <div class="loader-bar hidden" id="receive-loader"></div>
       </div>

       <div id="panel-send" class="sync-pane hidden">
          <p class="sync-instruction">${t.sync.lblInput}</p>
          <input type="number" id="sync-input-code" class="wf-input big-input" placeholder="${t.sync.placeholder}">
          <button id="btn-do-sync" class="riven-btn" onclick="executeSyncSend()">${t.sync.btnActionSend}</button>
       </div>

       <div class="sync-limits-footer">
          ${t.sync.limits}
       </div>
    </div>
  `;

  document.body.appendChild(syncDiv);
}

Object.assign(globalThis, {
  toggleSyncPanel: function () {
    const panel = document.getElementById("cloud-sync-container");
    panel.classList.toggle("open");

    if (panel.classList.contains("open")) {
      if (
        document.getElementById("panel-receive").classList.contains("active") ||
        !document.getElementById("panel-send").classList.contains("active")
      ) {
        globalThis.switchSyncTab("receive");
      }
    } else {
      stopReceiver();
    }
  },

  switchSyncTab: function (mode) {
    document
      .querySelectorAll(".sync-tab")
      .forEach((b) => b.classList.remove("active"));
    document.getElementById(`tab-sync-${mode}`).classList.add("active");

    document
      .querySelectorAll(".sync-pane")
      .forEach((p) => p.classList.add("hidden"));
    document.getElementById(`panel-${mode}`).classList.remove("hidden");

    if (mode === "receive") {
      startReceiver();
    } else {
      stopReceiver();
    }
  },

  executeSyncSend: async function () {
    const t = TEXTS[state.currentLang].sync;
    const code = document.getElementById("sync-input-code").value;
    const msg = document.getElementById("finalMessage")?.innerText;
    const btn = document.getElementById("btn-do-sync");

    if (code?.length !== 4) return showToast("Código inválido (4 dígitos)");
    if (!msg || msg === "...") return showToast("No hay mensaje para enviar");

    const originalText = btn.innerText;
    btn.innerText = t.sending;
    btn.disabled = true;

    try {
      const res = await sendSyncMessage(code, msg);
      if (res.status === 429) {
        throw new Error("Límite alcanzado. Espera 1 minuto.");
      }
      if (!res.ok) throw new Error("Server Error");

      btn.innerText = t.sent;
      btn.style.background = "var(--wf-lfg)";
      setTimeout(() => {
        btn.innerText = originalText;
        btn.style.background = "";
        btn.disabled = false;
        document.getElementById("cloud-sync-container").classList.remove("open");
      }, 1500);
    } catch (e) {
      btn.innerText = e.message.includes("Límite") ? "Límite (1min)" : t.error;
      btn.style.background = "#331111";
      btn.style.color = "#ff5555";

      setTimeout(() => {
        btn.innerText = originalText;
        btn.style.background = "";
        btn.style.color = "";
        btn.disabled = false;
      }, 3000);
    }
  }
});

function stopReceiver() {
  if (syncInterval) clearInterval(syncInterval);
  if (timeoutTimer) clearTimeout(timeoutTimer);
  syncInterval = null;
  timeoutTimer = null;

  const loader = document.getElementById("receive-loader");
  if (loader) loader.classList.add("hidden");
}

function startReceiver() {
  stopReceiver();

  const codeDisplay = document.getElementById("sync-code-display");
  const statusMsg = document.getElementById("sync-status-msg");
  const loader = document.getElementById("receive-loader");
  const container = document.getElementById("panel-receive");

  if (!codeDisplay) return;

  if (document.getElementById("btn-retry-sync")) {
    document.getElementById("btn-retry-sync").remove();
  }
  statusMsg.classList.remove("hidden");

  const code = Math.floor(1000 + Math.random() * 9000);
  codeDisplay.innerText = code;
  statusMsg.innerText = TEXTS[state.currentLang].sync.waiting;
  statusMsg.style.color = "#888";
  loader.classList.remove("hidden");

  syncInterval = setInterval(async () => {
    try {
      const res = await getSyncMessage(code);
      const data = await res.json();
      if (res.status === 429) {
        stopReceiver();
        statusMsg.innerHTML = `<span style="color:#ff4444"> Too many tries , wait for a minute..</span>`;
        return;
      }
      if (!res.ok) {
        stopReceiver();
        statusMsg.innerHTML = `<span style="color:#ff4444"> Server error. Try again later.</span>`;
        return;
      }
      if (data?.val) {
        stopReceiver();
        const box = document.getElementById("finalMessage");
        if (box) {
          box.innerText = data.val;
          box.style.animation = "none";
          // TODO sure go ahead why this does nothing ?
          // box.offsetHeight;
          box.style.animation = "pulse 0.5s ease";
        }
        statusMsg.innerText = TEXTS[state.currentLang].sync.success;
        statusMsg.style.color = "var(--wf-lfg)";

        setTimeout(() => {
          const panel = document.getElementById("cloud-sync-container");
          if (panel) panel.classList.remove("open");
        }, 2000);
      }
    } catch (e) {
      console.error("Sync Poll Error", e);
    }
  }, 3000);

  timeoutTimer = setTimeout(() => {
    stopReceiver();

    statusMsg.innerText = "Tiempo de espera agotado (Ahorro de energía)";
    statusMsg.style.color = "#e6c200";
    loader.classList.add("hidden");

    const btnRetry = document.createElement("button");
    btnRetry.id = "btn-retry-sync";
    btnRetry.className = "tier-header-btn";
    btnRetry.style.marginTop = "10px";
    btnRetry.style.justifyContent = "center";
    btnRetry.innerText = "↻ Reactivar Conexión";
    btnRetry.onclick = () => startReceiver();

    if (!document.getElementById("btn-retry-sync")) {
      container.appendChild(btnRetry);
    }
  }, 120000);
}
