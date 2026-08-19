import { sendSyncMessage, getSyncMessage } from "../repositories/api.repository.js";

export function isValidSyncCode(code) {
    return /^\d{4}$/.test(String(code ?? ""));
}

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
