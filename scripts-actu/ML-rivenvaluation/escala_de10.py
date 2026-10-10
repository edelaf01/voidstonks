import argparse
import glob
import json
import math
import os
import re
import sys
import urllib.request
from datetime import date, datetime, timedelta, timezone

AQUI = os.path.dirname(os.path.abspath(__file__))
ARMAS = os.path.join(AQUI, "..", "..", "deploy", "assets", "json", "cleaned_weapons.json")
SERIE = os.path.join(AQUI, "de_semanal.jsonl")
DESTINO = os.path.join(AQUI, "..", "..", "deploy", "assets", "ml", "de10.json")
DE_ENDPOINTS = [
    "https://www-static.warframe.com/repos/weeklyRivensPC.json",
    "https://www-static.warframe.com/repos/weeklyRivensPS4.json",
    "https://www-static.warframe.com/repos/weeklyRivensXB1.json",
    "https://www-static.warframe.com/repos/weeklyRivensNSW.json"
]
CABECERAS = {"accept": "application/json", "user-agent": "VoidStonks-Oraculo/1.0 (+https://voidstonks.com)"}
SEMANAS_GUARDADAS = 26
N_DE = 10
K_L = 3
K_S = 5
DESFASES_SEMILLA = (2, 3, 1, 4, 5)
ZAW_400 = {
    "kroostra", "kwath", "laka", "peye", "seekalla", "shtung", "jayap", "korb",
    "ruhang", "ruhang_ii", "ekwana_jai", "ekwana_ruhang", "ekwana_jai_ii",
    "ekwana_ruhang_ii", "ekwana_ii_jai", "ekwana_ii_ruhang", "jai", "jai_ii",
    "vargeet_jai", "vargeet_ruhang", "vargeet_jai_ii", "vargeet_ruhang_ii",
    "vargeet_ii_jai", "vargeet_ii_ruhang", "plague_akwin", "plague_bokwin"
}
ALIAS = {
    "dex_furis": "furis", "dex_afuris": "afuris", "pangolin": "pangolin_sword",
    "pangolin_prime": "pangolin_sword", "pangolin_sword": "pangolin_sword",
    "dual_decurions": "dual_decurion", "prisma_dual_decurions": "dual_decurion"
}
PREFIJOS = ["coda_", "kuva_", "tenet_", "prisma_", "dex_", "carmine_", "telos_", "synoid_", "secura_", "rakta_", "sancti_", "mara_", "vaykor_"]
SUFIJOS = ["_prime", "_vandal", "_wraith", "_coda"]


def reparar(texto):
    texto = texto.replace("'", '"')
    return re.sub(r'([{,]\s*)([a-zA-Z0-9_]+)(\s*:)', r'\1"\2"\3', texto)


def slug(nombre):
    s = nombre.lower().strip().replace("&", "and")
    s = re.sub(r'[\s\-]+', '_', s)
    s = re.sub(r'[^a-z0-9_]', '', s)
    return re.sub(r'_+', '_', s)


def familia(nombre, slugs):
    if not nombre:
        return ""
    s = slug(nombre)
    if s in ZAW_400:
        return ""
    if s in ALIAS:
        return ALIAS[s]
    base = s
    cambiado = True
    while cambiado:
        cambiado = False
        for pre in PREFIJOS:
            if base.startswith(pre):
                base = base[len(pre):]
                cambiado = True
        for suf in SUFIJOS:
            if base.endswith(suf):
                base = base[:-len(suf)]
                cambiado = True
    if base == s:
        return s
    return base if base in slugs else s


def es_mk1(nombre):
    n = nombre.lower()
    return "mk1" in n or "mk-1" in n


def armas_del_catalogo(ruta=ARMAS):
    with open(ruta, encoding="utf-8") as f:
        return [a["name"] for a in json.load(f) if not es_mk1(a["name"])]


def miembros_por_familia(armas):
    slugs = {slug(a) for a in armas}
    miembros = {}
    for a in armas:
        f = familia(a, slugs)
        if f:
            miembros.setdefault(f, []).append(a)
    return miembros


