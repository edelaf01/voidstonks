import argparse
import json
import os
import re
import urllib.request
from datetime import date, datetime, timedelta, timezone

import relicsrun
from precios_prime import universo

RECIENTES = 3
VENTANAS = {"7": 7, "30": 30}
VOLUMEN_DIAS = 7
VAULT_DIAS = 14
WFCD = "https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/{nombre}.json"
WFCD_FICHEROS = ("Warframes", "Primary", "Secondary", "Melee", "Sentinels", "SentinelWeapons", "Archwing", "Arch-Gun", "Arch-Melee")
VAULT_TRADER = "https://api.warframestat.us/pc/vaultTrader/"
CABECERAS = {"Accept": "application/json", "User-Agent": "VoidStonks-Precios/1.0 (+https://voidstonks.com)"}


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


def volumen_de(filas, reliquia):
    fc = relicsrun.fila(relicsrun.variante(filas, "intact" if reliquia else None), "closed")
    return (fc.get("volume") or 0) if fc else 0


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
    necesarias.update(f for f in fechas if f > ultima - timedelta(days=VOLUMEN_DIAS))
    return necesarias


def calcula(carpeta, fechas, objetivos_, por_id, por_nombre):
    series = {slug: {"p": {}, "pm": {}} for slug in objetivos_}
    volumenes, dias_volumen = {}, 0
    desde_volumen = fechas[-1] - timedelta(days=VOLUMEN_DIAS)
    for fecha in sorted(fechas_necesarias(fechas)):
        dia = relicsrun.carga(carpeta, fecha)
        if dia is None:
            continue
        en_volumen = fecha > desde_volumen
        dias_volumen += en_volumen
        mapa = relicsrun.por_slug(dia, por_id, por_nombre)
        for slug, (reliquia, nombre) in objetivos_.items():
            filas = mapa.get(slug) or [f for f in (dia.get(nombre) or []) if isinstance(f, dict)]
            if filas:
                for clave, valor in precios_de(filas, reliquia).items():
                    series[slug][clave][fecha] = valor
                if en_volumen:
                    volumenes[slug] = volumenes.get(slug, 0) + volumen_de(filas, reliquia)
    t = {}
    for slug, claves in series.items():
        entrada = {}
        for clave in ("p", "pm"):
            serie = claves.get(clave, {})
            if serie:
                r = tendencia(serie, fechas)
                for k, v in r.items():
                    entrada[clave + k[1:]] = v
        if dias_volumen and slug in volumenes:
            entrada["v"] = round(volumenes[slug] / dias_volumen, 1)
        if entrada:
            t[slug] = entrada
    return t


def pide_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=CABECERAS), timeout=60) as r:
        return json.load(r)


def base_slug(nombre):
    return re.sub(r"[^a-z0-9]+", "_", nombre.lower()).strip("_")


def cambios_vault(slugs, hoy):
    items = []
    for nombre in WFCD_FICHEROS:
        try:
            items += [i for i in pide_json(WFCD.format(nombre=nombre)) if isinstance(i, dict) and i.get("name", "").endswith(" Prime")]
        except Exception as e:
            print(f"Sin {nombre} de WFCD: {type(e).__name__} {str(e)[:80]}")
    try:
        trader = pide_json(VAULT_TRADER)
    except Exception as e:
        print(f"Sin vaultTrader: {type(e).__name__} {str(e)[:80]}")
        trader = {}
    por_nombre = {i["name"]: i for i in items}
    grupos = {}
    for i in items:
        grupos.setdefault((i.get("releaseDate"), i.get("vaultDate")), []).append(i["name"])

    def del_pack(pack):
        nombres = re.sub(r"^M P V |\s+Prime\s+(Single|Dual)\s+Pack$", "", pack or "").split()
        res = set()
        for n in nombres:
            i = por_nombre.get(n + " Prime")
            if i:
                res.update(grupos.get((i.get("releaseDate"), i.get("vaultDate")), [i["name"]]))
        return res

    marcas = {}
    limite = (hoy - timedelta(days=VAULT_DIAS)).isoformat()
    for i in items:
        fecha = (i.get("vaultDate") or "")[:10]
        if i.get("vaulted") and limite <= fecha <= hoy.isoformat():
            marcas[i["name"]] = {"t": "vault", "d": fecha}
    expiry = trader.get("expiry") or ""
    actual = set()
    for e in trader.get("inventory") or []:
        if "Pack" in (e.get("item") or ""):
            actual |= del_pack(e.get("item"))
    inicio = expiry
    for e in sorted(trader.get("schedule") or [], key=lambda e: e.get("expiry") or ""):
        fin = e.get("expiry") or ""
        if fin <= expiry:
            continue
        nombres = del_pack(e.get("item"))
        if nombres:
            for n in nombres:
                marcas.setdefault(n, {"t": "resurgence_proxima", "d": inicio[:10]})
            break
        inicio = fin
    for n in actual:
        marcas[n] = {"t": "resurgence_actual", "d": (trader.get("activation") or "")[:10], "h": expiry[:10]}

    vc = {}
    for n, marca in marcas.items():
        base = base_slug(n)
        for slug in slugs:
            if slug == base or slug.startswith(base + "_"):
                vc[slug] = marca
    return vc


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
    objs = objetivos(a.catalogo, a.arcanos)
    t = calcula(a.relicsrun, fechas, objs, por_id, por_nombre)
    try:
        vc = cambios_vault([s for s, (reliquia, nombre) in objs.items() if not reliquia and not nombre], date.today())
    except Exception as e:
        print(f"Sin cambios de vault: {type(e).__name__} {str(e)[:80]}")
        vc = {}
    for slug, marca in vc.items():
        t.setdefault(slug, {})["vc"] = marca

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
