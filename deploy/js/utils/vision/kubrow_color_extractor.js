import { OpenCVRepository } from "../../repositories/opencv.repository.js";

/**
 * ⚠️ MOTOR DE VISIÓN ARTIFICIAL KUBROW / VOIDSCANNER ⚠️
 * Basado en espacio CIELAB, CLAHE (2.0) y Calibración de Tinte de Orbitador (+4 A, -5 B, Luz: 0.4).
 * A prueba de fallos y memory leaks en OpenCV.js (Acepta HTMLVideoElement, Canvas, Image).
 */

export const PALETA_WARFRAME = {
  "Ash Grey": "#808079",
  "Anyo Grey (Navy)": "#363640",
  "Earth Brown": "#806A5D",
  "Ambulas Black (Dark Brown)": "#342622",
  "Corpus Grey": "#808080",
  "Shadow Grey (Cream)": "#80736B",
  "Hek Green": "#7E806A",
  "Sargas Brown (Gold)": "#C58D4D",
  "Kril Brown": "#80745E",
  "Jupiter Brown (Orange)": "#805A32",
  "Gallium Grey": "#78828C",
  "Phorid Red": "#804330",
  "Grustrag Grey": "#807A6C",
  "Alad Blue": "#5B6B80",
  "Saturn Brown": "#806753",
  "Venus Brown (Purple)": "#4D4146",
  "Sedna Grey": "#807979",
  "Derilect Black": "#262626",
  "Mars red": "#805F44",
  "Infested Black": "#363333",
  "Void Black": "#262020",
  "Darvo Blue": "#697280",
  "Ordis Grey": "#72727A",
  "Mercury Brown": "#807461",
};

export const COLOR_DESCRIPTIONS = {
  "Mars red": "Mars Red (Marrón Terracota / Marrón Cálido)",
  "Saturn Brown": "Saturn Brown (Marrón Tierra)",
  "Light gold": "Light Gold (Dorado Claro / Arena)",
  "Sargas Brown (Gold)": "Sargas Brown (Dorado Intenso)",
  "Kril Brown": "Kril Brown (Marrón Beige)",
  "Earth Brown": "Earth Brown (Marrón Canela)",
  "Ash Grey": "Ash Grey (Gris Ceniza / Beige Claro)",
  "Shadow Grey (Cream)": "Shadow Grey (Crema / Gris Claro)",
  "Ambulas Black (Dark Brown)": "Ambulas Black (Marrón Oscuro)",
  "Corpus Grey": "Corpus Grey (Gris Medio)",
};

export function hexToRgb(hexStr) {
  const hex = hexStr.replace("#", "");
  return [
    parseInt(hex.substring(0, 2), 16),
    parseInt(hex.substring(2, 4), 16),
    parseInt(hex.substring(4, 6), 16),
  ];
}

export function rgbToLab(r, g, b) {
  let r_ = r / 255;
  let g_ = g / 255;
  let b_ = b / 255;

  r_ = r_ > 0.04045 ? Math.pow((r_ + 0.055) / 1.055, 2.4) : r_ / 12.92;
  g_ = g_ > 0.04045 ? Math.pow((g_ + 0.055) / 1.055, 2.4) : g_ / 12.92;
  b_ = b_ > 0.04045 ? Math.pow((b_ + 0.055) / 1.055, 2.4) : b_ / 12.92;

  let x = (r_ * 0.4124 + g_ * 0.3576 + b_ * 0.1805) * 100;
  let y = (r_ * 0.2126 + g_ * 0.7152 + b_ * 0.0722) * 100;
  let z = (r_ * 0.0193 + g_ * 0.1192 + b_ * 0.9505) * 100;

  x /= 95.047;
  y /= 100.0;
  z /= 108.883;

  x = x > 0.008856 ? Math.pow(x, 1 / 3) : 7.787 * x + 16 / 116;
  y = y > 0.008856 ? Math.pow(y, 1 / 3) : 7.787 * y + 16 / 116;
  z = z > 0.008856 ? Math.pow(z, 1 / 3) : 7.787 * z + 16 / 116;

  const L = (116 * y - 16) * 2.55;
  const a = (x - y) * 500 + 128;
  const b_lab = (y - z) * 200 + 128;

  return [L, a, b_lab];
}

