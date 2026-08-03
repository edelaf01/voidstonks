import { WORKER_URL } from "../config.js";

const ALG = { name: "ECDH", namedCurve: "P-256" };

let cachedKey = null;
let cachedAt = 0;
const KEY_TTL_MS = 60 * 60 * 1000;

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));

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

export async function sealCredentials(payload) {
    const pub = await fetchPublicKey();
    if (!pub || !globalThis.crypto?.subtle) return null;

    try {
        const raw = Uint8Array.from(atob(pub), c => c.charCodeAt(0));
        const workerKey = await crypto.subtle.importKey("raw", raw, ALG, false, []);

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
