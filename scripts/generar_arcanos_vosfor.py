#!/usr/bin/env python3
"""generates arcanes_vosfor.json for the Vosfor Calculator from official public export"""

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

# manual extras for arcanes where WFM slug uses hyphens instead of underscores
MANUAL_EXTRAS = [
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
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    s = re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")
    return s


def pack_id(store_item):
    raw = store_item.rsplit("EntratiLabsArcanePack", 1)[-1]
    return re.sub(r"(?<!^)(?=[A-Z])", "_", raw).lower()


def main():
    vendors = fetch("ExportVendors.json")
    packs_export = fetch("ExportBoosterPacks.json")
    arcanes_export = fetch("ExportArcanes.json")
    dict_en = fetch("dict.en.json")
    dict_es = fetch("dict.es.json")
    syndicates = fetch("ExportSyndicates.json")

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

    wfcd = fetch(WFCD_ARCANES)
    tradable_names = {a["name"] for a in wfcd if a.get("tradable") and a.get("introduced")}
    others = []
    for key, a in arcanes_export.items():
        name_en = dict_en.get(a["name"], a["name"])
        slug = slugify(name_en)
        if slug in arcanes:
            continue
        if name_en in MANUAL_NAMES:
            continue
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
    for m in MANUAL_EXTRAS:
        arcanes.setdefault(m["slug"], {
            "en": m["en"], "es": m["es"], "rarity": m["rarity"],
            "vosfor": m["vosfor"], "maxRank": m["maxRank"],
        })
        if m["slug"] not in others:
            others.append(m["slug"])
    others.sort()

    tradables = {slugify(dict_en.get(a["name"], a["name"])): [dict_en.get(a["name"], a["name"]), dict_es.get(a["name"], a["name"]), a.get("fusionLimit", 5)]
                 for a in arcanes_export.values() if dict_en.get(a["name"], a["name"]) in tradable_names}
    for m in MANUAL_EXTRAS:
        tradables.setdefault(m["slug"], [m["en"], m["es"], m["maxRank"]])

    slug_manual = {m["en"]: m["slug"] for m in MANUAL_EXTRAS}
    sindicatos = []
    for key, syn in sorted(syndicates.items()):
        ofertas = []
        for fav in syn.get("favours", []):
            a = arcanes_export.get(fav.get("storeItem", "").replace("/StoreItems", ""))
            if not a or not fav.get("standingCost"):
                continue
            name_en = dict_en.get(a["name"], a["name"])
            slug = slug_manual.get(name_en, slugify(name_en))
            if slug in tradables:
                ofertas.append({"slug": slug, "standing": fav["standingCost"], "rango": fav.get("requiredLevel", 0)})
        if ofertas:
            sindicatos.append({
                "id": key.rsplit("/", 1)[-1],
                "en": dict_en.get(syn.get("name", ""), key),
                "es": dict_es.get(syn.get("name", ""), dict_en.get(syn.get("name", ""), key)),
                "ofertas": sorted(ofertas, key=lambda o: o["slug"]),
            })

    out = {
        "updated": date.today().isoformat(),
        "source": "warframe-public-export-plus (browse.wf)",
        "packs": packs,
        "others": others,
        "arcanes": arcanes,
        "tradables": dict(sorted(tradables.items())),
        "sindicatos": sindicatos,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"OK -> {OUT}")
    print(f"    {len(packs)} colecciones, {len(arcanes)} arcanos ({len(others)} fuera de packs)")
    for pk in packs:
        print(f"    - {pk['id']}: {len(pk['items'])} arcanos, {pk['cost']['vosfor']} vosfor")
    for sy in sindicatos:
        print(f"    - {sy['en']}: {len(sy['ofertas'])} arcanos por reputación")


if __name__ == "__main__":
    main()
