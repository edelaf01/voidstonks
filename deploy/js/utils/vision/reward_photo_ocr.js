/**
 * Lee la pantalla VOID FISSURE/REWARDS de una foto de cámara o de una captura directa.
 *
 * Fases: SCOUT (localiza la fila de nombres por el ancla "PRIME") → ROI (recorta esa banda)
 * → UNIÓN (preprocesados complementarios) → COLUMNAS (filtro por rejilla equiespaciada).
 *
 * Diseño, mediciones y callejones sin salida: MAINTENANCE_REWARD_PHOTO_OCR.md
 */

// Lado mayor al que se normaliza la imagen antes de OCR (fijo, no un multiplicador).
const MAX_SIDE = 1800;

const SCOUT_SIDE = 1500;

// Resolución para PaddleOCR: a 1400 px lee las 5 imágenes de referencia sin fallos.
const PADDLE_SIDE = 1400;


// Por debajo de esta nitidez la imagen se considera lavada y se realzan bordes primero.
const BLUR_THRESHOLD = 9.5;

// Recortes de respaldo [arriba, abajo] en fracción del alto. Se prueban de ajustado a
// amplio y gana el que más recompensas lea: ningún margen único sirve para todas las fotos.
const ROI_MARGINS = [
    [0.20, 0.08],
    [0.32, 0.14],
    [0.45, 0.20],
];

const cleanToken = (t) => t.replace(/[^A-Za-z]/g, "").toUpperCase();

/** Escala manteniendo proporción para que el lado mayor sea `maxSide`. */
function fitSize(w, h, maxSide) {
    const k = maxSide / Math.max(w, h);
    return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

// Preprocesados complementarios: cada uno rescata recompensas que los otros pierden, así
// que sus resultados se UNEN. Corren en workers distintos (coste paralelo, no acumulativo).
const MAIN_PASSES = [
    { name: "gray", filter: "grayscale(100%)", cvMode: null },
    { name: "cvsoft", filter: null, cvMode: "soft" },
    { name: "graycontrast", filter: "grayscale(100%) contrast(160%)", cvMode: null },
    { name: "unsharp", filter: "grayscale(100%)", cvMode: null, unsharp: true },
];

/**
 * Realce de bordes por máscara de desenfoque. Se prefiere a un kernel de convolución fijo:
 * el kernel [-1..9..-1] sube la nitidez numérica pero destroza el OCR (ver MAINTENANCE).
 */
function applyUnsharp(canvas, engine) {
    if (!engine?.isReady || typeof cv === "undefined") return;
    let src = null, blurred = null, out = null;
    try {
        src = cv.imread(canvas);
        blurred = new cv.Mat();
        out = new cv.Mat();
        cv.GaussianBlur(src, blurred, new cv.Size(0, 0), 2.0);
        cv.addWeighted(src, 2.2, blurred, -1.2, 0, out);
        cv.imshow(canvas, out);
    } catch {
        // Si el realce falla, se sigue con la imagen sin tocar: es una mejora opcional.
    } finally {
        src?.delete();
        blurred?.delete();
        out?.delete();
    }
}

/**
 * Preprocesados del scout, del más barato al más caro. Se prueban hasta encontrar el ancla:
 * el gris solo no basta con tinte saturado, donde texto y fondo se funden al pasar a gris.
 */
const SCOUT_PASSES = [
    { name: "gray", filter: "grayscale(100%)", cvMode: null },
    { name: "graycontrast", filter: "grayscale(100%) contrast(160%)", cvMode: null },
    { name: "cvsoft", filter: null, cvMode: "soft" },
];

/**
 * Nitidez aproximada: media de |Δluma| entre píxeles vecinos sobre una miniatura de 160 px.
 * Sirve para comparar fotogramas de una misma ráfaga entre sí, no como medida absoluta.
 */
export function frameSharpness(source) {
    const W = source.naturalWidth || source.videoWidth || source.width;
    const H = source.naturalHeight || source.videoHeight || source.height;
    if (!W || !H) return 0;
    const tw = 160, th = Math.max(1, Math.round((H / W) * 160));
    const cvs = document.createElement("canvas");
    cvs.width = tw; cvs.height = th;
    const ctx = cvs.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, tw, th);
    const d = ctx.getImageData(0, 0, tw, th).data;
    let sum = 0, n = 0;
    for (let y = 0; y < th; y++) {
        for (let x = 1; x < tw; x++) {
            const i = (y * tw + x) * 4, j = i - 4;
            const a = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            const b = 0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2];
            sum += Math.abs(a - b);
            n++;
        }
    }
    return n ? sum / n : 0;
}

