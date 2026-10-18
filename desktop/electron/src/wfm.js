import { readFile, writeFile } from "node:fs/promises";

const V1 = "https://api.warframe.market/v1";
const V2 = "https://api.warframe.market/v2";
const AGENTE = "VoidStonks/2.6 (+https://voidstonks.com)";
const PLATAFORMAS = new Set(["pc", "ps4", "xbox", "switch", "mobile"]);
const HUECO_MS = 500;
const CATALOGO_TTL_MS = 24 * 60 * 60 * 1000;
const CATALOGO_FALLO_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 20000;
const CATALOGO_TIMEOUT_MS = 60000;
const FRENO_DESAFIO_MS = 30 * 60 * 1000;
const FRENO_CAIDA_MS = 30000;
const HEX24 = /^[a-f0-9]{24}$/i;
const esSlug = (s) => typeof s === "string" && /^[a-z0-9_-]+$/i.test(s);

const respuesta = (status, datos) => ({ status, cuerpo: JSON.stringify(datos) });
const fallo = (status, mensaje) => respuesta(status, { error: mensaje });
const estado = (s) => (s === 204 || s === 205 || s === 304 ? 200 : s >= 200 && s <= 599 ? s : 502);
const plataformaDe = (p) => (PLATAFORMAS.has(p) ? p : "pc");
const lista = (q, max) => [...new Set(String(q).split(",").map((s) => s.trim()).filter(Boolean))].slice(0, max);
const frenada = () => new Response(JSON.stringify({ error: "wfm_frenado" }), { status: 429, headers: { "Content-Type": "application/json" } });
const frenoDe = (res) => {
  if (res.status === 429) {
    const reintento = Number(res.headers.get("Retry-After"));
    return Math.min(120000, Math.max(5000, reintento > 0 ? reintento * 1000 : 30000));
  }
  if (res.status === 403 && res.headers.get("cf-mitigated")) return FRENO_DESAFIO_MS;
  return res.status >= 500 ? FRENO_CAIDA_MS : 0;
};

const resumeMercado = (stats, top, rank = null) => {
  if (!stats && !top) return null;

  let days = stats?.payload?.statistics_closed?.["90days"] || [];
  if (rank !== null) {
    const sameRank = days.filter((d) => (d.mod_rank ?? 0) === rank);
    if (sameRank.length) days = sameRank;
  }
  const last = days.length ? days[days.length - 1] : null;

  const pick = (list, n) => {
    let rows = (list || []).filter((o) => o.user?.status !== "offline");
    if (rank !== null) {
      const sameRank = rows.filter((o) => (o.rank ?? 0) === rank);
      if (sameRank.length) rows = sameRank;
    }
    return rows.slice(0, n).map((o) => ({
      platinum: o.platinum,
      quantity: o.quantity,
      user: o.user?.ingameName || "?",
      status: o.user?.status || "offline"
    }));
  };

  const horas = (stats?.payload?.statistics_closed?.["48hours"] || []).filter((h) => h.volume > 0);
  const reciente = {};
  for (const clave of new Set(horas.map((h) => h.mod_rank ?? ""))) {
    const hs = horas.filter((h) => (h.mod_rank ?? "") === clave).sort((a, b) => a.datetime.localeCompare(b.datetime));
    const total = hs.reduce((s, h) => s + h.volume, 0);
    const porPrecio = [...hs].sort((a, b) => a.median - b.median);
    let acumulado = 0, mediana = porPrecio[porPrecio.length - 1].median;
    for (const h of porPrecio) {
      acumulado += h.volume;
      if (acumulado * 2 >= total) {
        mediana = h.median;
        break;
      }
    }
    const ultima = hs[hs.length - 1];
    reciente[clave] = { ultima: ultima.closed_price, hora: ultima.datetime, mediana, volumen: total };
  }

  return {
    median: last?.median ?? null,
    avg: last?.avg_price ?? null,
    volume: last?.volume ?? null,
    min: last?.min_price ?? null,
    max: last?.max_price ?? null,
    day: last?.datetime ?? null,
    rank: rank,
    reciente,
    sell: pick(top?.data?.sell, 5),
    buy: pick(top?.data?.buy, 5)
  };
};

