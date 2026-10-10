import json
import os
import sys

import numpy as np
import pandas as pd

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import nivel_y_tirada as nyt
import armas_sin_wfm
import anuncios as an
import escala_de10

CUANTILES_APP = (0.25, 0.5, 0.8, 0.9, 0.95)
CORTE_PRECISION = nyt.CORTE
CORTE_FINAL = os.environ.get("VOIDSTONKS_CORTE_FINAL", "2026-10-09")
FECHA_DATOS = "2026-10-08"
MIN_PRECISION = 8
UMBRAL_CORTADAS = 450
FILAS_PARIDAD = 40
FILAS_COMPROBACION = 300
TOLERANCIA = 1e-4
DESTINO = os.path.join(AQUI, "..", "..", "deploy", "assets", "ml", "nivel_y_tirada.json")
PARIDAD = os.path.join(AQUI, "..", "..", "tests", "fixtures", "nivel_y_tirada_paridad.json")
DE10 = os.path.join(AQUI, "..", "..", "deploy", "assets", "ml", "de10.json")
RHO = 0.7
N_POBLACION = 30
CUANTILES_POBLACION = np.linspace(0, 1, 21)
CLASE = {"Sniper": "Rifle", "Bow": "Rifle", "Launcher": "Rifle", "Companion Weapon": "Rifle", "Dual Pistols": "Pistol", "Throwing": "Pistol", "Zaw Component": "Melee"}
CAMPOS = ["weapon", "stat_pos1", "stat_pos2", "stat_pos3", "stat_neg", "mag_pos1", "mag_pos2", "mag_pos3", "mag_neg"]

def f32(valor):
    return float(str(np.float32(valor)))

def topes_por_slug():
    tope = {}
    for c in an.leer_csv("slugs_consultados.csv"):
        if c["ok"] == "1":
            tope[c["slug"]] = max(tope.get(c["slug"], 0), int(c["subastas"]))
    return tope

def armas_cortadas(tabla):
    tope = topes_por_slug()
    arma_de_id = {i: w for i, w in zip(tabla["auction_id"], tabla["weapon"]) if i}
    cortadas = set()
    for nombre in ("subastas_vivas.csv", "subastas_desaparecidas.csv"):
        for s in an.leer_csv(nombre):
            arma = arma_de_id.get(s["auction_id"])
            if arma and tope.get(s["slug"], 0) >= UMBRAL_CORTADAS:
                cortadas.add(arma)
    return cortadas

def precision_por_arma(cortadas):
    nyt.CORTE = CORTE_PRECISION
    tabla = nyt.leer_anuncios()
    predictor = nyt.correr_variante(tabla, tabla["entreno"] & tabla["fresco"] & ~tabla["weapon"].isin(cortadas), False, True)[0]
    prueba = tabla[tabla["prueba"] & tabla["fresco"] & tabla["weapon"].isin(predictor.contexto["niveles"])]
    precios = predictor(prueba)
    p50 = precios[:, 1]
    y = prueba["precio_primero"].values
    ape = np.abs(p50 - y) / np.maximum(y, 5)
    prueba_ape = pd.DataFrame({"weapon": prueba["weapon"].values, "ape": ape})
    resultado = {}
    for arma, grupo in prueba_ape.groupby("weapon"):
        n = len(grupo)
        if n >= MIN_PRECISION:
            resultado[arma] = {"mape": round(float(np.mean(grupo["ape"]) * 100), 1), "n": int(n)}
    return {k: resultado[k] for k in sorted(resultado)}

def arboles_por_cuantil(modelo, columnas):
    bruto = json.loads(bytes(modelo.get_booster().save_raw("json")).decode("utf-8"))
    if list(modelo.get_booster().feature_names) != list(columnas):
        raise SystemExit("columnas no coinciden")
    modelo_json = bruto["learner"]["gradient_booster"]["model"]
    arboles = modelo_json["trees"]
    info = modelo_json["tree_info"]
    texto = bruto["learner"]["learner_model_param"]["base_score"]
    if isinstance(texto, str):
        if texto.startswith("["):
            bases = [float(v) for v in texto.strip("[]").split(",")]
        else:
            bases = [float(texto)]
    elif isinstance(texto, list):
        bases = [float(v) for v in texto]
    else:
        bases = [float(texto)]
    if len(bases) == 1:
        bases = bases * len(CUANTILES_APP)
    if len(bases) != len(CUANTILES_APP):
        raise SystemExit("cantidad de bases")
    por_cuantil = [[] for _ in CUANTILES_APP]
    for i, arbol in enumerate(arboles):
        por_cuantil[info[i]].append({
            "si": [int(v) for v in arbol.get("split_indices", [])],
            "sc": [f32(v) for v in arbol.get("split_conditions", [])],
            "L": [int(v) for v in arbol.get("left_children", [])],
            "R": [int(v) for v in arbol.get("right_children", [])],
            "dl": [int(v) for v in arbol.get("default_left", [])]
        })
    return [f32(b) for b in bases], por_cuantil