const PALETA_LAB = {};
for (const [nombre, hexStr] of Object.entries(PALETA_WARFRAME)) {
  const [r, g, b] = hexToRgb(hexStr);
  PALETA_LAB[nombre] = rgbToLab(r, g, b);
}

export function colorMasCercanoLab(labDetectado) {
  let distanciaMinima = Infinity;
  let nombreCercano = null;
  const [l1, a1, b1] = labDetectado;

  for (const [nombre, [l2, a2, b2]] of Object.entries(PALETA_LAB)) {
    // 💡 CALIBRACIÓN LUZ: Peso de 0.4 exacto
    const dl = (l1 - l2) * 0.4;
    const da = a1 - a2;
    const db = b1 - b2;
    const dist = Math.sqrt(da * da + db * db + dl * dl);

    if (dist < distanciaMinima) {
      distanciaMinima = dist;
      nombreCercano = nombre;
    }
  }
  return nombreCercano;
}

export function parseKubrowHeader(text) {
  if (!text) return { playerName: null, breed: null };

  const clean = text.replace(/[\n\r]+/g, " ").trim();

  const breedsMap = {
    CHESA: "Chesa",
    HURAS: "Huras",
    SAHASA: "Sahasa",
    RAKSA: "Raksa",
    SUNIKA: "Sunika",
    HELMINTH: "Helminth Charger",
    KAVAT: "Kavat",
  };

  let foundBreed = null;
  for (const [key, val] of Object.entries(breedsMap)) {
    if (new RegExp(`\\b${key}\\b`, "i").test(clean)) {
      foundBreed = val;
      break;
    }
  }

  let playerName = null;
  const matchUser =
    clean.match(/(?:[+\s]*)([A-Z0-9_\-\.]+)\s*(?:['’]|['’]?S|\bS\b)\s+(?:CHESA|HURAS|SAHASA|RAKSA|SUNIKA|HELMINTH|KAVAT|\w+)\s+KUBROW/i) ||
    clean.match(/(?:[+\s]*)([A-Z0-9_\-\.]+)\s*['’]S/i) ||
    clean.match(/(?:[+\s]*)([A-Z0-9_\-\.]+)\s+[A-Z]+\s+KUBROW/i);

  if (matchUser && matchUser[1]) {
    const rawName = matchUser[1].replace(/^[+\s\W]+/, "").trim();
    if (rawName.length >= 3 && !/KUBROW|CHESA|HURAS|SAHASA|RAKSA|SUNIKA/i.test(rawName)) {
      playerName = rawName;
    }
  }

  return { playerName, breed: foundBreed };
}

/**
 * MOTOR DE CONSENSO DE 6 PASADAS DE ALTA PRECISIÓN (A PRUEBA DE CRASHES)
 * k = [4, 6, 7], tol = [20.0, 25.0], A: +4, B: -5, dl weight = 0.4
 */
export async function extraerColoresConsenso(canvasSource) {
  if (!canvasSource) return ["Mars red", "Saturn Brown", "Light gold"];

  // Convertir HTMLVideoElement a Canvas síncronamente para evitar BindingError en cv.imread
  let inputCanvas = canvasSource;
  if (canvasSource && (canvasSource.tagName === "VIDEO" || canvasSource instanceof HTMLVideoElement)) {
    if (!globalThis._kubrowHelperCvs) {
      globalThis._kubrowHelperCvs = document.createElement("canvas");
    }
    const helper = globalThis._kubrowHelperCvs;
    const w = canvasSource.videoWidth || canvasSource.width || 1280;
    const h = canvasSource.videoHeight || canvasSource.height || 720;
    if (w > 0 && h > 0) {
      helper.width = w;
      helper.height = h;
      const ctx = helper.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(canvasSource, 0, 0, w, h);
      inputCanvas = helper;
    }
  }

  const ready = await OpenCVRepository.waitReady(10000).catch(() => false);
  if (!ready || !globalThis.cv || !globalThis.cv.imread) {
    return extraerColoresFallbackCanvas(inputCanvas);
  }

  const cv = globalThis.cv;
  // Rastreamos TODOS los Mats para liberarlos en el finally (sin fugas en live scan).
  const mats = [];
  const track = (m) => { if (m) mats.push(m); return m; };

  try {
    const srcMat = track(cv.imread(inputCanvas));
    if (!srcMat || srcMat.cols === 0 || srcMat.rows === 0) {
      return extraerColoresFallbackCanvas(inputCanvas);
    }

    // 1. Redimensión OBLIGATORIA a 500px de ancho (barato + estable frame a frame)
    const targetWidth = 500;
    const proporcion = 500.0 / srcMat.cols;
    const targetHeight = Math.round(srcMat.rows * proporcion);

    const resizedMat = track(new cv.Mat());
    cv.resize(srcMat, resizedMat, new cv.Size(targetWidth, targetHeight), 0, 0, cv.INTER_AREA);

    const rgbMat = track(new cv.Mat());
    cv.cvtColor(resizedMat, rgbMat, cv.COLOR_RGBA2RGB);

    // 2. SILUETA DEL KUBROW: aislar al sujeto del fondo negro del orbitador.
    //    (Otsu sobre gris -> morfología -> mayor componente -> envolvente convexo).
    const maskMat = track(aislarKubrowMask(cv, rgbMat, mats));

    const labMat = track(new cv.Mat());
    cv.cvtColor(rgbMat, labMat, cv.COLOR_RGB2Lab);

    // 3. CLAHE + NORMALIZACIÓN del canal L (contraste consistente por frame)
    const channels = track(new cv.MatVector());
    cv.split(labMat, channels);
    const lChannel = track(channels.get(0));

    const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
    const lClahe = track(new cv.Mat());
    clahe.apply(lChannel, lClahe);
    clahe.delete();
    const lNorm = track(new cv.Mat());
    cv.normalize(lClahe, lNorm, 0, 255, cv.NORM_MINMAX);

    channels.set(0, lNorm);
    cv.merge(channels, labMat);

    // 4. Recolectar SOLO los píxeles de la silueta + calibración de tinte (+4 A, -5 B).
    //    Filtramos ya por tolerancia máxima (25) contra la paleta: descartamos
    //    píxeles basura en una sola pasada en vez de 6 bucles JS.
    const rows = labMat.rows;
    const cols = labMat.cols;
    const paletaEntries = Object.entries(PALETA_LAB);
    const nPal = paletaEntries.length;
    // Datos planos para cv.kmeans nativo (Float32, 3 canales por fila).
    const buf = [];
    const TOL_MAX = 25.0;

    for (let r = 0; r < rows; r++) {
      const maskRow = maskMat.ucharPtr(r, 0);
      const labRow = labMat.ucharPtr(r, 0);
      for (let c = 0; c < cols; c++) {
        if (maskRow[c] === 0) continue;
        const idx = c * 3;
        const L = labRow[idx];
        const a = Math.min(255, Math.max(0, labRow[idx + 1] + 4));
        const b = Math.min(255, Math.max(0, labRow[idx + 2] - 5));

        // ¿está cerca de ALGÚN color de la paleta? (poda de ruido)
        let minDist = Infinity;
        for (let p = 0; p < nPal; p++) {
          const [, [l2, a2, b2]] = paletaEntries[p];
          const dl = (L - l2) * 0.4;
          const da = a - a2;
          const db = b - b2;
          const dist = dl * dl + da * da + db * db; // sin sqrt: comparamos cuadrados
          if (dist < minDist) minDist = dist;
        }
        if (minDist < TOL_MAX * TOL_MAX) {
          buf.push(L, a, b);
        }
      }
    }

    const nPix = buf.length / 3;
    if (nPix < 10) return extraerColoresFallbackCanvas(inputCanvas);

    // 5. K-MEANS NATIVO (C++): mucho más rápido que 6 pasadas en JS.
    //    Consenso ligero con k=[4,6] promediando contribuciones por color.
    const conteo = {};
    for (const k of [4, 6]) {
      const kk = Math.min(k, nPix);
      const samples = track(cv.matFromArray(nPix, 3, cv.CV_32F, buf));
      const labels = track(new cv.Mat());
      const centers = track(new cv.Mat());
      const criteria = new cv.TermCriteria(
        cv.TermCriteria_EPS + cv.TermCriteria_MAX_ITER, 20, 0.5,
      );
      cv.kmeans(samples, kk, labels, criteria, 3, cv.KMEANS_PP_CENTERS, centers);

      // Conteo de píxeles por cluster
      const clusterCounts = new Array(kk).fill(0);
      for (let i = 0; i < nPix; i++) clusterCounts[labels.intAt(i, 0)]++;

      for (let ci = 0; ci < kk; ci++) {
        const pct = (clusterCounts[ci] / nPix) * 100;
        if (pct <= 2.5) continue;
        const cl = centers.floatAt(ci, 0);
        const ca = centers.floatAt(ci, 1);
        const cb = centers.floatAt(ci, 2);
        const name = colorMasCercanoLab([cl, ca, cb]);
        if (name) conteo[name] = (conteo[name] || 0) + pct;
      }
      // Liberar el hilo entre pasadas para no congelar la UI del live scanner.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const coloresFinales = Object.entries(conteo)
      .sort((a, b) => b[1] - a[1])
      .map((entry) => entry[0]);

    while (coloresFinales.length < 3) coloresFinales.push("Desconocido");
    return coloresFinales.slice(0, 3);
  } catch (e) {
    console.warn("[KubrowColorExtractor] OpenCV error, usando fallback canvas:", e);
    return extraerColoresFallbackCanvas(inputCanvas);
  } finally {
    for (const m of mats) {
      try { m.delete(); } catch { /* ya liberado */ }
    }
  }
}

/**
 * Aísla la silueta del kubrow del fondo negro del orbitador.
 * Otsu (brillo) -> apertura/cierre morfológico -> mayor componente conexo ->
 * envolvente convexo (conserva el pelaje oscuro interior, p.ej. Void Black).
 * Devuelve un Mat máscara 8UC1 (255 = kubrow). Cae al rectángulo central si falla.
 * Todos los Mats intermedios se registran en `mats` para liberación centralizada.
 */
function aislarKubrowMask(cv, rgbMat, mats) {
  const rows = rgbMat.rows;
  const cols = rgbMat.cols;
  const track = (m) => { if (m) mats.push(m); return m; };

  const rectFallback = () => {
    const m = new cv.Mat.zeros(rows, cols, cv.CV_8UC1);
    const p1 = new cv.Point(Math.floor(cols * 0.30), Math.floor(rows * 0.20));
    const p2 = new cv.Point(Math.floor(cols * 0.70), Math.floor(rows * 0.80));
    cv.rectangle(m, p1, p2, new cv.Scalar(255), -1);
    return m;
  };

  try {
    const gray = track(new cv.Mat());
    cv.cvtColor(rgbMat, gray, cv.COLOR_RGB2GRAY);

    const mask = track(new cv.Mat());
    cv.threshold(gray, mask, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);

    const kernel = track(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(7, 7)));
    cv.morphologyEx(mask, mask, cv.MORPH_OPEN, kernel);
    cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, kernel, new cv.Point(-1, -1), 2);

    // Mayor componente conexo = cuerpo del kubrow.
    const labels = track(new cv.Mat());
    const stats = track(new cv.Mat());
    const centroids = track(new cv.Mat());
    const n = cv.connectedComponentsWithStats(mask, labels, stats, centroids, 8);
    if (n <= 1) return track(rectFallback());

    let bestIdx = -1;
    let bestArea = 0;
    for (let i = 1; i < n; i++) {
      const area = stats.intAt(i, cv.CC_STAT_AREA);
      if (area > bestArea) { bestArea = area; bestIdx = i; }
    }
    if (bestIdx < 0 || bestArea < rows * cols * 0.02) return track(rectFallback());

    // Máscara del mayor componente.
    const body = track(new cv.Mat.zeros(rows, cols, cv.CV_8UC1));
    for (let r = 0; r < rows; r++) {
      const lr = labels.intPtr(r, 0);
      const br = body.ucharPtr(r, 0);
      for (let c = 0; c < cols; c++) {
        if (lr[c] === bestIdx) br[c] = 255;
      }
    }

    // Envolvente convexo: rellena el pelaje oscuro interior perdido por Otsu.
    const contours = track(new cv.MatVector());
    const hierarchy = track(new cv.Mat());
    cv.findContours(body, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    if (contours.size() === 0) return body;

    let biggest = null;
    let biggestArea = 0;
    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const a = cv.contourArea(cnt);
      if (a > biggestArea) { biggestArea = a; biggest = cnt; }
    }
    if (!biggest) return body;

    const hull = track(new cv.Mat());
    cv.convexHull(biggest, hull);
    const hullVec = track(new cv.MatVector());
    hullVec.push_back(hull);

    const filled = track(new cv.Mat.zeros(rows, cols, cv.CV_8UC1));
    cv.fillPoly(filled, hullVec, new cv.Scalar(255));
    // Erosión leve para no rozar el borde/fondo.
    cv.erode(filled, filled, kernel);
    return filled;
  } catch (e) {
    console.warn("[KubrowColorExtractor] segmentación falló, rectángulo:", e);
    return track(rectFallback());
  }
}

function extraerColoresFallbackCanvas(canvasSource) {
  try {
    if (!canvasSource) return ["Mars red", "Saturn Brown", "Light gold"];

    let canvas = canvasSource;
    if (canvasSource.tagName === "VIDEO" || canvasSource instanceof HTMLVideoElement) {
      if (!globalThis._kubrowHelperCvs) {
        globalThis._kubrowHelperCvs = document.createElement("canvas");
      }
      canvas = globalThis._kubrowHelperCvs;
      const w = canvasSource.videoWidth || canvasSource.width || 1280;
      const h = canvasSource.videoHeight || canvasSource.height || 720;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(canvasSource, 0, 0, w, h);
    }

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

    const samples = [];
    const width = canvas.width;
    const height = canvas.height;

    for (let y = Math.floor(height * 0.20); y < Math.floor(height * 0.80); y += 2) {
      for (let x = Math.floor(width * 0.30); x < Math.floor(width * 0.70); x += 2) {
        const i = (y * width + x) * 4;
        let r = imgData[i];
        let g = imgData[i + 1];
        let b = imgData[i + 2];
        const a = imgData[i + 3];

        if (a > 128) {
          const lab = rgbToLab(r, g, b);
          lab[1] = Math.min(255, Math.max(0, lab[1] + 4));
          lab[2] = Math.min(255, Math.max(0, lab[2] - 5));
          const name = colorMasCercanoLab(lab);
          if (name) {
            samples.push(name);
          }
        }
      }
    }

    const counts = {};
    for (const s of samples) counts[s] = (counts[s] || 0) + 1;

    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map((e) => e[0])
      .slice(0, 3);
  } catch (e) {
    console.warn("[KubrowColorExtractor] Canvas fallback error:", e);
    return ["Mars red", "Saturn Brown", "Light gold"];
  }
}
