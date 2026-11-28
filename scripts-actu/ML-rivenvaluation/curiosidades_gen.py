"""generates market highlights for the frontend carousel from history_series.json"""
import json
import os

import numpy as np
import pandas as pd

HIST_SERIES = os.environ.get("VOIDSTONKS_HIST_SERIES", "history_series.json")
MIN_VENTA = 40
MIN_SALTO = 20
POP_MIN = 2.0
RATIO_VOLATIL = 3.0
PREFIJOS_FAMILIA = (
    "dex", "kuva", "coda", "prisma", "tenet", "mk1",
    "vaykor", "synoid", "secura", "rakta", "telos", "sancti",
)


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


def _tandas_weekly(series):
    _cambios = {}
    for _serie in series.values():
        _sv = sorted([p for p in _serie if (p.get("official_median") or 0) > 0],
                     key=lambda p: p.get("date", ""))
        for _a, _b in zip(_sv, _sv[1:]):
            if _a["official_median"] != _b["official_median"]:
                _cambios[_b["date"]] = _cambios.get(_b["date"], 0) + 1
    fechas = sorted(f for f, n in _cambios.items() if n >= 50)
    tandas = []
    for f in fechas:
        if tandas and (pd.Timestamp(f) - pd.Timestamp(tandas[-1][1])).days <= 1:
            tandas[-1] = (tandas[-1][0], f)
        else:
            tandas.append((f, f))
    return tandas


def _fechas_weekly(series):
    return [fin for _, fin in _tandas_weekly(series)]


def _familia(arma):
    partes = str(arma or "").strip().lower().replace("-", " ").split()
    while len(partes) > 1 and partes[0] in PREFIJOS_FAMILIA:
        partes.pop(0)
    return " ".join(partes)


def _dedup_familia(eventos):
    mejor = {}
    for e in eventos:
        k = _familia(e.get("arma"))
        clave = (abs(e.get("pct") or 0), e.get("fecha") or "", -len(str(e.get("arma") or "")))
        if k not in mejor or clave > mejor[k][0]:
            mejor[k] = (clave, e)
    return [e for _, e in mejor.values()]


def _sin_variantes(firmas):
    grupos = {}
    for arma, f in firmas.items():
        grupos.setdefault(f, []).append(arma)
    return {a for a, f in firmas.items()
            if not any(o != a and f" {o} " in f" {a} " for o in grupos[f])}


def _generar_curiosidades(path_series, top=40, dias_max=None):
    if not os.path.exists(path_series):
        return []
    try:
        with open(path_series, "r", encoding="utf-8") as f:
            series = json.load(f)
    except Exception as e:
        print(f"[WARN] curiosidades: no se pudo leer {path_series}: {e}")
        return []

    tandas = _tandas_weekly(series)
    if not tandas:
        return []
    _publicaciones = [fin for _, fin in tandas]

    def _tras_publicacion(fecha):
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
        s = sorted([p for p in serie if (p.get("official_median") or 0) > 0],
                   key=lambda p: p.get("date", ""))
        if not s:
            continue
        pre = [p for p in s if p.get("date", "") < tandas[0][0]]
        slots = [(pre[-1]["date"], pre[-1])] if pre else []
        for idx, (ini, fin) in enumerate(tandas):
            sig = tandas[idx + 1][0] if idx + 1 < len(tandas) else None
            pts = [p for p in s if p.get("date", "") >= ini and (sig is None or p.get("date", "") < sig)]
            if pts:
                p_sel = next((x for x in pts if x.get("date") == fin), pts[-1])
                slots.append((fin, p_sel))
            else:
                slots.append(None)
        if len(slots) < 5:
            continue
        for k in range(4, len(slots)):
            ventana = slots[k - 4:k + 1]
            if any(x is None for x in ventana):
                continue
            fecha = ventana[4][0]
            if _corte and fecha < _corte:
                continue
            previas = [p for _, p in ventana[:3]]
            actuales = [p for _, p in ventana[3:]]
            pop = _pop_de(actuales[-1])
            if pop < POP_MIN or float(np.median([_pop_de(p) for p in previas])) < POP_MIN:
                continue
            actuales_v = [float(p["official_median"]) for p in actuales]
            previas_v = [float(p["official_median"]) for p in previas]
            cur_v = float(np.median(actuales_v))
            base_v = float(np.median(previas_v))
            if base_v < MIN_VENTA or cur_v < MIN_VENTA:
                continue
            vol = float(np.median([p.get("volatility_index") or 0 for p in actuales]))
            base_vol = float(np.median([p.get("volatility_index") or 0 for p in previas]))
            cambio_signo = (actuales_v[0] - base_v) * (actuales_v[1] - base_v) < 0
            rango_alto = max(actuales_v) / min(actuales_v) > RATIO_VOLATIL

            tipo = None
            pct = (cur_v - base_v) / base_v * 100
            if abs(cur_v - base_v) >= MIN_SALTO and abs(pct) >= 25:
                if cambio_signo or rango_alto:
                    tipo = "volatil"
                else:
                    tipo = "subida_venta" if pct > 0 else "bajada_venta"
                v_de, v_a = round(base_v), round(cur_v)
            elif rango_alto:
                tipo = "volatil"
                v_de, v_a = round(min(actuales_v)), round(max(actuales_v))
                pct = (v_a - v_de) / v_de * 100
            elif (vol != float(previas[-1].get("volatility_index") or 0)
                    and 0 < base_vol <= 6 and base_vol != 3.0 and vol >= 15):
                tipo = "volatil"
                pct = (vol - base_vol) / max(base_vol, 0.1) * 100
                v_de, v_a = round(base_vol / 10, 2), round(vol / 10, 1)
            if not tipo:
                continue

            _desde = ventana[2][0]
            _pub, _tras = _tras_publicacion(fecha)
            eventos.append({
                "weekly": _pub, "dias_tras_weekly": _tras,
                "arma": arma, "fecha": fecha, "desde": _desde, "tipo": tipo,
                "pct": round(pct), "de": v_de, "a": v_a,
                "pop_de": round(pop, 1), "fuente": "de",
            })

    mejor = {}
    for e in eventos:
        k = e["arma"]
        peso = (e["fecha"], e["tipo"] != "volatil", abs(e["pct"]))
        if k not in mejor or peso > (mejor[k]["fecha"], mejor[k]["tipo"] != "volatil",
                                     abs(mejor[k]["pct"])):
            mejor[k] = e
    por_tipo = {}
    for e in _dedup_familia(mejor.values()):
        por_tipo.setdefault(e["tipo"], []).append(e)
    for lista in por_tipo.values():
        lista.sort(key=lambda e: (e["fecha"], abs(e["pct"])), reverse=True)
    orden = sorted(por_tipo, key=lambda t: (por_tipo[t][0]["fecha"], t), reverse=True)
    salida, i = [], 0
    while len(salida) < top and any(len(v) > i for v in por_tipo.values()):
        for tipo in orden:
            if len(por_tipo[tipo]) > i and len(salida) < top:
                salida.append(por_tipo[tipo][i])
        i += 1
    return salida