export function creaWfm({
  fetch,
  ahora = Date.now,
  espera = (ms) => new Promise((r) => setTimeout(r, ms)),
  rutaCatalogo,
  leeFichero = (ruta) => readFile(ruta, "utf8"),
  escribeFichero = (ruta, texto) => writeFile(ruta, texto, "utf8"),
  credenciales = null
}) {
  const vigente = (desde, ms) => {
    const d = ahora() - desde;
    return d >= 0 && d < ms;
  };

  let frenoHasta = 0;
  let cola = Promise.resolve();
  const turno = () => {
    const mio = cola;
    cola = cola.then(() => espera(HUECO_MS));
    return mio;
  };

  const pide = async (url, { metodo = "GET", plataforma = "pc", token = null, cuerpo, cabeceras = {}, limite = TIMEOUT_MS } = {}) => {
    if (ahora() < frenoHasta) return frenada();
    await turno();
    if (ahora() < frenoHasta) return frenada();
    const headers = {
      "User-Agent": AGENTE,
      Accept: "application/json",
      platform: plataformaDe(plataforma),
      language: "en",
      ...cabeceras
    };
    if (token) {
      headers.Cookie = `JWT=${token}`;
      headers.Authorization = `Bearer ${token}`;
    }
    if (cuerpo !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(url, { method: metodo, headers, body: cuerpo, signal: AbortSignal.timeout(limite) });
    const freno = frenoDe(res);
    if (freno) frenoHasta = Math.max(frenoHasta, ahora() + freno);
    if (res.status === 403 && res.headers.get("cf-mitigated")) {
      await res.body?.cancel().catch(() => {});
      return frenada();
    }
    return res;
  };

  const jsonDe = async (url) => {
    try {
      const res = await pide(url);
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  };

  const mercado = async (slug, rank = null, soloStats = false) => {
    const [stats, top] = await Promise.all([
      jsonDe(`${V1}/items/${encodeURIComponent(slug)}/statistics`),
      soloStats ? null : jsonDe(`${V2}/orders/item/${encodeURIComponent(slug)}/top`)
    ]);
    return resumeMercado(stats, top, rank);
  };

  let catalogo = null;
  let enVuelo = null;
  let catalogoFallidoEn = -Infinity;
  const cargaCatalogo = async () => {
    if (!catalogo) {
      try {
        const c = JSON.parse(await leeFichero(rutaCatalogo));
        if (Array.isArray(c?.items) && Number.isFinite(c?.t)) catalogo = c;
      } catch { }
    }
    if (catalogo && vigente(catalogo.t, CATALOGO_TTL_MS)) return catalogo.items;
    if (vigente(catalogoFallidoEn, CATALOGO_FALLO_MS)) return catalogo?.items || null;
    try {
      const res = await pide(`${V2}/items`, { limite: CATALOGO_TIMEOUT_MS });
      const datos = res.ok ? await res.json() : null;
      if (Array.isArray(datos?.data)) {
        const items = datos.data
          .filter((it) => it?.id || it?.slug)
          .map((it) => {
            const i18n = it.i18n?.en || Object.values(it.i18n || {})[0];
            const e = { id: it.id, slug: it.slug, name: i18n?.name, thumb: i18n?.thumb };
            if (it.maxRank) e.maxRank = it.maxRank;
            return e;
          });
        catalogo = { t: ahora(), items };
        try {
          await escribeFichero(rutaCatalogo, JSON.stringify(catalogo));
        } catch { }
        return items;
      }
    } catch { }
    if (ahora() >= frenoHasta) catalogoFallidoEn = ahora();
    return catalogo?.items || null;
  };
  const catalogoWfm = () => (enVuelo ??= cargaCatalogo().finally(() => { enVuelo = null; }));

  const entra = async (email, password, platform) => {
    const res = await pide(`${V1}/auth/signin`, {
      metodo: "POST",
      plataforma: platform,
      cuerpo: JSON.stringify({ email, password }),
      cabeceras: { Authorization: "JWT" }
    });
    if (!res.ok) {
      let detail = "invalid_credentials";
      try {
        const err = await res.json();
        if (err?.error?.email) detail = "email_not_found";
        else if (err?.error?.password) detail = "wrong_password";
      } catch { }
      if (res.status === 429) return respuesta(429, { error: "rate_limited" });
      if (res.status >= 500) return respuesta(estado(res.status), { error: "server" });
      return respuesta(res.status === 400 ? 401 : estado(res.status), { error: detail });
    }
    let token = res.headers.get("authorization");
    if (!token) {
      const cookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
      const texto = cookies.length ? cookies.join("; ") : res.headers.get("set-cookie") || "";
      const m = texto.match(/JWT=([^;]+)/);
      if (m) token = m[1];
    }
    if (!token) return fallo(502, "No token returned");
    let ingameName = null;
    let userSlug = null;
    try {
      const payload = await res.json();
      const user = payload?.payload?.user || {};
      ingameName = user.ingame_name || null;
      userSlug = (user.slug || user.ingame_name || "").toLowerCase() || null;
    } catch { }
    const limpio = token.replace(/^JWT\s+/i, "");
    let v2Status = 0;
    try {
      const sondeo = await pide(`${V2}/orders/my`, { token: limpio, plataforma: platform });
      v2Status = sondeo.status;
      await sondeo.text();
    } catch { }
    return respuesta(200, {
      token: limpio,
      ingameName,
      userSlug,
      authorized: v2Status === 200,
      diag: {
        via: res.headers.get("authorization") ? "header" : "cookie",
        v2Status
      }
    });
  };

  const manejadores = {
    wfm_login: async ({ metodo, cuerpo }) => {
      if (metodo !== "POST") return fallo(405, "Method not allowed");
      let datos;
      try {
        datos = JSON.parse(cuerpo);
      } catch {
        return fallo(400, "Invalid body");
      }
      const { email, password, platform } = datos || {};
      if (
        typeof email !== "string" || !email ||
        typeof password !== "string" || !password ||
        typeof platform !== "string" || !platform ||
        email.length > 254 || password.length > 256
      ) {
        return fallo(400, "Missing credentials");
      }
      const r = await entra(email, password, platform);
      if (credenciales && typeof datos.recordar === "boolean") {
        if (datos.recordar === false) {
          await credenciales.borra();
        } else if (r.status === 200) {
          await credenciales.guarda({ email, password, platform, nombre: JSON.parse(r.cuerpo).ingameName || null }).catch(() => false);
        }
      }
      return r;
    },
    wfm_recordadas: async () => {
      if (!credenciales || !credenciales.disponible()) {
        return respuesta(200, { disponible: false, guardadas: false, nombre: null });
      }
      const c = await credenciales.lee();
      return respuesta(200, { disponible: true, guardadas: !!c, nombre: c?.nombre || null });
    },
    wfm_login_recordado: async ({ metodo }) => {
      if (metodo !== "POST") return fallo(405, "Method not allowed");
      const c = credenciales ? await credenciales.lee() : null;
      if (!c) return respuesta(401, { error: "no_saved" });
      const r = await entra(c.email, c.password, c.platform);
      if (r.status === 401) {
        await credenciales.borra();
        return r;
      }
      if (r.status === 200) {
        return respuesta(200, { ...JSON.parse(r.cuerpo), platform: c.platform });
      }
      return r;
    },
    wfm_olvidar: async ({ metodo }) => {
      if (metodo !== "POST") return fallo(405, "Method not allowed");
      if (credenciales) await credenciales.borra();
      return respuesta(200, { ok: true });
    },
    wfm_logout: async ({ token }) => {
      if (!token) return respuesta(200, { ok: true });
      let revoked = false;
      try {
        const res = await pide(`${V2}/auth/signout`, { metodo: "POST", token });
        revoked = res.ok;
        await res.text().catch(() => "");
      } catch { }
      return respuesta(200, { ok: true, revoked });
    },
    wfm_my_orders: async ({ params, token }) => {
      const plataforma = params.platform;
      if (token) {
        const res = await pide(`${V2}/orders/my`, { token, plataforma });
        if (res.ok) return { status: 200, cuerpo: await res.text(), scope: "full" };
        if (res.status === 429 || res.status >= 500) return { status: estado(res.status), cuerpo: await res.text() };
        await res.text().catch(() => "");
      }
      if (params.user) {
        if (!esSlug(params.user)) return fallo(400, "Invalid user");
        const res = await pide(`${V2}/orders/user/${encodeURIComponent(params.user.toLowerCase())}`, { plataforma });
        return { status: estado(res.status), cuerpo: await res.text(), scope: "public" };
      }
      return fallo(401, "Missing token or user");
    },
    wfm_order_create: async ({ metodo, token, cuerpo }) => {
      if (metodo !== "POST") return fallo(405, "Method not allowed");
      if (!token) return fallo(401, "Missing token");
      let payload;
      try {
        payload = JSON.parse(cuerpo);
      } catch {
        return fallo(400, "Invalid body");
      }
      if (typeof payload?.itemId !== "string" || !HEX24.test(payload.itemId)) {
        return fallo(400, "Invalid itemId");
      }
      if (payload.type !== "sell" && payload.type !== "buy") {
        return fallo(400, "Invalid type");
      }
      const platinum = Number(payload.platinum);
      const quantity = Number(payload.quantity ?? 1);
      if (!Number.isInteger(platinum) || platinum < 1) {
        return fallo(400, "Invalid platinum");
      }
      if (!Number.isInteger(quantity) || quantity < 1) {
        return fallo(400, "Invalid quantity");
      }
      const body = { itemId: payload.itemId, type: payload.type, platinum, quantity };
      for (const k of ["rank", "subtype", "perTrade", "visible", "amberStars", "cyanStars"]) {
        if (payload[k] !== undefined) body[k] = payload[k];
      }
      const res = await pide(`${V2}/order`, {
        metodo: "POST",
        token,
        plataforma: payload.platform,
        cuerpo: JSON.stringify(body)
      });
      const texto = await res.text();
      return { status: estado(res.status), cuerpo: texto || JSON.stringify({ ok: res.ok }) };
    },
    wfm_order_edit: async ({ params, metodo, token, cuerpo }) => {
      if (metodo !== "POST") return fallo(405, "Method not allowed");
      if (!token) return fallo(401, "Missing token");
      const id = params.id;
      if (typeof id !== "string" || !HEX24.test(id)) return fallo(400, "Invalid order id");
      let payload = {};
      if (cuerpo !== null && cuerpo !== "") {
        try {
          const parseado = JSON.parse(cuerpo);
          if (parseado && typeof parseado === "object") payload = parseado;
        } catch {
          return fallo(400, "Invalid body");
        }
      }
      let destino;
      let metodoHttp;
      let cuerpoEnvio;
      const action = params.action;
      if (action === "update") {
        destino = `${V2}/order/${id}`;
        metodoHttp = "PATCH";
        const patch = {};
        for (const k of ["platinum", "quantity", "visible", "perTrade", "rank", "subtype"]) {
          if (payload[k] !== undefined) patch[k] = payload[k];
        }
        if (!Object.keys(patch).length) return fallo(400, "Nothing to update");
        cuerpoEnvio = JSON.stringify(patch);
      } else if (action === "close") {
        destino = `${V2}/order/${id}/close`;
        metodoHttp = "POST";
        cuerpoEnvio = JSON.stringify({ quantity: payload.quantity ?? 1 });
      } else if (action === "delete") {
        destino = `${V2}/order/${id}`;
        metodoHttp = "DELETE";
      } else {
        return fallo(400, "Invalid action");
      }
      const res = await pide(destino, {
        metodo: metodoHttp,
        token,
        plataforma: payload.platform,
        cuerpo: cuerpoEnvio
      });
      const texto = await res.text();
      return { status: estado(res.status), cuerpo: texto || JSON.stringify({ ok: res.ok }) };
    },
    wfm_resolve: async ({ params }) => {
      const q = params.ids;
      if (!q) return respuesta(200, {});
      const ids = lista(q, 100);
      if (!ids.every((id) => HEX24.test(id))) return fallo(400, "Invalid id");
      if (!ids.length) return respuesta(200, {});
      const items = await catalogoWfm();
      if (!items) return fallo(502, "network");
      const wanted = new Set(ids);
      const out = {};
      for (const it of items) {
        if (it?.id && wanted.has(it.id)) {
          const entry = { slug: it.slug, name: it.name, thumb: it.thumb };
          if (it.maxRank) entry.maxRank = it.maxRank;
          out[it.id] = entry;
        }
      }
      return respuesta(200, out);
    },
    wfm_ids: async ({ params }) => {
      const q = params.slugs;
      if (!q) return respuesta(200, {});
      const slugs = lista(q, 100);
      if (!slugs.every(esSlug)) return fallo(400, "Invalid slug");
      if (!slugs.length) return respuesta(200, {});
      const items = await catalogoWfm();
      if (!items) return fallo(502, "network");
      const wanted = new Set(slugs);
      const out = {};
      for (const it of items) {
        if (it?.slug && wanted.has(it.slug)) {
          const entry = { id: it.id, name: it.name, thumb: it.thumb };
          if (it.maxRank) entry.maxRank = it.maxRank;
          out[it.slug] = entry;
        }
      }
      return respuesta(200, out);
    },
    wfm_item_market: async ({ params }) => {
      const slug = params.slug;
      if (!esSlug(slug)) return fallo(400, "Invalid slug");
      let rank = null;
      if (params.rank !== undefined) {
        rank = parseInt(params.rank, 10);
        if (!Number.isInteger(rank) || rank < 0 || rank > 20) return fallo(400, "Invalid rank");
      }
      const data = await mercado(slug, rank);
      return respuesta(200, data || {});
    },
    wfm_market_batch: async ({ params }) => {
      const q = params.slugs;
      if (!q) return respuesta(200, {});
      const slugs = lista(q, 30);
      if (!slugs.every(esSlug)) return fallo(400, "Invalid slug");
      const soloStats = params.solo === "stats";
      const out = {};
      for (const slug of slugs) {
        const data = await mercado(slug, null, soloStats);
        if (data) out[slug] = data;
      }
      if (soloStats && !Object.keys(out).length && ahora() < frenoHasta) {
        return fallo(429, "wfm_frenado");
      }
      return respuesta(200, out);
    }
  };

  return {
    async ejecuta(tipo, peticion) {
      const manejador = Object.hasOwn(manejadores, tipo) ? manejadores[tipo] : null;
      if (!manejador) return fallo(400, "Invalid type");
      const p = peticion && typeof peticion === "object" ? peticion : {};
      const params = p.params && typeof p.params === "object" ? p.params : {};
      try {
        return await manejador({
          params,
          metodo: p.metodo === "POST" ? "POST" : "GET",
          token: typeof p.token === "string" && p.token ? p.token : null,
          cuerpo: typeof p.cuerpo === "string" ? p.cuerpo : null
        });
      } catch {
        return fallo(502, "network");
      }
    }
  };
}
