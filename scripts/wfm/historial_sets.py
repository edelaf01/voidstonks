import argparse
import json
import os
import time
from datetime import date, timedelta

import relicsrun

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SALIDA = os.path.join(RAIZ, "deploy", "assets", "json", "historial_sets.json")
URL = "https://relics.run/history/price_history_{fecha}.json"
INICIO = date(2021, 1, 4)
PASO = 7


def lee(ruta):
    try:
        with open(ruta, encoding="utf-8") as f:
            datos = json.load(f)
        return datos if isinstance(datos, dict) and "d" in datos and "s" in datos else None
    except Exception:
        return None


def dia(carpeta, fecha):
    if carpeta:
        datos = relicsrun.carga(carpeta, fecha)
        if datos:
            return datos
    estado, cuerpo = relicsrun.obtiene(URL.format(fecha=fecha.isoformat()))
    time.sleep(relicsrun.PAUSA_S)
    if estado != "ok":
        return None
    try:
        return json.loads(cuerpo)
    except Exception:
        return None


def precios(datos):
    res = {}
    for nombre, filas in datos.items():
        if nombre.endswith(" Prime Set") and isinstance(filas, list):
            p = relicsrun.precio(relicsrun.variante(filas))
            if p is not None:
                res[nombre] = round(p)
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--relicsrun", default=None)
    ap.add_argument("--salida", default=SALIDA)
    ap.add_argument("--max", type=int, default=0)
    ap.add_argument("--paso", type=int, default=PASO)
    args = ap.parse_args()
    previo = lee(args.salida) or {"d": [], "s": {}}
    fechas, series = previo["d"], previo["s"]
    hoy = date.today()
    f = date.fromisoformat(fechas[-1]) + timedelta(days=args.paso) if fechas else INICIO
    nuevas = 0
    while f < hoy and (not args.max or nuevas < args.max):
        datos = dia(args.relicsrun, f)
        if datos:
            p = precios(datos)
            for nombre in series:
                series[nombre].append(p.pop(nombre, None))
            for nombre, v in p.items():
                series[nombre] = [None] * len(fechas) + [v]
            fechas.append(f.isoformat())
            nuevas += 1
            print(f"   {f} {len(series)} sets")
        f += timedelta(days=args.paso)
    with open(args.salida, "w", encoding="utf-8") as fh:
        json.dump({"updated": hoy.isoformat(), "d": fechas, "s": series}, fh, separators=(",", ":"), sort_keys=True)
    print(f"{nuevas} fechas nuevas, {len(fechas)} en total -> {args.salida}")


if __name__ == "__main__":
    main()
