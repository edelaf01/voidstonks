/**
 * Yields the thread between two synchronous blocks so the browser paints and handles input. An await on a
 * resolved promise is a microtask and does not repaint; a MACROTASK is needed. Not setTimeout(0): the scanner
 * loop reschedules itself with setTimeout, so past the 5th nesting level the browser clamps it to 4 ms.
 * scheduler.yield() resumes as soon as it painted; without it, a MessageChannel: a macrotask with no clamp.
 * setTimeout is the last resort.
 */
export function creaCedeHilo({ scheduler, MessageChannel } = globalThis) {
    // `() => scheduler.yield()` and not the bare method: detached from its object it throws "Illegal invocation"
    if (typeof scheduler?.yield === "function") return () => scheduler.yield();
    if (typeof MessageChannel === "function") {
        // one channel per call, closed on arrival: a shared one with onmessage keeps the Node process alive (tests do
        // not finish) and with unref() it loses the message
        return () => new Promise((resolve) => {
            const { port1, port2 } = new MessageChannel();
            port1.onmessage = () => { port1.close(); resolve(); };
            port2.postMessage(null);
        });
    }
    return () => new Promise((resolve) => setTimeout(resolve, 0));
}

export const cedeHilo = creaCedeHilo();
