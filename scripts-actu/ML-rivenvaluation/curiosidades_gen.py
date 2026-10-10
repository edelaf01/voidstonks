"""generates market highlights for the frontend carousel from history_series.json, accumulating notable
movements across runs
usage: python curiosidades_gen.py -> writes to $DEPLOY_ML_DIR (default ./generado)
env: CURIOS_DIAS (detection window), CURIOS_HISTORIAL_DIAS (history window), CURIOS_MAX (event cap),
DEPLOY_ML_DIR
"""
import json
import os

import numpy as np
import pandas as pd

HIST_SERIES = os.environ.get("VOIDSTONKS_HIST_SERIES", "history_series.json")
MIN_VENTA = 40
POP_MIN = 2.0


def _pop_de(p):
    liq = p.get("liquidity_score") or 0
    of = p.get("wfm_market_sample") or 0
    if liq == 50 and of == 0:
        return 0.0
    return (liq - 0.5 - 1.5 * of) / 5


def _prima_de(p):
    om = p.get("official_median") or 0
    r = p.get("rerolled_premium_ratio") or 0
    if om <= 0 or r <= 0 or r == 1:
        return None
    respaldo = round(min(10.0, max(1.5, (p.get("wfm_avg_price") or om) / om)), 2)
    return None if abs(r - respaldo) < 0.006 else r


def _fechas_weekly(series):
    # days DE published its weekly table, detected when hundreds of weapons change official_median at once
    # (measured: 379-401 weapons)
    # anchors events so movements right after publication count as reactions to new data rather than noise
    _cambios = {}
    for _serie in series.values():
        _sv = sorted([p for p in _serie if (p.get("official_median") or 0) > 0],
                     key=lambda p: p.get("date", ""))
        for _a, _b in zip(_sv, _sv[1:]):
            if _a["official_median"] != _b["official_median"]:
                _cambios[_b["date"]] = _cambios.get(_b["date"], 0) + 1
    return sorted(f for f, n in _cambios.items() if n >= 50)


def _sin_variantes(firmas):
    grupos = {}
    for arma, f in firmas.items():
        grupos.setdefault(f, []).append(arma)
    return {a for a, f in firmas.items()
            if not any(o != a and f" {o} " in f" {a} " for o in grupos[f])}


