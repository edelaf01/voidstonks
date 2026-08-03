import { WORKER_URL } from "../config.js";

/**
 * Encrypts the credentials in the browser before sending them to the worker.
 *
 * Scheme: ephemeral ECDH P-256 + AES-GCM 256.
 *   1. Fetch the worker public key.
 *   2. Generate an ephemeral pair (a new one per login, never reused).
 *   3. ECDH yields the AES key that seals the JSON.
 *   4. { epk, iv, data } travels: it cannot be opened without the worker private key.
 *
 * The private key lives in the Cloudflare Secrets Store, which is write-only: not even the account owner can
 * read it, only the runtime.
 *
 * Scope: protects against accidental leaks (logs, dumps, proxies) and anyone intercepting the request. It does
 * NOT protect against a compromised worker, since logging in means decrypting at some point.
 */

const ALG = { name: "ECDH", namedCurve: "P-256" };

let cachedKey = null;
let cachedAt = 0;
const KEY_TTL_MS = 60 * 60 * 1000;

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

/** Downloads (and caches) the worker public key. */
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
 * Seals an object so only the worker can read it.
 * @param {object} payload e.g. { email, password }
 * @returns {Promise<{epk: string, iv: string, data: string}|null>} null when there is no key
 */
export async function sealCredentials(payload) {
    const pub = await fetchPublicKey();
    if (!pub || !globalThis.crypto?.subtle) return null;

    try {
        const raw = Uint8Array.from(atob(pub), c => c.charCodeAt(0));
        const workerKey = await crypto.subtle.importKey("raw", raw, ALG, false, []);

        // ephemeral pair, one per login: each envelope is independent
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
