import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone

import relicsrun

URL = "https://api.warframe.market/v1/items/{slug}/statistics"
CABECERAS = {"Accept": "application/json", "User-Agent": "VoidStonks-Arcanos/1.0 (+https://voidstonks.com)"}
PAUSA_S = 2.0
INTENTOS = 3
MINIMO_OK = 0.5
MAX_403 = 5
MAX_ESPERA_S = 900
MAX_FALLOS_SEGUIDOS = 10
HORAS = 24
DIAS_RR = 2
MARGEN_RR = 3
conteo_403 = [0]


def espera_429(cabecera, intento):
    valor = (cabecera or "").strip()
    if valor.isdigit():
        return int(valor) or 30 * (intento + 1)
    try:
        return max(1, int((parsedate_to_datetime(valor) - datetime.now(timezone.utc)).total_seconds()))
    except (TypeError, ValueError, OverflowError):
        return 30 * (intento + 1)


def pide(slug):
    for intento in range(INTENTOS):
        req = urllib.request.Request(URL.format(slug=slug), headers=CABECERAS)
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                conteo_403[0] = 0
                return json.load(r).get("payload", {})
        except urllib.error.HTTPError as e:
            if e.code == 403 and e.headers.get("cf-mitigated"):
                print("WFM pide un desafío de Cloudflare: se corta sin escribir nada")
                sys.exit(1)
            if e.code == 403:
                conteo_403[0] += 1
                if conteo_403[0] >= MAX_403:
                    print(f"WFM responde 403 {MAX_403} veces seguidas: se corta sin escribir nada")
                    sys.exit(1)
                return None
            conteo_403[0] = 0
            if e.code == 404:
                return {}
            if e.code == 429:
                espera = espera_429(e.headers.get("Retry-After"), intento)
                if espera > MAX_ESPERA_S:
                    print(f"WFM pide esperar {espera}s: se corta sin escribir nada")
                    sys.exit(1)
                print(f"   429 en {slug}: espero {espera}s")
                time.sleep(espera)
                continue
            print(f"   HTTP {e.code} en {slug}")
        except Exception as e:
            conteo_403[0] = 0
            print(f"   {type(e).__name__} en {slug}: {str(e)[:80]}")
        time.sleep(10 * (intento + 1))
    return None


def de_rango(filas, rango, tipo=None):
    return [f for f in filas if (f.get("mod_rank") or 0) == rango and (tipo is None or f.get("order_type") == tipo)]


def mediana_de_venta(cerradas, rango):
    filas = sorted((f for f in de_rango(cerradas, rango) if f.get("volume", 0) > 0 and f.get("median")),
                   key=lambda f: f["median"])
    volumen = sum(f["volume"] for f in filas)
    if not volumen:
        return 0, 0
    acumulado = 0
    for f in filas:
        acumulado += f["volume"]
        if acumulado * 2 >= volumen:
            return round(f["median"]), round(volumen / 2, 1)
    return 0, 0


def ultima(filas):
    return max(filas, key=lambda f: f["datetime"]) if filas else None


def resumen(stats):
    cerradas = stats.get("statistics_closed", {}).get("48hours", [])
    vivas = stats.get("statistics_live", {}).get("48hours", [])
    rango_max = max([f.get("mod_rank") or 0 for f in cerradas + vivas] or [0])

    def rango(r):
        venta, compra = ultima(de_rango(vivas, r, "sell")), ultima(de_rango(vivas, r, "buy"))
        p = round(venta["min_price"]) if venta else 0
        h, v = mediana_de_venta(cerradas, r)
        return {
            "p": p, "d": compra["volume"] if compra else 0,
            "bb": round(compra["max_price"]) if compra else 0, "h": h, "v": v, "pe": h or p,
        }

    r0 = rango(0)
    rm = rango(rango_max) if rango_max > 0 else {"p": 0, "d": 0, "bb": 0, "h": 0, "v": 0, "pe": 0}
    return {
        **r0, "rm": rango_max, "pm": rm["p"], "dm": rm["d"], "bbm": rm["bb"],
        "hm": rm["h"], "vm": rm["v"], "pem": rm["pe"],
    }