def _generar_curiosidades(path_series, top=40, dias_max=None):
    """detects market movements across MULTIPLE types to prevent repetitive highlights"""
    if not os.path.exists(path_series):
        return []
    try:
        with open(path_series, "r", encoding="utf-8") as f:
            series = json.load(f)
    except Exception as e:
        print(f"[WARN] curiosidades: no se pudo leer {path_series}: {e}")
        return []

    VENTANA = 7
    # only RECENT movements: measured against the last date in the history rather than today so delayed runs
    # behave the same
    # avoids ordering solely by magnitude, which kept old events pinned permanently
    _publicaciones = _fechas_weekly(series)

    def _tras_publicacion(fecha):
        """last weekly publication on or before date, and elapsed days"""
        previas = [f for f in _publicaciones if f <= fecha]
        if not previas:
            return None, None
        ult = previas[-1]
        return ult, (pd.Timestamp(fecha) - pd.Timestamp(ult)).days

    _dias = int(os.environ.get("CURIOS_DIAS", dias_max or 21))
    _ultima = max((p.get("date") or "" for serie in series.values() for p in serie), default="")
    _corte = ""
    if _ultima:
        _corte = str((pd.Timestamp(_ultima) - pd.Timedelta(days=_dias)).date())
    eventos = []
    for arma, serie in series.items():
        s = [p for p in serie if (p.get("official_median") or 0) > 0]
        if len(s) < VENTANA + 3:
            continue
        s.sort(key=lambda p: p.get("date", ""))
        for i in range(VENTANA, len(s)):
            hoy, ayer, previos = s[i], s[i - 1], s[i - VENTANA:i]
            if _corte and (hoy.get("date") or "") < _corte:
                continue
            pop = _pop_de(hoy)
            if pop < POP_MIN or float(np.median([_pop_de(p) for p in previos])) < POP_MIN:
                continue
            cur_v = float(hoy["official_median"])
            base_v = float(np.median([p["official_median"] for p in previos]))
            vol = float(hoy.get("volatility_index") or 0)
            base_vol = float(np.median([p.get("volatility_index") or 0 for p in previos]))

            tipo = None
            # DE publishes WEEKLY on a daily series: official_median only changes on 13% of days
            # +0% without publication means no data rather than no movement; sale floor filters noise from tiny
            # volumes (1p to 100p on two sales)
            if cur_v != ayer["official_median"] and base_v >= MIN_VENTA and cur_v >= MIN_VENTA:
                pct = (cur_v - base_v) / base_v * 100
                if abs(pct) >= 25:
                    tipo = "subida_venta" if pct > 0 else "bajada_venta"
                    v_de, v_a = round(base_v), round(cur_v)
            if (not tipo and vol != float(ayer.get("volatility_index") or 0)
                    and cur_v >= MIN_VENTA and 0 < base_vol <= 6 and base_vol != 3.0 and vol >= 15):
                tipo = "volatil"
                pct = (vol - base_vol) / max(base_vol, 0.1) * 100
                v_de, v_a = round(base_vol / 10, 2), round(vol / 10, 1)
            if not tipo:
                continue

            # movement spans multiple days: compares median of previous VENTANA against today
            # storing the date range reports the real measurement window instead of a synthetic exact date
            _desde = s[i - VENTANA].get("date")
            _pub, _tras = _tras_publicacion(hoy.get("date") or "")
            eventos.append({
                "weekly": _pub, "dias_tras_weekly": _tras,
                "arma": arma, "fecha": hoy.get("date"), "desde": _desde, "tipo": tipo,
                "pct": round(pct), "de": v_de, "a": v_a,
                "pop_de": round(pop, 1), "fuente": "de",
            })

    # one per weapon, distributed by type to avoid repeating the same highlight
    mejor = {}
    for e in eventos:
        k = e["arma"]
        peso = (e["tipo"] != "volatil", e["fecha"], abs(e["pct"]))
        if k not in mejor or peso > (mejor[k]["tipo"] != "volatil", mejor[k]["fecha"],
                                     abs(mejor[k]["pct"])):
            mejor[k] = e
    quedan = _sin_variantes({a: (e["tipo"], e["fecha"], e["de"], e["a"]) for a, e in mejor.items()})
    por_tipo = {}
    for e in mejor.values():
        if e["arma"] in quedan:
            por_tipo.setdefault(e["tipo"], []).append(e)
    for lista in por_tipo.values():
        # sorted by DATE first so recent events take priority over older larger movements
        # magnitude breaks ties within the same day
        lista.sort(key=lambda e: (e["fecha"], abs(e["pct"])), reverse=True)
    # round starts with the type having the MOST RECENT event rather than alphabetical order
    # type name serves only as a tiebreaker for determinism
    orden = sorted(por_tipo, key=lambda t: (por_tipo[t][0]["fecha"], t), reverse=True)
    salida, i = [], 0
    while len(salida) < top and any(len(v) > i for v in por_tipo.values()):
        for tipo in orden:                     # round-robin between types
            if len(por_tipo[tipo]) > i and len(salida) < top:
                salida.append(por_tipo[tipo][i])
        i += 1
    return salida


def _generar_globales(series):
    """whole-market stats computed from history to interleave general market facts with specific weapon
    movements
    """
    publicaciones = _fechas_weekly(series)
    if not publicaciones:
        return []
    ult = publicaciones[-1]
    tanda = [f for f in publicaciones if (pd.Timestamp(ult) - pd.Timestamp(f)).days <= 2]
    out = []
    cambios, fiables = {}, {}
    for arma, serie in series.items():
        s = sorted([p for p in serie if (p.get("official_median") or 0) > 0],
                   key=lambda p: p.get("date", ""))
        if not s:
            continue
        antes = [p["official_median"] for p in s if p.get("date", "") < tanda[0]]
        tras = [p["official_median"] for p in s if tanda[0] <= p.get("date", "") <= ult]
        if antes and tras and tras[-1] != antes[-1]:
            cambios[arma] = (antes[-1], tras[-1])
        if s[-1]["official_median"] >= MIN_VENTA and _pop_de(s[-1]) >= POP_MIN:
            fiables[arma] = s[-1]
    quedan = _sin_variantes(cambios)
    suben = sum(1 for a in quedan if cambios[a][1] > cambios[a][0])
    bajan = len(quedan) - suben
    if suben + bajan:
        g = {"tipo": "global_weekly", "fecha": ult, "suben": suben, "bajan": bajan}
        if tanda[0] != ult:
            g["desde"] = tanda[0]
        out.append(g)
    fiables = {a: fiables[a] for a in _sin_variantes(
        {a: (p["official_median"], p.get("rerolled_premium_ratio")) for a, p in fiables.items()})}
    primas = [r for r in (_prima_de(p) for p in fiables.values()) if r is not None]
    if len(primas) >= 30:
        out.append({"tipo": "global_prima", "valor": round(float(np.median(primas)), 1),
                    "armas": len(primas)})
    if fiables:
        arma, p = max(fiables.items(),
                      key=lambda kv: (kv[1]["official_median"], -len(kv[0]), kv[0]))
        out.append({"tipo": "global_cara", "arma": arma, "valor": round(p["official_median"])})
    return out