def _generar_globales(series):
    tandas = _tandas_weekly(series)
    if not tandas:
        return []
    inicio, ult = tandas[-1]
    out = []
    cambios, fiables = {}, {}
    for arma, serie in series.items():
        s = sorted([p for p in serie if (p.get("official_median") or 0) > 0],
                   key=lambda p: p.get("date", ""))
        if not s:
            continue
        antes = [p["official_median"] for p in s if p.get("date", "") < inicio]
        tras = [p["official_median"] for p in s if inicio <= p.get("date", "") <= ult]
        if antes and tras and tras[-1] != antes[-1]:
            cambios[arma] = (antes[-1], tras[-1])
        if s[-1]["official_median"] >= MIN_VENTA and _pop_de(s[-1]) >= POP_MIN:
            fiables[arma] = s[-1]
    quedan = _sin_variantes(cambios)
    suben = sum(1 for a in quedan if cambios[a][1] > cambios[a][0])
    bajan = len(quedan) - suben
    if suben + bajan:
        g = {"tipo": "global_weekly", "fecha": ult, "suben": suben, "bajan": bajan}
        if inicio != ult:
            g["desde"] = inicio
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


REPETIDO_DIAS = 7

FRESCOS_DIAS = 7
ARCHIVO_MAX = 40


def _nota(e):
    magnitud = min(abs(e.get("pct") or 0), 300) * (0.3 if e.get("tipo") == "volatil" else 1.0)
    liquidez = np.log1p(e.get("pop_de") or 0)
    tras_weekly = e.get("dias_tras_weekly")
    bonus = 1.25 if (tras_weekly is not None and tras_weekly <= 2) else 1.0
    return float(magnitud * liquidez * bonus)


def _fusiona_historial(nuevos, ruta, dias_historial, tope):
    previos = []
    if os.path.exists(ruta):
        try:
            with open(ruta, "r", encoding="utf-8") as f:
                previos = json.load(f).get("eventos") or []
        except (json.JSONDecodeError, OSError, ValueError):
            previos = []
    previos = [e for e in previos if e.get("fuente") == "de"]

    hoy = pd.Timestamp.now("UTC").date()
    corte = str(hoy - pd.Timedelta(days=dias_historial))
    fusion, ultima = [], {}
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
    frontera = str(hoy - pd.Timedelta(days=FRESCOS_DIAS))
    frescos = [e for e in fusion if (e.get("fecha") or "") >= frontera]
    archivo = [e for e in fusion if (e.get("fecha") or "") < frontera]
    archivo.sort(key=_nota, reverse=True)
    salida = _dedup_familia(frescos + archivo[:ARCHIVO_MAX])
    salida.sort(key=lambda e: e.get("fecha") or "", reverse=True)
    return salida[:tope]


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
        _hasta = max((p.get("date") or "" for s_ in _series.values() for p in s_), default="")
        json.dump({"generado": str(pd.Timestamp.now("UTC").date()), "serie_hasta": _hasta,
                   "globales": _gl, "eventos": _ev}, f, indent=1, ensure_ascii=False)
    from collections import Counter
    print(f"Curiosidades: {len(_ev)} eventos en el historial "
          f"({_antes} detectados hoy) + {len(_gl)} globales -> {_ruta}")
    if _ev:
        print("  por tipo:", dict(Counter(e["tipo"] for e in _ev)))
        print("  fechas  :", min(e["fecha"] for e in _ev), "->", max(e["fecha"] for e in _ev))
