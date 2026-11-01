import argparse
import gzip
import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

URL = "https://relics.run/history/price_history_{fecha}.json"
CATALOGO = "https://api.warframe.market/v2/items"
AGENTE = "VoidStonks-Precios/1.0 (+https://voidstonks.com)"
CABECERAS = {"Accept": "application/json", "Accept-Encoding": "gzip", "User-Agent": AGENTE}
PAUSA_S = 2.0
INTENTOS = 3
ESPERA_S = 5
MAX_ERRORES_SEGUIDOS = 2
DIAS_GUARDADOS = 35
DIAS_DESCARGA = 33
MIN_ARTICULOS = 100


def obtiene(url, cabeceras=CABECERAS):
    for intento in range(INTENTOS):
        req = urllib.request.Request(url, headers=cabeceras)
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                cuerpo = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    cuerpo = gzip.decompress(cuerpo)
                return "ok", cuerpo
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return "falta", None
            print(f"   HTTP {e.code} en {url}")
            if e.code != 429 and e.code < 500:
                return "error", None
        except Exception as e:
            print(f"   {type(e).__name__} en {url}: {str(e)[:80]}")
        if intento < INTENTOS - 1:
            time.sleep(ESPERA_S * 2 ** intento)
    return "error", None


def fichero(carpeta, fecha):
    return os.path.join(carpeta, f"price_history_{fecha.isoformat()}.json")


