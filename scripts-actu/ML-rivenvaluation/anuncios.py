import csv
import json
import math
import os
import statistics
from collections import defaultdict
from datetime import date, timedelta

AQUI = os.path.dirname(os.path.abspath(__file__))
HIST = os.environ.get("VOIDSTONKS_HIST", "/var/home/ppsoy/Documentos/GitHub/Voidstonks-cron/historial_precios")
BANDAS = os.environ.get("VOIDSTONKS_BANDS", os.path.join(AQUI, "..", "..", "deploy", "assets", "ml", "price_bands.json"))
CORTE = os.environ.get("VOIDSTONKS_CORTE", "2026-09-01")
SALIDA = os.environ.get("VOIDSTONKS_OUT", os.path.join(AQUI, "generado"))

INICIO_MAGNITUDES = "2026-06-21"
INICIO_IDS = "2026-08-04"
CUANTILES = (0.25, 0.5, 0.8, 0.9)
MIN_VALORES = 20
EDAD_FRESCO = 14
EDAD_NUEVO = 3
CAMPOS_FIRMA = ("weapon", "stat_pos1", "stat_pos2", "stat_pos3", "stat_neg", "mag_pos1", "mag_pos2", "mag_pos3", "mag_neg")
TRAMOS_REL = ((0.5, "<0.5"), (0.8, "0.5-0.8"), (1.25, "0.8-1.25"), (2, "1.25-2"), (4, "2-4"), (math.inf, ">=4"))
TRAMOS_EDAD = ((7, "<7"), (31, "7-30"), (181, "30-180"), (366, "180-365"), (math.inf, ">=365"))


