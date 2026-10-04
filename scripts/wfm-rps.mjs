import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

export function consultaSQL(dataset, horas = 1) {
  const h = Math.max(1, Math.min(72, Math.floor(Number(horas) || 1)));
  return `SELECT toUnixTimestamp(timestamp) AS s, blob1 AS endpoint, blob2 AS colo, blob3 AS tipo, double1 AS estado, sum(_sample_interval) AS n
FROM ${dataset}
WHERE timestamp > NOW() - INTERVAL '${h}' HOUR
GROUP BY s, endpoint, colo, tipo, estado
LIMIT 100000
FORMAT JSON`;
}

export function filasDeTail(linea) {
  let evento;
  try { evento = JSON.parse(linea); } catch { return []; }
  const filas = [];
  for (const log of evento?.logs || []) {
    for (const m of log?.message || []) {
      let d = m;
      if (typeof m === "string") { try { d = JSON.parse(m); } catch { continue; } }
      if (!d?.wfm) continue;
      filas.push({ s: Math.floor((d.t || log.timestamp || Date.now()) / 1000), endpoint: d.wfm, colo: d.colo || "?", tipo: d.frenada ? "frenada" : "enviada", estado: d.estado, n: 1 });
    }
  }
  return filas;
}

export function resumen(filas) {
  const enviadas = filas.filter((f) => f.tipo !== "frenada");
  const porSegundo = new Map(), porColoSegundo = new Map(), porMinuto = new Map();
  const porEndpoint = {}, picoColo = {};
  let total = 0, r429 = 0, frenadas = 0;
  for (const f of filas) if (f.tipo === "frenada") frenadas += Number(f.n) || 0;
  for (const f of enviadas) {
    const n = Number(f.n) || 0;
    total += n;
    if (Number(f.estado) === 429) r429 += n;
    porSegundo.set(f.s, (porSegundo.get(f.s) || 0) + n);
    const clave = `${f.colo}|${f.s}`;
    porColoSegundo.set(clave, (porColoSegundo.get(clave) || 0) + n);
    porMinuto.set(Math.floor(f.s / 60), (porMinuto.get(Math.floor(f.s / 60)) || 0) + n);
    porEndpoint[f.endpoint] = (porEndpoint[f.endpoint] || 0) + n;
  }
  for (const [clave, n] of porColoSegundo) {
    const colo = clave.split("|")[0];
    picoColo[colo] = Math.max(picoColo[colo] || 0, n);
  }
  const segundos = [...porSegundo.keys()];
  const desde = segundos.length ? Math.min(...segundos) : 0;
  const hasta = segundos.length ? Math.max(...segundos) : 0;
  const [picoS, picoN] = [...porSegundo].sort((a, b) => b[1] - a[1])[0] || [0, 0];
  const [minS, minN] = [...porMinuto].sort((a, b) => b[1] - a[1])[0] || [0, 0];
  return {
    total, r429, frenadas,
    pico: { rps: picoN, s: picoS },
    minutoMasCargado: { n: minN, rps: Math.round((minN / 60) * 100) / 100, s: minS * 60 },
    media: hasta > desde ? Math.round((total / (hasta - desde + 1)) * 100) / 100 : total,
    porEndpoint, picoColo,
  };
}

const hora = (s) => new Date(s * 1000).toLocaleTimeString("es-ES");

export function texto(r) {
  const endpoints = Object.entries(r.porEndpoint).sort((a, b) => b[1] - a[1]).map(([e, n]) => `${e} ${n}`).join(" · ");
  const colos = Object.entries(r.picoColo).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(" · ");
  return [
    `${r.total} peticiones a WFM, ${r.r429} con 429, ${r.frenadas} frenadas sin salir`,
    `pico ${r.pico.rps} rps (${r.pico.s ? hora(r.pico.s) : "-"}) · media ${r.media} rps · minuto más cargado ${r.minutoMasCargado.n} (${r.minutoMasCargado.rps} rps)`,
    `por endpoint: ${endpoints || "-"}`,
    `pico por colo (rps): ${colos || "-"}`,
  ].join("\n");
}

async function analytics(args) {
  const cuenta = process.env.CF_ACCOUNT_ID, token = process.env.CF_API_TOKEN;
  if (!cuenta || !token) throw new Error("Faltan CF_ACCOUNT_ID y CF_API_TOKEN (permiso Account Analytics: Read)");
  const dataset = args.find((a, i) => args[i - 1] === "--dataset") || "voidstonks_wfm";
  const horas = args.find((a, i) => args[i - 1] === "--horas") || 1;
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cuenta}/analytics_engine/sql`, {
    method: "POST", headers: { Authorization: `Bearer ${token}` }, body: consultaSQL(dataset, horas),
  });
  if (!res.ok) throw new Error(`Analytics Engine ${res.status}: ${await res.text()}`);
  const { data = [] } = await res.json();
  console.log(`Últimas ${horas} h (${dataset})\n${texto(resumen(data.map((d) => ({ ...d, s: Number(d.s) }))))}`);
}

async function tail() {
  const filas = [];
  const lector = createInterface({ input: process.stdin });
  lector.on("line", (l) => filas.push(...filasDeTail(l)));
  setInterval(() => {
    const ahora = Math.floor(Date.now() / 1000);
    const ultimas = filas.filter((f) => f.s > ahora - 60);
    const r = resumen(ultimas);
    const ultimo = resumen(ultimas.filter((f) => f.s >= ahora - 10));
    console.log(`[${hora(ahora)}] últimos 10 s: ${Math.round((ultimo.total / 10) * 10) / 10} rps · 60 s: ${r.total} peticiones, pico ${r.pico.rps} rps, 429: ${r.r429}, frenadas: ${r.frenadas}`);
  }, 5000);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const [modo = "analytics", ...args] = process.argv.slice(2);
  (modo === "tail" ? tail() : analytics(args)).catch((e) => { console.error(e.message); process.exit(1); });
}