def estadisticas(filas, ndias):
    cerradas = [{**f, "volume": f.get("volume", 0) * 2 / ndias} for f in filas if f.get("order_type") == "closed"]
    vivas = [f for f in filas if f.get("order_type") == "sell"] + [{**f, "volume": round(f.get("volume", 0) / HORAS)} for f in filas if f.get("order_type") == "buy"]
    return {"statistics_closed": {"48hours": cerradas}, "statistics_live": {"48hours": vivas}}


def desde_relicsrun(carpeta, ruta_catalogo, tradables, hoy):
    dias = relicsrun.dias_recientes(carpeta, hoy, DIAS_RR, MARGEN_RR)
    if not dias:
        return {}
    cat = relicsrun.catalogo(ruta_catalogo)
    por_id, por_nombre = relicsrun.indice(cat)
    mapas = [relicsrun.por_slug(dia, por_id, por_nombre) for _, dia in dias]
    precios = {}
    for slug, datos in tradables.items():
        nombre = datos[0] if isinstance(datos, list) and datos else ""
        filas = [f for (_, dia), mapa in zip(dias, mapas) for f in (mapa.get(slug) or dia.get(nombre) or []) if isinstance(f, dict)]
        if filas:
            r = resumen(estadisticas(filas, len(dias)))
            if r["pe"] > 0:
                r["bb"] = min(r["bb"], r["pe"])
            if r["pem"] > 0:
                r["bbm"] = min(r["bbm"], r["pem"])
            precios[slug] = r
    return precios


def main():
    args = argparse.ArgumentParser()
    args.add_argument("--arcanos", required=True)
    args.add_argument("--salida", required=True)
    args.add_argument("--catalogo")
    args.add_argument("--relicsrun")
    a = args.parse_args()

    if a.arcanos.startswith("http"):
        with urllib.request.urlopen(urllib.request.Request(a.arcanos, headers=CABECERAS), timeout=30) as r:
            tradables = json.load(r).get("tradables", {})
    else:
        with open(a.arcanos, encoding="utf-8") as f:
            tradables = json.load(f).get("tradables", {})
    slugs = sorted(tradables)
    print(f"{len(slugs)} arcanos, una petición cada {PAUSA_S:.0f} s")

    previos = {}
    if a.relicsrun:
        try:
            previos = desde_relicsrun(a.relicsrun, a.catalogo, tradables, datetime.now(timezone.utc).date())
        except Exception as e:
            print(f"relics.run descartado: {e}")
    pendientes = [s for s in slugs if s not in previos]
    print(f"{len(previos)} arcanos desde relics.run, {len(pendientes)} a /statistics")
    precios, seguidos = dict(previos), 0
    for i, slug in enumerate(pendientes, 1):
        stats = pide(slug)
        if stats is None:
            seguidos += 1
            if seguidos >= MAX_FALLOS_SEGUIDOS:
                print(f"WFM no responde a {MAX_FALLOS_SEGUIDOS} arcanos seguidos: se corta sin escribir nada")
                sys.exit(1)
        else:
            seguidos = 0
            precios[slug] = resumen(stats)
        if i % 25 == 0 or i == len(pendientes):
            print(f"   {i}/{len(pendientes)} ({len(precios)} con datos)")
        time.sleep(PAUSA_S)

    if len(precios) < len(slugs) * MINIMO_OK:
        print(f"Solo {len(precios)}/{len(slugs)} arcanos con datos: no se toca {a.salida}")
        sys.exit(1)

    salida = {
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "fuente": ("relics.run price_history (2 días) + " if previos else "") + "warframe.market /v1/items/{slug}/statistics (48 h)",
        "arcanos": precios,
    }
    with open(a.salida, "w", encoding="utf-8") as f:
        json.dump(salida, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    print(f"Escrito {a.salida}: {len(precios)} arcanos")


if __name__ == "__main__":
    main()
