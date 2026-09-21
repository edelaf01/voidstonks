// yields thread via macrotasks to let browser repaint without setTimeout clamping
export function creaCedeHilo({ scheduler, MessageChannel } = globalThis) {
    // wraps scheduler.yield because detached from its object it throws "Illegal invocation"
    if (typeof scheduler?.yield === "function") return () => scheduler.yield();
    if (typeof MessageChannel === "function") {
        return () => new Promise((resolve) => {
            const { port1, port2 } = new MessageChannel();
            port1.onmessage = () => { port1.close(); resolve(); };
            port2.postMessage(null);
        });
    }
    return () => new Promise((resolve) => setTimeout(resolve, 0));
}

export const cedeHilo = creaCedeHilo();