def fecha_de(nombre):
    prefijo = "price_history_"
    sufijo = ".json"
    if not (nombre.startswith(prefijo) and nombre.endswith(sufijo)):
        return None
    cadena = nombre[len(prefijo):-len(sufijo)]
    if len(cadena) != 10:
        return None
    try:
        return datetime.strptime(cadena, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None


def fechas_guardadas(carpeta):
    if not os.path.isdir(carpeta):
        return []
    fechas = []
    for nombre in os.listdir(carpeta):
        f = fecha_de(nombre)
        if f is not None:
            fechas.append(f)
    return sorted(fechas)


def poda(carpeta, hoy, dias=DIAS_GUARDADOS):
    if not os.path.isdir(carpeta):
        return 0
    limite = hoy - timedelta(days=dias)
    borrados = 0
    for nombre in os.listdir(carpeta):
        f = fecha_de(nombre)
        if nombre.endswith(".tmp") or (f is not None and f < limite):
            try:
                os.remove(os.path.join(carpeta, nombre))
                borrados += 1
            except OSError:
                pass
    return borrados


def asegura(carpeta, hoy, dias=DIAS_DESCARGA):
    os.makedirs(carpeta, exist_ok=True)
    nuevos = 0
    ausentes = 0
    fallidos = 0
    racha_errores = 0
    peticiones = 0
    for d in range(1, dias + 1):
        fecha = hoy - timedelta(days=d)
        ruta = fichero(carpeta, fecha)
        if os.path.exists(ruta):
            continue
        if peticiones > 0:
            time.sleep(PAUSA_S)
        peticiones += 1
        estado, cuerpo = obtiene(URL.format(fecha=fecha.isoformat()))
        if estado == "ok":
            try:
                datos = json.loads(cuerpo)
                if not isinstance(datos, dict) or len(datos) < MIN_ARTICULOS:
                    estado = "error"
            except Exception:
                estado = "error"
        if estado == "ok":
            tmp = ruta + ".tmp"
            with open(tmp, "wb") as f:
                f.write(cuerpo)
            os.replace(tmp, ruta)
            nuevos += 1
            racha_errores = 0
        elif estado == "falta":
            ausentes += 1
            racha_errores = 0
        else:
            fallidos += 1
            racha_errores += 1
            if racha_errores >= MAX_ERRORES_SEGUIDOS:
                print("relics.run no responde: se deja de descargar")
                break
    return nuevos, ausentes, fallidos


def carga(carpeta, fecha):
    ruta = fichero(carpeta, fecha)
    try:
        with open(ruta, "rb") as f:
            datos = json.load(f)
        return datos if isinstance(datos, dict) and len(datos) >= MIN_ARTICULOS else None
    except Exception:
        return None


def dias_recientes(carpeta, hoy, n, margen):
    recientes = []
    for d in range(1, margen + 1):
        fecha = hoy - timedelta(days=d)
        dia = carga(carpeta, fecha)
        if dia is not None:
            recientes.append((fecha, dia))
            if len(recientes) == n:
                break
    return sorted(recientes, key=lambda x: x[0])


def catalogo(ruta):
    if ruta and os.path.exists(ruta):
        try:
            with open(ruta, encoding="utf-8") as f:
                cat = json.load(f)
            if isinstance(cat, dict) and isinstance(cat.get("data"), list) and cat["data"]:
                return cat
        except Exception:
            pass
    estado, cuerpo = obtiene(CATALOGO, {"Accept": "application/json", "User-Agent": AGENTE})
    if estado == "ok" and cuerpo:
        try:
            cat = json.loads(cuerpo)
            if isinstance(cat, dict) and isinstance(cat.get("data"), list) and cat["data"]:
                if ruta:
                    carpeta_padre = os.path.dirname(os.path.abspath(ruta))
                    os.makedirs(carpeta_padre, exist_ok=True)
                    with open(ruta, "w", encoding="utf-8") as f:
                        json.dump(cat, f, ensure_ascii=False, separators=(",", ":"))
                return cat
        except Exception:
            return None
    return None


def indice(cat):
    if not cat or not isinstance(cat, dict) or not isinstance(cat.get("data"), list):
        return {}, {}
    por_id = {}
    por_nombre = {}
    for it in cat["data"]:
        if not isinstance(it, dict):
            continue
        slug = it.get("slug")
        if not slug:
            continue
        item_id = it.get("id")
        if item_id:
            por_id[item_id] = slug
        i18n = it.get("i18n") or {}
        nombre = (i18n.get("en") or next(iter(i18n.values()), {})).get("name", "")
        if nombre:
            por_nombre[nombre] = slug
    return por_id, por_nombre


def por_slug(dia, por_id, por_nombre):
    if not isinstance(dia, dict):
        return {}
    res = {}
    for nombre, filas in dia.items():
        if not isinstance(filas, list):
            continue
        filas_dict = [f for f in filas if isinstance(f, dict)]
        if not filas_dict:
            continue
        slug = None
        for f in filas_dict:
            item_id = f.get("item_id")
            if item_id in por_id:
                slug = por_id[item_id]
                break
        if not slug:
            slug = por_nombre.get(nombre)
        if not slug:
            continue
        res[slug] = filas_dict
    return res


def variante(filas, subtipo=None, rango=0):
    return [f for f in filas if f.get("subtype") == subtipo and (f.get("mod_rank") or 0) == rango]


def fila(filas, tipo):
    for f in filas:
        if f.get("order_type") == tipo:
            return f
    return None


def precio(filas):
    fc = fila(filas, "closed")
    if fc and (fc.get("volume") or 0) > 0 and fc.get("median"):
        return float(fc["median"])
    fs = fila(filas, "sell")
    if fs and fs.get("median"):
        return float(fs["median"])
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--carpeta", required=True)
    parser.add_argument("--dias", type=int, default=DIAS_DESCARGA)
    args = parser.parse_args()
    hoy = datetime.now(timezone.utc).date()
    borrados = poda(args.carpeta, hoy)
    nuevos, ausentes, fallidos = asegura(args.carpeta, hoy, args.dias)
    print(f"relics.run: {nuevos} días nuevos, {ausentes} sin publicar, {fallidos} fallidos, {borrados} borrados, {len(fechas_guardadas(args.carpeta))} en caché")


if __name__ == "__main__":
    main()
