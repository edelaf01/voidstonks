import argparse
import json
import os
import subprocess
import sys
import tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PIPELINE = os.path.join(RAIZ, "scripts", "prediccion-prime")
EXPORTAR = os.path.join(PIPELINE, "exportar.py")
DATOS = os.path.join(PIPELINE, "datos")
EVENTOS = os.path.join(RAIZ, "deploy", "assets", "json", "eventos_prime.json")
SALIDA = os.path.join(RAIZ, "deploy", "assets", "json", "prediccion_prime.json")
NIVELES = ["alta", "media", "baja"]
MIN_ITEMS = 150
HORIZONTE = 28
CLAVES_ERROR = ("mediana", "p90", "cobertura", "n")


def es_num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def es_int(x):
    return isinstance(x, int) and not isinstance(x, bool)


def valida(doc):
    errores = []
    if not isinstance(doc, dict):
        return ["raiz no es objeto"]
    if doc.get("v") != 1:
        errores.append("v != 1")
    if not isinstance(doc.get("generado"), str) or not doc.get("generado"):
        errores.append("generado ausente")
    if doc.get("horizonte_dias") != HORIZONTE:
        errores.append("horizonte_dias != %d" % HORIZONTE)
    if doc.get("niveles") != NIVELES:
        errores.append("niveles != %s" % NIVELES)
    if not es_num(doc.get("cobertura")):
        errores.append("cobertura no numerica")
    error = doc.get("error")
    if not isinstance(error, dict) or set(error) != set(NIVELES):
        errores.append("error sin los tres niveles")
    else:
        for nivel in NIVELES:
            bloque = error[nivel]
            if not isinstance(bloque, dict) or any(not es_num(bloque.get(k)) for k in CLAVES_ERROR):
                errores.append("error.%s incompleto" % nivel)
    items = doc.get("items")
    if not isinstance(items, dict):
        errores.append("items no es objeto")
        return errores
    if len(items) < MIN_ITEMS:
        errores.append("items %d < %d" % (len(items), MIN_ITEMS))
    malos = 0
    for slug, it in items.items():
        ok = (
            isinstance(slug, str)
            and isinstance(it, dict)
            and all(es_int(it.get(k)) for k in ("ref", "p10", "p50", "p90", "n"))
            and it["p10"] <= it["p50"] <= it["p90"]
            and 0 <= it["n"] <= 2
        )
        if not ok:
            malos += 1
            if malos <= 5:
                errores.append("item invalido: %s" % slug)
    if malos > 5:
        errores.append("... %d items invalidos en total" % malos)
    return errores


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--datos", default=DATOS)
    ap.add_argument("--eventos", default=EVENTOS)
    ap.add_argument("--salida", default=SALIDA)
    ap.add_argument("--exportar", default=EXPORTAR)
    ap.add_argument("--validar", help="solo valida este JSON, sin lanzar exportar.py")
    a = ap.parse_args()

    if a.validar:
        with open(a.validar, encoding="utf-8") as f:
            errores = valida(json.load(f))
        for e in errores:
            print("ERROR:", e, file=sys.stderr)
        return 1 if errores else 0

    destino = os.path.abspath(a.salida)
    carpeta = os.path.dirname(destino)
    os.makedirs(carpeta, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".prediccion_prime_", suffix=".json", dir=carpeta)
    os.close(fd)
    try:
        r = subprocess.run(
            [sys.executable, a.exportar, "--datos", a.datos, "--eventos", a.eventos, "--salida", tmp],
            cwd=os.path.dirname(os.path.abspath(a.exportar)),
        )
        if r.returncode != 0:
            print("exportar.py fallo (codigo %d); no se sobrescribe" % r.returncode, file=sys.stderr)
            return 1
        try:
            with open(tmp, encoding="utf-8") as f:
                doc = json.load(f)
        except (OSError, ValueError) as e:
            print("JSON ilegible: %s; no se sobrescribe" % e, file=sys.stderr)
            return 1
        if isinstance(doc, dict) and isinstance(doc.get("items"), dict):
            doc["items"] = {k: v for k, v in doc["items"].items() if k.endswith("_set")}
        errores = valida(doc)
        if errores:
            for e in errores:
                print("ERROR:", e, file=sys.stderr)
            print("validacion fallida; no se sobrescribe", file=sys.stderr)
            return 1
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, destino)
        tmp = None
        print("prediccion_prime.json: %d items, generado %s" % (len(doc["items"]), doc["generado"]))
        return 0
    finally:
        if tmp and os.path.exists(tmp):
            os.unlink(tmp)


if __name__ == "__main__":
    sys.exit(main())