def recorrer(base, arboles, fila):
    suma = np.float32(base)
    for arbol in arboles:
        nodo = 0
        L = arbol["L"]
        R = arbol["R"]
        si = arbol["si"]
        sc = arbol["sc"]
        dl = arbol["dl"]
        while L[nodo] != -1:
            v = fila[si[nodo]]
            if np.isnan(v):
                nodo = L[nodo] if dl[nodo] else R[nodo]
            else:
                nodo = L[nodo] if v < np.float32(sc[nodo]) else R[nodo]
        suma = np.float32(suma + np.float32(sc[nodo]))
    return float(suma)

def comprobar(modelo, bases, por_cuantil, matriz):
    muestra = matriz.tail(FILAS_COMPROBACION)
    esperado = modelo.predict(muestra).reshape((-1, len(CUANTILES_APP)))
    x = muestra.to_numpy(dtype=np.float32)
    calculado = np.zeros_like(esperado, dtype=np.float32)
    for i in range(len(muestra)):
        for q in range(len(CUANTILES_APP)):
            calculado[i, q] = recorrer(bases[q], por_cuantil[q], x[i])
    diferencia = float(np.max(np.abs(calculado - esperado)))
    if diferencia > TOLERANCIA:
        raise SystemExit(f"Diferencia {diferencia}")
    return diferencia

def tabla_anidada(diccionario_tuplas):
    resultado = {}
    for (arma, stat), valor in diccionario_tuplas.items():
        if arma not in resultado:
            resultado[arma] = {}
        resultado[arma][stat] = float(valor)
    return {arma: {stat: resultado[arma][stat] for stat in sorted(resultado[arma])} for arma in sorted(resultado)}

def filas_paridad(tabla_frescos, contexto, modelo):
    rng = np.random.default_rng(nyt.SEMILLA)
    mascara = tabla_frescos["weapon"].isin(contexto["niveles"])
    for i in [1, 2, 3]:
        mascara &= (tabla_frescos[f"stat_pos{i}"] == "") | tabla_frescos[f"mag_pos{i}"].notna()
    mascara &= (tabla_frescos["stat_neg"] == "") | tabla_frescos["mag_neg"].notna()
    candidatos = tabla_frescos[mascara]
    idx_con = rng.choice(candidatos[candidatos["stat_neg"] != ""].index, size=25, replace=False)
    idx_sin = rng.choice(candidatos[candidatos["stat_neg"] == ""].index, size=15, replace=False)
    idx_elegidos = sorted(np.concatenate([idx_con, idx_sin]))
    filas_a_procesar = []
    for i, idx in enumerate(idx_elegidos):
        fila = candidatos.loc[idx]
        arma = fila["weapon"]
        positivos = [[fila[f"stat_pos{k}"], float(fila[f"mag_pos{k}"])] for k in [1, 2, 3] if fila[f"stat_pos{k}"] != ""]
        negativo = [fila["stat_neg"], float(fila["mag_neg"])] if fila["stat_neg"] != "" else None
        diccionario_fila = {
            "weapon": arma,
            "stat_pos1": fila["stat_pos1"], "mag_pos1": fila["mag_pos1"],
            "stat_pos2": fila["stat_pos2"], "mag_pos2": fila["mag_pos2"],
            "stat_pos3": fila["stat_pos3"], "mag_pos3": fila["mag_pos3"],
            "stat_neg": fila["stat_neg"], "mag_neg": fila["mag_neg"]
        }
        filas_a_procesar.append((diccionario_fila, {"arma": arma, "positivos": positivos, "negativo": negativo}))
        if i == 0:
            arma_sin = arma
            pos_sin = [["Radiation", 50.0]] + (positivos[:1] if positivos else [])
            neg_sin = None
            dic_sin = {
                "weapon": arma_sin,
                "stat_pos1": "Radiation", "mag_pos1": 50.0,
                "stat_pos2": pos_sin[1][0] if len(pos_sin) > 1 else "", "mag_pos2": pos_sin[1][1] if len(pos_sin) > 1 else np.nan,
                "stat_pos3": "", "mag_pos3": np.nan,
                "stat_neg": "", "mag_neg": np.nan
            }
            filas_a_procesar.append((dic_sin, {"arma": arma_sin, "positivos": pos_sin, "negativo": neg_sin}))
    resultado = []
    for fila_dict, entrada in filas_a_procesar:
        caracteristicas = nyt.fila_caracteristicas(fila_dict, contexto["efectos"]["todos"], contexto)
        r = np.sort(modelo.predict(pd.DataFrame([caracteristicas], columns=contexto["columnas"])).reshape(-1))
        resultado.append({
            **entrada,
            "x": [None if pd.isna(v) else float(v) for v in caracteristicas],
            "r": [float(v) for v in r]
        })
    return resultado