# keeps only the most recent reading per (weapon, type) within this window to avoid duplicate daily
# detections
REPETIDO_DIAS = 7

# the entire last week is kept as current events; older entries retain only NOTABLE movements to avoid
# burying highlights
FRESCOS_DIAS = 7
ARCHIVO_MAX = 40


def _nota(e):
    """scores how much an event deserves to survive past a week based on pct movement, trade volume and
    proximity to DE weekly publication
    """
    magnitud = min(abs(e.get("pct") or 0), 300) * (0.3 if e.get("tipo") == "volatil" else 1.0)
    liquidez = np.log1p(e.get("pop_de") or 0)
    tras_weekly = e.get("dias_tras_weekly")
    bonus = 1.25 if (tras_weekly is not None and tras_weekly <= 2) else 1.0
    return float(magnitud * liquidez * bonus)


def _fusiona_historial(nuevos, ruta, dias_historial, tope):
    """merges today detections with existing history, deduplicating and expiring old events"""
    previos = []
    if os.path.exists(ruta):
        try:
            with open(ruta, "r", encoding="utf-8") as f:
                previos = json.load(f).get("eventos") or []
        except (json.JSONDecodeError, OSError, ValueError):
            previos = []   # a partial file must not fail the daily run
    previos = [e for e in previos if e.get("fuente") == "de"]

    hoy = pd.Timestamp.now("UTC").date()
    corte = str(hoy - pd.Timedelta(days=dias_historial))
    fusion, ultima = [], {}
    # today events first: if an event is redetected, the new reading takes precedence
    for e in [*nuevos, *previos]:
        fecha = e.get("fecha") or ""
        if fecha < corte:
            continue
        clave = (e.get("arma"), e.get("tipo"))
        anterior = ultima.get(clave)
        if anterior is not None and abs((pd.Timestamp(fecha) - pd.Timestamp(anterior)).days) < REPETIDO_DIAS:
            continue
        ultima[clave] = fecha
        fusion.append(e)
    # curation: entire week is kept, plus only the most notable older events
    frontera = str(hoy - pd.Timedelta(days=FRESCOS_DIAS))
    frescos = [e for e in fusion if (e.get("fecha") or "") >= frontera]
    archivo = [e for e in fusion if (e.get("fecha") or "") < frontera]
    archivo.sort(key=_nota, reverse=True)
    salida = frescos + archivo[:ARCHIVO_MAX]
    # descending by date for the frontend; stable sort preserves signal-strength ordering within each day
    salida.sort(key=lambda e: e.get("fecha") or "", reverse=True)
    # one card per weapon: sorted by date so only the most recent reading survives when a move triggers
    # multiple types
    vistas, unicos = set(), []
    for e in salida:
        arma = str(e.get("arma") or "").lower()
        if arma in vistas:
            continue
        vistas.add(arma)
        unicos.append(e)
    return unicos[:tope]


if __name__ == "__main__":
    _ev = _generar_curiosidades(HIST_SERIES)
    with open(HIST_SERIES, "r", encoding="utf-8") as _f:
        _series = json.load(_f)
    _gl = _generar_globales(_series)
    _dest = os.environ.get("DEPLOY_ML_DIR", "generado")
    os.makedirs(_dest, exist_ok=True)
    _ruta = os.path.join(_dest, "curiosidades.json")
    _antes = len(_ev)
    _ev = _fusiona_historial(_ev, _ruta,
                             int(os.environ.get("CURIOS_HISTORIAL_DIAS", 60)),
                             int(os.environ.get("CURIOS_MAX", 240)))
    with open(_ruta, "w", encoding="utf-8") as f:
        # serie_hasta is the last date in history supplying events, separate from generated to expose stale
        # history data
        _hasta = max((p.get("date") or "" for s_ in _series.values() for p in s_), default="")
        json.dump({"generado": str(pd.Timestamp.now("UTC").date()), "serie_hasta": _hasta,
                   "globales": _gl, "eventos": _ev}, f, indent=1, ensure_ascii=False)
    from collections import Counter
    print(f"Curiosidades: {len(_ev)} eventos en el historial "
          f"({_antes} detectados hoy) + {len(_gl)} globales -> {_ruta}")
    if _ev:
        print("  por tipo:", dict(Counter(e["tipo"] for e in _ev)))
        print("  fechas  :", min(e["fecha"] for e in _ev), "->", max(e["fecha"] for e in _ev))
