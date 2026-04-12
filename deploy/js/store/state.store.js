
const listeners = new Map();
export const rawState = {};

export function get(key) {
    return rawState[key];
}

export function set(key, value) {
    rawState[key] = value;

    const callbacks = listeners.get(key);
    if (callbacks) {
        callbacks.forEach(fn => {
            try {
                fn(value);
            } catch (e) {
                console.error(`Error in state subscription for key ${key}:`, e);
            }
        });
    }
}

/**
 * @param {string} key
 * @param {Function} fn
 * @returns {Function}
 */
export function subscribe(key, fn) {
    if (!listeners.has(key)) {
        listeners.set(key, new Set());
    }
    listeners.get(key).add(fn);

    return () => {
        const callbacks = listeners.get(key);
        if (callbacks) {
            callbacks.delete(fn);
        }
    };
}
