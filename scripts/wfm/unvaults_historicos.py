import argparse
import datetime
import json
import re
import urllib.parse
import urllib.request

from eventos_prime import CICLO, SALIDA, de_traders, dia, une
from tendencias import CABECERAS

API = "https://wiki.warframe.com/api.php?action=parse&prop=wikitext&format=json&formatversion=2&page={}"
FECHA = re.compile(r"\d{4}-\d{2}-\d{2}")
LARGA = re.compile(r"([A-Z][a-z]+ \d{1,2}, \d{4}),? to ([A-Z][a-z]+ \d{1,2}, \d{4})")
FILA = re.compile(r'^\|- data-rowid="[^"]*"\n\|\{\{\w+\|([^}|]+)\}\}\n[^\n]*\n([^\n]*)', re.M)


def wikitexto(pagina):
    req = urllib.request.Request(API.format(urllib.parse.quote(pagina)), headers=CABECERAS)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)["parse"]["wikitext"]


def iso(texto):
    return datetime.datetime.strptime(texto, "%B %d, %Y").date().isoformat()


def inicios(texto):
    res = {}
    for nombre, celda in FILA.findall(texto):
        res.setdefault(nombre.strip(), set()).update(FECHA.findall(celda))
    return res


def archivados(texto):
    return {iso(a): iso(b) for a, b in LARGA.findall(texto)}


def agenda_de():
    vault, _ = de_traders()
    fines = sorted(e["expiry"][:10] for e in vault.get("schedule") or [])
    return fines


def fin_de(ini, fines, viejos):
    d = dia(ini)
    for f in fines:
        if f > ini and (dia(f) - d).days <= CICLO + 7:
            return f, True
    if ini in viejos:
        return viejos[ini], True
    return (d + datetime.timedelta(days=CICLO)).isoformat(), False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--salida", default=SALIDA)
    args = ap.parse_args()
    with open(args.salida, encoding="utf-8") as f:
        datos = json.load(f)
    primes = {k for k in datos if not k.startswith("_")}
    fines = agenda_de()
    viejos = archivados(wikitexto("Prime_Vault/Archived_Unvaultings"))
    starts = inicios(wikitexto("Prime_Vault"))
    per = {k: [list(p) for p in v] for k, v in (datos.get("_unvaults") or {}).items()}
    exactos = estimados = 0
    for nombre, fechas in starts.items():
        if nombre not in primes:
            continue
        for ini in fechas:
            fin, exacto = fin_de(ini, fines, viejos)
            exactos += exacto
            estimados += not exacto
            per.setdefault(nombre, []).append([ini, fin])
    datos["_unvaults"] = {k: une(v) for k, v in sorted(per.items()) if une(v)}
    with open(args.salida, "w", encoding="utf-8") as f:
        json.dump(datos, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    print(f"{len(datos['_unvaults'])} primes, {exactos} periodos con fin real, {estimados} con fin estimado (+{CICLO} d)")
    for n in ("Chroma Prime", "Nidus Prime", "Strun Prime"):
        print(n, datos["_unvaults"].get(n))


if __name__ == "__main__":
    main()
