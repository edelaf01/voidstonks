import argparse
import json
import os
import re
import sys
import time
import urllib.request

import relicsrun

RELIQUIAS = "https://raw.githubusercontent.com/WFCD/warframe-drop-data/gh-pages/data/relics.json"
CABECERAS = {"Accept": "application/json", "User-Agent": relicsrun.AGENTE}
SET = "https://api.warframe.market/v2/item/{slug}/set"
PAUSA_SET_S = 0.4


def verdad(v):
    if v is None or v is False:
        return False
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return v != 0
    if isinstance(v, str):
        return v != ""
    return True


def enteros(v):
    if isinstance(v, float) and v.is_integer() and abs(v) < 2 ** 53:
        return int(v)
    if isinstance(v, list):
        return [enteros(x) for x in v]
    if isinstance(v, dict):
        return {k: enteros(x) for k, x in v.items()}
    return v


def i18n_en(it):
    i18n = it.get("i18n") if isinstance(it, dict) else None
    if not isinstance(i18n, dict):
        return None
    en = i18n.get("en")
    if verdad(en):
        return en
    return next(iter(i18n.values()), None)


def wfm_items(catalogo):
    por_slug = {}
    por_id = {}
    for it in catalogo:
        if not isinstance(it, dict) or not verdad(it.get("slug")) or not verdad(it.get("id")):
            continue
        entrada = {"id": it["id"]}
        i18n = i18n_en(it)
        if isinstance(i18n, dict):
            if verdad(i18n.get("name")):
                entrada["name"] = i18n["name"]
            if verdad(i18n.get("thumb")):
                entrada["thumb"] = i18n["thumb"]
        if "maxRank" in it:
            entrada["maxRank"] = it["maxRank"]
        if verdad(it.get("subtypes")):
            entrada["subtypes"] = it["subtypes"]
        if verdad(it.get("bulkTradable")):
            entrada["bulkTradable"] = True
        for campo in ("maxAmberStars", "maxCyanStars", "ducats"):
            if campo in it:
                entrada[campo] = it[campo]
        if verdad(it.get("vaulted")):
            entrada["vaulted"] = True
        por_slug[it["slug"]] = entrada
        inverso = {"slug": it["slug"]}
        if "name" in entrada:
            inverso["name"] = entrada["name"]
        if "thumb" in entrada:
            inverso["thumb"] = entrada["thumb"]
        por_id[it["id"]] = inverso
    return {"bySlug": por_slug, "byId": por_id}


def nombre_en(it):
    i18n = i18n_en(it)
    nombre = i18n.get("name") if isinstance(i18n, dict) else None
    return nombre if isinstance(nombre, str) and nombre else None


def prime_items_list(catalogo, sets=None):
    nombres = set()
    for it in catalogo:
        nombre = nombre_en(it)
        if nombre and "Prime" in nombre and not nombre.endswith(" Set"):
            nombres.add(nombre)
    salida = {"items": sorted(nombres, key=lambda s: s.encode("utf-16-be"))}
    if sets:
        salida["sets"] = sets
    return salida


def sets_prime(catalogo):
    nombres = {it["id"]: nombre_en(it) for it in catalogo if isinstance(it, dict) and verdad(it.get("id"))}
    sets = {}
    for it in catalogo:
        nombre = nombre_en(it) if isinstance(it, dict) else None
        if not nombre or not nombre.endswith(" Set") or not re.search(r" (Prime|Vandal|Wraith) ", nombre) or not verdad(it.get("slug")):
            continue
        estado, cuerpo = relicsrun.obtiene(SET.format(slug=it["slug"]))
        time.sleep(PAUSA_SET_S)
        if estado != "ok":
            continue
        try:
            piezas = json.loads(cuerpo)["data"]["items"]
        except (ValueError, KeyError, TypeError):
            continue
        partes = {nombres.get(p.get("id")) for p in piezas if isinstance(p, dict) and not p.get("setRoot")}
        partes.discard(None)
        if partes:
            sets[nombre[:-4]] = sorted(partes)
    return sets


def relics_opt(datos):
    reliquias = []
    for r in (datos or {}).get("relics") or []:
        if isinstance(r, dict) and r.get("state") == "Intact":
            fila = {"tier": r.get("tier"), "relicName": r.get("relicName"), "state": "Intact", "rewards": r.get("rewards")}
            reliquias.append({k: v for k, v in fila.items() if k == "state" or k in r})
    return {"relics": reliquias}


def escribe(ruta, datos):
    with open(ruta, "w", encoding="utf-8") as f:
        json.dump(enteros(datos), f, ensure_ascii=False, separators=(",", ":"))
    print(f"{ruta}: {os.path.getsize(ruta)} bytes")


def main():
    args = argparse.ArgumentParser()
    args.add_argument("--catalogo")
    args.add_argument("--carpeta", default=".")
    a = args.parse_args()

    cat = relicsrun.catalogo(a.catalogo)
    datos = cat.get("data") if isinstance(cat, dict) else None
    if not isinstance(datos, list) or len(datos) < 1000:
        print("catálogo de WFM vacío o incompleto")
        sys.exit(1)
    os.makedirs(a.carpeta, exist_ok=True)
    escribe(os.path.join(a.carpeta, "wfm_items.json"), wfm_items(datos))
    escribe(os.path.join(a.carpeta, "prime_items_list.json"), prime_items_list(datos, sets_prime(datos)))

    with urllib.request.urlopen(urllib.request.Request(RELIQUIAS, headers=CABECERAS), timeout=60) as r:
        reliquias = relics_opt(json.load(r))
    if len(reliquias["relics"]) < 100:
        print("relics.json sin reliquias intactas")
        sys.exit(1)
    escribe(os.path.join(a.carpeta, "relics_opt.json"), reliquias)


if __name__ == "__main__":
    main()
