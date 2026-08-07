import json
import os

import numpy as np
import pandas as pd

HIST_SERIES = os.environ.get("VOIDSTONKS_HIST_SERIES", "history_series.json")


def _generar_curiosidades(path_series, top=40, dias_max=None):
    if not os.path.exists(path_series):
        return []
    try:
        with open(path_series, "r", encoding="utf-8") as f:
            series = json.load(f)
    except Exception as e:
        print(f"[WARN] curiosidades: no se pudo leer {path_series}: {e}")
        return []

    MIN_OFERTAS, MIN_PRECIO, VENTANA = 12, 60, 7
    _cambios = {}
    for _serie in series.values():
        _sv = sorted([p for p in _serie if (p.get("official_median") or 0) > 0],
                     key=lambda p: p.get("date", ""))
        for _a, _b in zip(_sv, _sv[1:]):
            if _a["official_median"] != _b["official_median"]:
                _cambios[_b["date"]] = _cambios.get(_b["date"], 0) + 1
    _publicaciones = sorted(f for f, n in _cambios.items() if n >= 50)

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
        s = [p for p in serie if (p.get("wfm_avg_price") or 0) > 0]
        if len(s) < VENTANA + 3:
            continue
        s.sort(key=lambda p: p.get("date", ""))
        for i in range(VENTANA, len(s)):
            hoy = s[i]
            if _corte and (hoy.get("date") or "") < _corte:
                continue
            of = int(hoy.get("wfm_market_sample") or 0)
            if of < MIN_OFERTAS:
                continue
            prev = [p["wfm_avg_price"] for p in s[i - VENTANA:i] if p.get("wfm_avg_price")]
            if len(prev) < 4:
                continue
            base = float(np.median(prev))
            cur = float(hoy["wfm_avg_price"])
            if base < MIN_PRECIO or cur < MIN_PRECIO:
                continue
            ask_pct = (cur - base) / base * 100

            pv = [p.get("official_median") or 0 for p in s[i - VENTANA:i + 1]]
            pv = [x for x in pv if x > 0]
            de_publico = len(set(pv)) >= 2 and len(pv) > 1
            base_v = float(np.median(pv[:-1])) if de_publico else 0.0
            cur_v = float(hoy.get("official_median") or 0)
            MIN_VENTA = 25
            venta_pct = (((cur_v - base_v) / base_v * 100)
                         if (base_v >= MIN_VENTA and cur_v >= MIN_VENTA) else None)

            tipo = None
            if venta_pct is not None and venta_pct >= 25 and abs(ask_pct) < 20:
                tipo = "convergencia"
            elif venta_pct is not None and venta_pct >= 25:
                tipo = "subida_venta"
            elif venta_pct is not None and venta_pct <= -25:
                tipo = "bajada_venta"
            elif ask_pct <= -45:
                tipo = "desplome_ask"
            elif ask_pct >= 60 and venta_pct is not None and abs(venta_pct) < 15:
                tipo = "especulacion"
            if not tipo:
                continue

            # movement spans multiple days: compares median of previous VENTANA against today
            # storing the date range reports the real measurement window instead of a synthetic exact date
            _desde = s[i - VENTANA].get("date")
            _pub, _tras = _tras_publicacion(hoy.get("date") or "")
            eventos.append({
                "weekly": _pub, "dias_tras_weekly": _tras,
                "arma": arma, "fecha": hoy.get("date"), "desde": _desde, "tipo": tipo,
                "ask_pct": round(ask_pct), "ask_de": round(base), "ask_a": round(cur),
                "venta_pct": (round(venta_pct) if venta_pct is not None else None),
                "venta_de": round(base_v) if base_v else None,
                "venta_a": round(cur_v) if cur_v else None,
                "ofertas": of,
                "solo_ask": tipo == "especulacion",
            })

    # one per weapon, distributed by type to avoid repeating the same highlight
    mejor = {}
    for e in eventos:
        k = e["arma"]
        if k not in mejor or abs(e["ask_pct"]) > abs(mejor[k]["ask_pct"]):
            mejor[k] = e
    por_tipo = {}
    for e in mejor.values():
        por_tipo.setdefault(e["tipo"], []).append(e)
    for lista in por_tipo.values():
        # sorted by DATE first so recent events take priority over older larger movements
        # magnitude breaks ties within the same day
        lista.sort(key=lambda e: (e["fecha"], max(abs(e["ask_pct"]), abs(e["venta_pct"] or 0))),
                   reverse=True)
    salida, i = [], 0
    while len(salida) < top and any(len(v) > i for v in por_tipo.values()):
        for tipo in sorted(por_tipo):          # round-robin between types
            if len(por_tipo[tipo]) > i and len(salida) < top:
                salida.append(por_tipo[tipo][i])
        i += 1
    return salida


