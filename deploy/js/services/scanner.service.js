import { VisionService, WF_THEMES } from "./vision.service.js";
import { OCRService } from "./ocr.service.js";
import { OCRRepository } from "../repositories/ocr.repository.js";
import { OpenCVRepository } from "../repositories/opencv.repository.js";
import { ScannerHUD } from "../ui.components/ui_scanner_hud.js";
import { ScannerModal } from "../ui.components/ui_scanner_modal.js";
import { initializeOCRDatabase } from "../repositories/api.repository.js";

export const ScannerService = {
    isScanning: false,
    scanInterval: null,
    currentRate: 1200,
    lastTrackedRelic: "",
    sessionInventory: new Map(),
    detectionLocked: false,
    scanCounter: 0,
    inventoryHasScanned: false,
    qtyVotes: new Map(),
    lastStableHash: null,
    virtualCanvas: null,
    lastHashL: null,
    lastHashR: null,
    rivenConsensusBuffer: [],

    async start() {
        if (this.isScanning) return;
        this.isScanning = true;
        this.latchedContext = "UNKNOWN";
        this.unknownFrameCount = 0;
        this.detectionLocked = false;
        this.lastHashL = null;
        this.lastHashR = null;
        this.rivenConsensusBuffer = [];
        this.qtyVotes = new Map();
        globalThis.ScannerService = this;
        if (!this.virtualCanvas) {
            this.virtualCanvas = document.createElement("canvas");
            this.virtualCanvas.id = "scanner-virtual-canvas";
        }

        initializeOCRDatabase().catch(err => console.warn("Error fetching OCR reference database from backend:", err));

        import("./rivens.service.js").then(m => m.fetchRivenWeapons()).catch(err => console.warn("Error fetching Riven weapons:", err));

        await OCRRepository.warmUp();
        OpenCVRepository.waitReady().catch(() => { });
        OCRService.initMatcherData();
        this.loop();
    },

    stop() {
        this.isScanning = false;
        if (this.scanInterval) clearTimeout(this.scanInterval);
        this.scanInterval = null;
        OCRRepository.terminateAll();
    },

    async loop() {
        if (!this.isScanning) return;

        const video = document.getElementById("live-video");
        if (!video || video.paused || video.ended) {
            this.scanInterval = setTimeout(() => this.loop(), 1000);
            return;
        }

        try {
            await this.processFrame(video, this.virtualCanvas);
        } catch (e) {
            console.warn("Scanner loop error:", e);
        } finally {
            if (this.isScanning) {
                this.scanInterval = setTimeout(() => this.loop(), this.currentRate);
            }
        }
    },

    latchedContext: "UNKNOWN",
    unknownFrameCount: 0,
    lastRivenContextTime: 0,

    async processFrame(video, virtualCanvas) {
        if (this.detectionLocked) return;
        if (!this.isScanning) return;
        this.scanCounter++;

        const dims = VisionService.prepareVirtualCanvas(video, virtualCanvas);

        const worker1 = OCRRepository.workers[0];
        if (!worker1) return;
        const { data: headerData } = await OCRRepository.recognize(worker1, virtualCanvas, {}, { text: true });

        const rawContext = VisionService.determineContext(headerData.text);
        const now = Date.now();

        const textUpper = (headerData.text || "").toUpperCase();
        const containsAnchor = textUpper.includes("MODS") || textUpper.includes("MODIFICADORES") ||
                               textUpper.includes("CYCLE") || textUpper.includes("CICLO") || textUpper.includes("CICLAR") ||
                               textUpper.includes("KUVA") || textUpper.includes("KUYVA") ||
                               textUpper.includes("ATRIBUTOS") || textUpper.includes("ELEGIR") || textUpper.includes("CONFIRMAR") ||
                               textUpper.includes("AGRIETADO");
        
        if (rawContext === "INVENTORY_MODS" || rawContext === "ITEM_DETAILS" || containsAnchor) {
            this.lastRivenContextTime = now;
        }

        let routedContext = rawContext;

        if (this.lastRivenContextTime && (now - this.lastRivenContextTime < 8000)) {
            if (rawContext === "UNKNOWN" || rawContext === "INVENTORY") {
                routedContext = "INVENTORY_MODS";
            } else if (rawContext === "RELICS" || rawContext === "REWARD") {
                this.lastRivenContextTime = 0;
            }
        }

        if (routedContext === "UNKNOWN") {
            this.unknownFrameCount++;
            if (this.unknownFrameCount >= 3) {
                this.latchedContext = "UNKNOWN";
            }
        } else {
            this.unknownFrameCount = 0;
            this.latchedContext = routedContext;
        }

        console.log(`[SCAN] Context Raw: ${rawContext} | Latched: ${this.latchedContext} | Header: "${(headerData.text || "").trim().slice(0, 60)}"`);
        await this.routeFrameAction(this.latchedContext, video, dims);

        ScannerHUD.updateFrameCounter(this.scanCounter);
    },

    recordQtyVote(itemName, qtyResult) {
        let votes = this.qtyVotes.get(itemName);
        if (!votes) { votes = new Map(); this.qtyVotes.set(itemName, votes); }

        const readOk = /\d/.test(qtyResult.raw || "");
        if (readOk) {
            votes.set(qtyResult.qty, (votes.get(qtyResult.qty) || 0) + 1);
        }

        const consensus = this.modeQty(votes);
        this.sessionInventory.set(itemName, consensus !== null ? consensus : qtyResult.qty);
    },

    modeQty(votes) {
        let bestQty = null, bestCount = -1;
        for (const [qty, count] of votes) {
            if (count > bestCount || (count === bestCount && qty > bestQty)) {
                bestCount = count; bestQty = qty;
            }
        }
        return bestQty;
    },

    autoScrollHash: null,
    autoScrollStableTimer: null,
    lastFrameHash: null,
    scrollDirectionAccumulator: 0,
    lastRowLums: null,

    async routeFrameAction(contextType, video, dims) {
        ScannerHUD.updateContext(contextType);

        if (contextType === "INVENTORY") {
            if (!globalThis.state.autoScanEnabled) {
                this.currentRate = 3000;
                this.autoScrollHash = null;
                this.lastFrameHash = null;
                if (this.autoScrollStableTimer) {
                    clearTimeout(this.autoScrollStableTimer);
                    this.autoScrollStableTimer = null;
                }
                return;
            }

            this.currentRate = 300;

            const sampleCvs = document.createElement("canvas");
            sampleCvs.width = 48; sampleCvs.height = 27;
            const sCtx = sampleCvs.getContext("2d", { willReadFrequently: true });
            sCtx.drawImage(video, 0, Math.floor(video.videoHeight * 0.25), video.videoWidth, Math.floor(video.videoHeight * 0.5), 0, 0, 48, 27);
            const currentHash = VisionService.getFrameHash(sCtx, 48, 27);

            if (this.lastFrameHash === null || this.lastFrameHash === undefined) {
                this.lastFrameHash = currentHash;
                return;
            }

            const rowLums = [];
            const imgData = sCtx.getImageData(0, 0, 48, 27);
            const px = imgData.data;
            for (let r = 0; r < 27; r++) {
                let sum = 0;
                const rowStart = r * 48 * 4;
                for (let c = 0; c < 48; c++) {
                    const idx = rowStart + c * 4;
                    sum += px[idx] * 0.299 + px[idx+1] * 0.587 + px[idx+2] * 0.114;
                }
                rowLums.push(sum / 48);
            }

            let bestDy = 0;
            let mseZero = 0;
            if (this.lastRowLums) {
                let minError = Infinity;
                for (let dy = -6; dy <= 6; dy++) {
                    let errorSum = 0;
                    let count = 0;
                    for (let r = 0; r < 27; r++) {
                        const prevR = r + dy;
                        if (prevR >= 0 && prevR < 27) {
                            const diff = rowLums[r] - this.lastRowLums[prevR];
                            errorSum += diff * diff;
                            count++;
                        }
                    }
                    const mse = count > 0 ? (errorSum / count) : Infinity;
                    if (dy === 0) mseZero = mse;
                    if (mse < minError) {
                        minError = mse;
                        bestDy = dy;
                    }
                }
            }
            this.lastRowLums = rowLums;

            const isScrolling = (bestDy !== 0 && minError < mseZero - 5) || mseZero > 80;

            if (isScrolling) {
                this.scrollDirectionAccumulator += bestDy;
                if (this.autoScrollStableTimer) {
                    clearTimeout(this.autoScrollStableTimer);
                    this.autoScrollStableTimer = null;
                }
                ScannerHUD.updateScrollStatus("detected");
                return;
            }

            const hasPageChanged = !this.autoScrollHash || Math.abs(currentHash - this.autoScrollHash) >= 120;
            const isScrollDown = this.scrollDirectionAccumulator > 1;
            const isFirstScan = !this.autoScrollHash;

            if (hasPageChanged && !this.autoScrollStableTimer && !this.detectionLocked) {
                if (!isFirstScan && this.scrollDirectionAccumulator < 0) {
                    this.scrollDirectionAccumulator = 0;
                    this.autoScrollHash = currentHash;
                    ScannerHUD.updateScrollStatus("done", this.sessionInventory.size);
                    return;
                }

                ScannerHUD.updateScrollStatus("detected");

                this.autoScrollStableTimer = setTimeout(async () => {
                    this.scrollDirectionAccumulator = 0;
                    if (!globalThis.state.autoScanEnabled || this.detectionLocked) {
                        this.autoScrollStableTimer = null;
                        return;
                    }

                    const v = document.getElementById("live-video");
                    const snapshot = document.createElement("canvas");
                    snapshot.width = v.videoWidth; snapshot.height = v.videoHeight;
                    snapshot.getContext("2d").drawImage(v, 0, 0);

                    await this.processInventoryGrid(snapshot, dims.width, dims.height, dims.scale);
                    this.autoScrollHash = currentHash;
                    this.autoScrollStableTimer = null;

                }, 800);
            } else if (!this.autoScrollStableTimer) {
                this.scrollDirectionAccumulator = 0;
                ScannerHUD.updateScrollStatus("done", this.sessionInventory.size);
            }

        } else if (contextType === "INVENTORY_MODS" || contextType === "ITEM_DETAILS" || (globalThis.state.scannerModsMode && contextType === "INVENTORY")) {
            this.currentRate = 1200;
            if (this.detectionLocked) return;
            await this.processRivenCard(video, dims, contextType);
        } else if (contextType === "RELICS") {
            if (globalThis.RivenScannerHUD) globalThis.RivenScannerHUD.dismiss();
            this.currentRate = 600;
            await this.processRelicSelection(video, dims);
        } else if (contextType === "REWARD") {
            if (globalThis.RivenScannerHUD) globalThis.RivenScannerHUD.dismiss();
            if (this.detectionLocked) return;
            this.currentRate = 1200;
            await this.processRewards(video, dims);
        } else {
            if (globalThis.RivenScannerHUD) globalThis.RivenScannerHUD.dismiss();
            this.currentRate = globalThis.state.autoScanEnabled ? 1000 : 3000;
        }
    },

    lastParsedL: null,
    lastParsedR: null,

    _isSameRiven(a, b) {
        if (!a && !b) return true;
        if (!a || !b) return false;
        if (a.weaponName !== b.weaponName) return false;
        if (a.rolls !== b.rolls) return false;
        if (a.stats.length !== b.stats.length) return false;
        for (let i = 0; i < a.stats.length; i++) {
            if (a.stats[i].name !== b.stats[i].name) return false;
            if (a.stats[i].isPositive !== b.stats[i].isPositive) return false;
        }
        return true;
    },

    _isBetterOrEqualRead(newRiven, oldRiven) {
        if (!oldRiven) return true;
        if (!newRiven) return false;

        if (oldRiven.weaponName && !newRiven.weaponName) return false;

        if (oldRiven.rolls !== null && newRiven.rolls === null) return false;

        if (newRiven.weaponName !== oldRiven.weaponName || newRiven.rolls !== oldRiven.rolls) {
            return true;
        }

        const newMatchedCount = newRiven.stats.filter(s => s.matched).length;
        const oldMatchedCount = oldRiven.stats.filter(s => s.matched).length;

        if (newMatchedCount > oldMatchedCount) return true;
        if (newMatchedCount < oldMatchedCount) return false;

        const newConf = newRiven.validation?.confidence ?? 0;
        const oldConf = oldRiven.validation?.confidence ?? 0;
        if (newConf > oldConf) return true;

        return false;
    },

    _getCanvasHash(canvas) {
        if (!canvas) return "";
        const tiny = document.createElement("canvas");
        tiny.width = 8;
        tiny.height = 8;
        const ctx = tiny.getContext("2d");
        const startY = Math.floor(canvas.height * 0.45);
        const sourceH = canvas.height - startY;
        ctx.drawImage(canvas, 0, startY, canvas.width, sourceH, 0, 0, 8, 8);
        const imgData = ctx.getImageData(0, 0, 8, 8).data;
        let hash = "";
        for (let i = 0; i < imgData.length; i += 4) {
            const avg = Math.floor((imgData[i] + imgData[i+1] + imgData[i+2]) / 3);
            hash += avg.toString(16).padStart(2, "0");
        }
        return hash;
    },

    _compareHashes(hash1, hash2) {
        if (!hash1 || !hash2) return false;
        if (hash1.length !== hash2.length) return false;
        let diff = 0;
        for (let i = 0; i < hash1.length; i += 2) {
            const val1 = parseInt(hash1.substring(i, i + 2), 16);
            const val2 = parseInt(hash2.substring(i, i + 2), 16);
            diff += Math.abs(val1 - val2);
        }
        const avgDiff = diff / (hash1.length / 2);
        return avgDiff < 18;
    },

    _rivenFingerprint(parsed) {
        if (!parsed) return "null";
        const w = parsed.weaponName || "?";
        const s = parsed.stats.map(st => `${st.isPositive ? "+" : "-"}${st.name}`).sort().join(",");
        return `${w}|${s}`;
    },

    // splits OCR words into riven cards by X gaps, filters art noise and rebuilds text lines
    _wordsToCards(data, canvasWidth) {
        let words = [];
        const pushAll = (arr) => { if (Array.isArray(arr)) for (const w of arr) words.push(w); };
        if (Array.isArray(data?.words)) pushAll(data.words);
        if (!words.length && Array.isArray(data?.lines)) data.lines.forEach(l => pushAll(l.words));
        if (!words.length && Array.isArray(data?.paragraphs)) data.paragraphs.forEach(p => (p.lines || []).forEach(l => pushAll(l.words)));
        if (!words.length && Array.isArray(data?.blocks)) data.blocks.forEach(b => (b.paragraphs || []).forEach(p => (p.lines || []).forEach(l => pushAll(l.words))));

        if (globalThis._rivenWordDump) {
            const dump = words.filter(w => w && w.text && w.bbox)
                .map(w => `${w.text.trim()}@${Math.round(w.confidence ?? 0)}(${Math.round((w.bbox.x0 + w.bbox.x1) / 2)},${Math.round((w.bbox.y0 + w.bbox.y1) / 2)})`)
                .join("  ");
            console.log(`[RIVEN WORDS] ${dump}`);
        }

        const isContent = (t) => (t || "").replace(/[^a-z0-9]/gi, "").length >= 3 || /\d/.test(t || "");

        const toText = (ws) => {
            const heights = ws.map(w => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
            const medH = heights[Math.floor(heights.length / 2)] || 20;
            const lines = [];
            for (const w of ws.slice().sort((a, b) => a.bbox.y0 - b.bbox.y0)) {
                const cy = (w.bbox.y0 + w.bbox.y1) / 2;
                let line = lines.find(L => Math.abs(L.cy - cy) < medH * 0.6);
                if (!line) { line = { cy, ws: [] }; lines.push(line); }
                line.ws.push(w);
                line.cy = (line.cy * (line.ws.length - 1) + cy) / line.ws.length;
            }
            lines.sort((a, b) => a.cy - b.cy);
            return lines.map(L => L.ws.sort((a, b) => a.bbox.x0 - b.bbox.x0).map(w => w.text).join(" ")).join("\n");
        };

        const gapThresh = Math.max(canvasWidth * 0.07, 80);
        const clusterByX = (ws) => {
            const items = ws.map(w => ({ w, cx: (w.bbox.x0 + w.bbox.x1) / 2 })).sort((a, b) => a.cx - b.cx);
            const groups = [[]];
            let prev = null;
            for (const it of items) {
                if (prev !== null && it.cx - prev > gapThresh) groups.push([]);
                groups[groups.length - 1].push(it.w);
                prev = it.cx;
            }
            return groups;
        };

        const ANCHOR_CONF = 70;
        const INSIDE_CONF = 28;
        const anchors = words.filter(w => w && w.text && w.bbox && isContent(w.text) && (w.confidence ?? 0) >= ANCHOR_CONF);
        console.log(`[OCR DIAG] dataKeys=[${Object.keys(data || {}).join(",")}] rawWords=${words.length} anchors=${anchors.length}`, words[0]);
        if (anchors.length >= 3) {
            const anchorGroups = clusterByX(anchors).filter(g => g.length >= 3);
            if (anchorGroups.length >= 2) {
                const inside = words.filter(w => w && w.text && w.bbox && isContent(w.text) && (w.confidence ?? 0) >= INSIDE_CONF);
                const cards = anchorGroups.map(g => {
                    const x0 = Math.min(...g.map(t => t.bbox.x0)), x1 = Math.max(...g.map(t => t.bbox.x1));
                    const mx = (x1 - x0) * 0.06;
                    const ws = inside.filter(w => {
                        const cx = (w.bbox.x0 + w.bbox.x1) / 2;
                        return cx >= x0 - mx && cx <= x1 + mx;
                    });
                    return toText(ws);
                });
                console.log(`[OCR DIAG] spatial cards=${cards.length} (anchorGroups=${anchorGroups.length})`);
                return cards;
            }
        }

        const usable = words.filter(w => w && w.text && isContent(w.text) && (w.confidence ?? 0) >= 50 && w.bbox);
        console.log(`[OCR DIAG] usable=${usable.length} (fallback)`);
        if (usable.length < 3) return null;
        const realGroups = clusterByX(usable).filter(g => g.length >= 3);
        console.log(`[OCR DIAG] gapThresh=${Math.round(gapThresh)} realGroups=${realGroups.length}`);
        if (realGroups.length < 2) return null;
        return realGroups.map(toText);
    },

    async processRivenCard(video, dims, contextType = null) {
        const { scale } = dims;

        const cardCrop = contextType === "ITEM_DETAILS" ? VisionService.RIVEN_ITEM_DETAILS_CROP : VisionService.RIVEN_CARD_CROP;

        const canvases = VisionService.prepareRivenCardCanvases(video, scale, cardCrop);
        const hash = canvases.map(c => this._getCanvasHash(c)).join("|");

        if (globalThis.dumpRivenCrops) {
            canvases.forEach((c, i) => console.log(`[RIVEN CROP ${canvases.length > 1 ? `C${i + 1}` : "C"}] ${c.toDataURL("image/png")}`));
            globalThis.dumpRivenCrops = false;
        }

        if ((this.lastParsedL || this.lastParsedR) && this._sameCombinedHash(hash, this.lastHashL)) {
            this.lastRivenContextTime = Date.now();
            return;
        }

        const worker = OCRRepository.workers[1] || OCRRepository.workers[0];
        const { RivenOCRService } = await import("./riven_ocr.service.js?v=2");

        const reads = await Promise.all(canvases.map(c => OCRRepository.recognize(worker, c, {}, { blocks: true })));
        const entries = [];
        reads.forEach((res, ci) => {
            const cardTexts = this._wordsToCards(res.data, canvases[ci].width) || [res.data.text || ""];
            cardTexts.forEach((text) => {
                const parsed = RivenOCRService.parseRivenCard(text);
                const label = `C${entries.length + 1}`;
                this._logRivenRead(label, text, parsed, canvases[ci]);
                entries.push({ res, text, parsed, canvas: canvases[ci] });
            });
        });

        const anyText = entries.map(e => e.text.toUpperCase()).join(" ");
        const hasCardAnchor = /CYCLE|KUVA|KUYVA|CONFIRM|\bMR\s*\d/.test(anyText);

        const MIN_CONF = 0.5;
        const valids = entries.filter(e => e.parsed && (e.parsed.validation?.confidence ?? 0) >= MIN_CONF);

        if (valids.length || hasCardAnchor) this.lastRivenContextTime = Date.now();

        const currentFP = valids.map(e => this._rivenFingerprint(e.parsed)).join("||") || "none";
        this.rivenConsensusBuffer.push(currentFP);
        if (this.rivenConsensusBuffer.length > 3) this.rivenConsensusBuffer.shift();
        const matchCount = this.rivenConsensusBuffer.filter(fp => fp === currentFP).length;
        const hasConsensus = matchCount >= 2;

        const parsedL = valids[0]?.parsed || null;
        const parsedR = valids[1]?.parsed || null;

        const shownCount = (this.lastParsedL ? 1 : 0) + (this.lastParsedR ? 1 : 0);
        const revealsMore = valids.length > shownCount;

        const newWeapons = valids.map(e => e.parsed.weaponName).filter(Boolean).sort().join("|");
        const shownWeapons = [this.lastParsedL, this.lastParsedR].filter(Boolean)
            .map(p => p.weaponName).filter(Boolean).sort().join("|");
        const weaponChanged = newWeapons !== "" && newWeapons !== shownWeapons;

        if (!hasConsensus && !revealsMore && !weaponChanged && (this.lastParsedL || this.lastParsedR)) {
            console.log(`[RIVEN OCR] Consensus: ${matchCount}/3 — waiting for confirmation`);
            if (globalThis._scannerDebug) this._renderRivenDebug(entries, false);
            return;
        }

        const lastFP = [this.lastParsedL, this.lastParsedR].filter(Boolean)
            .map(p => this._rivenFingerprint(p)).join("||") || "none";
        const shouldUpdate = currentFP !== "none" && currentFP !== lastFP;

        if (globalThis._scannerDebug) this._renderRivenDebug(entries, shouldUpdate);

        if (!shouldUpdate) return;

        this.lastParsedL = parsedL;
        this.lastParsedR = parsedR;
        this.lastHashL = hash;
        this.lastHashR = null;

        let screenshotDataURL = null;
        try {
            const C = cardCrop;
            const colorCvs = document.createElement("canvas");
            const cropX = Math.floor(video.videoWidth * C.x);
            const cropW = Math.floor(video.videoWidth * C.w);
            const cropY = Math.floor(video.videoHeight * C.y);
            const cropH = Math.floor(video.videoHeight * C.h);
            colorCvs.width = cropW;
            colorCvs.height = cropH;
            colorCvs.getContext("2d").drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
            screenshotDataURL = colorCvs.toDataURL("image/png");
        } catch (e) {
            console.warn("Screenshot capture failed:", e);
        }

        if (globalThis.showRivenAppraisal) {
            globalThis.showRivenAppraisal(parsedL, parsedR, screenshotDataURL);
        }
    },

    _sameCombinedHash(a, b) {
        if (!a || !b) return false;
        const pa = a.split("|"), pb = b.split("|");
        if (pa.length !== pb.length) return false;
        return pa.every((h, i) => this._compareHashes(h, pb[i]));
    },

    _logRivenRead(side, rawText, parsed, canvas) {
        const raw = (rawText || "").trim().replace(/\n/g, " | ");
        const v = parsed?.validation;
        const tag = parsed
            ? `${parsed.weaponName || "?"} | ${parsed.stats.length} stats | conf ${v ? v.confidence : "?"}${v && !v.valid ? " ⚠" : " ✓"}`
            : "no parse";
        console.log(`[RIVEN OCR ${side}] ${tag} | crop ${canvas?.width}x${canvas?.height} | raw: "${raw}"`);
        if (parsed) {
            const stats = parsed.stats.map(s => `${s.isPositive ? "+" : "-"}${s.value}% ${s.name}${s.suspicious ? "⚠" : ""}`).join("  ");
            console.log(`  → riven: ${parsed.rivenName || "—"} | rolls ${parsed.rolls ?? "—"} | mr ${parsed.mr ?? "—"} | ${stats}`);
            if (v?.issues?.length) console.log(`  → issues: ${v.issues.join("; ")}`);
        }
    },

    _renderRivenDebug(entries, accepted) {
        if (!entries || entries.length === 0) return;

        const gap = 12;
        const panelH = Math.max(...entries.map(e => e.canvas.height));
        const totalW = entries.reduce((w, e) => w + e.canvas.width, 0) + gap * (entries.length - 1);

        const debugCvs = document.createElement("canvas");
        debugCvs.width = Math.max(totalW, 200);
        debugCvs.height = panelH + 22;
        const dCtx = debugCvs.getContext("2d");
        dCtx.fillStyle = "#000";
        dCtx.fillRect(0, 0, debugCvs.width, debugCvs.height);

        let xOff = 0;
        entries.forEach((e, idx) => {
            dCtx.drawImage(e.canvas, xOff, 18);

            if (e.res?.data?.lines) {
                e.res.data.lines.forEach(line => {
                    const t = line.text ? line.text.trim() : "";
                    if (!t || !line.bbox) return;
                    const b = line.bbox;
                    const isStat = t.includes("%") || t.includes("+") || t.includes("-");
                    dCtx.strokeStyle = "rgba(0, 229, 255, 0.6)";
                    dCtx.lineWidth = 1;
                    dCtx.strokeRect(xOff + b.x0, 18 + b.y0, b.x1 - b.x0, b.y1 - b.y0);
                    dCtx.fillStyle = isStat ? "#00ff78" : "#aaa";
                    dCtx.font = "9px monospace";
                    dCtx.fillText(t, xOff + b.x0, 18 + b.y0 - 1);
                });
            }

            const conf = e.parsed?.validation ? ` c${e.parsed.validation.confidence}` : "";
            dCtx.fillStyle = "rgba(172, 131, 213, 0.95)";
            dCtx.font = "bold 10px monospace";
            dCtx.fillText(`#${idx + 1} ${e.parsed ? (e.parsed.weaponName || "?") : "—"}${conf}`, xOff + 2, 12);

            xOff += e.canvas.width + gap;
        });

        const consensusCount = this.rivenConsensusBuffer.filter(fp => fp === this.rivenConsensusBuffer[this.rivenConsensusBuffer.length - 1]).length;
        dCtx.fillStyle = accepted ? "#00ff78" : "#ff6644";
        dCtx.font = "bold 10px monospace";
        dCtx.fillText(`${accepted ? "✓" : "⏳"} ${consensusCount}/3`, debugCvs.width - 48, 12);

        ScannerHUD.updateDebugSnapshot(debugCvs.toDataURL("image/webp"));
    },

    async processRelicSelection(video, dims) {
        const { scale } = dims;
        const canvas = VisionService.prepareRelicSelectionCanvas(video, scale);
        const worker1 = OCRRepository.workers[0];
        const { data } = await OCRRepository.recognize(worker1, canvas, {}, { text: true });

        const relicMatch = OCRService.parseRelicSelection(data.text);
        if (relicMatch && relicMatch !== this.lastTrackedRelic) {
            this.lastTrackedRelic = relicMatch;
            if (globalThis.showTrackConfirm) globalThis.showTrackConfirm(relicMatch, data.text);
        }
    },

    async processRewards(video, dims) {
        const { width, height, scale } = dims;
        const ocrCanvas = VisionService.prepareRewardOCRCanvas(video, width, height, scale);
        console.log(`[REWARD] Canvas: ${ocrCanvas.width}x${ocrCanvas.height}`);

        if (globalThis.OpenCVEngine?.isReady) {
            globalThis.OpenCVEngine.processForOCR(ocrCanvas, "hard");
            console.log("[REWARD] Binarization: OpenCV");
        } else {
            const ctx = ocrCanvas.getContext("2d", { willReadFrequently: true });
            const imgData = ctx.getImageData(0, 0, ocrCanvas.width, ocrCanvas.height);
            const px = imgData.data;
            let textPixels = 0;
            for (let i = 0; i < px.length; i += 4) {
                const v = px[i] > 128 ? 0 : 255;
                if (v === 0) textPixels++;
                px[i] = px[i + 1] = px[i + 2] = v;
            }
            ctx.putImageData(imgData, 0, 0);
            const totalPx = px.length / 4;
            console.log(`[REWARD] Binarization: ${textPixels} text pixels / ${totalPx} total (${(100 * textPixels / totalPx).toFixed(2)}%)`);
        }

        const dbgPanel = document.getElementById("live-debug-snapshot");
        if (dbgPanel?.style.display === "block") {
            const debugImg = document.getElementById("live-debug-snapshot-img");
            if (debugImg) debugImg.src = ocrCanvas.toDataURL("image/jpeg", 0.85);
        }

        const namesCanvas = VisionService.prepareRewardNamesCanvas(video, width, height, scale);
        const w0 = OCRRepository.workers[0];
        const w1 = OCRRepository.workers[1] || w0;
        const [metaRes, namesRes] = await Promise.all([
            OCRRepository.recognize(w0, ocrCanvas, {}, { blocks: true }),
            OCRRepository.recognize(w1, namesCanvas, {}, { blocks: true }),
        ]);
        const data = metaRes.data;
        const rawOcr = data.text || "";
        console.log(`[REWARD] OCR raw (grayscale/badges): "${rawOcr.replaceAll(/\n+/g, " ").trim().slice(0, 120)}"`);
        const namesRaw = namesRes.data?.text || "";
        console.log(`[REWARD] OCR raw (color/nombres): "${namesRaw.replaceAll(/\n+/g, " ").trim().slice(0, 120)}"`);

        const mergedWords = [...(namesRes.data?.words || []), ...(data.words || [])];
        const foundItems = OCRService.parseRewards({ words: mergedWords, imageW: ocrCanvas.width });
        console.log(`[REWARD] Items found: ${foundItems.length}`, foundItems.map(i => i.name));

        clearRewardDebugLogs();
        const cleanOcrText = rawOcr.replaceAll(/\n+/g, ' ').trim();
        addRewardDebugLog("OCR", `Read: ${cleanOcrText}`, "info");
        addRewardDebugLog("SCAN", `Items found: ${foundItems.length}`, foundItems.length > 0 ? "match" : "warn");

        const contextText = `${rawOcr} ${namesRaw}`.toUpperCase();
        const NON_REWARD_TOKENS = [
            "MISSION COMPLETE", "MISION COMPLETADA", "MISIÓN COMPLETADA",
            "IMPORTANCE", "IMPORTANCIA", "SEARCH", "BUSCAR",
        ];
        const badToken = NON_REWARD_TOKENS.find(t => contextText.includes(t));
        if (badToken && foundItems.length > 0) {
            console.log(`[REWARD] Ignorado: pantalla fuera de contexto (token "${badToken}")`);
            addRewardDebugLog("CTX", `Skipped: end-of-mission screen detected ("${badToken}")`, "warn");
            return;
        }

        if (foundItems.length > 0 && !this.detectionLocked) {
            foundItems.forEach(item => {
                const status = item.crafted ? "CRAFTED" : `${item.owned} OWNED`;
                addRewardDebugLog("ITEM", `${item.name} -> ${status}`, "match");
            });

            this.detectionLocked = true;
            const snapshot = document.createElement("canvas");
            snapshot.width = width; snapshot.height = height;
            snapshot.getContext("2d").drawImage(video, 0, 0, width, height);
            ScannerModal.open(snapshot.toDataURL("image/jpeg", 0.85), foundItems, width, height, scale, rawOcr);
        }
    },

    async processInventoryGrid(snapshot, width, height, scale) {
        if (this.detectionLocked) return;
        this.detectionLocked = true;

        try {
            if (globalThis.LiveCalibration && !globalThis.LiveCalibration.hasCalibration()) {
                console.log("[INV] No calibration found. Starting zone calibration...");
                const calibCvs = document.createElement("canvas");
                calibCvs.width = width;
                calibCvs.height = height;
                const calibCtx = calibCvs.getContext("2d", { willReadFrequently: true });
                calibCtx.drawImage(snapshot, 0, 0);
                await globalThis.LiveCalibration.runCalibrationFlow(
                    calibCtx.getImageData(0, 0, width, height)
                );
                return;
            }

            const calibData = globalThis.LiveCalibration?.getGrid();
            if (!calibData?.gridZone) {
                console.warn("[INV] No grid zone calibration available.");
                return;
            }

            const { gridZone } = calibData;

            const theme = VisionService.detectThemeFromSnapshot(
                snapshot,
                gridZone.x, gridZone.y, gridZone.w, gridZone.h
            );
            if (!theme) {
                console.warn("[INV] Theme detection inconclusive this frame — skipping.");
                ScannerHUD.updateScrollStatus("done", 0);
                return;
            }
            console.log(`[INV] Theme detected: ${theme.name} (r:${theme.r} g:${theme.g} b:${theme.b})`);

            const autoGrid = VisionService.buildAutoGrid(snapshot, gridZone, theme, calibData);
            if (!autoGrid || autoGrid.cellRects.length === 0) {
                console.warn("[INV] Auto-grid detection failed — inventory may not be visible or zone needs recalibration.");
                ScannerHUD.updateScrollStatus("done", 0);
                return;
            }

            const { cellRects, cellW, cellH } = autoGrid;
            console.log(`[INV] Auto-grid: ${autoGrid.rows}r × ${autoGrid.cols}c, ${cellRects.length} cells`);

            ScannerHUD.updateScrollStatus("scanning");

            const debugCanvas = document.createElement("canvas");
            debugCanvas.width = gridZone.w;
            debugCanvas.height = gridZone.h;
            const dCtx = debugCanvas.getContext("2d");
            dCtx.drawImage(snapshot, gridZone.x, gridZone.y, gridZone.w, gridZone.h, 0, 0, gridZone.w, gridZone.h);

            dCtx.strokeStyle = "rgba(0,229,255,0.4)";
            dCtx.lineWidth = 1;
            cellRects.forEach(cell => dCtx.strokeRect(cell.sx - gridZone.x, cell.sy - gridZone.y, cellW, cellH));

            const gridLeft = Math.min(...cellRects.map(c => c.sx)) - gridZone.x;
            const gridRight = Math.max(...cellRects.map(c => c.sx + cellW)) - gridZone.x;
            dCtx.strokeStyle = "rgba(255, 193, 7, 0.5)";
            dCtx.lineWidth = 1.5;
            dCtx.setLineDash([6, 4]);
            for (let ri = 0; ri < autoGrid.rows; ri++) {
                const rowCell = cellRects.find(c => c.r === ri);
                if (rowCell) {
                    dCtx.beginPath();
                    dCtx.moveTo(gridLeft, rowCell.sy - gridZone.y);
                    dCtx.lineTo(gridRight, rowCell.sy - gridZone.y);
                    dCtx.stroke();
                }
            }
            dCtx.setLineDash([]);

            const activeCells = [];
            for (const cell of cellRects) {
                const textSrcY = Math.round(cellH * 0.58);
                const textSrcH = cellH - textSrcY;
                const textCvs = VisionService.cropThemeBinarized(snapshot, cell.sx, cell.sy + textSrcY, cellW, textSrcH, theme);

                const tCtx = textCvs.getContext("2d");
                const imgData = tCtx.getImageData(0, 0, textCvs.width, textCvs.height);
                const pixels = imgData.data;
                let whitePixelCount = 0;
                for (let p = 0; p < pixels.length; p += 4) {
                    if (pixels[p] > 200) whitePixelCount++;
                }

                if (whitePixelCount < 40) {
                    this.lastRawOcrLog.push(`[r${cell.r}c${cell.c}] SKIPPED (empty)`);
                    const relX = cell.sx - gridZone.x;
                    const relY = cell.sy - gridZone.y;
                    dCtx.strokeStyle = "rgba(255, 255, 255, 0.04)";
                    dCtx.lineWidth = 1;
                    dCtx.strokeRect(relX + 2, relY + 2, cellW - 4, cellH - 4);
                } else {
                    activeCells.push({ cell, textCvs });
                }
            }

            const workers = OCRRepository.workers;
            const bWorkers = OCRRepository.badgeWorkers;
            this.lastRawOcrLog = [];

            let cellIndex = 0;
            const runWorker = async (worker, bWorker) => {
                while (cellIndex < activeCells.length) {
                    const task = activeCells[cellIndex++];
                    if (!task) break;

                    const { cell, textCvs } = task;
                    const combinedText = await OCRService.extractCellText(worker, textCvs);

                    if (!combinedText) {
                        this.lastRawOcrLog.push(`[r${cell.r}c${cell.c}] NONE`);
                        continue;
                    }

                    let logStr = `[r${cell.r}c${cell.c}] OCR: ${combinedText.join(" ")}`;
                    let bestItem = OCRService.getValidItemMatch(combinedText);
                    
                    if (!bestItem) {
                        const fullCellCvs = VisionService.cropThemeBinarized(snapshot, cell.sx, Math.max(0, cell.sy - 16), cellW, cellH + 16, theme);
                        const fallbackText = await OCRService.extractCellText(worker, fullCellCvs);
                        if (fallbackText && fallbackText.length) {
                            logStr = `[r${cell.r}c${cell.c}] OCR (fallback): ${fallbackText.join(" ")}`;
                            bestItem = OCRService.getValidItemMatch(fallbackText);
                        }
                    }

                    if (bestItem) {
                        const badgeCanvas = VisionService.extractBadgeByColor(snapshot, cell, cellW, cellH, theme);
                        const qtyResult = await OCRService.extractCellQuantity(bWorker, badgeCanvas);

                        logStr += ` || BDG: ${qtyResult.raw}`;
                        this.lastRawOcrLog.push(logStr);

                        this.recordQtyVote(bestItem.originalName, qtyResult);

                        const relX = cell.sx - gridZone.x;
                        const relY = cell.sy - gridZone.y;

                        dCtx.fillStyle = "rgba(10, 15, 28, 0.98)";
                        dCtx.fillRect(relX, relY + cellH - 50, cellW, 50);
                        
                        dCtx.fillStyle = "rgba(0, 229, 255, 0.7)";
                        dCtx.fillRect(relX, relY + cellH - 50, cellW, 1.5);

                        dCtx.fillStyle = "#ffb300";
                        dCtx.font = "italic 9px system-ui, -apple-system, sans-serif";
                        const rawText = combinedText.join(" ");
                        const badgeRawText = qtyResult.raw ? qtyResult.raw.trim().replaceAll(/\s+/g, " ") : "Ø";
                        const maxCharsItem = Math.floor(cellW / 5.5);
                        const truncatedItem = rawText.length > maxCharsItem ? rawText.slice(0, maxCharsItem - 3) + "..." : rawText;
                        dCtx.fillText(truncatedItem, relX + 6, relY + cellH - 37);

                        dCtx.fillText(`BDG: "${badgeRawText}"`, relX + 6, relY + cellH - 25);

                        dCtx.fillStyle = "#00ff78";
                        dCtx.font = "bold 12px system-ui, -apple-system, sans-serif";
                        const shortName = bestItem.originalName.replace(/Prime/gi, "").trim();
                        dCtx.fillText(shortName, relX + 6, relY + cellH - 8);

                        const shiftLeft = (cell.c === 0) ? 14 : 2;
                        dCtx.fillStyle = "rgba(0, 0, 0, 0.85)";
                        dCtx.fillRect(relX - shiftLeft, relY + 4, 44 + (shiftLeft - 2), 18);
                        dCtx.fillStyle = "#ffc107";
                        dCtx.font = "bold 11px monospace";
                        const consensusQty = this.sessionInventory.get(bestItem.originalName) ?? qtyResult.qty;
                        dCtx.fillText(`x${consensusQty}`, relX - shiftLeft + 8, relY + 17);

                        if (badgeCanvas) {
                            const bX = (badgeCanvas.cropX !== undefined ? badgeCanvas.cropX : cell.sx) - gridZone.x;
                            const bY = badgeCanvas.bestY - gridZone.y;
                            const bW = badgeCanvas.cropW !== undefined ? badgeCanvas.cropW : Math.round(cellW * 0.28);
                            const bH = badgeCanvas.cropH !== undefined ? badgeCanvas.cropH : Math.round(cellH * 0.12);
                            dCtx.strokeStyle = "rgba(255, 193, 7, 0.85)";
                            dCtx.lineWidth = 1.5;
                            dCtx.strokeRect(bX, bY, bW, bH);
                        }
                    } else {
                        this.lastRawOcrLog.push(logStr);
                        const relX = cell.sx - gridZone.x;
                        const relY = cell.sy - gridZone.y;
                        dCtx.strokeStyle = "rgba(255, 30, 80, 0.6)";
                        dCtx.lineWidth = 2;
                        dCtx.strokeRect(relX + 2, relY + 2, cellW - 4, cellH - 4);

                        dCtx.fillStyle = "rgba(25, 10, 15, 0.98)";
                        dCtx.fillRect(relX, relY + cellH - 50, cellW, 50);
                        
                        dCtx.fillStyle = "rgba(255, 30, 80, 0.7)";
                        dCtx.fillRect(relX, relY + cellH - 50, cellW, 1.5);

                        dCtx.fillStyle = "#ff5252";
                        dCtx.font = "italic 9px system-ui, -apple-system, sans-serif";
                        const rawText = combinedText ? combinedText.join(" ") : "EMPTY";
                        const maxCharsItem = Math.floor(cellW / 5.5);
                        const truncatedItem = rawText.length > maxCharsItem ? rawText.slice(0, maxCharsItem - 3) + "..." : rawText;
                        dCtx.fillText(truncatedItem, relX + 6, relY + cellH - 37);

                        dCtx.fillText(`BDG: "Ø"`, relX + 6, relY + cellH - 25);

                        dCtx.fillStyle = "#8c9eff";
                        dCtx.font = "bold 12px system-ui, -apple-system, sans-serif";
                        dCtx.fillText("UNMATCHED CELL", relX + 6, relY + cellH - 8);
                    }
                }
            };

            try {
                const workerPromises = [];
                const activeWorkerCount = Math.min(workers.length, activeCells.length);
                for (let w = 0; w < activeWorkerCount; w++) {
                    workerPromises.push(runWorker(workers[w], bWorkers[w]));
                }
                await Promise.all(workerPromises);

                ScannerHUD.updateScrollStatus("done", this.sessionInventory.size);
                ScannerHUD.updateDetectedItems(this.sessionInventory);

                if (ScannerHUD.updateDebugSnapshot) {
                    ScannerHUD.updateDebugSnapshot(debugCanvas.toDataURL("image/jpeg", 0.7));
                    this.lastDebugUpdate = Date.now() + 5000;
                }
            } catch (e) {
                console.error("[INV] Grid processing failed:", e);
            } finally {
                this.detectionLocked = false;
            }

        } finally {
            this.detectionLocked = false;
        }
    },

};
function clearRewardDebugLogs() {
    const container = document.getElementById("rewards-raw-ocr-content");
    if (container) container.innerHTML = "";
}

function addRewardDebugLog(tag, msg, type = "info") {
    const container = document.getElementById("rewards-raw-ocr-content");
    if (!container) return;

    const entry = document.createElement("div");

    const colors = {
        info: "#ff9800",
        match: "#00ff78",
        warn: "#f1c40f"
    };

    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour12: false });

    entry.innerHTML = `
        <span style="color:#555;">[${timeStr}]</span>
        <span style="color:${colors[type]}; font-weight:bold;">${tag.toUpperCase()}</span>
        <span style="color:#eee;">${msg}</span>
    `;

    container.appendChild(entry);

    const parent = document.getElementById("rewards-dbg-text");
    if (parent) parent.scrollTop = parent.scrollHeight;
}