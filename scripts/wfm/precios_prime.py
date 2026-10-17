import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from email.utils import parsedate_to_datetime
from datetime import datetime, timezone

CATALOGO = "https://api.warframe.market/v2/items"
TOP = "https://api.warframe.market/v2/orders/item/{slug}/top"
CABECERAS = {"Accept": "application/json", "User-Agent": "VoidStonks-Precios/1.0 (+https://voidstonks.com)"}
PAUSA_S = 2.0
INTENTOS = 3
MINIMO_OK = 0.5
MIN_VENDEDORES = 3
MAX_403 = 5
MAX_ESPERA_S = 900
MAX_FALLOS_SEGUIDOS = 10
SLUG_VALIDO = re.compile(r"^[a-z0-9_]+$")
conteo_403 = [0]


def espera_429(cabecera, intento):
    valor = (cabecera or "").strip()
    if valor.isdigit():
        return int(valor) or 30 * (intento + 1)
    try:
        return max(1, int((parsedate_to_datetime(valor) - datetime.now(timezone.utc)).total_seconds()))
    except (TypeError, ValueError, OverflowError):
        return 30 * (intento + 1)


def pide(url):
    for intento in range(INTENTOS):
        req = urllib.request.Request(url, headers=CABECERAS)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                conteo_403[0] = 0
                return json.load(r)
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
                print(f"   429: espero {espera}s")
                time.sleep(espera)
                continue
            print(f"   HTTP {e.code} en {url}")
        except Exception as e:
            conteo_403[0] = 0
            print(f"   {type(e).__name__} en {url}: {str(e)[:80]}")
        time.sleep(10 * (intento + 1))
    return None


def universo(reliquias=False, cache=None):
    catalogo = None
    if cache and os.path.exists(cache):
        with open(cache, encoding="utf-8") as f:
            catalogo = json.load(f)
    if not catalogo:
        catalogo = pide(CATALOGO)
        if catalogo and cache:
            with open(cache, "w", encoding="utf-8") as f:
                json.dump(catalogo, f, ensure_ascii=False, separators=(",", ":"))
    if not catalogo:
        return []
    slugs = []
    for it in catalogo.get("data", []):
        slug = it.get("slug", "")
        nombre = (it.get("i18n", {}).get("en") or next(iter(it.get("i18n", {}).values()), {})).get("name", "")
        es_reliquia = slug.endswith("_relic")
        if SLUG_VALIDO.match(slug) and (es_reliquia if reliquias else ("Prime" in nombre and not es_reliquia)):
            slugs.append(slug)
    return sorted(slugs)


def precio_de_top(top):
    ventas = sorted(o["platinum"] for o in top.get("data", {}).get("sell", []) if o.get("user", {}).get("status") != "offline")
    baratas = ventas[:5]
    if not baratas:
        return 0, 0
    mitad = len(baratas) // 2
    precio = baratas[mitad] if len(baratas) % 2 else round((baratas[mitad - 1] + baratas[mitad]) / 2)
    return precio, len(ventas)


def anteriores(origen):
    if not origen:
        return {}
    try:
        if origen.startswith("http"):
            with urllib.request.urlopen(urllib.request.Request(origen, headers=CABECERAS), timeout=30) as r:
                return json.load(r).get("p", {})
        with open(origen, encoding="utf-8") as f:
            return json.load(f).get("p", {})
    except (OSError, ValueError):
        return {}


def main():
    args = argparse.ArgumentParser()
    args.add_argument("--salida", required=True)
    args.add_argument("--previos")
    args.add_argument("--reliquias", action="store_true")
    args.add_argument("--catalogo")
    a = args.parse_args()
    url_top = TOP + ("?subtype=intact" if a.reliquias else "")
    minimo = 1 if a.reliquias else MIN_VENDEDORES

    slugs = universo(a.reliquias, a.catalogo)
    if not slugs:
        print("Sin catálogo de WFM: no se toca nada")
        sys.exit(1)
    previos = anteriores(a.previos)
    print(f"{len(slugs)} {'reliquias' if a.reliquias else 'objetos prime'}, una petición cada {PAUSA_S:.0f} s")

    precios, ok, seguidos = {}, 0, 0
    for i, slug in enumerate(slugs, 1):
        time.sleep(PAUSA_S)
        top = pide(url_top.format(slug=slug))
        if top is None:
            seguidos += 1
            if seguidos >= MAX_FALLOS_SEGUIDOS:
                print(f"WFM no responde a {MAX_FALLOS_SEGUIDOS} objetos seguidos: se corta sin escribir nada")
                sys.exit(1)
            if slug in previos:
                precios[slug] = previos[slug]
        else:
            seguidos = 0
            ok += 1
            precio, vendedores = precio_de_top(top)
            precios[slug] = previos[slug] if vendedores < minimo and slug in previos else precio
        if i % 100 == 0 or i == len(slugs):
            print(f"   {i}/{len(slugs)} ({ok} con respuesta)")

    if ok < len(slugs) * MINIMO_OK:
        print(f"Solo {ok}/{len(slugs)} respuestas: no se toca {a.salida}")
        sys.exit(1)

    ahora = datetime.now(timezone.utc)
    salida = {
        "v": 1,
        "t": int(ahora.timestamp() * 1000),
        "updated": ahora.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "fuente": f"warframe.market {url_top}: mediana de las 5 ventas online más baratas",
        "p": precios,
    }
    os.makedirs(os.path.dirname(os.path.abspath(a.salida)), exist_ok=True)
    with open(a.salida, "w", encoding="utf-8") as f:
        json.dump(salida, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    print(f"Escrito {a.salida}: {len(precios)} precios ({ok} actualizados)")


if __name__ == "__main__":
    main()
