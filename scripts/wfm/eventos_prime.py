import argparse
import datetime
import json
import lzma
import os
import re
import statistics
import sys
import urllib.parse
import urllib.request

from tendencias import CABECERAS, VAULT_TRADER, WFCD, WFCD_FICHEROS, pide_json

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SALIDA = os.path.join(RAIZ, "deploy", "assets", "json", "eventos_prime.json")
CICLO = 28


def eventos(items):
    res = {}
    for it in items:
        nombre = it.get("name") or ""
        if not it.get("isPrime") or not nombre.endswith(" Prime"):
            continue
        ev = {}
        if it.get("releaseDate"):
            ev["pa"] = it["releaseDate"][:10]
        if it.get("vaulted") and it.get("vaultDate"):
            ev["v"] = it["vaultDate"][:10]
        if ev:
            res[nombre] = ev
    return res


def del_pack(pack):
    return [n + " Prime" for n in re.sub(r"^M P V |\s+Prime\s+(Single|Dual)\s+Pack$", "", pack or "").split()]


def dia(s):
    return datetime.date.fromisoformat(s[:10])


def une(periodos):
    res = []
    for ini, fin in sorted([p[0][:10], p[1][:10]] for p in periodos if p and p[0] and p[1] and p[0][:10] <= p[1][:10]):
        if res and ini <= res[-1][1]:
            res[-1][1] = max(res[-1][1], fin)
        else:
            res.append([ini, fin])
    return res


def varzia(trader):
    fin = trader.get("expiry") or ""
    if not fin:
        return None
    agenda = sorted((e for e in trader.get("schedule") or [] if e.get("expiry")), key=lambda e: e["expiry"])
    actual = next((e for e in agenda if e["expiry"] == fin), None)
    res = {"fin": fin, "n": del_pack(actual["item"]) if actual else []}
    sig = next((e for e in agenda if e["expiry"] > fin), None)
    if sig:
        fin_sig = sig["expiry"]
        if (dia(fin_sig) - dia(fin)).days > CICLO + 7:
            fin_sig = (dia(fin) + datetime.timedelta(days=CICLO)).isoformat() + fin[10:]
        res["sig"] = {"ini": fin, "fin": fin_sig, "n": del_pack(sig.get("item"))}
    return res


VOID_TRADER = "https://api.warframestat.us/pc/voidTrader?language=en"
ITEMS = "https://api.warframestat.us/items/search/{}?by=uniqueName&only=uniqueName,name&language=en"
BUSCA = re.compile(r"^/Lotus/(StoreItems/)?(Weapons|Powersuits|Upgrades/Mods)/|/T[1-4]VoidProjection.+Vault[A-Z]")
REFINO = re.compile(r"\s+(Intact|Exceptional|Flawless|Radiant|Relic)$")
WORLDSTATE = "https://api.warframe.com/cdn/worldState.php"
EXPORT = "https://content.warframe.com/PublicExport/"
EXPORTS = ("ExportWeapons", "ExportWarframes", "ExportRelicArcane", "ExportUpgrades")


def pide_bytes(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=CABECERAS), timeout=60) as r:
        datos = r.read()
    try:
        return lzma.decompress(datos)
    except lzma.LZMAError:
        return datos


def fecha(d):
    ms = int(d["$date"]["$numberLong"])
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def inventario(t):
    return [{"uniqueName": m["ItemType"]} for m in t.get("Manifest") or [] if m.get("ItemType")]


def de_traders():
    ws = json.loads(pide_bytes(WORLDSTATE))
    pv = next((t for t in ws.get("PrimeVaultTraders") or [] if t.get("Expiry")), None)
    vault = {
        "expiry": fecha(pv["Expiry"]),
        "inventory": inventario(pv),
        "schedule": [
            {"expiry": fecha(e["Expiry"]), "item": re.sub(r"(?<!^)(?=[A-Z])", " ", (e.get("FeaturedItem") or "").rsplit("/", 1)[-1])}
            for e in pv.get("ScheduleInfo") or [] if e.get("Expiry")
        ],
    } if pv else {}
    baro = {"inventory": [i for t in ws.get("VoidTraders") or [] for i in inventario(t)]}
    return vault, baro


def a_resolver(*traders):
    res = {}
    for t in traders:
        for e in (t.get("inventory") or []) + (t.get("schedule") or []):
            u = (e.get("uniqueName") or "") if isinstance(e, dict) else ""
            if BUSCA.search(u):
                res[u.replace("/StoreItems/", "/")] = u.rsplit("/", 1)[-1]
    return res


def nombres(*traders):
    claves = a_resolver(*traders)
    if not claves:
        return {}
    segs = ",".join(sorted({urllib.parse.quote(s) for s in claves.values()}))
    por_ruta = {x["uniqueName"]: x["name"] for x in pide_json(ITEMS.format(segs)) if x.get("uniqueName") and x.get("name")}
    return {seg: REFINO.sub("", por_ruta[ruta]) for ruta, seg in claves.items() if ruta in por_ruta}


