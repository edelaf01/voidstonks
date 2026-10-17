import { wfmEnLanzador } from "../../repositories/launcher.repository.js";
import { pideWfm } from "./wfm_transporte.js";



const TOKEN_KEY = "wfm_jwt";
const NAME_KEY = "wfm_name";
const SLUG_KEY = "wfm_slug";
const SCOPE_KEY = "wfm_scope";
const STATUS_KEY = "wfm_status";
const EXPIRY_KEY = "wfm_exp";
const PLATFORM_KEY = "wfm_platform";

const SESSION_TTL_MS = 3 * 60 * 60 * 1000;

function normalizeToken(raw) {
    if (!raw) return "";
    return raw.trim().replace(/^JWT\s+/i, "").replace(/^["']|["']$/g, "").trim();
}

export function decodeToken(token) {
    const parts = normalizeToken(token).split(".");
    if (parts.length !== 3) return null;
    try {
        const payload = JSON.parse(
            atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))
        );
        return typeof payload === "object" && payload ? payload : null;
    } catch {
        return null;
    }
}

export function isTokenValid(token) {
    const payload = decodeToken(token);
    if (!payload?.exp) return false;
    return payload.exp * 1000 > Date.now();
}

export function getToken() {
    let stored = null;
    try {
        stored = sessionStorage.getItem(TOKEN_KEY);
    } catch {
        return null;
    }
    if (!stored) return null;
    const until = parseInt(sessionStorage.getItem(EXPIRY_KEY) || "0", 10);
    if (!until || Date.now() > until) {
        clearToken();
        return null;
    }
    if (!isTokenValid(stored)) {
        clearToken();
        return null;
    }
    return stored;
}

export async function login(email, password, platform = "pc") {
    if (!email || !password) return { ok: false, error: "missing_fields" };

     let payload = { email, password, platform };
    if (!wfmEnLanzador()) {
        try {
            const { sealCredentials } = await import("../../utils/wfm_crypto.js");
            const sealed = await sealCredentials({ email, password });
            if (sealed) payload = { sealed, platform };
        } catch {}
    }

    let res;
    try {
        res = await pideWfm("wfm_login", "", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
    } catch {
        return { ok: false, error: "network" };
    }

    let body;
    try {
        body = await res.json();
    } catch {
        return { ok: false, error: "server" };
    }

    if (!res.ok || !body?.token) {
        if (res.status === 429) return { ok: false, error: "rate_limited" };
        return { ok: false, error: body?.error || "invalid_credentials" };
    }

    const token = normalizeToken(body.token);
    if (!isTokenValid(token)) return { ok: false, error: "server" };

   const slug = (body.userSlug || body.ingameName || "").toLowerCase();
    if (!body.authorized && !slug) {
        pideWfm("wfm_logout", "", { method: "POST", headers: { "X-WFM-Token": token } }).catch(() => {});
        return { ok: false, error: "token_rejected", diag: body.diag };
    }

    try {
        sessionStorage.setItem(TOKEN_KEY, token);
        sessionStorage.setItem(EXPIRY_KEY, String(Date.now() + SESSION_TTL_MS));
        if (body.ingameName) sessionStorage.setItem(NAME_KEY, body.ingameName);
        if (slug) sessionStorage.setItem(SLUG_KEY, slug);
        sessionStorage.setItem(SCOPE_KEY, body.authorized ? "full" : "public");
       sessionStorage.setItem(PLATFORM_KEY, platform);
    } catch {
        return { ok: false, error: "storage" };
    }

    return {
        ok: true,
        ingameName: body.ingameName || null,
        authorized: !!body.authorized
    };
}

export function getIngameName() {
    try {
        return sessionStorage.getItem(NAME_KEY);
    } catch {
        return null;
    }
}

export function getUserSlug() {
    try {
        return sessionStorage.getItem(SLUG_KEY);
    } catch {
        return null;
    }
}

export function getScope() {
    try {
        return sessionStorage.getItem(SCOPE_KEY);
    } catch {
        return null;
    }
}

export function cacheScope(served) {
    if (served !== "full" && served !== "public") return;
    try {
        sessionStorage.setItem(SCOPE_KEY, served);
    } catch {}
}

export function getPlatform() {
    try {
        return sessionStorage.getItem(PLATFORM_KEY) || "pc";
    } catch {
        return "pc";
    }
}

export function clearToken() {
    try {
        for (const k of [TOKEN_KEY, NAME_KEY, SLUG_KEY, SCOPE_KEY, STATUS_KEY, EXPIRY_KEY,
            PLATFORM_KEY]) {
            sessionStorage.removeItem(k);
        }
    } catch {}
}

export async function logout() {
    const token = getToken();
    let revoked = false;

    if (token) {
        try {
            const res = await pideWfm("wfm_logout", "", {
                method: "POST",
                headers: { "X-WFM-Token": token }
            });
            if (res.ok) revoked = !!(await res.json())?.revoked;
        } catch {}
    }

    clearToken();
    return { ok: true, revoked };
}

export function wfmPrivado() {
    return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(globalThis.location?.hostname || "") || globalThis.voidstonksNativo?.desarrollo === true || wfmEnLanzador();
}

export function isLoggedIn() {
    return getToken() !== null || getUserSlug() !== null;
}