def resumen(valores):
    return [int(len(valores))] + [round(float(v), 3) for v in np.quantile(valores, CUANTILES_POBLACION)]

def mediana_tirada(modelo, columnas, filas):
    x = pd.DataFrame(np.asarray(filas, dtype=np.float32), columns=columnas)
    return np.sort(modelo.predict(x).reshape(-1, len(CUANTILES_APP)), axis=1)[:, 1]

def poblaciones(tabla, contexto, modelo, sin):
    with open(DE10, encoding="utf-8") as f:
        de10 = json.load(f)["familias"]
    armas = escala_de10.armas_del_catalogo()
    slugs = {escala_de10.slug(a) for a in armas}
    miembros = escala_de10.miembros_por_familia(armas)
    cortadas = {s for s, n in topes_por_slug().items() if n >= UMBRAL_CORTADAS}
    tipos = nyt.tipo_por_arma()
    dispo = armas_sin_wfm.dispo_por_arma()
    columnas = list(contexto["columnas"])
    familia = {w: escala_de10.familia(w, slugs) for w in tabla["weapon"].unique()}
    frescos = tabla[tabla["fresco"]]
    armas_frescas = frescos["weapon"].values
    fam = np.array([familia[w] for w in armas_frescas])
    clase = np.array([CLASE.get(tipos[w], tipos[w]) for w in armas_frescas])
    cortada = np.isin(fam, sorted(cortadas))
    registros = frescos[CAMPOS].to_dict("records")

    conocida = np.isin(armas_frescas, sorted(contexto["niveles"]))
    idx = np.where(conocida)[0]
    r = mediana_tirada(modelo, columnas, [nyt.fila_caracteristicas(registros[i], contexto["efectos"]["todos"], contexto) for i in idx])
    pob = {}
    for f in sorted(set(fam[idx])):
        valores = r[fam[idx] == f]
        if len(valores) >= N_POBLACION:
            pob[f] = resumen(valores)
    sin_cortar = ~cortada[idx]
    pool_clase = {c: resumen(r[sin_cortar & (clase[idx] == c)]) for c in sorted(set(clase[idx][sin_cortar]))}

    contexto_sin = dict(contexto)
    contexto_sin["niveles"] = {}
    contexto_sin["conteos"] = {w: float(np.expm1(sin["log_n"])) for w in set(armas_frescas)}
    contexto_sin["ref_pos"] = {(w, s): v * dispo[w] for w in set(armas_frescas) if dispo.get(w, 0) > 0 for s, v in sin["ref_pos"].items()}
    contexto_sin["ref_neg"] = {(w, s): v * dispo[w] for w in set(armas_frescas) if dispo.get(w, 0) > 0 for s, v in sin["ref_neg"].items()}
    globales_pos, _, globales_neg, _ = contexto["efectos"]["todos"]
    base = np.where(~cortada & np.array([dispo.get(w, 0) > 0 for w in armas_frescas]))[0]
    x_sin = np.asarray([nyt.fila_caracteristicas(registros[i], (globales_pos, {}, globales_neg, {}), contexto_sin) for i in base], dtype=np.float32)
    i_nivel = columnas.index("nivel")
    con_anuncios = set(familia.values())
    pool = {}
    nivel_pool = {}
    for f in sorted((cortadas | (set(de10) - con_anuncios)) & set(de10)):
        tipo = next((tipos[w] for w in miembros.get(f, []) if tipos[w] != "desconocido"), None)
        if tipo is None:
            continue
        l10, _, _, pop10, _ = de10[f]
        nivel = round(float(l10 if pop10 >= armas_sin_wfm.POP_FIABLE else sin["nivel"][0] * l10 + sin["nivel"][1]), 4)
        x = x_sin[clase[base] == CLASE.get(tipo, tipo)].copy()
        x[:, i_nivel] = nivel
        pool[f] = resumen(mediana_tirada(modelo, columnas, x))
        nivel_pool[f] = nivel
    return {"rho": RHO, "pob": pob, "pool": pool, "nivel_pool": nivel_pool, "pool_clase": pool_clase}

