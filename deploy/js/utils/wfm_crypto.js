import { WORKER_URL } from "../config.js";

/**
 * Cifra las credenciales en el navegador antes de mandarlas al worker.
 *
 * Esquema: ECDH P-256 efímero + AES-GCM 256.
 *   1. Se pide la clave pública del worker.
 *   2. Se genera un par efímero (uno nuevo por login, nunca se reutiliza).
 *   3. Del ECDH sale la clave AES con la que se sella el JSON.
 *   4. Viaja { epk, iv, data }: sin la privada del worker no se abre.
 *
 * La privada vive en el Secrets Store de Cloudflare, que es write-only: no la puede
 * leer ni el dueño de la cuenta, solo el runtime al ejecutar.
 *
 * Alcance honesto: protege contra fugas accidentales (logs, volcados, proxies) y
 * contra quien intercepte la petición. NO protege contra un worker comprometido,
 * porque para poder hacer login hay que descifrar en algún momento.
 */

const ALG = { name: "ECDH", namedCurve: "P-256" };

let cachedKey = null;
let cachedAt = 0;
const KEY_TTL_MS = 60 * 60 * 1000;

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

/** Descarga (y cachea) la clave pública del worker. */
async function fetchPublicKey() {
    if (cachedKey && Date.now() - cachedAt < KEY_TTL_MS) return cachedKey;
    try {
        const res = await fetch(`${WORKER_URL}?type=wfm_pubkey`);
        if (!res.ok) return null;
        const { key } = await res.json();
        if (!key) return null;
        cachedKey = key;
        cachedAt = Date.now();
        return key;
    } catch {
        return null;
    }
}

/**
 * Sella un objeto para que solo el worker pueda leerlo.
 * @param {object} payload p. ej. { email, password }
 * @returns {Promise<{epk: string, iv: string, data: string}|null>} null si no hay clave
 */
export async function sealCredentials(payload) {
    const pub = await fetchPublicKey();
    if (!pub || !globalThis.crypto?.subtle) return null;

    try {
        const raw = Uint8Array.from(atob(pub), c => c.charCodeAt(0));
        const workerKey = await crypto.subtle.importKey("raw", raw, ALG, false, []);

        // Par efímero: uno por login. Sin reutilizar, cada sobre es independiente.
        const eph = await crypto.subtle.generateKey(ALG, false, ["deriveKey"]);
        const aes = await crypto.subtle.deriveKey(
            { name: "ECDH", public: workerKey },
            eph.privateKey,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt"]
        );

        const iv = crypto.getRandomValues(new Uint8Array(12));
        const data = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv },
            aes,
            new TextEncoder().encode(JSON.stringify(payload))
        );

        return {
            epk: b64(await crypto.subtle.exportKey("raw", eph.publicKey)),
            iv: b64(iv),
            data: b64(data)
        };
    } catch {
        return null;
    }
}