def leer_csv(nombre):
    with open(os.path.join(HIST, nombre), newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def precio(texto):
    try:
        valor = float(texto)
    except (TypeError, ValueError):
        return None
    return valor if valor > 0 else None


def magnitud(texto):
    try:
        return f"{float(texto):.1f}" if texto else ""
    except ValueError:
        return ""


def dias_entre(desde, hasta):
    return (date.fromisoformat(hasta) - date.fromisoformat(desde)).days


def tramo(valor, tramos):
    return next(nombre for limite, nombre in tramos if valor < limite)


def leer_filas():
    filas, leidas, sin_magnitudes = [], 0, 0
    with open(os.path.join(HIST, "dataset_raw_ml.csv"), newline="", encoding="utf-8") as f:
        for fila in csv.DictReader(f):
            leidas += 1
            fila["price"] = precio(fila["price"])
            if fila["price"] is None:
                continue
            if fila["fecha"] < INICIO_MAGNITUDES:
                sin_magnitudes += 1
                continue
            for campo in ("mag_pos1", "mag_pos2", "mag_pos3", "mag_neg"):
                fila[campo] = magnitud(fila[campo])
            filas.append(fila)
    return filas, leidas, sin_magnitudes


def agrupar_por_anuncio(filas):
    ids_por_firma, creado_de_id = defaultdict(set), {}
    for fila in filas:
        if fila["auction_id"]:
            ids_por_firma[tuple(fila[c] for c in CAMPOS_FIRMA)].add(fila["auction_id"])
            creado_de_id.setdefault(fila["auction_id"], fila["created"][:10])
    grupos = defaultdict(list)
    for fila in filas:
        firma = tuple(fila[c] for c in CAMPOS_FIRMA)
        ids = ids_por_firma.get(firma, ())
        if fila["auction_id"]:
            clave = fila["auction_id"]
        elif len(ids) == 1 and creado_de_id[next(iter(ids))] <= fila["fecha"]:
            clave = next(iter(ids))
        else:
            clave = "f:" + "|".join(firma)
        grupos[clave].append(fila)
    return grupos


def resumir_anuncio(clave, filas, desaparecidas):
    primera, ultima = filas[0], filas[-1]
    auction_id = next((f["auction_id"] for f in filas if f["auction_id"]), "")
    tiradas = next((f["tiradas"] for f in reversed(filas) if f["tiradas"]), "")
    creado = next((f["created"][:10] for f in filas if f["created"]), "")
    precios = [f["price"] for f in filas]
    desaparecida = desaparecidas.get(auction_id, {})
    return {
        "clave": clave,
        "auction_id": auction_id,
        **{c: primera[c] for c in CAMPOS_FIRMA},
        "tiradas": int(float(tiradas)) if tiradas else "",
        "created": creado,
        "primera_fecha": primera["fecha"],
        "ultima_fecha": ultima["fecha"],
        "dias_vistos": len({f["fecha"] for f in filas}),
        "precio_primero": precios[0],
        "precio_ultimo": precios[-1],
        "precio_min": min(precios),
        "cambios_precio": sum(1 for a, b in zip(precios, precios[1:]) if a != b),
        "inicio": creado or primera["fecha"],
        "edad_al_verla": dias_entre(creado, primera["fecha"]) if creado else "",
        "censurado": 1 if not creado and primera["fecha"] == INICIO_MAGNITUDES else 0,
        "desaparecida_fecha": desaparecida.get("fecha", ""),
        "desaparecida_precio": desaparecida.get("ultimo_precio", ""),
    }


def escribir_anuncios(anuncios):
    with open(os.path.join(SALIDA, "anuncios.csv"), "w", newline="", encoding="utf-8") as f:
        escritor = csv.DictWriter(f, fieldnames=list(anuncios[0]))
        escritor.writeheader()
        escritor.writerows(anuncios)


def arma_por_slug(anuncios, subastas):
    arma_de_id = {a["auction_id"]: a["weapon"] for a in anuncios if a["auction_id"]}
    pares = defaultdict(lambda: defaultdict(int))
    for s in subastas:
        if s["auction_id"] in arma_de_id:
            pares[s["slug"]][arma_de_id[s["auction_id"]]] += 1
    return {slug: max(armas, key=armas.get) for slug, armas in pares.items()}


def cuantil(ordenados, q):
    posicion = q * (len(ordenados) - 1)
    i = int(posicion)
    if i + 1 >= len(ordenados):
        return ordenados[-1]
    fraccion = posicion - i
    return ordenados[i] * (1 - fraccion) + ordenados[i + 1] * fraccion


def banda_por_arma(pares):
    por_arma = defaultdict(list)
    for arma, valor in pares:
        por_arma[arma].append(valor)
    return {arma: {q: cuantil(sorted(v), q) for q in CUANTILES} for arma, v in por_arma.items() if len(v) >= MIN_VALORES}


def banda_publicada(armas):
    with open(BANDAS, encoding="utf-8") as f:
        publicadas = json.load(f)
    sin_mayusculas = {k.lower(): v for k, v in publicadas.items()}
    bandas = {}
    for arma in armas:
        b = publicadas.get(arma) or sin_mayusculas.get(arma.lower())
        if b and len(b.get("q") or []) == 9:
            bandas[arma] = {q: cuantil(b["q"], round((q - 0.1) / 0.8, 9)) for q in CUANTILES}
    return bandas


def evaluar(conjunto, banda):
    if not conjunto:
        return {"n": 0, "armas": 0}
    pinball, dentro, por_debajo, sesgos = 0.0, 0, 0, []
    for arma, y in conjunto:
        pred = banda[arma]
        errores = [math.log(y) - math.log(pred[q]) for q in CUANTILES]
        pinball += sum(max(q * d, (q - 1) * d) for q, d in zip(CUANTILES, errores)) / len(CUANTILES)
        dentro += pred[0.25] <= y <= pred[0.9]
        por_debajo += y <= pred[0.5]
        sesgos.append(math.log(y / pred[0.5]))
    n = len(conjunto)
    return {"n": n, "armas": len({a for a, _ in conjunto}), "pinball_log": pinball / n, "cobertura_25_90": dentro / n,
            "bajo_p50": por_debajo / n, "sesgo_p50": math.exp(statistics.median(sesgos))}


def ritmo_de_salida(vivas, desaparecidas, arma_slug, truncados, mediana):
    fechas = sorted(d["fecha"] for d in desaparecidas.values())
    if not fechas:
        return {"por_rel": {}, "por_edad": {}}
    dias = [(date.fromisoformat(fechas[0]) + timedelta(days=i)).isoformat() for i in range(dias_entre(fechas[0], fechas[-1]) + 1)]
    universo = {v["auction_id"]: v for v in vivas}
    universo.update(desaparecidas)
    seguidas = []
    for s in universo.values():
        arma = arma_slug.get(s["slug"])
        if s["slug"] in truncados or arma not in mediana:
            continue
        seguidas.append({"rel": precio(s.get("ultimo_precio") or s.get("precio")) / mediana[arma],
                         "creada": s["created"][:10], "salida": s.get("fecha"), "vista": s["primera_vez"]})
    por_rel = defaultdict(lambda: {"expuestas": 0, "eventos": 0})
    por_edad = defaultdict(lambda: {"expuestas": 0, "eventos": 0})
    for dia in dias:
        for s in seguidas:
            if not s["vista"] or s["vista"] >= dia or (s["salida"] and s["salida"] < dia):
                continue
            edad = tramo(dias_entre(s["creada"], dia), TRAMOS_EDAD) if s["creada"] else "sin_fecha"
            for cubo in (por_rel[tramo(s["rel"], TRAMOS_REL)], por_edad[edad]):
                cubo["expuestas"] += 1
                cubo["eventos"] += s["salida"] == dia
    for tabla in (por_rel, por_edad):
        for cubo in tabla.values():
            cubo["tasa"] = cubo["eventos"] / cubo["expuestas"]
    return {"por_rel": dict(por_rel), "por_edad": dict(por_edad)}


def deriva_de_nuevos(anuncios):
    nuevos = [a for a in anuncios if a["created"] >= INICIO_IDS and a["edad_al_verla"] != "" and a["edad_al_verla"] <= EDAD_NUEVO]
    mediana = {arma: b[0.5] for arma, b in banda_por_arma((a["weapon"], a["precio_primero"]) for a in nuevos).items()}
    quincenas = defaultdict(list)
    for a in nuevos:
        if a["weapon"] in mediana:
            quincena = a["created"][:7] + ("a" if int(a["created"][8:10]) <= 15 else "b")
            quincenas[quincena].append(math.log(a["precio_primero"] / mediana[a["weapon"]]))
    return {q: {"n": len(v), "relativo": math.exp(statistics.median(v))} for q, v in sorted(quincenas.items())}


def imprimir(informe):
    for seccion in ("anuncios", "slugs", "reparto", "armas_por_base"):
        print(f"\n{seccion}")
        for k, v in informe[seccion].items():
            print(f"  {k:<28} {v}")
    for conjunto, bases in informe["evaluacion"].items():
        print(f"\nevaluación sobre {conjunto}")
        print(f"  {'base':<18} {'n':>7} {'armas':>6} {'pinball':>8} {'cob25-90':>9} {'bajo_p50':>9} {'sesgo_p50':>10}")
        for base, m in bases.items():
            if m["n"]:
                print(f"  {base:<18} {m['n']:>7} {m['armas']:>6} {m['pinball_log']:>8.4f} {m['cobertura_25_90']:>9.4f} {m['bajo_p50']:>9.4f} {m['sesgo_p50']:>10.4f}")
    for clave, titulo in (("por_rel", "precio / mediana del arma"), ("por_edad", "edad del anuncio (días)")):
        print(f"\nritmo de salida por {titulo}")
        print(f"  {'tramo':<12} {'expuestas':>10} {'eventos':>8} {'tasa/día':>9}")
        for t, c in informe["ritmo"][clave].items():
            print(f"  {t:<12} {c['expuestas']:>10} {c['eventos']:>8} {c['tasa']:>9.4f}")
    print(f"\nanuncios nuevos (vistos <= {EDAD_NUEVO} días tras crearse) respecto a la mediana del arma")
    for q, d in informe["deriva"].items():
        print(f"  {q}: n={d['n']:>6} {d['relativo']:.2f}")


def main():
    os.makedirs(SALIDA, exist_ok=True)
    desaparecidas = {d["auction_id"]: d for d in leer_csv("subastas_desaparecidas.csv") if precio(d["ultimo_precio"])}
    vivas = [v for v in leer_csv("subastas_vivas.csv") if precio(v["precio"])]
    truncados = {c["slug"] for c in leer_csv("slugs_consultados.csv") if c["truncado"] == "1"}

    filas, leidas, sin_magnitudes = leer_filas()
    anuncios = [resumir_anuncio(clave, grupo, desaparecidas) for clave, grupo in agrupar_por_anuncio(filas).items()]
    escribir_anuncios(anuncios)

    arma_slug = arma_por_slug(anuncios, vivas + list(desaparecidas.values()))
    entreno = [a for a in anuncios if a["primera_fecha"] < CORTE]
    prueba = [a for a in anuncios if a["inicio"] >= CORTE and a["primera_fecha"] >= CORTE]
    filas_entreno = [f for f in filas if f["fecha"] < CORTE]

    bases = {
        "price_bands": banda_publicada({a["weapon"] for a in anuncios}),
        "filas": banda_por_arma((f["weapon"], f["price"]) for f in filas_entreno),
        "anuncios": banda_por_arma((a["weapon"], a["precio_primero"]) for a in entreno),
        "anuncios_frescos": banda_por_arma((a["weapon"], a["precio_primero"]) for a in entreno
                                           if not a["censurado"] and (a["edad_al_verla"] == "" or a["edad_al_verla"] <= EDAD_FRESCO)),
    }
    comunes = set.intersection(*(set(b) for b in bases.values()))
    conjuntos = {
        "nuevas": [(a["weapon"], a["precio_primero"]) for a in prueba],
        "desaparecidas": [(arma_slug[d["slug"]], precio(d["ultimo_precio"])) for d in desaparecidas.values() if d["slug"] in arma_slug],
        "vivas_no_truncadas": [(arma_slug[v["slug"]], precio(v["precio"])) for v in vivas if v["slug"] in arma_slug and v["slug"] not in truncados],
    }

    informe = {
        "anuncios": {"filas_leidas": leidas, "filas_sin_magnitudes": sin_magnitudes, "anuncios": len(anuncios),
                     "con_auction_id": sum(1 for a in anuncios if a["auction_id"]),
                     "sin_id": sum(1 for a in anuncios if a["clave"].startswith("f:"))},
        "slugs": {"mapeados": len(arma_slug), "sin_mapear": len({s["slug"] for s in vivas + list(desaparecidas.values())} - set(arma_slug)), "truncados": len(truncados)},
        "reparto": {"entreno": len(entreno), "prueba": len(prueba), "excluidos": len(anuncios) - len(entreno) - len(prueba),
                    "filas_entreno": len(filas_entreno)},
        "armas_por_base": {nombre: len(b) for nombre, b in bases.items()},
        "evaluacion": {nombre: {base: evaluar([(a, y) for a, y in c if a in comunes], banda) for base, banda in bases.items()}
                       for nombre, c in conjuntos.items()},
        "ritmo": ritmo_de_salida(vivas, desaparecidas, arma_slug, truncados, {a: b[0.5] for a, b in bases["anuncios"].items()}),
        "deriva": deriva_de_nuevos(anuncios),
    }
    with open(os.path.join(SALIDA, "informe_anuncios.json"), "w", encoding="utf-8") as f:
        json.dump(informe, f, indent=2, ensure_ascii=False)
    imprimir(informe)


if __name__ == "__main__":
    main()
