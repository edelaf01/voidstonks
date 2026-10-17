import { WORKER_URL } from "../../config.js";
import { wfmEnLanzador, pideWfmAlLanzador } from "../../repositories/launcher.repository.js";

export async function pideWfm(tipo, consulta = "", init) {
    const url = `${WORKER_URL}?type=${tipo}${consulta}`;
    if (!wfmEnLanzador()) return init === undefined ? fetch(url) : fetch(url, init);
    init ??= {};
    const r = await pideWfmAlLanzador(tipo, {
        params: Object.fromEntries(new URLSearchParams(consulta)),
        metodo: init.method || "GET",
        token: init.headers?.["X-WFM-Token"] || null,
        cuerpo: init.body ?? null
    });
    return new Response(r?.cuerpo ?? "", { status: r?.status || 502, headers: r?.scope ? { "X-WFM-Scope": r.scope } : {} });
}