def combinar_plataformas(listas):
    datos = {}
    for lista in listas:
        for entrada in lista:
            arma = entrada.get("compatibility")
            if not arma or es_mk1(arma):
                continue
            tipo = "rerolled" if entrada.get("rerolled", False) else "unrolled"
            if arma not in datos:
                datos[arma] = {t: {"pops": [], "medians": [], "stddevs": [], "mins": [], "maxs": []} for t in ("rerolled", "unrolled")}
            d = datos[arma][tipo]
            d["pops"].append(entrada.get("pop", 0.0))
            d["medians"].append(entrada.get("median", 0))
            d["stddevs"].append(entrada.get("stddev", 0))
            d["mins"].append(entrada.get("min", 0))
            d["maxs"].append(entrada.get("max", 0))
    salida = {}
    for arma, mercados in datos.items():
        salida[arma] = {}
        for tipo in ("rerolled", "unrolled"):
            m = mercados[tipo]
            minimos = [x for x in m["mins"] if x > 0]
            if m["pops"]:
                salida[arma][tipo] = {
                    "pop": round(sum(m["pops"]) / len(m["pops"]), 3),
                    "median": round(sum(m["medians"]) / len(m["medians"])),
                    "stddev": round(sum(m["stddevs"]) / len(m["stddevs"]), 2),
                    "min_price": min(minimos) if minimos else 0,
                    "max_price": max(m["maxs"]) if m["maxs"] else 0
                }
    return salida


def fila(re_):
    re_ = re_ or {}
    med = re_.get("median") or 0
    if med <= 0:
        return None
    return [re_.get("pop") or 0, med, re_.get("stddev") or 0, re_.get("max_price") or 0]


def semana_desde_de(de, miembros):
    semana = {}
    for f in sorted(miembros):
        base = next((a for a in miembros[f] if a in de), None)
        if base is None:
            continue
        valores = fila(de[base].get("rerolled"))
        if valores:
            semana[f] = valores
    return semana


def semana_desde_instantanea(datos, slugs):
    semana = {}
    vistos = set()
    for arma, v in datos.items():
        if not isinstance(v, dict):
            continue
        f = familia(arma, slugs)
        if not f or f in vistos:
            continue
        vistos.add(f)
        valores = fila(v.get("de_rerolled"))
        if valores:
            semana[f] = valores
    return dict(sorted(semana.items()))


def martes(d):
    if isinstance(d, str):
        d = date.fromisoformat(d[:10])
    return (d - timedelta(days=(d.weekday() - 1) % 7)).isoformat()


def leer_serie(ruta):
    if not os.path.exists(ruta):
        return []
    with open(ruta, encoding="utf-8") as f:
        return [json.loads(linea) for linea in f if linea.strip()]


def guardar_serie(ruta, serie):
    serie = sorted(serie, key=lambda s: s["semana"])[-SEMANAS_GUARDADAS:]
    with open(ruta, "w", encoding="utf-8") as f:
        for s in serie:
            f.write(json.dumps(s, separators=(",", ":")) + "\n")
    return serie


def mediana(valores):
    v = sorted(valores)
    n = len(v)
    return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2


def tramo(pop10):
    return "<1.5" if pop10 < 1.5 else "1.5-3" if pop10 < 3 else ">=3"