function drawTo(src, sx, sy, sw, sh, tw, th, pass, engine) {
    const cvs = document.createElement("canvas");
    cvs.width = tw; cvs.height = th;
    const ctx = cvs.getContext("2d", { willReadFrequently: true });
    if (pass.filter) ctx.filter = pass.filter;
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, tw, th);
    ctx.filter = "none";
    if (pass.unsharp) applyUnsharp(cvs, engine);
    if (pass.cvMode && engine?.isReady) engine.processForOCR(cvs, pass.cvMode);
    return cvs;
}

/**
 * Filtra por rejilla de columnas: las cards están equiespaciadas, así que sus X forman una
 * progresión aritmética y lo que no cae en ella es un falso positivo del OCR.
 *
 * Con ≤2 ítems se devuelven tal cual: dos puntos siempre definen un paso, y filtrar ahí
 * sería inventar estructura donde no hay evidencia.
 */
export function filterByColumns(items) {
    if (items.length <= 2) return { kept: [...items], pitch: null };

    const xs = items.map((i) => i.xFrac);
    let best = null;

    for (let a = 0; a < xs.length; a++) {
        for (let b = a + 1; b < xs.length; b++) {
            const pitch = xs[b] - xs[a];
            // 4 cards ocupan ~0.125 de separación; 2 muy separadas, ~0.19.
            if (pitch < 0.07 || pitch > 0.35) continue;

            for (const origin of xs) {
                const byColumn = new Map();
                for (const it of items) {
                    const k = Math.round((it.xFrac - origin) / pitch);
                    // Tolerancia relativa al paso: absorbe la inclinación de la foto.
                    if (Math.abs(it.xFrac - (origin + k * pitch)) > pitch * 0.22) continue;
                    const prev = byColumn.get(k);
                    if (!prev || (it.ratio ?? 0) > (prev.ratio ?? 0)) byColumn.set(k, it);
                }
                const kept = [...byColumn.values()];
                // Prioridades: ítems conservados > columnas vacías (penaliza el paso doble,
                // que explica un subconjunto saltándose columnas) > suma de ratios.
                const ks = kept.map((it) => Math.round((it.xFrac - origin) / pitch));
                const span = ks.length ? Math.max(...ks) - Math.min(...ks) + 1 : 0;
                const holes = span - kept.length;
                const ratioSum = kept.reduce((s, it) => s + (it.ratio ?? 0), 0);
                const score = kept.length * 1000 - holes * 100 + ratioSum;
                if (!best || score > best.score) best = { score, pitch, kept };
            }
        }
    }

    if (!best) return { kept: [...items], pitch: null };
    return { kept: best.kept.sort((p, q) => p.xFrac - q.xFrac), pitch: best.pitch };
}

/**
 * Reasigna los badges de cantidad ("N Owned") a la recompensa que les corresponde.
 *
 * `parseRewards` los busca en la ventana del nombre, y eso falla cuando el OCR pierde la
 * palabra "Owned" y solo queda el número: un "14" suelto no cuenta como cantidad. Y no vale
 * con aceptar cualquier número cercano, porque el badge se dibuja en la esquina de su card
 * mientras el nombre va centrado, así que puede caer más cerca del nombre VECINO que del
 * suyo (medido: el "2 Owned" de Yareli cae a 5 px de "Forma" y a 188 px de "Yareli").
 *
 * Con las columnas ya resueltas, la geometría es conocida: las cards están equiespaciadas,
 * así que cada badge pertenece a la columna en cuyo ancho cae, no al nombre más próximo.
 */
