#!/usr/bin/env python3
"""Genera deploy/assets/json/arcanes_vosfor.json para la Calculadora de Vosfor.

Fuentes (warframe-public-export-plus, espejo de los datos oficiales del juego):
  - ExportVendors.json      -> coste de los packs de Loid (Vosfor + creditos)
  - ExportBoosterPacks.json -> contenido de cada coleccion + pesos de rareza por tirada
  - ExportArcanes.json      -> distillPointValue (Vosfor al disolver), rareza, rango max
  - dict.en.json / dict.es.json -> nombres EN/ES

Re-ejecutar cuando DE anada colecciones nuevas: el script descubre los packs
automaticamente (todo lo que empiece por EntratiLabsArcanePack).

Uso:  python3 scripts/generar_arcanos_vosfor.py (también lo llama scripts/actualizar_contenido.py)
"""

import json
import re
import unicodedata
import urllib.request
from datetime import date
from pathlib import Path

BASE = "https://browse.wf/warframe-public-export-plus"
WFCD_ARCANES = "https://cdn.jsdelivr.net/gh/WFCD/warframe-items@master/data/json/Arcanes.json"
OUT = Path(__file__).resolve().parent.parent / "deploy/assets/json/arcanes_vosfor.json"

ARCANE_SHOP_MANIFEST = "/Lotus/Types/Game/VendorManifests/EntratiLabs/EntratiLabsArcaneShopManifest"
VOSFOR_ITEM = "/Lotus/Types/Items/MiscItems/DistillPoints"

# Arcanos comerciables que se inyectan a mano porque el flujo automatico no los captaria bien:
#   - Aun NO estan en WFCD (el cruce de tradables los omitiria), y/o
#   - su url_name de warframe.market usa GUIONES, no guiones bajos, asi que slugify() daria
#     un slug que no casa con WFM (precios rotos).
# El "slug" debe ser el url_name EXACTO de warframe.market (verificar en la API v2 /items).
# Quitar una entrada cuando WFCD la incluya Y su slug coincida con slugify(name_en).
MANUAL_EXTRAS = [
    # Artefacto Tektolisto (Marie Leroux, La Cathedrale) — quest The Old Peace
    {"slug": "zid-an-asheir",  "en": "Zid-an Asheir",  "es": "Zid-an Asheir",  "rarity": "COMMON", "vosfor": 24, "maxRank": 5},
    {"slug": "zid-an-haras",   "en": "Zid-an Haras",   "es": "Zid-an Haras",   "rarity": "COMMON", "vosfor": 24, "maxRank": 5},
    {"slug": "zid-an-sek-eel", "en": "Zid-an Sek-eel", "es": "Zid-an Sek-eel", "rarity": "COMMON", "vosfor": 24, "maxRank": 5},
    {"slug": "zid-an-uskos",   "en": "Zid-an Uskos",   "es": "Zid-an Uskos",   "rarity": "COMMON", "vosfor": 24, "maxRank": 5},
    {"slug": "zid-an-osbok",   "en": "Zid-an Osbok",   "es": "Zid-an Osbok",   "rarity": "COMMON", "vosfor": 24, "maxRank": 5},
]
MANUAL_NAMES = {m["en"] for m in MANUAL_EXTRAS}


