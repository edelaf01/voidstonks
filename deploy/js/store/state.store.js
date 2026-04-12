
const listeners = new Map();
export const rawState = {};

/**
 * Gets a value from the state.
 */
export function get(key) {
    return rawState[key];
}

/**
 * Sets a value in the state and notifies subscribers.
 */
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
 * Subscribes to changes on a specific key.
 * @param {string} key - The state key to watch.
 * @param {Function} fn - The callback. Receives (newValue)
 * @returns {Function} An unsubscribe function
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