export function assignBadges(items, pitch, words, imageW, nameRowY) {
    if (!items.length || !pitch || !words?.length || !nameRowY) return items;

    // Los badges están ENCIMA de la fila de nombres. Sin este corte entran los "+5" del
    // squad y los contadores del HUD, que están debajo (medido: un "45" del squad se
    // asignaba como cantidad).
    const numbers = words
        .filter((w) => /^\d{1,3}$/.test(w.text.trim()) && parseInt(w.text, 10) > 0)
        .map((w) => ({
            value: parseInt(w.text, 10),
            xFrac: (w.bbox.x0 + w.bbox.x1) / 2 / imageW,
            y: w.bbox.y1,
        }))
        .filter((n) => n.y < nameRowY);
    if (!numbers.length) return items;

    return items.map((it) => {
        if (it.owned || it.crafted) return it;   // ya lo resolvió parseRewards
        // El badge se dibuja en el borde IZQUIERDO de su card, mientras el nombre va
        // centrado, así que aparece desplazado a la izquierda respecto a su propio nombre
        // (medido: el badge de Yareli cae a 0,10 de "Yareli" y a 0,02 de "Forma", la card
        // siguiente). Se busca en la ventana que va de medio paso a la izquierda hasta un
        // poco a la derecha del nombre, y se compara ese mismo criterio para todas las
        // cards para que no haya dos reclamando el mismo número.
        const claim = (item, n) => {
            const rel = n.xFrac - item.xFrac;
            return rel >= -pitch * 0.55 && rel <= pitch * 0.15 ? Math.abs(rel + pitch * 0.2) : Infinity;
        };
        const mine = numbers
            .map((n) => ({ n, d: claim(it, n) }))
            .filter(({ n, d }) => d !== Infinity &&
                !items.some((other) => other !== it && claim(other, n) < d))
            .sort((a, b) => a.d - b.d);
        return mine.length ? { ...it, owned: mine[0].n.value } : it;
    });
}

/**
 * Ángulo de inclinación del texto, medido EN LA IMAGEN: pendiente de la recta que pasa por
 * los "PRIME" de la fila de nombres (regresión lineal sobre sus centros).
 *
 * Se mide aquí y no con el giroscopio a propósito: el sensor da la inclinación del móvil
 * respecto a la gravedad, pero lo que estropea el OCR es el ángulo respecto a la PANTALLA.
 * Un móvil perfectamente vertical frente a un monitor inclinado produce texto torcido y el
 * giroscopio diría 0°. La imagen sí contiene el dato real.
 *
 * Devuelve grados (negativo = fila cayendo hacia la derecha) o null si no hay anclas.
 */
export function measureTextSkew(words) {
    // Solo los "PRIME": están todos en la MISMA fila, así que su recta es la inclinación
    // real. Se probó usar todas las palabras para tener más puntos (con la foto torcida el
    // OCR lee menos y a veces no hay anclas suficientes), pero mezcla filas distintas —HUD,
    // nombres del squad— y la regresión inventa un ángulo: una foto recta midió -5,1° y al
    // "enderezarla" pasó de 4/4 a 2/4.
    const pts = words
        .filter((w) => cleanToken(w.text) === "PRIME")
        .map((w) => ({ x: (w.bbox.x0 + w.bbox.x1) / 2, y: (w.bbox.y0 + w.bbox.y1) / 2 }));
    if (pts.length < 3) return null;

    const n = pts.length;
    const mx = pts.reduce((acc, p) => acc + p.x, 0) / n;
    const my = pts.reduce((acc, p) => acc + p.y, 0) / n;
    const num = pts.reduce((acc, p) => acc + (p.x - mx) * (p.y - my), 0);
    const den = pts.reduce((acc, p) => acc + (p.x - mx) ** 2, 0);
    if (!den) return null;
    return Math.atan(num / den) * 180 / Math.PI;
}

/**
 * Localiza la fila de nombres usando "PRIME" como ancla: aparece en casi toda recompensa,
 * siempre en esa fila, y no en el HUD ni en los nombres de los jugadores del squad.
 * Devuelve { y, count } de la fila con más apariciones, o null si no hay ancla.
 */
