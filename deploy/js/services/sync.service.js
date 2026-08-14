import { sendSyncMessage, getSyncMessage } from "../repositories/api.repository.js";

/**
 * Buzón efímero para pasar un mensaje entre dos dispositivos con un código de 4 dígitos.
 *
 * Existe para que `ui_sync.js` no hable con el repositorio: el componente decidía qué pintar
 * mirando `res.status === 429` y `res.ok`, o sea que la UI tenía que saber de códigos HTTP y
 * repetía ese mapeo en el emisor y en el receptor con textos distintos. Aquí se traduce una
 * vez a un resultado con nombre y el componente solo elige el mensaje.
 */

/** Código válido: exactamente 4 dígitos. Lo comprueban el emisor y el receptor. */
export function isValidSyncCode(code) {
    return /^\d{4}$/.test(String(code ?? ""));
}

/**
 * Deja un mensaje en el buzón.
 * @returns {Promise<{ok: true} | {ok: false, reason: "invalid-code"|"rate-limit"|"server"}>}
 */
export async function sendSync(code, message) {
    if (!isValidSyncCode(code)) return { ok: false, reason: "invalid-code" };
    try {
        const res = await sendSyncMessage(code, message);
        // 429 se distingue del resto porque tiene arreglo (esperar) y el aviso lo dice.
        if (res.status === 429) return { ok: false, reason: "rate-limit" };
        if (!res.ok) return { ok: false, reason: "server" };
        return { ok: true };
    } catch {
        return { ok: false, reason: "server" };
    }
}

/**
 * Mira el buzón una vez. Se llama en bucle mientras se espera al otro dispositivo, así que
 * "todavía nada" es un resultado normal y no un error.
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
        // Un fallo de red suelto no debe cortar el bucle: el siguiente tick lo reintenta.
        return { status: "waiting" };
    }
}