def fetch(name, base=BASE):
    url = name if name.startswith("http") else f"{base}/{name}"
    req = urllib.request.Request(url, headers={"User-Agent": "VoidStonks-DataGen/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def slugify(name):
    """Nombre EN -> slug de warframe.market (arcane_energize, primary_merciless...)."""
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")
    return s


def pack_id(store_item):
    """/Lotus/Types/BoosterPacks/EntratiLabsArcanePackDuviri -> duviri (id estable)."""
    raw = store_item.rsplit("EntratiLabsArcanePack", 1)[-1]
    return re.sub(r"(?<!^)(?=[A-Z])", "_", raw).lower()


def main():
    vendors = fetch("ExportVendors.json")
    packs_export = fetch("ExportBoosterPacks.json")
    arcanes_export = fetch("ExportArcanes.json")
    dict_en = fetch("dict.en.json")
    dict_es = fetch("dict.es.json")

    # Coste de los packs segun el manifiesto de la tienda de Loid
    costs = {}
    shop = vendors.get(ARCANE_SHOP_MANIFEST, {})
    for it in shop.get("items", []):
        store = it.get("storeItem", "")
        if "EntratiLabsArcanePack" not in store:
            continue
        vosfor = next((p["ItemCount"] for p in it.get("itemPrices", []) if p["ItemType"] == VOSFOR_ITEM), None)
        key = store.replace("/StoreItems", "")
        costs[key] = {"vosfor": vosfor, "credits": it.get("credits", 0)}

    packs = []
    arcanes = {}
    for key, p in sorted(packs_export.items()):
        if "EntratiLabsArcanePack" not in key:
            continue
        items = []
        for comp in p.get("components", []):
            a = arcanes_export.get(comp["Item"])
            if not a:
                print(f"[!] {comp['Item']} no existe en ExportArcanes, omitido")
                continue
            name_en = dict_en.get(a["name"], a["name"])
            slug = slugify(name_en)
            items.append(slug)
            arcanes.setdefault(slug, {
                "en": name_en,
                "es": dict_es.get(a["name"], name_en),
                "rarity": a.get("rarity", comp.get("Rarity", "RARE")),
                "vosfor": a.get("distillPointValue", 0),
                "maxRank": a.get("fusionLimit", 5),
            })

        cost = costs.get(key, {"vosfor": 200, "credits": 50000})
        packs.append({
            "id": pack_id(key),
            "en": dict_en.get(p["name"], key),
            "es": dict_es.get(p["name"], key),
            "cost": cost,
            "rolls": p.get("rarityWeightsPerRoll", []),
            "items": sorted(items),
        })

    # Resto de arcanos comerciables que NO estan en ningun pack de Loid (tambien se
    # pueden vender o disolver). Cruzamos con WFCD para incluir solo los tradables
    # reales de warframe.market y no quemar llamadas del worker en slugs invendibles.
    wfcd = fetch(WFCD_ARCANES)
    tradable_names = {a["name"] for a in wfcd if a.get("tradable")}
    others = []
    for key, a in arcanes_export.items():
        name_en = dict_en.get(a["name"], a["name"])
        slug = slugify(name_en)
        if slug in arcanes:
            continue
        if name_en in MANUAL_NAMES:
            continue  # lo inyecta MANUAL_EXTRAS con el slug correcto de WFM
        if name_en not in tradable_names:
            continue
        if a.get("distillPointValue", 0) <= 0:
            continue
        others.append(slug)
        arcanes[slug] = {
            "en": name_en,
            "es": dict_es.get(a["name"], name_en),
            "rarity": a.get("rarity", "RARE"),
            "vosfor": a.get("distillPointValue", 0),
            "maxRank": a.get("fusionLimit", 5),
        }
    # Inyectar los arcanos manuales (con su slug exacto de WFM) en arcanes + others.
    for m in MANUAL_EXTRAS:
        arcanes.setdefault(m["slug"], {
            "en": m["en"], "es": m["es"], "rarity": m["rarity"],
            "vosfor": m["vosfor"], "maxRank": m["maxRank"],
        })
        if m["slug"] not in others:
            others.append(m["slug"])
    others.sort()

    out = {
        "updated": date.today().isoformat(),
        "source": "warframe-public-export-plus (browse.wf)",
        "packs": packs,
        "others": others,
        "arcanes": arcanes,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"OK -> {OUT}")
    print(f"    {len(packs)} colecciones, {len(arcanes)} arcanos ({len(others)} fuera de packs)")
    for pk in packs:
        print(f"    - {pk['id']}: {len(pk['items'])} arcanos, {pk['cost']['vosfor']} vosfor")


if __name__ == "__main__":
    main()