export function findNameRowY(words, bucketSize = 0.02) {
    const buckets = new Map();
    for (const w of words) {
        if (cleanToken(w.text) !== "PRIME") continue;
        const key = Math.round(w.cy / bucketSize);
        buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    let bestKey = null, bestCount = 0;
    for (const [key, count] of buckets) {
        if (count > bestCount) { bestCount = count; bestKey = key; }
    }
    return bestKey === null ? null : { y: bestKey * bucketSize, count: bestCount };
}

/**
 * Lee las recompensas de una imagen (HTMLImageElement, canvas o video).
 *
 * @param {CanvasImageSource & {naturalWidth?:number,videoWidth?:number,width?:number}} source
 * @param {object} deps - { ocrRepository, ocrService, opencvEngine }
 * @param {(label:string, pct:number)=>void} [onProgress]
 * @param {{skipIfNoAnchor?: boolean}} [opts] - skipIfNoAnchor: abandona en cuanto se ve que
 *        no hay ancla, en vez de caer al OCR de la imagen entera (útil en ráfaga).
 * @returns {Promise<{items:Array, roi:object, ms:number, trace:string[]}>}
 */
export async function scanRewardPhoto(source, deps, onProgress, opts = {}) {
    const { ocrRepository, ocrService, opencvEngine, paddleRepository } = deps;
    const t0 = performance.now();
    const trace = [];
    const progress = (label, pct) => { if (onProgress) onProgress(label, pct); };

    const W = source.naturalWidth || source.videoWidth || source.width;
    const H = source.naturalHeight || source.videoHeight || source.height;
    if (!W || !H) return { items: [], roi: null, ms: 0, trace: ["fuente sin dimensiones"] };

    // ---- Vía rápida: PaddleOCR sobre la imagen entera, en una sola pasada.
    //
    // Es una red neuronal de detección + reconocimiento, así que localiza el texto por sí
    // misma: no necesita el scout, ni recortes candidatos, ni varios preprocesados. Medido
    // sobre las 5 imágenes de referencia: 20/20 en ~630 ms, frente a los 2,5-3,7 s de la vía
    // con Tesseract, y además lee los nombres sin partir palabras.
    //
    // Si algo falla (no carga el modelo, no hay red la primera vez, o no saca las 4), se
    // continúa con la vía de Tesseract de abajo, que no depende de nada externo.
    if (paddleRepository && !opts.skipPaddle) {
        try {
            progress(null, 40);
            const [tw, th] = fitSize(W, H, PADDLE_SIDE);
            const cvs = drawTo(source, 0, 0, W, H, tw, th, { filter: null }, opencvEngine);
            const words = await paddleRepository.recognizeWordsWithBoxes(cvs);
            const items = ocrService.parseRewards({ words, imageW: cvs.width })
                .filter((it) => typeof it.xPos === "number")
                .map((it) => ({ ...it, xFrac: it.xPos / cvs.width, from: "paddle" }));
            const skew = measureTextSkew(words);
            const { kept, pitch } = filterByColumns(items.sort((a, b) => a.xFrac - b.xFrac));
            trace.push(`paddle: ${items.length} → ${kept.length} (paso ${pitch ? pitch.toFixed(3) : "n/d"})`);
            if (kept.length >= 2) {
                // Y de la fila de nombres: la mediana de las palabras "PRIME", que siempre
                // están en ella. Sirve de techo para distinguir badges (encima) del resto.
                const primeYs = words
                    .filter((w) => cleanToken(w.text) === "PRIME")
                    .map((w) => w.bbox.y0)
                    .sort((a, b) => a - b);
                const nameRowY = primeYs.length ? primeYs[Math.floor(primeYs.length / 2)] : 0;
                const withBadges = assignBadges(kept, pitch, words, cvs.width, nameRowY);
                return {
                    items: withBadges.map((it) => ({ ...it, xPos: it.xFrac * W })),
                    roi: { x: 0, y: 0, w: W, h: H, auto: false },
                    debugCanvas: cvs,
                    ms: Math.round(performance.now() - t0),
                    trace,
                    skew,
                    engine: "paddle",
                };
            }
        } catch (e) {
            trace.push(`paddle no disponible: ${String(e).slice(0, 60)}`);
        }
    }

    const runPasses = async (sx, sy, sw, sh, maxSide, passes) => {
        const [tw, th] = fitSize(sw, sh, maxSide);
        return Promise.all(passes.map(async (p, i) => {
            const cvs = drawTo(source, sx, sy, sw, sh, tw, th, p, opencvEngine);
            const worker = ocrRepository.workers[i % ocrRepository.workers.length] || ocrRepository.workers[0];
            const { data } = await ocrRepository.recognize(worker, cvs, {}, { blocks: true });
            const rawWords = data.words || [];
            return {
                pass: p.name,
                width: cvs.width,
                canvas: cvs,
                items: ocrService.parseRewards({ words: rawWords, imageW: cvs.width }),
                words: rawWords.map((w) => ({
                    text: w.text,
                    cy: (w.bbox.y0 + w.bbox.y1) / 2 / cvs.height,
                    cx: (w.bbox.x0 + w.bbox.x1) / 2 / cvs.width,
                    hFrac: (w.bbox.y1 - w.bbox.y0) / cvs.height,
                })),
            };
        }));
    };

    // Fase 1: SCOUT en cascada, parando en cuanto aparece el ancla.
    progress(null, 20);
    let row = null, scoutPass = null, scoutResult = null;
    for (const pass of SCOUT_PASSES) {
        const scout = await runPasses(0, 0, W, H, SCOUT_SIDE, [pass]);
        row = findNameRowY(scout.flatMap((p) => p.words));
        scoutPass = pass.name;
        scoutResult = scout[0];
        // Con 2+ apariciones la fila es fiable; 1 se acepta como último recurso.
        if (row && row.count >= 2) break;
    }
    trace.push(row ? `ancla PRIME y=${row.y.toFixed(3)} (${row.count}, ${scoutPass})` : "sin ancla PRIME");

    // Atajo: el scout ya OCReó la imagen entera. Si de ahí salen las 4, no hace falta más.
    if (scoutResult) {
        const merged = new Map();
        for (const it of scoutResult.items) {
            if (typeof it.xPos !== "number") continue;
            merged.set(it.name, { ...it, xFrac: it.xPos / scoutResult.width, from: `scout:${scoutPass}` });
        }
        const early = filterByColumns([...merged.values()].sort((a, b) => a.xFrac - b.xFrac));
        if (early.kept.length >= 4) {
            trace.push(`atajo: el scout ya leyó ${early.kept.length}`);
            return {
                items: early.kept.map((it) => ({ ...it, xPos: it.xFrac * W })),
                roi: { x: 0, y: 0, w: W, h: H, auto: false },
                debugCanvas: scoutResult.canvas,
                ms: Math.round(performance.now() - t0),
                trace,
            };
        }
    }

    // Sin ancla solo queda OCRear la imagen entera (lento y poco fiable). En ráfaga no
    // compensa: mejor pasar al siguiente fotograma.
    if (!row && opts.skipIfNoAnchor) {
        return { items: [], roi: null, ms: Math.round(performance.now() - t0), trace, skipped: true };
    }

    // Fases 2-4: se prueban varios recortes y gana el que más recompensas lea.
    await ocrRepository.ensureSecondWorker?.().catch(() => {});

    const candidateRois = [];
    if (row && scoutResult) {
        // ROI clavada con lo que el scout ya midió: la altura de la letra da la escala real
        // de la UI, así que el recorte en "alturas de línea" se adapta a cualquier pantalla,
        // distancia y resolución. En X se ciñe a donde hay texto (fuera solo hay ruido).
        const rowWords = scoutResult.words.filter((w) => Math.abs(w.cy - row.y) < 0.03);
        const heights = rowWords.map((w) => w.hFrac).filter((h) => h > 0).sort((a, b) => a - b);
        const lineH = heights.length ? heights[Math.floor(heights.length / 2)] : 0.02;

        // ~9 alturas de línea arriba (arte + badge) y ~3 abajo. No se agranda por defecto:
        // ampliar reparte los mismos 1800 px entre más superficie y el texto pierde nitidez.
        const yTop = Math.max(0, Math.round((row.y - lineH * 9) * H));
        const yBot = Math.min(H, Math.round((row.y + lineH * 3) * H));

        const xs = rowWords.map((w) => w.cx);
        let x0 = 0, x1 = W;
        if (xs.length >= 2) {
            const pad = 0.06; // aire a los lados: el nombre más largo puede salirse del rango visto
            x0 = Math.max(0, Math.round((Math.min(...xs) - pad) * W));
            x1 = Math.min(W, Math.round((Math.max(...xs) + pad) * W));
        }
        if (yBot - yTop > H * 0.04 && x1 - x0 > W * 0.3) {
            candidateRois.push({ x: x0, y: yTop, w: x1 - x0, h: yBot - yTop, auto: true, up: lineH * 9, down: lineH * 3 });
        }
    }
    // Respaldo: si la ROI clavada no llega a las 4, se prueban márgenes más amplios (un
    // nombre de tres líneas empieza más arriba de lo que sugiere la altura de una línea) y,
    // como último recurso, la imagen entera — el scout puede fallar en fotos muy borrosas.
    if (row) {
        for (const [up, down] of ROI_MARGINS) {
            const yTop = Math.max(0, Math.round((row.y - up) * H));
            const yBot = Math.min(H, Math.round((row.y + down) * H));
            if (yBot - yTop > H * 0.08) candidateRois.push({ x: 0, y: yTop, w: W, h: yBot - yTop, auto: true, up, down });
        }
    }
    candidateRois.push({ x: 0, y: 0, w: W, h: H, auto: false });

    // Si la foto llega lavada (de lejos o con el autofoco corto), el realce de bordes va
    // primero; si no, manda el preprocesado que encontró el ancla. Umbral: ver MAINTENANCE.
    const blurry = frameSharpness(source) < BLUR_THRESHOLD;
    const preferred = blurry ? "unsharp" : scoutPass;
    const ordered = [...MAIN_PASSES].sort((a, b) => (b.name === preferred) - (a.name === preferred));
    if (blurry) trace.push("imagen poco nítida: se realzan bordes primero");

    // En serie, con corte al llegar a 4: en paralelo saturaba los workers y salía más lento.
    // El paralelismo que rinde es el de los preprocesados dentro de un recorte.
    const evaluate = async (cand, passesToRun) => {
        const passes = await runPasses(cand.x, cand.y, cand.w, cand.h, MAX_SIDE, passesToRun);
        // Unión: cada preprocesado rescata recompensas que los otros pierden.
        const merged = new Map();
        for (const p of passes) {
            for (const it of p.items) {
                if (typeof it.xPos !== "number") continue;
                // Fracción del ancho: las pasadas pueden tener resoluciones distintas.
                const c = { ...it, xFrac: it.xPos / p.width, from: p.pass };
                const prev = merged.get(it.name);
                if (!prev || (it.ratio ?? 0) > (prev.ratio ?? 0)) merged.set(it.name, c);
            }
        }
        const union = [...merged.values()].sort((a, b) => a.xFrac - b.xFrac);
        const { kept, pitch } = filterByColumns(union);
        const label = cand.auto ? `${cand.up.toFixed(2)}/${cand.down.toFixed(2)}` : "completa";
        trace.push(`roi ${label} (y=${cand.y} h=${cand.h}): unión ${union.length} → ${kept.length}`);
        return { roi: cand, kept, pitch, passes };
    };

    // Tantas pasadas simultáneas como workers: pedir más solo las encola.
    const workerCount = Math.max(1, ocrRepository.workers?.length || 1);
    const activePasses = ordered.slice(0, workerCount);

    let best = null;
    for (const [idx, cand] of candidateRois.entries()) {
        progress(null, 45 + idx * 12);
        const r = await evaluate(cand, activePasses);
        if (!best || r.kept.length > best.kept.length) best = r;
        if (best.kept.length >= 4) break; // la pantalla nunca muestra más de 4
    }

    const { roi, kept, pitch, passes } = best;
    trace.push(`elegido: y=${roi.y} h=${roi.h} · paso=${pitch ? pitch.toFixed(3) : "n/d"} · ${kept.length} recompensas`);

    // xPos en coordenadas de la imagen original: quien pinte badges no conoce la ROI.
    const items = kept.map((it) => ({ ...it, xPos: roi.x + it.xFrac * roi.w }));

    return {
        items,
        roi,
        debugCanvas: passes[0]?.canvas || null,
        ms: Math.round(performance.now() - t0),
        trace,
    };
}

/**
 * Escanea una ráfaga de fotogramas y consolida por CONSENSO (un ítem entra si aparece en
 * 2+ frames): así un frame movido o con reflejo no arruina el disparo, y los falsos
 * positivos —que rara vez se repiten— quedan fuera.
 *
 * @param {() => (CanvasImageSource|null)} grabFrame - captura un fotograma nuevo
 * @param {object} deps - igual que scanRewardPhoto
 * @param {object} [opts] - { frames = 3, delayMs = 120, budgetMs = 6000, onProgress }
 */
export async function scanRewardBurst(grabFrame, deps, opts = {}) {
    const { frames = 3, delayMs = 120, budgetMs = 6000, onProgress } = opts;
    const t0 = performance.now();
    const trace = [];
    const perFrame = [];

    // Se capturan todos al principio: alternar captura y análisis separaría las tomas
    // varios segundos y serían momentos distintos, no muestras del mismo instante.
    const shots = [];
    for (let i = 0; i < frames; i++) {
        const source = grabFrame();
        if (!source) break;
        shots.push(source);
        // Pausa mínima: sin ella repetirían el mismo defecto (mismo movimiento/reflejo).
        if (i < frames - 1 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }

    // Los más nítidos primero: medir la nitidez cuesta milisegundos y evita gastar el
    // tiempo en los frames movidos para llegar tarde al bueno (13 s → 5 s medidos).
    shots.sort((a, b) => frameSharpness(b) - frameSharpness(a));

    for (const [i, source] of shots.entries()) {
        if (onProgress) onProgress(null, 15 + (i / shots.length) * 70);

        // Los intermedios abandonan pronto si no hay ancla; el último agota las opciones.
        const isLast = i === shots.length - 1;
        const res = await scanRewardPhoto(source, deps, null, { skipIfNoAnchor: !isLast });
        perFrame.push(res);
        trace.push(`frame ${i + 1}: ${res.items.length}${res.skipped ? " (sin ancla, descartado)" : ""} (${res.ms}ms)`);

        if (res.items.length >= 4) break; // el máximo de la pantalla: no hay más que ganar

        // Presupuesto: cada frame cuesta un pipeline completo. Pasado el límite se responde
        // con lo que haya — esperar es peor que una lectura menos redundante.
        if (performance.now() - t0 > budgetMs) {
            trace.push(`presupuesto agotado tras ${perFrame.length} frame(s)`);
            break;
        }
    }

    if (perFrame.length === 0) {
        return { items: [], roi: null, ms: 0, trace: ["sin fotogramas"], frames: 0 };
    }

    const votes = new Map();
    for (const res of perFrame) {
        for (const it of res.items) {
            const prev = votes.get(it.name);
            if (prev) {
                prev.count++;
                if ((it.ratio ?? 0) > (prev.item.ratio ?? 0)) prev.item = it;
            } else {
                votes.set(it.name, { count: 1, item: it });
            }
        }
    }

    const minVotes = perFrame.length >= 2 ? 2 : 1;
    let items = [...votes.values()].filter((v) => v.count >= minVotes).map((v) => v.item);

    // Si el consenso se queda corto, se cae al mejor frame: es preferible una lectura
    // coherente que una lista recortada por un consenso que no llegó a formarse.
    const bestFrame = perFrame.reduce((a, b) => (b.items.length > a.items.length ? b : a));
    if (items.length < bestFrame.items.length) {
        trace.push(`consenso ${items.length} < mejor frame ${bestFrame.items.length}: se usa el frame`);
        items = bestFrame.items;
    }

    items.sort((a, b) => (a.xPos ?? 0) - (b.xPos ?? 0));
    trace.push(`consenso (≥${minVotes} de ${perFrame.length}): ${items.length}`);

    return {
        items,
        roi: bestFrame.roi,
        debugCanvas: bestFrame.debugCanvas,
        ms: Math.round(performance.now() - t0),
        trace,
        frames: perFrame.length,
    };
}
