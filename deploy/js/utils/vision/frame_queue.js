// bounded queue of video crops with a canvas pool to decouple capture from processing
export function createFrameQueue({ max = 3, process }) {
    const pool = [];
    const queue = [];
    let busy = false;

    const acquire = (w, h) => {
        const cvs = pool.pop() || document.createElement("canvas");
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
                // one tick before reading so the browser paints between shot and read
                await new Promise((r) => setTimeout(r, 0));
                try {
                    await process(job);
                } catch (e) {
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

        enqueue(source, sx, sy, sw, sh, meta = null) {
            if (queue.length >= max) return false;
            const cvs = acquire(sw, sh);
            cvs.getContext("2d", { willReadFrequently: true })
                .drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
            queue.push({ cvs, meta });
            drain();
            return true;
        },

        clear() {
            while (queue.length) {
                const job = queue.pop();
                if (pool.length < max) pool.push(job.cvs);
            }
        },

        release() {
            if (busy || queue.length) { pendingRelease = true; return; }
            freePool();
        },
    };
}
