import argparse
import json
import statistics
from datetime import datetime, timezone

import relicsrun

METRICAS = ("venta_min", "venta_mediana", "cerrada_mediana")
PEORES = 20
TOLERANCIA = 10


def lee_precios(ruta):
    if not ruta:
        return {}
    try:
        with open(ruta, encoding="utf-8") as f:
            datos = json.load(f)
        p = datos.get("p", {}) if isinstance(datos, dict) else {}
        return p if isinstance(p, dict) else {}
    except Exception:
        return {}


def valores_rr(filas):
    res = {}
    fs = relicsrun.fila(filas, "sell")
    if fs:
        vmin = fs.get("min_price")
        if vmin is not None and vmin > 0:
            res["venta_min"] = vmin
        vmed = fs.get("median")
        if vmed is not None and vmed > 0:
            res["venta_mediana"] = vmed
    fc = relicsrun.fila(filas, "closed")
    if fc and (fc.get("volume") or 0) > 0:
        cmed = fc.get("median")
        if cmed is not None and cmed > 0:
            res["cerrada_mediana"] = cmed
    return res


def diferencia(rr, top):
    return round((rr - top) / top * 100, 1)


def compara(precios, mapa, reliquia):
    res = {}
    for slug, top in precios.items():
        if not (isinstance(top, (int, float)) and top > 0 and slug in mapa):
            continue
        filas = relicsrun.variante(mapa[slug], "intact") if reliquia else relicsrun.variante(mapa[slug])
        vrr = valores_rr(filas)
        if not vrr:
            continue
        dif = {m: diferencia(valor, top) for m, valor in vrr.items()}
        res[slug] = {
            "grupo": "reliquia" if reliquia else "prime",
            "top": top,
            **vrr,
            "dif": dif,
        }
    return res


def estadistica(entradas, metrica):
    filtrados = [(abs(e["dif"][metrica]), slug, e["top"], e[metrica], e["dif"][metrica])
                 for slug, e in entradas.items() if metrica in e["dif"]]
    n = len(filtrados)
    if n == 0:
        return {"n": 0}
    abs_difs = [f[0] for f in filtrados]
    mediana_abs = round(statistics.median(abs_difs), 1)
    dentro_10 = round(sum(1 for a in abs_difs if a <= TOLERANCIA) / n, 3)
    ordenados = sorted(filtrados, key=lambda x: (-x[0], x[1]))[:PEORES]
    peores = [{"slug": f[1], "top": f[2], "rr": f[3], "dif": f[4]} for f in ordenados]
    return {
        "n": n,
        "mediana_abs": mediana_abs,
        "dentro_10": dentro_10,
        "peores": peores,
    }


def metricas(s):
    res = {}
    for grupo in ("todos", "prime", "reliquia"):
        if grupo == "todos":
            entradas = s
        else:
            entradas = {slug: e for slug, e in s.items() if e.get("grupo") == grupo}
        if not entradas:
            continue
        res[grupo] = {m: estadistica(entradas, m) for m in METRICAS}
    return res


def resumen_md(dia, metricas_):
    encabezado = f"## /top vs relics.run (día {dia})"
    hay_datos = any(e.get("n", 0) > 0 for g in metricas_.values() for e in g.values())
    if not hay_datos:
        return f"{encabezado}\n\nSin datos para comparar.\n"

    lineas = [encabezado, ""]
    lineas.append("| grupo | métrica | n | mediana de la dif. absoluta | dentro de ±10 % |")
    lineas.append("| --- | --- | ---: | ---: | ---: |")
    for grupo, mets in metricas_.items():
        for metrica, e in mets.items():
            if e.get("n", 0) > 0:
                lineas.append(f"| {grupo} | {metrica} | {e['n']} | {e['mediana_abs']:.1f} % | {e['dentro_10'] * 100:.1f} % |")

    todos = metricas_.get("todos", {})
    for metrica in METRICAS:
        e = todos.get(metrica, {})
        peores = e.get("peores", [])
        if e.get("n", 0) > 0 and peores:
            lineas.append("")
            lineas.append(f"### Peores: {metrica}")
            lineas.append("")
            lineas.append("| slug | /top | relics.run | dif % |")
            lineas.append("| --- | ---: | ---: | ---: |")
            for p in peores:
                lineas.append(f"| {p['slug']} | {p['top']} | {p['rr']} | {p['dif']:.1f} % |")
    lineas.append("")
    return "\n".join(lineas)


def escribe(ruta, texto):
    with open(ruta, "w", encoding="utf-8") as f:
        f.write(texto)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--relicsrun", required=True)
    parser.add_argument("--catalogo", required=True)
    parser.add_argument("--prime")
    parser.add_argument("--reliquias")
    parser.add_argument("--salida", required=True)
    parser.add_argument("--resumen", required=True)
    a = parser.parse_args()

    fechas = relicsrun.fechas_guardadas(a.relicsrun)
    dia = fechas[-1] if fechas else None
    datos_dia = relicsrun.carga(a.relicsrun, dia) if dia else None
    if datos_dia is None:
        escribe(a.resumen, resumen_md("-", {}))
        print("Sin días de relics.run: no hay comparación")
        return

    por_id, por_nombre = relicsrun.indice(relicsrun.catalogo(a.catalogo))
    mapa = relicsrun.por_slug(datos_dia, por_id, por_nombre)
    s = {**compara(lee_precios(a.prime), mapa, False), **compara(lee_precios(a.reliquias), mapa, True)}
    m = metricas(s)

    salida = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "dia": dia.isoformat(),
        "metricas": m,
        "s": s,
    }
    escribe(a.salida, json.dumps(salida, ensure_ascii=False, separators=(",", ":"), sort_keys=True))
    escribe(a.resumen, resumen_md(dia.isoformat(), m))
    print(f"Escrito {a.salida}: {len(s)} objetos comparados con relics.run del {dia}")


if __name__ == "__main__":
    main()
