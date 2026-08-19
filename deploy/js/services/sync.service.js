import { sendSyncMessage, getSyncMessage } from "../repositories/api.repository.js";

/**
 * Short-lived mailbox to pass a message between two devices with a 4-digit code.
 * Maps HTTP results to named outcomes for ui_sync.js.
 */

export function isValidSyncCode(code) {
    return /^\d{4}$/.test(String(code ?? ""));
}

/** @returns {Promise<{ok: true} | {ok: false, reason: "invalid-code"|"rate-limit"|"server"}>} */
export async function sendSync(code, message) {
    if (!isValidSyncCode(code)) return { ok: false, reason: "invalid-code" };
    try {
        const res = await sendSyncMessage(code, message);
        if (res.status === 429) return { ok: false, reason: "rate-limit" };
        if (!res.ok) return { ok: false, reason: "server" };
        return { ok: true };
    } catch {
        return { ok: false, reason: "server" };
    }
}

/**
 * Checks the mailbox once. Called in a loop, so "waiting" is a normal result.
 * @returns {Promise<{status: "received", value: string} | {status: "waiting"|"rate-limit"|"server"}>}
 */
export async function pollSync(code) {
    if (!isValidSyncCode(code)) return { status: "server" };
    try {
        const res = await getSyncMessage(code);
        if (res.status === 429) return { status: "rate-limit" };
        if (!res.ok) return { status: "server" };
        const data = await res.json();
        return data?.val ? { status: "received", value: data.val } : { status: "waiting" };
    } catch {
        return { status: "waiting" };
    }
}