def nombres_de(*traders):
    claves = a_resolver(*traders)
    if not claves:
        return {}
    indice = {l.split("_", 1)[0]: l for l in pide_bytes(EXPORT + "index_en.txt.lzma").decode().split()}
    por_ruta = {
        x["uniqueName"]: x["name"]
        for e in EXPORTS
        for lista in json.loads(pide_bytes(EXPORT + "Manifest/" + indice[e]).decode(), strict=False).values()
        for x in lista if x.get("uniqueName") and x.get("name")
    }
    return {seg: REFINO.sub("", por_ruta[ruta]) for ruta, seg in claves.items() if ruta in por_ruta}


def warframestat():
    try:
        vault = pide_json(VAULT_TRADER)
    except Exception as e:
        print(f"Sin vaultTrader: {type(e).__name__} {str(e)[:80]}")
        vault = {}
    try:
        baro = pide_json(VOID_TRADER)
    except Exception as e:
        print(f"Sin voidTrader: {type(e).__name__} {str(e)[:80]}")
        baro = {}
    return vault, baro


def unvaults(previos, vz, vault, nom, primes):
    per = {k: [list(p) for p in v] for k, v in (previos or {}).items()}
    if vz and vz.get("fin"):
        hoy = datetime.date.today().isoformat()
        actuales = set(vz.get("n") or [])
        actuales |= {nom.get(i["uniqueName"].rsplit("/", 1)[-1]) for i in (vault or {}).get("inventory") or []}
        for n in actuales:
            if n in primes:
                per.setdefault(n, []).append([hoy, vz["fin"]])
    res = {k: une(v) for k, v in per.items()}
    return {k: v for k, v in sorted(res.items()) if v}


def vault_estimado(primes, hoy):
    grupos = {}
    for n, ev in primes.items():
        if ev.get("pa"):
            grupos.setdefault(ev["pa"], []).append(n)
    vaulteados = sorted((pa, min(primes[n]["v"] for n in ns)) for pa, ns in grupos.items() if len(ns) >= 2 and all(primes[n].get("v") for n in ns))
    saltos = [(dia(v) - dia(pa)).days for pa, v in vaulteados if (dia(v) - dia(pa)).days > 365][-8:]
    if not saltos:
        return {}
    salto = datetime.timedelta(days=statistics.median(saltos))
    ultimo = vaulteados[-1][0]
    minimo = (hoy.replace(day=1) + datetime.timedelta(days=32)).replace(day=1)
    res = {}
    for pa, ns in sorted(grupos.items()):
        if pa <= ultimo or len(ns) < 2 or any(primes[n].get("v") for n in ns):
            continue
        minimo = max(dia(pa) + salto, minimo)
        for n in ns:
            res[n] = minimo.strftime("%Y-%m")
    return res


def previo(ruta, clave):
    try:
        with open(ruta, encoding="utf-8") as f:
            return json.load(f).get(clave)
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--salida", default=SALIDA)
    args = ap.parse_args()
    res = {}
    for nombre in WFCD_FICHEROS:
        res.update(eventos(pide_json(WFCD.format(nombre=nombre))))
    try:
        vault, baro = de_traders()
    except Exception as e:
        print(f"Sin worldState: {type(e).__name__} {str(e)[:80]}")
        vault, baro = {}, {}
    if not vault:
        vault, baro = warframestat()
    vz = (varzia(vault) if vault else None) or previo(args.salida, "_varzia")
    if vz:
        res["_varzia"] = vz
    nom = {}
    for resolver in (nombres_de, nombres):
        try:
            nom = resolver(vault, baro) if vault or baro else {}
            break
        except Exception as e:
            print(f"Sin nombres ({resolver.__name__}): {type(e).__name__} {str(e)[:80]}")
    if not nom or not (vault and baro):
        nom = {**(previo(args.salida, "_nombres") or {}), **nom}
    if nom:
        res["_nombres"] = nom
    primes = {k: v for k, v in res.items() if not k.startswith("_")}
    for n, ve in vault_estimado(primes, datetime.date.today()).items():
        res[n]["ve"] = ve
    unv = unvaults(previo(args.salida, "_unvaults"), vz, vault, nom, primes)
    if unv:
        res["_unvaults"] = unv
    if not any(not k.startswith("_") for k in res):
        print("0 primes, no se escribe")
        sys.exit(1)
    with open(args.salida, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    print(f"{len(primes)} primes, {len(res.get('_unvaults', {}))} con unvaults, {len(res.get('_nombres', {}))} nombres -> {args.salida}")


if __name__ == "__main__":
    main()
