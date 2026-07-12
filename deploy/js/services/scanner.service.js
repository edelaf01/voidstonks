import { VisionService, WF_THEMES } from "./vision.service.js";
import { OCRService } from "./ocr.service.js";
import { OCRRepository } from "../repositories/ocr.repository.js";
import { OpenCVRepository } from "../repositories/opencv.repository.js";
import { ScannerHUD } from "../ui.components/ui_scanner_hud.js";
import { ScannerModal } from "../ui.components/ui_scanner_modal.js";
import { initializeOCRDatabase } from "../repositories/api.repository.js";
import { escapeHTML } from "../ui.components/ui_components.js";

export const ScannerService = {
    isScanning: false,
    scanInterval: null,
    currentRate: 1200,
    RIVEN_RATE_ACTIVE: 400, // no result shown yet, or the hash changed
    RIVEN_RATE_IDLE: 1000, // result shown and the screen is still
    lastTrackedRelic: "",
    sessionInventory: new Map(),
    sessionRelics: new Map(), // relicName -> consensus qty (relic fallback on the inventory grid)
    detectionLocked: false,
    scanCounter: 0,
    inventoryHasScanned: false,
    qtyVotes: new Map(), // itemName -> Map<qty, count> (qty consensus across frames)
    relicQtyVotes: new Map(), // relicName -> Map<qty, count>
    lastStableHash: null,
    virtualCanvas: null,
    lastHashL: null,
    lastHashR: null,
    lastNoResultHash: null,
    lastNoResultTime: 0,
    lastHeaderHash: null,
    lastHeaderText: null,
    lastHeaderOcrTime: 0, // the skip expires after 2.5 s, bounding blindness from hash collisions
    lastRivenContextType: null, // "INVENTORY_MODS" | "ITEM_DETAILS" of the last riven hit: the grace period reroutes to the same one
    lastTwoCardHash: null, // card hash when 2 rivens were last confirmed (2->1 hysteresis)
    oneCardStreak: 0, // reads with fewer than 2 cards after a real hash change (2->1 hysteresis)
    newCardStreak: 0,
    weaponSwitchCandidate: null, // weapon set pending confirmation as a riven switch
    weaponSwitchStreak: 0, // reads with that same new set (matcher anti-flip)
    rivenConsensusBuffer: [],

    async start() {
        if (this.isScanning) return;
        this.isScanning = true;
        this.latchedContext = "UNKNOWN";
        this.unknownFrameCount = 0;
        this.detectionLocked = false;
        this.lastHashL = null;
        this.lastHashR = null;
        this.lastNoResultHash = null;
        this.lastNoResultTime = 0;
        this.lastHeaderHash = null;
        this.lastHeaderText = null;
        this.lastHeaderOcrTime = 0;
        this.lastRivenContextType = null;
        this.lastTwoCardHash = null;
        this.oneCardStreak = 0;
        this.newCardStreak = 0;
        this.weaponSwitchCandidate = null;
        this.weaponSwitchStreak = 0;
        this.rivenConsensusBuffer = [];
        this.qtyVotes = new Map();
        this.sessionRelics = new Map();
        this.relicQtyVotes = new Map();
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

        const headerHash = this._smallCanvasHash(virtualCanvas);
        const headerCacheFresh = this.lastHeaderOcrTime && (Date.now() - this.lastHeaderOcrTime < 2500);
        let headerText;
        if (this.lastHeaderText !== null && headerCacheFresh && this._compareHashes(headerHash, this.lastHeaderHash, 6)) {
            headerText = this.lastHeaderText;
        } else {
            const headerTheme = VisionService.finalizeVirtualCanvas(virtualCanvas);
            const { data: headerData } = await OCRRepository.recognize(worker1, virtualCanvas, {}, { text: true });
            headerText = headerData.text || "";

            if (headerTheme && VisionService.determineContext(headerText) === "UNKNOWN") {
                if (!this._altHeaderCvs) this._altHeaderCvs = document.createElement("canvas");
                VisionService.prepareVirtualCanvas(video, this._altHeaderCvs);
                const altCtx = this._altHeaderCvs.getContext("2d", { willReadFrequently: true });
                VisionService.applyThemeDistanceThreshold(altCtx, this._altHeaderCvs.width, this._altHeaderCvs.height, headerTheme);
                const { data: altData } = await OCRRepository.recognize(worker1, this._altHeaderCvs, {}, { text: true });
                const altText = altData.text || "";
                if (VisionService.determineContext(altText) !== "UNKNOWN") {
                    console.log(`[SCAN] Header rescatado por binarización de tema: "${altText.trim().slice(0, 60)}"`);
                    headerText = altText;
                }
            }
            this.lastHeaderText = headerText;
            this.lastHeaderHash = headerHash;
            this.lastHeaderOcrTime = Date.now();
        }

        const rawContext = VisionService.determineContext(headerText);
        const now = Date.now();

        const textUpper = headerText.toUpperCase();
        const containsAnchor = textUpper.includes("MODS") || textUpper.includes("MODIFICADORES") ||
                               textUpper.includes("CYCLE") || textUpper.includes("CICLO") || textUpper.includes("CICLAR") ||
                               textUpper.includes("KUVA") || textUpper.includes("KUYVA") ||
                               textUpper.includes("ATRIBUTOS") || textUpper.includes("ELEGIR") || textUpper.includes("CONFIRMAR") ||
                               textUpper.includes("AGRIETADO");
        
        if (rawContext === "INVENTORY_MODS" || rawContext === "ITEM_DETAILS" || containsAnchor) {
            this.lastRivenContextTime = now;
            this.lastRivenContextType = rawContext === "ITEM_DETAILS" ? "ITEM_DETAILS" : "INVENTORY_MODS";
        }

        let routedContext = rawContext;

        if (this.lastRivenContextTime && (now - this.lastRivenContextTime < 8000)) {
            if (rawContext === "UNKNOWN" || rawContext === "INVENTORY") {
                routedContext = this.lastRivenContextType || "INVENTORY_MODS";
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

        console.log(`[SCAN] Context Raw: ${rawContext} | Latched: ${this.latchedContext} | Header: "${headerText.trim().slice(0, 60)}"`);
        await this.routeFrameAction(this.latchedContext, video, dims);

        ScannerHUD.updateFrameCounter(this.scanCounter);
    },

    recordQtyVote(itemName, qtyResult, votesMap = this.qtyVotes, targetMap = this.sessionInventory) {
        let votes = votesMap.get(itemName);
        if (!votes) { votes = new Map(); votesMap.set(itemName, votes); }

        const readOk = /\d/.test(qtyResult.raw || "");
        if (readOk) {
            votes.set(qtyResult.qty, (votes.get(qtyResult.qty) || 0) + 1);
        }

        const consensus = this.modeQty(votes);
        targetMap.set(itemName, consensus !== null ? consensus : qtyResult.qty);
    },

    // Most voted qty (ties: the larger). null without votes.
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
    // movement seen since the last scan: forces a rescan once still, since the page hash collides
    // between similar pages
    sawScrollSinceScan: false,
    // debug panel history: [{ time, img, log, summary, warning }], newest first, cap 10
    debugHistory: [],

    async routeFrameAction(contextType, video, dims) {
        ScannerHUD.updateContext(contextType);

        if (contextType === "INVENTORY") {
            if (!globalThis.state.autoScanEnabled) {
                this.currentRate = 3000;
                this.autoScrollHash = null;
                this.lastFrameHash = null;
                this.sawScrollSinceScan = false;
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
            let minError = Infinity;
            if (this.lastRowLums) {
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
                this.sawScrollSinceScan = true;
                if (this.autoScrollStableTimer) {
                    clearTimeout(this.autoScrollStableTimer);
                    this.autoScrollStableTimer = null;
                }
                ScannerHUD.updateScrollStatus("detected");
                return;
            }

            // still: rescan after a scroll or a page hash change
            const hasPageChanged = !this.autoScrollHash || this.sawScrollSinceScan || Math.abs(currentHash - this.autoScrollHash) >= 120;
            const isFirstScan = !this.autoScrollHash;

            if (hasPageChanged && !this.autoScrollStableTimer && !this.detectionLocked) {
                if (!isFirstScan && this.scrollDirectionAccumulator <= -3) {
                    this.scrollDirectionAccumulator = 0;
                    this.sawScrollSinceScan = false;
                    this.autoScrollHash = currentHash;
                    ScannerHUD.updateScrollStatus("done", this.sessionInventory.size + this.sessionRelics.size);
                    return;
                }

                ScannerHUD.updateScrollStatus("detected");

                this.autoScrollStableTimer = setTimeout(async () => {
                    this.scrollDirectionAccumulator = 0;
                    // cleared here, not after the OCR: scrolling during the scan sets it again
                    this.sawScrollSinceScan = false;
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
                ScannerHUD.updateScrollStatus("done", this.sessionInventory.size + this.sessionRelics.size);
            }

        } else if (contextType === "INVENTORY_MODS" || contextType === "ITEM_DETAILS" || (globalThis.state.scannerModsMode && contextType === "INVENTORY")) {
            // fast poll by default; processRivenCard relaxes it (RIVEN_RATE_IDLE) on a still parsed screen
            this.currentRate = this.RIVEN_RATE_ACTIVE;
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
            if (contextType === "UNKNOWN" && VisionService.hasRivenTextHint(video)) {
                this.currentRate = this.RIVEN_RATE_ACTIVE;
                if (this.detectionLocked) return;
                await this.processRivenCard(video, dims, "ITEM_DETAILS");
                return;
            }
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
            // Ignore minor value differences to prevent HUD jitter
        }
        return true;
    },

    // loose riven identity: same weapon and rolls without the exact stat set, so a read that lost or
    // got back the faint curse merges into the shown card
    _isSameRivenIdentity(a, b) {
        if (!a && !b) return true;
        if (!a || !b) return false;
        if (a.weaponName !== b.weaponName) return false;
        // rolls only count when both reads have them: the MR line is often lost
        if (a.rolls !== null && b.rolls !== null && a.rolls !== b.rolls) return false;
        const namesA = new Set(a.stats.map(s => s.name));
        const namesB = new Set(b.stats.map(s => s.name));
        let overlap = 0;
        for (const n of namesA) if (namesB.has(n)) overlap++;
        const minLen = Math.min(namesA.size, namesB.size);
        return overlap >= Math.max(1, minLen - 1);
    },

    /**
     * Whether the new read is at least as good as the old one, so a worse frame does not replace it.
     */
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

    _tinyCvs: null,
    _tinyCtx() {
        if (!this._tinyCvs) {
            this._tinyCvs = document.createElement("canvas");
            this._tinyCvs.width = 16;
            this._tinyCvs.height = 9;
        }
        return this._tinyCvs.getContext("2d", { willReadFrequently: true });
    },

    _hashFromTiny(ctx) {
        const d = ctx.getImageData(0, 0, 16, 9).data;
        let hash = "";
        for (let i = 0; i < d.length; i += 4) {
            const avg = Math.floor((d[i] + d[i + 1] + d[i + 2]) / 3);
            hash += avg.toString(16).padStart(2, "0");
        }
        return hash;
    },

    _getVideoRegionHash(video, crop) {
        const ctx = this._tinyCtx();
        ctx.drawImage(video,
            Math.floor(video.videoWidth * crop.x), Math.floor(video.videoHeight * crop.y),
            Math.floor(video.videoWidth * crop.w), Math.floor(video.videoHeight * crop.h),
            0, 0, 16, 9);
        return this._hashFromTiny(ctx);
    },

    _smallCanvasHash(canvas) {
        const ctx = this._tinyCtx();
        ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, 16, 9);
        return this._hashFromTiny(ctx);
    },

    _compareHashes(hash1, hash2, tolerance = 18) {
        if (!hash1 || !hash2) return false;
        if (hash1.length !== hash2.length) return false;
        let diff = 0;
        for (let i = 0; i < hash1.length; i += 2) {
            const val1 = parseInt(hash1.substring(i, i + 2), 16);
            const val2 = parseInt(hash2.substring(i, i + 2), 16);
            diff += Math.abs(val1 - val2);
        }
        const avgDiff = diff / (hash1.length / 2);
        return avgDiff < tolerance;
    },

    _rivenFingerprint(parsed) {
        if (!parsed) return "null";
        const w = parsed.weaponName || "?";
        const s = parsed.stats.map(st => `${st.isPositive ? "+" : "-"}${st.name}`).sort().join(",");
        return `${w}|${s}`;
    },

    // splits the OCR words into cards by X (a big gap is a card boundary), drops low confidence background art
    // garbage and rebuilds each card's text by lines (Y) sorted by X. Returns null with a single card
    _wordsToCards(data, canvasWidth) {
        let words = [];
        const pushAll = (arr) => { if (Array.isArray(arr)) for (const w of arr) words.push(w); };
        if (Array.isArray(data?.words)) pushAll(data.words);
        if (!words.length && Array.isArray(data?.lines)) data.lines.forEach(l => pushAll(l.words));
        if (!words.length && Array.isArray(data?.paragraphs)) data.paragraphs.forEach(p => (p.lines || []).forEach(l => pushAll(l.words)));
        if (!words.length && Array.isArray(data?.blocks)) data.blocks.forEach(b => (b.paragraphs || []).forEach(p => (p.lines || []).forEach(l => pushAll(l.words))));

        // word dump to debug live inclusion/grouping: globalThis._rivenWordDump = true
        if (globalThis._rivenWordDump) {
            const dump = words.filter(w => w && w.text && w.bbox)
                .map(w => `${w.text.trim()}@${Math.round(w.confidence ?? 0)}(${Math.round((w.bbox.x0 + w.bbox.x1) / 2)},${Math.round((w.bbox.y0 + w.bbox.y1) / 2)})`)
                .join("  ");
            console.log(`[RIVEN WORDS] ${dump}`);
        }

        // "content" word (>=3 alphanumerics or a digit): drops loose art noise
        const isContent = (t) => (t || "").replace(/[^a-z0-9]/gi, "").length >= 3 || /\d/.test(t || "");

        // rebuilds a card's text: groups by line (Y center, tolerance = median height) so the value ("+92.4%") and
        // its name ("Status Chance") share a line, and sorts each line by X
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

        const gapThresh = Math.max(canvasWidth * 0.03, 40);
        const clusterByX = (ws) => {
            const items = ws.slice().sort((a, b) => a.bbox.x0 - b.bbox.x0);
            const groups = [[]];
            let maxX1 = null;
            for (const w of items) {
                if (maxX1 !== null && w.bbox.x0 - maxX1 > gapThresh) groups.push([]);
                groups[groups.length - 1].push(w);
                maxX1 = maxX1 === null ? w.bbox.x1 : Math.max(maxX1, w.bbox.x1);
            }
            return groups;
        };

        const ANCHOR_CONF = 70; // between garbage (≤~67) and real text (≳84)
        const INSIDE_CONF = 28; // faint but real tokens inside the box (e.g. the curse line)
        const anchors = words.filter(w => w && w.text && w.bbox && isContent(w.text) && (w.confidence ?? 0) >= ANCHOR_CONF);
        console.log(`[OCR DIAG] dataKeys=[${Object.keys(data || {}).join(",")}] rawWords=${words.length} anchors=${anchors.length}`, words[0]);
        if (anchors.length >= 3) {
            const anchorGroups = clusterByX(anchors).filter(g => g.length >= 3);
            if (anchorGroups.length >= 2) {
                const inside = words.filter(w => w && w.text && w.bbox && isContent(w.text) && (w.confidence ?? 0) >= INSIDE_CONF);
                const cards = anchorGroups.map(g => {
                    // cards are side by side, so tokens whose X CENTER falls in the card column get in with no Y filter, to
                    // catch the weapon name (top) and the curse line (bottom). The parser ignores non stat noise
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

        // fallback: flat confidence cut (>=50) + X gap
        const usable = words.filter(w => w && w.text && isContent(w.text) && (w.confidence ?? 0) >= 50 && w.bbox);
        console.log(`[OCR DIAG] usable=${usable.length} (fallback)`);
        if (usable.length < 3) return null;
        const realGroups = clusterByX(usable).filter(g => g.length >= 3);
        console.log(`[OCR DIAG] gapThresh=${Math.round(gapThresh)} realGroups=${realGroups.length}`);
        if (realGroups.length < 2) return null; // single card: back to the normal flow
        return realGroups.map(toText);
    },

    async processRivenCard(video, dims, contextType = null) {
        const { scale } = dims;

        // the "Item Details" popup has the card centered and higher, so it has its own crop
        const cardCrop = contextType === "ITEM_DETAILS" ? VisionService.RIVEN_ITEM_DETAILS_CROP : VisionService.RIVEN_CARD_CROP;

        // hash over the fixed video region, before preparing the canvases: tight crops jitter on a still
        // screen
        const hash = this._getVideoRegionHash(video, cardCrop);

        // already parsed and unchanged: skip OCR and relax the poll
        if ((this.lastParsedL || this.lastParsedR) && this._compareHashes(hash, this.lastHashL)) {
            this.lastRivenContextTime = Date.now();
            this.lastRivenContextType = contextType === "ITEM_DETAILS" ? "ITEM_DETAILS" : "INVENTORY_MODS";
            this.currentRate = this.RIVEN_RATE_IDLE;
            return;
        }

        if (this._compareHashes(hash, this.lastNoResultHash) && (Date.now() - this.lastNoResultTime < 3000)) {
            return;
        }

        // the reroll screen shows one centered card or two side by side; one canvas per card
        const canvases = VisionService.prepareRivenCardCanvases(video, scale, cardCrop);

        // debug: `globalThis.dumpRivenCrops = true` prints each binarized crop as a data URL
        if (globalThis.dumpRivenCrops) {
            canvases.forEach((c, i) => console.log(`[RIVEN CROP ${canvases.length > 1 ? `C${i + 1}` : "C"}] ${c.toDataURL("image/png")}`));
            globalThis.dumpRivenCrops = false;
        }

        const { RivenOCRService } = await import("./riven_ocr.service.js?v=3");

        // two cards: two workers in parallel. The 2nd is created lazily, so only the reroll pays its RAM.
        if (canvases.length > 1) await OCRRepository.ensureSecondWorker().catch(() => {});
        const pool = OCRRepository.workers.filter(Boolean);
        const reads = await Promise.all(canvases.map((c, i) =>
            OCRRepository.recognize(pool[i % pool.length] || pool[0], c, {}, { blocks: true })));
        // side by side, the OCR reads both cards in one pass: words are split by X, dropping art garbage
        // by confidence
        const entries = [];
        reads.forEach((res, ci) => {
            const cardTexts = this._wordsToCards(res.data, canvases[ci].width) || [res.data.text || ""];
            let cardEntries = cardTexts.map(text => ({
                res, text, parsed: RivenOCRService.parseRivenCard(text), canvas: canvases[ci],
            }));

            if (cardEntries.length >= 2) {
                const validCount = cardEntries.filter(e => e.parsed && e.parsed.weaponName).length;
                if (validCount < 2) {
                    const fullText = res.data.text || "";
                    const fullParsed = RivenOCRService.parseRivenCard(fullText);
                    const wName = cardEntries.find(e => e.parsed?.weaponName)?.parsed.weaponName || fullParsed?.weaponName || "";
                    const wKey = (wName.split(" ")[0] || "").toUpperCase();
                    const colsWithWeapon = wKey.length >= 4
                        ? cardEntries.filter(e => e.text.toUpperCase().includes(wKey)).length
                        : cardEntries.length; // without a reliable weapon, 2 cards cannot be dropped
                    if (fullParsed && fullParsed.weaponName && colsWithWeapon <= 1) {
                        console.log(`[OCR DIAG] split fantasma revertido: ${cardEntries.length} columnas -> 1 carta (texto completo)`);
                        cardEntries = [{ res, text: fullText, parsed: fullParsed, canvas: canvases[ci] }];
                    }
                }
            }

            cardEntries.forEach((e) => {
                this._logRivenRead(`C${entries.length + 1}`, e.text, e.parsed, e.canvas);
                entries.push(e);
            });
        });

        const anyText = entries.map(e => e.text.toUpperCase()).join(" ");
        const hasCardAnchor = /CYCLE|KUVA|KUYVA|CONFIRM|\bMR\s*\d/.test(anyText);

        const MIN_CONF = 0.5;
        const valids = entries.filter(e => e.parsed && (e.parsed.validation?.confidence ?? 0) >= MIN_CONF);

        if (valids.length || hasCardAnchor) {
            this.lastRivenContextTime = Date.now();
            // remembers which crop made the hit: the grace period reroutes to the same type
            this.lastRivenContextType = contextType === "ITEM_DETAILS" ? "ITEM_DETAILS" : "INVENTORY_MODS";
        }

        if (!valids.length) {
            console.log(`[RIVEN OCR] sin parse válido en este frame (${contextType || "reroll"}) — se cachea el hash y no se reintenta hasta que la pantalla cambie`);
        }
        this.lastNoResultHash = valids.length ? null : hash;
        if (!valids.length) this.lastNoResultTime = Date.now();

        const currentFP = valids.map(e => this._rivenFingerprint(e.parsed)).join("||") || "none";
        this.rivenConsensusBuffer.push(currentFP);
        if (this.rivenConsensusBuffer.length > 3) this.rivenConsensusBuffer.shift();
        const matchCount = this.rivenConsensusBuffer.filter(fp => fp === currentFP).length;
        const hasConsensus = matchCount >= 2;

        let rawL = valids[0]?.parsed || null;
        let rawR = valids[1]?.parsed || null;
        const shownCards = [this.lastParsedL, this.lastParsedR].filter(Boolean);
        const shownCount = shownCards.length;

        // a single read realigns with its shown slot: with 2 cards shown and only the right one parsed,
        // valids[0] would overwrite the left slot
        if (shownCount === 2 && rawL && !rawR) {
            const matchesL = this._isSameRivenIdentity(rawL, this.lastParsedL);
            const matchesR = this._isSameRivenIdentity(rawL, this.lastParsedR);
            if (matchesR && !matchesL) { rawR = rawL; rawL = null; }
        }

        let revealsMore = valids.length > shownCount;

        if (revealsMore && shownCount >= 1) {
            const otherShown = shownCards[0];
            const newCard = [rawL, rawR].find(p => p && !shownCards.some(s => this._isSameRivenIdentity(p, s)));
            const sameWeaponAsShown = !newCard || newCard.weaponName === otherShown.weaponName;
            if (!sameWeaponAsShown) {
                this.newCardStreak = (this.newCardStreak || 0) + 1;
                if (this.newCardStreak < 2) revealsMore = false;
            } else {
                this.newCardStreak = 0;
            }
        } else {
            this.newCardStreak = 0;
        }

        const newWeapons = [...new Set(valids.map(e => e.parsed.weaponName).filter(Boolean))].sort().join("|");
        const shownWeapons = [...new Set(shownCards.map(p => p.weaponName).filter(Boolean))].sort().join("|");
        let weaponChanged = newWeapons !== "" && newWeapons !== shownWeapons;

        let weaponSwitchPending = false;
        if (weaponChanged && shownCards.length) {
            if (this.weaponSwitchCandidate === newWeapons) {
                this.weaponSwitchStreak++;
            } else {
                this.weaponSwitchCandidate = newWeapons;
                this.weaponSwitchStreak = 1;
            }
            if (this.weaponSwitchStreak < 2) {
                weaponChanged = false;
                weaponSwitchPending = true;
            }
        } else {
            this.weaponSwitchCandidate = null;
            this.weaponSwitchStreak = 0;
        }

        // 2->1 hysteresis: with 2 cards shown, fewer in one frame may be a partial read. Several reads in
        // a row (or a weapon change) before dropping the card that no longer arrives.
        let dropExtra = false;
        if (valids.length < shownCount) {
            this.oneCardStreak++;
            const DOWNGRADE_STREAK = 4;
            if (this.oneCardStreak >= DOWNGRADE_STREAK || weaponChanged) {
                dropExtra = true;
                this.oneCardStreak = 0;
            }
        } else {
            this.oneCardStreak = 0;
        }

        const mergeSlot = (raw, shown) => {
            if (!raw) return shown;
            if (shown && this._isSameRivenIdentity(raw, shown)) {
                return this._isBetterOrEqualRead(raw, shown) ? raw : shown;
            }
            // weapon change not confirmed yet: keep what is shown, or an A, B, A, B matcher forms a 2 of 3
            // consensus for both weapons
            if (shown && weaponSwitchPending && raw.weaponName !== shown.weaponName) return shown;
            return raw; // another riven, or nothing shown here yet
        };

        let finalL = mergeSlot(rawL, this.lastParsedL);
        let finalR = mergeSlot(rawR, this.lastParsedR);
        if (dropExtra) {
            // confirmed: the card whose slot got no new read is dropped
            if (!rawL) finalL = null;
            if (!rawR) finalR = null;
        }

        const anyUpgrade = (finalL && finalL !== this.lastParsedL && this._isSameRivenIdentity(finalL, this.lastParsedL)) ||
                            (finalR && finalR !== this.lastParsedR && this._isSameRivenIdentity(finalR, this.lastParsedR));

        if ((this.lastParsedL || this.lastParsedR) && !hasConsensus && !revealsMore && !weaponChanged && !anyUpgrade) {
            console.log(`[RIVEN OCR] Consensus: ${matchCount}/3 — waiting for confirmation`);
            if (globalThis._scannerDebug) this._renderRivenDebug(entries, false);
            return;
        }

        // no re-render when the result is the same as what is shown
        const changed = !this._isSameRiven(finalL, this.lastParsedL) || !this._isSameRiven(finalR, this.lastParsedR);

        if (globalThis._scannerDebug) this._renderRivenDebug(entries, changed);

        if (!weaponSwitchPending) {
            this.lastHashL = hash;
            this.lastHashR = null;
        }

        if (!changed) return;

        this.lastParsedL = finalL;
        this.lastParsedR = finalR;

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
            globalThis.showRivenAppraisal(this.lastParsedL, this.lastParsedR, screenshotDataURL);
        }
    },

    _sameCombinedHash(a, b) {
        if (!a || !b) return false;
        const pa = a.split("|"), pb = b.split("|");
        if (pa.length !== pb.length) return false;
        return pa.every((h, i) => this._compareHashes(h, pb[i]));
    },

    /**
     * Per-card log: raw OCR, crop size, parsed result and validation, in a collapsed group.
     */
    _logRivenRead(side, rawText, parsed, canvas) {
        const raw = (rawText || "").trim().replace(/\n/g, " | ");
        const v = parsed?.validation;
        const tag = parsed
            ? `${parsed.weaponName || "?"} | ${parsed.stats.length} stats | conf ${v ? v.confidence : "?"}${v && !v.valid ? " ⚠" : " ✓"}`
            : "no parse";
        // raw OCR on the top-level line, visible without expanding the group
        console.log(`[RIVEN OCR ${side}] ${tag} | crop ${canvas?.width}x${canvas?.height} | raw: "${raw}"`);
        if (parsed) {
            const stats = parsed.stats.map(s => `${s.isPositive ? "+" : "-"}${s.value}% ${s.name}${s.suspicious ? "⚠" : ""}`).join("  ");
            console.log(`  → riven: ${parsed.rivenName || "—"} | rolls ${parsed.rolls ?? "—"} | mr ${parsed.mr ?? "—"} | ${stats}`);
            if (v?.issues?.length) console.log(`  → issues: ${v.issues.join("; ")}`);
        }
    },

    /**
     * Riven debug panel: each card's binarized OCR input with its line boxes and parsed weapon.
     * `entries` comes from processRivenCard ({ res, parsed, canvas } per card).
     */
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

            // line boxes in this card's canvas space
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
        await OCRRepository.ensureSecondWorker();
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
            let calibData = VisionService.detectGridAutoCalib(snapshot, width, height);

            if (!calibData) {
                calibData = globalThis.LiveCalibration?.getGrid() || null;
                if (calibData) {
                    console.log("[INV] Auto-grid sin señal este frame — usando calibración manual guardada.");
                }
            }

            if (!calibData?.gridZone) {
                if (globalThis.LiveCalibration && !globalThis.LiveCalibration.hasCalibration()) {
                    console.log("[INV] Sin auto-grid ni calibración. Abriendo calibración manual...");
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

            this.lastRawOcrLog = [];
            const scanStats = { cells: cellRects.length, matched: 0, relics: 0, empty: 0, unmatched: 0, none: 0 };
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
                    scanStats.empty++;
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

            await Promise.all([OCRRepository.ensureSecondWorker(), OCRRepository.ensureBadgeWorkers()]);
            const workers = OCRRepository.workers;
            const bWorkers = OCRRepository.badgeWorkers;

            let cellIndex = 0;
            const runWorker = async (worker, bWorker) => {
                while (cellIndex < activeCells.length) {
                    const task = activeCells[cellIndex++];
                    if (!task) break;

                    const { cell, textCvs } = task;
                    const combinedText = await OCRService.extractCellText(worker, textCvs);

                    if (!combinedText) {
                        scanStats.none++;
                        this.lastRawOcrLog.push(`[r${cell.r}c${cell.c}] NONE`);
                        continue;
                    }

                    let logStr = `[r${cell.r}c${cell.c}] OCR: ${combinedText.join(" ")}`;
                    let bestItem = OCRService.getValidItemMatch(combinedText);
                    let fallbackText = null;

                    if (!bestItem) {
                        const fullCellCvs = VisionService.cropThemeBinarized(snapshot, cell.sx, Math.max(0, cell.sy - 16), cellW, cellH + 16, theme);
                        fallbackText = await OCRService.extractCellText(worker, fullCellCvs);
                        if (fallbackText && fallbackText.length) {
                            logStr = `[r${cell.r}c${cell.c}] OCR (fallback): ${fallbackText.join(" ")}`;
                            bestItem = OCRService.getValidItemMatch(fallbackText);
                        }
                    }

                    let relicMatch = null;
                    let relicText = combinedText;
                    if (!bestItem) {
                        relicMatch = OCRService.getRelicMatch(combinedText);
                        if (!relicMatch && fallbackText && fallbackText.length) {
                            relicMatch = OCRService.getRelicMatch(fallbackText);
                            if (relicMatch) relicText = fallbackText;
                        }
                    }

                    if (bestItem) {
                        scanStats.matched++;
                        const badgeCanvas = VisionService.extractBadgeByColor(snapshot, cell, cellW, cellH, theme);
                        const qtyResult = await OCRService.extractCellQuantity(bWorker, badgeCanvas);

                        logStr += ` || BDG: ${qtyResult.raw}`;
                        this.lastRawOcrLog.push(logStr);

                        // time consensus: one frame's digit is fragile, the item name is not. The mode of the votes wins.
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
                    } else if (relicMatch) {
                        scanStats.relics++;
                        const badgeCanvas = VisionService.extractBadgeByColor(snapshot, cell, cellW, cellH, theme);
                        const qtyResult = await OCRService.extractCellQuantity(bWorker, badgeCanvas);

                        const relicSrc = relicText === combinedText ? "1st-pass" : "fallback";
                        logStr += ` || RELIC (${relicSrc}): ${relicMatch} || BDG: ${qtyResult.raw}`;
                        this.lastRawOcrLog.push(logStr);

                        this.recordQtyVote(relicMatch, qtyResult, this.relicQtyVotes, this.sessionRelics);

                        const relX = cell.sx - gridZone.x;
                        const relY = cell.sy - gridZone.y;

                        dCtx.fillStyle = "rgba(10, 15, 28, 0.98)";
                        dCtx.fillRect(relX, relY + cellH - 50, cellW, 50);

                        dCtx.fillStyle = "rgba(0, 229, 255, 0.9)";
                        dCtx.fillRect(relX, relY + cellH - 50, cellW, 1.5);

                        dCtx.fillStyle = "#ffb300";
                        dCtx.font = "italic 9px system-ui, -apple-system, sans-serif";
                        const rawText = relicText.join(" ");
                        const badgeRawText = qtyResult.raw ? qtyResult.raw.trim().replaceAll(/\s+/g, " ") : "Ø";
                        const maxCharsItem = Math.floor(cellW / 5.5);
                        const truncatedItem = rawText.length > maxCharsItem ? rawText.slice(0, maxCharsItem - 3) + "..." : rawText;
                        dCtx.fillText(truncatedItem, relX + 6, relY + cellH - 37);
                        dCtx.fillText(`BDG: "${badgeRawText}"`, relX + 6, relY + cellH - 25);

                        dCtx.fillStyle = "#00e5ff";
                        dCtx.font = "bold 12px system-ui, -apple-system, sans-serif";
                        dCtx.fillText(relicMatch, relX + 6, relY + cellH - 8);

                        const shiftLeft = (cell.c === 0) ? 14 : 2;
                        dCtx.fillStyle = "rgba(0, 0, 0, 0.85)";
                        dCtx.fillRect(relX - shiftLeft, relY + 4, 44 + (shiftLeft - 2), 18);
                        dCtx.fillStyle = "#00e5ff";
                        dCtx.font = "bold 11px monospace";
                        const consensusQty = this.sessionRelics.get(relicMatch) ?? qtyResult.qty;
                        dCtx.fillText(`x${consensusQty}`, relX - shiftLeft + 8, relY + 17);

                        if (badgeCanvas) {
                            const bX = (badgeCanvas.cropX !== undefined ? badgeCanvas.cropX : cell.sx) - gridZone.x;
                            const bY = badgeCanvas.bestY - gridZone.y;
                            const bW = badgeCanvas.cropW !== undefined ? badgeCanvas.cropW : Math.round(cellW * 0.28);
                            const bH = badgeCanvas.cropH !== undefined ? badgeCanvas.cropH : Math.round(cellH * 0.12);
                            dCtx.strokeStyle = "rgba(0, 229, 255, 0.85)";
                            dCtx.lineWidth = 1.5;
                            dCtx.strokeRect(bX, bY, bW, bH);
                        }
                    } else {
                        scanStats.unmatched++;
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

                ScannerHUD.updateScrollStatus("done", this.sessionInventory.size + this.sessionRelics.size);
                ScannerHUD.updateDetectedItems(this.sessionInventory, this.sessionRelics);

                // a full page gives rows x cols cells; missing cells mark the entry as WARNING
                const expected = autoGrid.rows * autoGrid.cols;
                const fails = scanStats.unmatched + scanStats.none;
                const hasWarning = fails > 0 || scanStats.cells < expected;
                const summary = `cells ${scanStats.cells}/${expected} · match ${scanStats.matched}`
                    + ` · relic ${scanStats.relics} · empty ${scanStats.empty} · fail ${fails}`
                    + (autoGrid.phaseShift ? ` · dy ${autoGrid.phaseShift > 0 ? "+" : ""}${autoGrid.phaseShift}px` : "");
                this.lastRawOcrLog.push(`[SUMMARY] ${summary}`);

                this.debugHistory.unshift({
                    time: new Date().toLocaleTimeString([], { hour12: false }),
                    img: debugCanvas.toDataURL("image/jpeg", 0.6),
                    log: [...this.lastRawOcrLog],
                    summary,
                    warning: hasWarning
                });
                if (this.debugHistory.length > 10) this.debugHistory.length = 10;
                if (ScannerHUD.updateDebugHistory) {
                    ScannerHUD.updateDebugHistory(this.debugHistory);
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
        <span style="color:${colors[type]}; font-weight:bold;">${escapeHTML(tag).toUpperCase()}</span>
        <span style="color:#eee;">${escapeHTML(msg)}</span>
    `;

    container.appendChild(entry);

    const parent = document.getElementById("rewards-dbg-text");
    if (parent) parent.scrollTop = parent.scrollHeight;
}