def main():
    nyt.CUANTILES = CUANTILES_APP
    cortadas = armas_cortadas(nyt.leer_anuncios())
    precision = precision_por_arma(cortadas)
    nyt.CORTE = CORTE_FINAL
    tabla = nyt.leer_anuncios()
    mascara = tabla["entreno"] & tabla["fresco"] & ~tabla["weapon"].isin(cortadas)
    predictor, _, conteos, _, modelo, n_arboles, matriz = nyt.correr_variante(tabla, mascara, False, True)
    contexto = predictor.contexto
    bases, por_cuantil = arboles_por_cuantil(modelo, contexto["columnas"])
    muestra = matriz.tail(FILAS_COMPROBACION)
    diferencia = comprobar(modelo, bases, por_cuantil, muestra)
    globales_pos, locales_pos, globales_neg, locales_neg = contexto["efectos"]["todos"]
    salida = {
        "fecha_datos": FECHA_DATOS,
        "cuantiles": list(CUANTILES_APP),
        "columnas": list(contexto["columnas"]),
        "stats_pos": list(contexto["stats_pos"]),
        "stats_neg": list(contexto["stats_neg"]),
        "tipos": list(contexto["tipos_ord"]),
        "mag_por_defecto": nyt.MAG_POR_DEFECTO,
        "armas": {
            w: {
                "nivel": float(contexto["niveles"][w]),
                "log_n": float(np.log1p(contexto["conteos"].get(w, 0))),
                "n": int(contexto["conteos"].get(w, 0)),
                "tipo": contexto["tipos"][w]
            } for w in sorted(contexto["niveles"])
        },
        "efectos": {
            "pos_global": {s: float(v) for s, v in sorted(globales_pos.items())},
            "pos_local": tabla_anidada(locales_pos),
            "neg_global": {s: float(v) for s, v in sorted(globales_neg.items())},
            "neg_local": tabla_anidada(locales_neg)
        },
        "ref_pos": tabla_anidada(contexto["ref_pos"]),
        "ref_neg": tabla_anidada(contexto["ref_neg"]),
        "precision": precision,
        "modelo": {"base": bases, "arboles": por_cuantil}
    }
    if len(sys.argv) > 1:
        with open(sys.argv[1], encoding="utf-8") as f:
            salida["sin_wfm"] = armas_sin_wfm.calcular(salida, json.load(f), armas_sin_wfm.dispo_por_arma())
        salida.update(poblaciones(tabla, contexto, modelo, salida["sin_wfm"]))
    with open(DESTINO, "w", encoding="utf-8") as f:
        json.dump(salida, f, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    paridad = filas_paridad(tabla[mascara], contexto, modelo)
    os.makedirs(os.path.dirname(PARIDAD), exist_ok=True)
    with open(PARIDAD, "w", encoding="utf-8") as f:
        json.dump(paridad, f, ensure_ascii=False, allow_nan=False, indent=1)
    print(n_arboles, len(por_cuantil[0]))
    print(bases)
    print(diferencia)
    print(os.path.getsize(DESTINO) // 1024)
    print(len(contexto["niveles"]), len(precision), np.median([v["mape"] for v in precision.values()]))
    print(len(paridad))
    print(len(cortadas))

if __name__ == "__main__":
    main()