def _generar_globales(series):
    """whole-market stats computed from history to interleave general market facts with specific weapon
    movements
    """
    dias = {}
    for serie in series.values():
        for p in serie:
            d = p.get("date")
            if not d:
                continue
            e = dias.setdefault(d, {"ask": [], "venta": [], "of": 0})
            if (p.get("wfm_avg_price") or 0) > 0:
                e["ask"].append(float(p["wfm_avg_price"]))
            _um = float(p.get("official_median") or 0)
            _pr = float(p.get("rerolled_premium_ratio") or 0)
            if _um > 0 and _pr > 0:
                e["venta"].append(_um * _pr)
            e["of"] += int(p.get("wfm_market_sample") or 0)
    fechas = sorted(dias)
    if len(fechas) < 8:
        return []

    out = []
    hoy, hace = dias[fechas[-1]], dias[fechas[-8]]
    if hoy["ask"] and hoy["venta"]:
        brecha = float(np.median(hoy["ask"])) / max(float(np.median(hoy["venta"])), 1)
        if brecha >= 2:
            out.append({"tipo": "global_brecha", "valor": round(brecha, 1),
                        "ask": round(float(np.median(hoy["ask"]))),
                        "venta": round(float(np.median(hoy["venta"]))),
                        "estimado": True})
    if hoy["ask"] and hace["ask"]:
        a, b = float(np.median(hace["ask"])), float(np.median(hoy["ask"]))
        if a > 0 and abs((b - a) / a) >= 0.05:
            out.append({"tipo": "global_tendencia", "valor": round((b - a) / a * 100),
                        "de": round(a), "a": round(b)})
    activas = sum(1 for serie in series.values()
                  if serie and (serie[-1].get("wfm_market_sample") or 0) >= 12)
    if activas:
        out.append({"tipo": "global_actividad", "valor": activas, "total": len(series)})
    top = max(series.items(),
              key=lambda kv: (kv[1][-1].get("wfm_market_sample") or 0) if kv[1] else 0,
              default=(None, None))
    if top[0] and top[1] and (top[1][-1].get("wfm_market_sample") or 0) >= 20:
        out.append({"tipo": "global_saturada", "arma": top[0],
                    "valor": int(top[1][-1]["wfm_market_sample"])})
    return out


if __name__ == "__main__":
    _ev = _generar_curiosidades(HIST_SERIES)
    with open(HIST_SERIES, "r", encoding="utf-8") as _f:
        _series = json.load(_f)
    _gl = _generar_globales(_series)
    _dest = os.environ.get("DEPLOY_ML_DIR", "generado")
    os.makedirs(_dest, exist_ok=True)
    _ruta = os.path.join(_dest, "curiosidades.json")
    with open(_ruta, "w", encoding="utf-8") as f:
        # serie_hasta is the last date in history supplying events, separate from generated to expose stale
        # history data
        _hasta = max((p.get("date") or "" for s_ in _series.values() for p in s_), default="")
        json.dump({"generado": str(pd.Timestamp.now("UTC").date()), "serie_hasta": _hasta,
                   "globales": _gl, "eventos": _ev}, f, indent=1, ensure_ascii=False)
    from collections import Counter
    print(f"Curiosidades: {len(_ev)} eventos + {len(_gl)} globales -> {_ruta}")
    if _ev:
        print("  por tipo:", dict(Counter(e["tipo"] for e in _ev)))
        print("  fechas  :", min(e["fecha"] for e in _ev), "->", max(e["fecha"] for e in _ev))
