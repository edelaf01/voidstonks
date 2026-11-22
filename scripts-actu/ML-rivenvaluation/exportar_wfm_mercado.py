import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

RAIZ = Path(__file__).resolve().parent
ENTRADA = RAIZ / "recientes" / "barrido" / "contratos.jsonl"
SALIDA = RAIZ.parents[1] / "deploy" / "assets" / "ml" / "wfm_mercado.json"
DIAS = 14


def cuantil(orden, q):
    if not orden:
        return None
    pos = (len(orden) - 1) * q
    i = int(pos)
    j = min(i + 1, len(orden) - 1)
    return round(orden[i] + (orden[j] - orden[i]) * (pos - i))


def fecha(texto):
    return datetime.fromisoformat(str(texto).replace("Z", "+00:00"))


def main():
    entrada = Path(sys.argv[1]) if len(sys.argv) > 1 else ENTRADA
    salida = Path(sys.argv[2]) if len(sys.argv) > 2 else SALIDA
    por_id = {}
    with open(entrada, encoding="utf-8") as f:
        for linea in f:
            try:
                c = json.loads(linea)
            except ValueError:
                continue
            if c.get("closed") or c.get("private") or c.get("visible") is False or c.get("platform") != "pc":
                continue
            item = c.get("item") or {}
            arma = item.get("weapon_url_name")
            precio = c.get("buyout_price")
            if not arma or not isinstance(precio, (int, float)) or precio <= 0 or not c.get("visto"):
                continue
            previo = por_id.get(c["id"])
            if previo is None or fecha(c["visto"]) > previo[3]:
                por_id[c["id"]] = (arma, bool(item.get("re_rolls")), precio, fecha(c["visto"]))
    if not por_id:
        print("sin contratos")
        sys.exit(1)
    ultimo = max(v[3] for v in por_id.values())
    desde = ultimo - timedelta(days=DIAS)
    grupos = {}
    for arma, tirado, precio, visto in por_id.values():
        if visto >= desde:
            grupos.setdefault(arma, {}).setdefault("tirado" if tirado else "sin_tirar", []).append(precio)
    armas = {}
    for arma, partes in sorted(grupos.items()):
        armas[arma] = {}
        for clave, precios in partes.items():
            precios.sort()
            armas[arma][clave] = [len(precios), cuantil(precios, 0.25), cuantil(precios, 0.5), cuantil(precios, 0.75)]
    datos = {"fecha": ultimo.date().isoformat(), "campos": ["n", "p25", "p50", "p75"], "armas": armas}
    salida.write_text(json.dumps(datos, separators=(",", ":")), encoding="utf-8")
    print(f"contratos={len(por_id)} armas={len(armas)} fecha={datos['fecha']} -> {salida}")


if __name__ == "__main__":
    main()
