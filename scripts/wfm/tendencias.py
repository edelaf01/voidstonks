import argparse
import json
import os
from datetime import datetime, timedelta, timezone

import relicsrun
from precios_prime import universo

RECIENTES = 3
VENTANAS = {"7": 7, "30": 30}


def media(valores):
    return round(sum(valores) / len(valores), 1) if valores else None


def precios_de(filas, reliquia):
    if reliquia:
        p = relicsrun.precio(relicsrun.variante(filas, "intact"))
        return {"p": p} if p is not None else {}
    p = relicsrun.precio(relicsrun.variante(filas))
    filas_sin_subtipo = [f for f in filas if f.get("subtype") is None]
    rango = max((f.get("mod_rank") or 0 for f in filas_sin_subtipo), default=0)
    res = {}
    if p is not None:
        res["p"] = p
    if rango > 0:
        pm = relicsrun.precio(relicsrun.variante(filas, None, rango))
        if pm is not None:
            res["pm"] = pm
    return res


def tendencia(serie, fechas):
    ultima = fechas[-1]
    res = {}
    val_p = media([serie[f] for f in fechas[-RECIENTES:] if f in serie])
    if val_p is not None:
        res["p"] = val_p
    for k, dias in VENTANAS.items():
        centro = ultima - timedelta(days=dias)
        valores = [serie[centro + timedelta(days=d)] for d in (-1, 0, 1) if (centro + timedelta(days=d)) in serie]
        val_k = media(valores)
        if val_k is not None:
            res["p" + k] = val_k
    return res


def objetivos(ruta_catalogo, ruta_arcanos):
    objs = {}
    for slug in universo(False, ruta_catalogo):
        objs[slug] = (False, "")
    for slug in universo(True, ruta_catalogo):
        objs[slug] = (True, "")
    if ruta_arcanos and os.path.exists(ruta_arcanos):
        try:
            with open(ruta_arcanos, encoding="utf-8") as f:
                tradables = json.load(f).get("tradables", {})
            if isinstance(tradables, dict):
                for slug, datos in tradables.items():
                    nombre = datos[0] if isinstance(datos, list) and datos else ""
                    objs[slug] = (False, nombre)
        except Exception:
            pass
    return objs


def fechas_necesarias(fechas):
    ultima = fechas[-1]
    fechas_set = set(fechas)
    necesarias = set(fechas[-RECIENTES:])
    for dias in VENTANAS.values():
        centro = ultima - timedelta(days=dias)
        for d in (-1, 0, 1):
            cand = centro + timedelta(days=d)
            if cand in fechas_set:
                necesarias.add(cand)
    return necesarias


def calcula(carpeta, fechas, objetivos_, por_id, por_nombre):
    series = {slug: {"p": {}, "pm": {}} for slug in objetivos_}
    for fecha in sorted(fechas_necesarias(fechas)):
        dia = relicsrun.carga(carpeta, fecha)
        if dia is None:
            continue
        mapa = relicsrun.por_slug(dia, por_id, por_nombre)
        for slug, (reliquia, nombre) in objetivos_.items():
            filas = mapa.get(slug) or [f for f in (dia.get(nombre) or []) if isinstance(f, dict)]
            if filas:
                for clave, valor in precios_de(filas, reliquia).items():
                    series[slug][clave][fecha] = valor
    t = {}
    for slug, claves in series.items():
        entrada = {}
        for clave in ("p", "pm"):
            serie = claves.get(clave, {})
            if serie:
                r = tendencia(serie, fechas)
                for k, v in r.items():
                    entrada[clave + k[1:]] = v
        if entrada:
            t[slug] = entrada
    return t


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--relicsrun", required=True)
    parser.add_argument("--catalogo", required=True)
    parser.add_argument("--arcanos", required=True)
    parser.add_argument("--salida", required=True)
    a = parser.parse_args()

    fechas = relicsrun.fechas_guardadas(a.relicsrun)
    if not fechas:
        print("Sin días de relics.run: no se escribe " + a.salida)
        return

    cat = relicsrun.catalogo(a.catalogo)
    por_id, por_nombre = relicsrun.indice(cat)
    t = calcula(a.relicsrun, fechas, objetivos(a.catalogo, a.arcanos), por_id, por_nombre)

    salida = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "dia": fechas[-1].isoformat(),
        "t": t,
    }
    with open(a.salida, "w", encoding="utf-8") as f:
        json.dump(salida, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    print(f"Escrito {a.salida}: {len(t)} tendencias (último día {fechas[-1]})")


if __name__ == "__main__":
    main()
