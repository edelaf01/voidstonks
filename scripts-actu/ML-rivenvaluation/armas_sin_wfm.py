import json
import os
import sys

import numpy as np

ARMAS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "deploy", "assets", "json", "cleaned_weapons.json")
DESTINO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "deploy", "assets", "ml", "nivel_y_tirada.json")
POP_FIABLE = 3
COLA_DE = 0.85

def mediana_de(dato):
    re_ = dato.get("de_rerolled") or {}
    un = dato.get("de_unrolled") or {}
    m = re_.get("median") or 0
    if m <= 0:
        m = un.get("median") or 0
    if (re_.get("median") or 0) > 0 and (re_.get("pop") or 0) < POP_FIABLE and (un.get("median") or 0) > 0 and m > un["median"] * 4:
        m = un["median"] * 4
    return float(m)

def calcular(salida, de, dispo):
    xs = []
    ys = []
    for w in sorted(salida["armas"]):
        if w in de and mediana_de(de[w]) > 0:
            xs.append(np.log(mediana_de(de[w])))
            ys.append(salida["armas"][w]["nivel"])
    a, b = np.polyfit(xs, ys, 1)

    log_n = float(np.median([v["log_n"] for v in salida["armas"].values()]))

    def calcular_ref(clave):
        por_stat = {}
        for w, stats in salida[clave].items():
            d = dispo.get(w)
            if not d or d <= 0:
                continue
            for s, v in stats.items():
                por_stat.setdefault(s, []).append(v / d)
        return {s: float(np.median(vals)) for s, vals in sorted(por_stat.items())}

    return {
        "nivel": [float(a), float(b)],
        "log_n": log_n,
        "n": len(xs),
        "ref_pos": calcular_ref("ref_pos"),
        "ref_neg": calcular_ref("ref_neg"),
        "cola_de": COLA_DE,
        "de_ref": {w: float((de[w].get("de_rerolled") or {}).get("median") or 0) for w in sorted(de) if ((de[w].get("de_rerolled") or {}).get("pop") or 0) >= POP_FIABLE and ((de[w].get("de_rerolled") or {}).get("median") or 0) > 0}
    }

def dispo_por_arma(ruta=ARMAS):
    with open(ruta, encoding="utf-8") as f:
        datos = json.load(f)
    return {d["name"]: float(d["omegaAttenuation"]) for d in datos if d.get("omegaAttenuation")}

def main():
    ruta_de = sys.argv[1]
    ruta = sys.argv[2] if len(sys.argv) > 2 else DESTINO
    with open(ruta, encoding="utf-8") as f:
        salida = json.load(f)
    with open(ruta_de, encoding="utf-8") as f:
        de = json.load(f)

    salida["sin_wfm"] = calcular(salida, de, dispo_por_arma())

    with open(ruta, "w", encoding="utf-8") as f:
        json.dump(salida, f, ensure_ascii=False, allow_nan=False, separators=(",", ":"))

    print(salida["sin_wfm"]["nivel"], salida["sin_wfm"]["log_n"], salida["sin_wfm"]["n"], len(salida["sin_wfm"]["ref_pos"]), len(salida["sin_wfm"]["ref_neg"]))

if __name__ == "__main__":
    main()
