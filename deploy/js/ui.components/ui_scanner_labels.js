/**
 * Rótulos del escáner: HUD, aviso de permisos y modal de calibración.
 *
 * Vivía dentro de ui.js, que ya roza el techo de 800 líneas de ARCHITECTURE.md §B. No recibe
 * nada del resto de la app —se le pasa el diccionario del idioma activo y solo escribe en el
 * DOM—, así que no cierra ningún ciclo de imports.
 */

const setText = (id, text) => {
  const el = document.getElementById(id);
  if (el && text) el.innerText = text;
};

/** @param t diccionario TEXTS del idioma activo. */
export function updateScannerLabels(t) {
  const sh = t.scannerHUD;
  if (sh) {
    setText("hud-title", sh.title);
    setText("close-drawer-btn", sh.btnStopScan);
    setText("hud-context-badge", sh.statusIdle);
    setText("btn-debug-toggle", sh.btnDebug);
    setText("btn-manual-scan", sh.btnScan);
    setText("btn-save-inv", sh.btnSave);
    setText("btn-recalibrate", sh.btnRecalibrate);
    setText("lbl-ocr-debug", sh.lblDebugSnapshot);
    setText("btn-copy-debug-log", sh.btnCopyLog);
    setText("lbl-detected-items", sh.lblDetected);
    setText("lbl-scan-empty-state", sh.lblEmpty);
    setText("lbl-ocr-engine", sh.lblEngine);

    // Estos cuatro no pasaban por TEXTS: se quedaban en "⟳ AUTO", "↺ RESET GRID",
    // "SYSTEM DIAGNOSTICS" y "FRAMES: 0" en inglés fijo, con el título en inglés también.
    setText("btn-auto-scan", sh.btnAutoScan);
    setText("btn-reset-grid", sh.btnResetGrid);
    setText("lbl-rewards-diagnostics", sh.lblDiagnostics);
    setText("hud-scan-counter", "");

    const setTitle = (id, text) => {
      const el = document.getElementById(id);
      if (el && text) {
        el.title = text;
        el.setAttribute("aria-label", text);
      }
    };
    setTitle("btn-debug-toggle", sh.titleDebug);
    setTitle("btn-auto-scan", sh.titleAutoScan);
    setTitle("btn-clear-session", sh.titleClearSession);
    setTitle("btn-reset-grid", sh.titleResetGrid);
  }

  const histLabel = document.querySelector("#btn-scan-history .history-btn-label");
  if (histLabel && t.history?.btnLabel) {
    histLabel.innerText = t.history.btnLabel;
  }

  const histTitle = document.querySelector("#scan-history-dropdown .scan-history-title");
  if (histTitle && t.history?.title) {
    histTitle.innerText = t.history.title;
  }

  const histClear = document.querySelector("#scan-history-dropdown .scan-history-clear-btn");
  if (histClear && t.history?.btnClearTooltip) {
    histClear.title = t.history.btnClearTooltip;
  }

  const rs = t.rewardScanner;
  if (rs) {
    setText("lbl-rewards-title", rs.modalTitle);
    setText("btn-continue-scan", rs.btnContinue);
  }

  const sc = t.scanner;
  if (sc) {
    setText("lbl-notice-title", sc.noticeTitle);
    setText("lbl-notice-perm", sc.noticePerm);
    setText("lbl-notice-pick", sc.noticePick);
    setText("lbl-notice-local", sc.noticeLocal);
    setText("lbl-notice-beta", sc.noticeBeta);
    setText("btn-accept-scan", sc.noticeAccept);

    const infoIcon = document.getElementById("scanner-info-icon");
    if (infoIcon && sc.infoIcon) infoIcon.dataset.tooltip = sc.infoIcon;

    const fab = document.getElementById("mobile-scan-btn");
    if (fab && sc.fabLabel) {
      fab.setAttribute("aria-label", sc.fabLabel);
      fab.title = sc.fabLabel;
    }

    // Solo en reposo: con la sesión abierta el rótulo lo lleva live_scanner.js
    // ("INICIANDO…" / "ESCANER ACTIVO") y pisarlo aquí mentiría sobre el estado.
    const toggle = document.getElementById("scanner-toggle");
    const label = toggle?.querySelector(".label");
    if (label && !toggle.classList.contains("active") && sc.idle) {
      label.innerText = sc.idle;
    }
  }

  const ct = t.calib;
  if (ct) {
    setText("lbl-calib-title", ct.title);
    setText("btn-calib-skip", ct.btnSkip);
    setText("calib-btn-next", ct.btnNext);
    const skip = document.getElementById("btn-calib-skip");
    if (skip && ct.skipHelp) {
      skip.title = ct.skipHelp;
      skip.dataset.tooltip = ct.skipHelp;
    }
  }
}