def calcular_de10(serie):
    ventana = sorted(serie, key=lambda s: s["semana"])[-N_DE:]
    acumulado = {}
    for s in ventana:
        for f, (pop, med, sd, mx) in s["de"].items():
            if med <= 0:
                continue
            u = (1 + math.sqrt(1 + 4 * (sd / med) ** 2)) / 2
            a = acumulado.setdefault(f, {"W": 0.0, "wl": 0.0, "ws2": 0.0, "max": 0, "pop": 0.0, "nsem": 0})
            w = max(pop, 0.5)
            a["W"] += w
            a["wl"] += w * math.log(med)
            a["ws2"] += w * math.log(u)
            a["max"] = max(a["max"], mx)
            a["pop"] += pop
            a["nsem"] += 1
    crudo = {}
    for f, a in acumulado.items():
        pop10 = a["pop"] / N_DE
        crudo[f] = {"W": a["W"], "l": a["wl"] / a["W"], "s": math.sqrt(a["ws2"] / a["W"]), "max": a["max"], "pop10": pop10, "nsem": a["nsem"], "tramo": tramo(pop10)}
    tramos = sorted({c["tramo"] for c in crudo.values()})
    mu_l = {t: mediana([c["l"] for c in crudo.values() if c["tramo"] == t]) for t in tramos}
    mu_s = {t: mediana([c["s"] for c in crudo.values() if c["tramo"] == t]) for t in tramos}
    familias = {}
    for f in sorted(crudo):
        c = crudo[f]
        l10 = (c["W"] * c["l"] + K_L * mu_l[c["tramo"]]) / (c["W"] + K_L)
        s10 = (c["W"] * c["s"] + K_S * mu_s[c["tramo"]]) / (c["W"] + K_S)
        familias[f] = [round(l10, 3), round(s10, 3), int(c["max"]), round(c["pop10"], 2), c["nsem"]]
    return {
        "semana": ventana[-1]["semana"] if ventana else None,
        "mu": {"l": {t: round(v, 3) for t, v in mu_l.items()}, "s": {t: round(v, 3) for t, v in mu_s.items()}},
        "familias": familias
    }


def descargar(url):
    peticion = urllib.request.Request(url, headers=CABECERAS)
    try:
        with urllib.request.urlopen(peticion, timeout=30) as r:
            return json.loads(reparar(r.read().decode("utf-8")))
    except Exception as e:
        print(f"{url}: {e}")
        return []


def leer_de_local(ruta):
    with open(ruta, encoding="utf-8") as f:
        return json.loads(reparar(f.read()))


def sembrar(carpeta, slugs):
    fechas = {os.path.basename(r)[5:15]: r for r in glob.glob(os.path.join(carpeta, "data_*.json"))}
    serie = []
    for s in sorted({martes(f) for f in fechas}):
        inicio = date.fromisoformat(s)
        elegida = next((d for d in ((inicio + timedelta(days=o)).isoformat() for o in DESFASES_SEMILLA) if d in fechas), None)
        if elegida is None:
            continue
        with open(fechas[elegida], encoding="utf-8") as f:
            serie.append({"semana": s, "de": semana_desde_instantanea(json.load(f), slugs)})
        print(s, elegida, len(serie[-1]["de"]))
    return serie


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--de", nargs="*", default=None)
    p.add_argument("--semana", default=None)
    p.add_argument("--semilla", default=None)
    p.add_argument("--serie", default=SERIE)
    p.add_argument("--salida", default=DESTINO)
    p.add_argument("--armas", default=ARMAS)
    args = p.parse_args()

    armas = armas_del_catalogo(args.armas)
    if args.semilla:
        serie = sembrar(args.semilla, {slug(a) for a in armas})
    else:
        serie = leer_serie(args.serie)
        listas = [leer_de_local(r) for r in args.de] if args.de else [descargar(u) for u in DE_ENDPOINTS]
        if not any(listas):
            sys.exit("sin datos de DE")
        nueva = semana_desde_de(combinar_plataformas(listas), miembros_por_familia(armas))
        etiqueta = args.semana or martes(datetime.now(timezone.utc).date())
        previas = [s for s in serie if s["semana"] < etiqueta]
        if previas and previas[-1]["de"] == nueva:
            print(f"DE no ha cambiado desde {previas[-1]['semana']}: no se añade {etiqueta}")
            return
        serie = [s for s in serie if s["semana"] != etiqueta] + [{"semana": etiqueta, "de": nueva}]
        print(etiqueta, len(nueva))
    serie = guardar_serie(args.serie, serie)
    de10 = calcular_de10(serie)
    with open(args.salida, "w", encoding="utf-8") as f:
        json.dump(de10, f, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    print(de10["semana"], len(serie), len(de10["familias"]), de10["mu"])


if __name__ == "__main__":
    main()
