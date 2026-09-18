/**
 * Bounded queue of video crops with a canvas POOL, to split TAKING the shot from PROCESSING it: capturing is
 * cheap and processing an inventory page slow, so chaining them makes the user wait between pages. Queued,
 * the user keeps scrolling and the consumer drains behind.
 *
 * - **Pool instead of a new canvas per shot.** A 1440p frame is ~15 MB and canvases piling up faster than
 *   the GC freed them crashed the tab once. Reusing at most `max` buffers bounds the memory.
 * - **Full = reject, not drop.** Returning false lets the caller NOT mark the page as seen, so it is retried
 *   as soon as there is room. Dropping the oldest shot would lose items that will not be looked at again.
 *
 * The consumer can go out of order or repeat pages: scanner results are a Map by canonical name and
 * quantities vote by mode.
 */
export function createFrameQueue({ max = 3, process }) {
    const pool = [];
    const queue = [];
    let busy = false;

    const acquire = (w, h) => {
        const cvs = pool.pop() || document.createElement("canvas");
        // setting width/height clears the canvas even with the same value: only touched when the size really
        // changed, to reuse the buffer as is
        if (cvs.width !== w) cvs.width = w;
        if (cvs.height !== h) cvs.height = h;
        return cvs;
    };

    let pendingRelease = false;
    const freePool = () => {
        for (const cvs of pool) { cvs.width = 0; cvs.height = 0; }
        pool.length = 0;
        pendingRelease = false;
    };

    const drain = async () => {
        if (busy) return;
        busy = true;
        try {
            while (queue.length) {
                const job = queue.shift();
                // one tick before reading: `process` starts in the SAME task as the capture, and grid detection plus page
                // color blocked in a row. With the tick the browser paints between shot and read
                await new Promise((r) => setTimeout(r, 0));
                try {
                    await process(job);
                } catch (e) {
                    // a frame that blows up cannot stop the queue: that one is lost and it goes on
                    console.error("[FrameQueue] fallo procesando un frame:", e);
                } finally {
                    if (pool.length < max) pool.push(job.cvs);
                }
            }
        } finally {
            busy = false;
            if (pendingRelease) freePool();
        }
    };

    return {
        get size() { return queue.length; },
        get isFull() { return queue.length >= max; },
        get isBusy() { return busy; },

        /**
         * Copies the given region of `source` into a pool canvas and queues it. Returns false when the queue is full
         * (the caller should retry later).
         */
        enqueue(source, sx, sy, sw, sh, meta = null) {
            if (queue.length >= max) return false;
            const cvs = acquire(sw, sh);
            cvs.getContext("2d", { willReadFrequently: true })
                .drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
            queue.push({ cvs, meta });
            drain();
            return true;
        },

        /** Empties what is pending, returning the canvases to the pool (screen change, stop…). */
        clear() {
            while (queue.length) {
                const job = queue.pop();
                if (pool.length < max) pool.push(job.cvs);
            }
        },

        /**
         * Frees the pool memory (canvases to 0×0) without dropping what is pending: a queued shot is a valid page
         * even if the player already left the inventory, so it is read and freed afterwards. Out of the inventory or
         * with the scanner stopped there is no reason to hold them.
         */
        release() {
            if (busy || queue.length) { pendingRelease = true; return; }
            freePool();
        },
    };
}
