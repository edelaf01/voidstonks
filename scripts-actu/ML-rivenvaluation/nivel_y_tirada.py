import json
import os
import sys
from collections import defaultdict

import numpy as np
import pandas as pd
import xgboost

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)

from anuncios import (
    CORTE,
    CUANTILES,
    EDAD_FRESCO,
    EDAD_NUEVO,
    INICIO_IDS,
    SALIDA,
    banda_por_arma,
    banda_publicada,
)

VIDA_MEDIA = float(os.environ.get("VOIDSTONKS_VIDA_MEDIA", "30"))
K_SUAVIZADO = 10
PLIEGUES = 5
MAG_POR_DEFECTO = 0.6
SEMILLA = 7
PESO_PRIMERA_VISTA = 0.5
DIAS_VALIDACION = 14
ARMAS = os.path.join(AQUI, "..", "..", "deploy", "assets", "json", "cleaned_weapons.json")
PRINCIPAL = "nivel_y_tirada_sin_tendencia"

def leer_anuncios():
    tabla = pd.read_csv(os.path.join(SALIDA, "anuncios.csv"), dtype=str, keep_default_na=False)
    for columna in ["precio_primero", "edad_al_verla", "censurado", "tiradas", "desaparecida_precio", "mag_pos1", "mag_pos2", "mag_pos3", "mag_neg"]:
        tabla[columna] = pd.to_numeric(tabla[columna], errors="coerce")
    for columna in ["stat_pos1", "stat_pos2", "stat_pos3", "stat_neg"]:
        tabla[columna] = tabla[columna].replace("None", "")
    tabla = tabla[tabla["precio_primero"] > 0].copy()
    corte_fecha = pd.to_datetime(CORTE)
    tabla["dia"] = (pd.to_datetime(tabla["primera_fecha"]) - corte_fecha).dt.days
    tabla["fresco"] = (tabla["edad_al_verla"] <= EDAD_NUEVO).fillna(False)
    tabla["primera_vista"] = (tabla["created"] == "") & (tabla["censurado"] == 0)
    tabla["entreno"] = tabla["primera_fecha"] < CORTE
    tabla["prueba"] = (tabla["inicio"] >= CORTE) & (tabla["primera_fecha"] >= CORTE)
    return tabla

def tipo_por_arma():
    with open(ARMAS, encoding="utf-8") as archivo:
        datos_armas = json.load(archivo)
    return defaultdict(lambda: "desconocido", {dato["name"]: dato["type"] for dato in datos_armas})

def mediana_ponderada(valores, pesos):
    if len(valores) == 0:
        return np.nan
    indices_orden = np.argsort(valores)
    valores_ordenados, pesos_ordenados = np.array(valores)[indices_orden], np.array(pesos)[indices_orden]
    acumulado = np.cumsum(pesos_ordenados)
    return valores_ordenados[acumulado >= acumulado[-1] / 2][0]

def cuantil_ponderado(valores, pesos, proporcion):
    if len(valores) == 0:
        return np.nan
    indices_orden = np.argsort(valores)
    valores_ordenados, pesos_ordenados = np.array(valores)[indices_orden], np.array(pesos)[indices_orden]
    acumulado = np.cumsum(pesos_ordenados)
    objetivo = proporcion * acumulado[-1]
    return valores_ordenados[acumulado >= objetivo][0]

def nivel_y_tendencia(tabla, pesos, con_tendencia):
    niveles_base = {}
    conteos_arma = {}
    pesos_array = np.array(pesos)
    log_precio = np.log(tabla["precio_primero"].values)
    armas_array = tabla["weapon"].values
    for arma_unica in np.unique(armas_array):
        mascara_arma = armas_array == arma_unica
        niveles_base[arma_unica] = mediana_ponderada(log_precio[mascara_arma], pesos_array[mascara_arma])
        conteos_arma[arma_unica] = int(np.sum(mascara_arma))
    pendiente = 0.0
    if con_tendencia:
        mascara_valida = (tabla["created"] >= INICIO_IDS).values
        if mascara_valida.sum() > 1:
            dias_validos = tabla["dia"].values[mascara_valida]
            armas_validas = armas_array[mascara_valida]
            niveles_validos = np.array([niveles_base[arma_v] for arma_v in armas_validas])
            y_tendencia = log_precio[mascara_valida] - niveles_validos
            pesos_tendencia = np.sqrt(pesos_array[mascara_valida])
            pendiente, _ = np.polyfit(dias_validos, y_tendencia, 1, w=pesos_tendencia)
    niveles_ajustados = {}
    for arma_unica in np.unique(armas_array):
        mascara_arma = armas_array == arma_unica
        y_ajustado = log_precio[mascara_arma] - pendiente * tabla["dia"].values[mascara_arma]
        niveles_base[arma_unica] = mediana_ponderada(y_ajustado, pesos_array[mascara_arma])
    nivel_mediano = np.median(list(niveles_base.values()))
    for arma_clave, cantidad in conteos_arma.items():
        niveles_ajustados[arma_clave] = float((cantidad * niveles_base[arma_clave] + K_SUAVIZADO * nivel_mediano) / (cantidad + K_SUAVIZADO))
    return niveles_ajustados, conteos_arma, float(pendiente)

def calcular_referencias(tabla_entreno):
    positivas = []
    for indice in [1, 2, 3]:
        temporal = tabla_entreno[["weapon", f"stat_pos{indice}", f"mag_pos{indice}"]].copy()
        temporal.columns = ["weapon", "stat", "mag"]
        positivas.append(temporal)
    tabla_positivas = pd.concat(positivas).dropna(subset=["mag"])
    tabla_positivas = tabla_positivas[tabla_positivas["stat"] != ""]
    tabla_positivas["mag"] = tabla_positivas["mag"].abs()
    referencias_positivas = tabla_positivas.groupby(["weapon", "stat"])["mag"].quantile(0.95).to_dict()
    tabla_negativas = tabla_entreno[["weapon", "stat_neg", "mag_neg"]].copy()
    tabla_negativas.columns = ["weapon", "stat", "mag"]
    tabla_negativas = tabla_negativas.dropna(subset=["mag"])
    tabla_negativas = tabla_negativas[tabla_negativas["stat"] != ""]
    tabla_negativas["mag"] = tabla_negativas["mag"].abs()
    referencias_negativas = tabla_negativas.groupby(["weapon", "stat"])["mag"].quantile(0.95).to_dict()
    return referencias_positivas, referencias_negativas

def calcular_efectos_fuente(tabla_fuente):
    positivas = []
    for indice in [1, 2, 3]:
        temporal = tabla_fuente[["weapon", f"stat_pos{indice}", "r", "peso"]].rename(columns={f"stat_pos{indice}": "stat"})
        positivas.append(temporal)
    tabla_positivas = pd.concat(positivas)
    tabla_positivas = tabla_positivas[tabla_positivas["stat"] != ""]
    tabla_negativas = tabla_fuente[["weapon", "stat_neg", "r", "peso"]].rename(columns={"stat_neg": "stat"})
    def agrupar_estadisticas(tabla_estadisticas):
        prior_global = np.average(tabla_estadisticas["r"], weights=tabla_estadisticas["peso"]) if len(tabla_estadisticas) > 0 else 0.0
        suma_pesos_global = tabla_estadisticas.groupby("stat")["peso"].sum()
        suma_residuos_global = tabla_estadisticas.groupby("stat").apply(lambda grupo: (grupo["r"] * grupo["peso"]).sum())
        efectos_globales = (suma_residuos_global + K_SUAVIZADO * prior_global) / (suma_pesos_global + K_SUAVIZADO)
        diccionario_globales = efectos_globales.to_dict()
        suma_pesos_local = tabla_estadisticas.groupby(["weapon", "stat"])["peso"].sum()
        suma_residuos_local = tabla_estadisticas.groupby(["weapon", "stat"]).apply(lambda grupo: (grupo["r"] * grupo["peso"]).sum())
        diccionario_locales = {}
        for (arma_clave, stat_clave), pesos_locales in suma_pesos_local.items():
            residuos_locales = suma_residuos_local[(arma_clave, stat_clave)]
            diccionario_locales[(arma_clave, stat_clave)] = (residuos_locales + K_SUAVIZADO * diccionario_globales[stat_clave]) / (pesos_locales + K_SUAVIZADO)
        return diccionario_globales, diccionario_locales
    globales_positivas, locales_positivas = agrupar_estadisticas(tabla_positivas)
    globales_negativas, locales_negativas = agrupar_estadisticas(tabla_negativas)
    return globales_positivas, locales_positivas, globales_negativas, locales_negativas

def obtener_efecto(arma_clave, stat_clave, globales, locales):
    if stat_clave == "":
        return 0.0
    return locales.get((arma_clave, stat_clave), globales.get(stat_clave, 0.0))

def obtener_efecto_neg(arma_clave, stat_clave, globales, locales):
    return locales.get((arma_clave, stat_clave), globales.get(stat_clave, 0.0))

def contexto_caracteristicas(tabla_solo_entreno, niveles_ajustados, conteos_arma):
    modelos_efectos = {}
    for pliegue_actual in range(PLIEGUES):
        modelos_efectos[pliegue_actual] = calcular_efectos_fuente(tabla_solo_entreno[tabla_solo_entreno["pliegue"] != pliegue_actual])
    modelos_efectos["todos"] = calcular_efectos_fuente(tabla_solo_entreno)
    referencias_positivas, referencias_negativas = calcular_referencias(tabla_solo_entreno)
    estadisticas_positivas_vistas = set(tabla_solo_entreno["stat_pos1"]) | set(tabla_solo_entreno["stat_pos2"]) | set(tabla_solo_entreno["stat_pos3"])
    estadisticas_positivas_vistas.discard("")
    estadisticas_positivas_ordenadas = sorted(list(estadisticas_positivas_vistas))
    estadisticas_negativas_vistas = set(tabla_solo_entreno["stat_neg"])
    estadisticas_negativas_vistas.discard("")
    estadisticas_negativas_ordenadas = sorted(list(estadisticas_negativas_vistas))
    diccionario_tipos = tipo_por_arma()
    tipos_ordenados = sorted(list(set(diccionario_tipos.values())))
    nombres_columnas = (
        ["num_pos", "tiene_neg", "efecto_1", "efecto_2", "efecto_3", "mag_1", "mag_2", "mag_3", "suma_efecto_mag", "efecto_neg", "mag_neg", "nivel", "log_n"]
        + [f"pos_{stat_pos}" for stat_pos in estadisticas_positivas_ordenadas]
        + [f"neg_{stat_neg}" for stat_neg in estadisticas_negativas_ordenadas]
        + [f"tipo_{tipo_visto}" for tipo_visto in tipos_ordenados]
    )
    return {
        "niveles": niveles_ajustados,
        "conteos": conteos_arma,
        "efectos": modelos_efectos,
        "ref_pos": referencias_positivas,
        "ref_neg": referencias_negativas,
        "stats_pos": estadisticas_positivas_ordenadas,
        "stats_neg": estadisticas_negativas_ordenadas,
        "tipos": diccionario_tipos,
        "tipos_ord": tipos_ordenados,
        "columnas": nombres_columnas
    }

def fila_caracteristicas(fila_datos, efectos, contexto):
    globales_pos, locales_pos, globales_neg, locales_neg = efectos
    arma_fila = fila_datos["weapon"]
    efectos_positivos = []
    for indice_stat in [1, 2, 3]:
        stat_actual = fila_datos[f"stat_pos{indice_stat}"]
        mag_actual = fila_datos[f"mag_pos{indice_stat}"]
        if stat_actual != "":
            efecto_calculado = obtener_efecto(arma_fila, stat_actual, globales_pos, locales_pos)
            efectos_positivos.append((efecto_calculado, stat_actual, mag_actual))
    efectos_positivos.sort(key=lambda tupla: tupla[0], reverse=True)
    magnitudes_normalizadas = []
    suma_efectos_magnitudes = 0.0
    for efecto_item, stat_item, mag_item in efectos_positivos:
        referencia_mag = contexto["ref_pos"].get((arma_fila, stat_item))
        if pd.isna(mag_item) or referencia_mag is None or pd.isna(referencia_mag) or referencia_mag == 0:
            mag_normalizada = np.nan
            suma_efectos_magnitudes += efecto_item * MAG_POR_DEFECTO
        else:
            mag_normalizada = np.clip(abs(mag_item) / referencia_mag, 0, 1)
            suma_efectos_magnitudes += efecto_item * mag_normalizada
        magnitudes_normalizadas.append(mag_normalizada)
    stat_negativo = fila_datos["stat_neg"]
    mag_negativa = fila_datos["mag_neg"]
    efecto_negativo = obtener_efecto_neg(arma_fila, stat_negativo, globales_neg, locales_neg)
    referencia_negativa = contexto["ref_neg"].get((arma_fila, stat_negativo))
    if pd.isna(mag_negativa) or referencia_negativa is None or pd.isna(referencia_negativa) or referencia_negativa == 0:
        mag_normalizada_negativa = np.nan
    else:
        mag_normalizada_negativa = np.clip(abs(mag_negativa) / referencia_negativa, 0, 1)
    fila_construida = [
        len(efectos_positivos),
        int(stat_negativo != ""),
        efectos_positivos[0][0] if len(efectos_positivos) > 0 else np.nan,
        efectos_positivos[1][0] if len(efectos_positivos) > 1 else np.nan,
        efectos_positivos[2][0] if len(efectos_positivos) > 2 else np.nan,
        magnitudes_normalizadas[0] if len(magnitudes_normalizadas) > 0 else np.nan,
        magnitudes_normalizadas[1] if len(magnitudes_normalizadas) > 1 else np.nan,
        magnitudes_normalizadas[2] if len(magnitudes_normalizadas) > 2 else np.nan,
        suma_efectos_magnitudes,
        efecto_negativo,
        mag_normalizada_negativa,
        contexto["niveles"].get(arma_fila, 0.0),
        np.log1p(contexto["conteos"].get(arma_fila, 0))
    ]
    for stat_pos in contexto["stats_pos"]:
        fila_construida.append(int(stat_pos in [tupla[1] for tupla in efectos_positivos]))
    for stat_neg in contexto["stats_neg"]:
        fila_construida.append(int(stat_neg == stat_negativo))
    tipo_arma = contexto["tipos"][arma_fila]
    for tipo_visto in contexto["tipos_ord"]:
        fila_construida.append(int(tipo_arma == tipo_visto))
    return fila_construida

def matriz_caracteristicas(tabla, contexto, pliegue_por_indice=None):
    filas_resultado = []
    for indice_fila, fila_datos in tabla.iterrows():
        if pliegue_por_indice is not None and indice_fila in pliegue_por_indice:
            efectos = contexto["efectos"][pliegue_por_indice[indice_fila]]
        else:
            efectos = contexto["efectos"]["todos"]
        filas_resultado.append(fila_caracteristicas(fila_datos, efectos, contexto))
    return pd.DataFrame(filas_resultado, index=tabla.index, columns=contexto["columnas"])

def entrenar_modelo(matriz_entreno, residuos_entreno, matriz_validacion, residuos_validacion, pesos_entreno, pesos_validacion):
    modelo_base = xgboost.XGBRegressor(
        objective="reg:quantileerror",
        quantile_alpha=list(CUANTILES),
        learning_rate=0.05,
        max_depth=6,
        min_child_weight=20,
        subsample=0.8,
        colsample_bytree=0.8,
        tree_method="hist",
        n_jobs=4,
        random_state=SEMILLA,
        n_estimators=2000,
        early_stopping_rounds=50
    )
    modelo_base.fit(
        matriz_entreno, residuos_entreno,
        sample_weight=pesos_entreno,
        eval_set=[(matriz_validacion, residuos_validacion)],
        sample_weight_eval_set=[pesos_validacion],
        verbose=False
    )
    numero_arboles = modelo_base.best_iteration + 1
    matriz_completa = pd.concat([matriz_entreno, matriz_validacion])
    residuos_completos = pd.concat([residuos_entreno, residuos_validacion])
    pesos_completos = np.concatenate([pesos_entreno, pesos_validacion])
    modelo_final = xgboost.XGBRegressor(
        objective="reg:quantileerror",
        quantile_alpha=list(CUANTILES),
        learning_rate=0.05,
        max_depth=6,
        min_child_weight=20,
        subsample=0.8,
        colsample_bytree=0.8,
        tree_method="hist",
        n_jobs=4,
        random_state=SEMILLA,
        n_estimators=numero_arboles
    )
    modelo_final.fit(matriz_completa, residuos_completos, sample_weight=pesos_completos)
    return modelo_final, numero_arboles

def predecir_precios(modelo, matriz_caracteristicas, log_niveles):
    predicciones = modelo.predict(matriz_caracteristicas)
    if predicciones.ndim == 1:
        predicciones = predicciones.reshape(-1, len(CUANTILES))
    predicciones = np.sort(predicciones, axis=1)
    return np.exp(predicciones + log_niveles.values[:, None])

def correr_variante(tabla_completa, mascara_entreno, con_tendencia, usar_xgboost):
    indices_entrenamiento = tabla_completa[mascara_entreno].index
    pesos_entrenamiento = 0.5 ** (-tabla_completa.loc[indices_entrenamiento, "dia"] / VIDA_MEDIA)
    mascara_primera_vista = tabla_completa.loc[indices_entrenamiento, "primera_vista"] & ~tabla_completa.loc[indices_entrenamiento, "fresco"]
    pesos_entrenamiento[mascara_primera_vista] *= PESO_PRIMERA_VISTA
    niveles_ajustados, conteos_arma, pendiente = nivel_y_tendencia(tabla_completa.loc[indices_entrenamiento], pesos_entrenamiento, con_tendencia)
    if not usar_xgboost:
        log_niveles_entreno = tabla_completa.loc[indices_entrenamiento, "weapon"].map(niveles_ajustados).fillna(0) + tabla_completa.loc[indices_entrenamiento, "dia"] * pendiente
        residuos_entreno = np.log(tabla_completa.loc[indices_entrenamiento, "precio_primero"]) - log_niveles_entreno
        cuantiles_residuos = [cuantil_ponderado(residuos_entreno.values, pesos_entrenamiento.values, cuantil) for cuantil in CUANTILES]
        def predecir_simple(tabla_evaluacion):
            log_niveles_eval = tabla_evaluacion["weapon"].map(niveles_ajustados).fillna(0) + tabla_evaluacion["dia"] * pendiente
            return np.exp(log_niveles_eval.values[:, None] + np.array(cuantiles_residuos)[None, :])
        return predecir_simple, niveles_ajustados, conteos_arma, pendiente, None, 0, None
    tabla_solo_entreno = tabla_completa.loc[indices_entrenamiento].copy()
    tabla_solo_entreno["r"] = np.log(tabla_solo_entreno["precio_primero"]) - (tabla_solo_entreno["weapon"].map(niveles_ajustados).fillna(0) + tabla_solo_entreno["dia"] * pendiente)
    tabla_solo_entreno["peso"] = pesos_entrenamiento
    tabla_solo_entreno["pliegue"] = np.random.default_rng(SEMILLA).integers(0, PLIEGUES, len(indices_entrenamiento))
    contexto = contexto_caracteristicas(tabla_solo_entreno, niveles_ajustados, conteos_arma)
    matriz_entreno = matriz_caracteristicas(tabla_solo_entreno, contexto, tabla_solo_entreno["pliegue"].to_dict())
    residuos = tabla_solo_entreno["r"]
    mascara_validacion = tabla_completa.loc[indices_entrenamiento, "dia"] >= -DIAS_VALIDACION
    indices_t = indices_entrenamiento[~mascara_validacion]
    indices_v = indices_entrenamiento[mascara_validacion]
    if len(indices_v) == 0:
        indices_t = indices_entrenamiento
        indices_v = indices_entrenamiento[:2]
    pesos_t = pesos_entrenamiento[~mascara_validacion]
    pesos_v = pesos_entrenamiento[mascara_validacion]
    modelo_xgboost, arboles_xgboost = entrenar_modelo(
        matriz_entreno.loc[indices_t], residuos.loc[indices_t],
        matriz_entreno.loc[indices_v], residuos.loc[indices_v],
        pesos_t.values if isinstance(pesos_t, pd.Series) else pesos_t,
        pesos_v.values if isinstance(pesos_v, pd.Series) else pesos_v
    )
    def predecir_xgboost(tabla_evaluacion):
        matriz_evaluacion = matriz_caracteristicas(tabla_evaluacion, contexto)
        log_niveles_eval = tabla_evaluacion["weapon"].map(niveles_ajustados).fillna(0) + tabla_evaluacion["dia"] * pendiente
        return predecir_precios(modelo_xgboost, matriz_evaluacion, log_niveles_eval)
    predecir_xgboost.contexto = contexto
    return predecir_xgboost, niveles_ajustados, conteos_arma, pendiente, modelo_xgboost, arboles_xgboost, matriz_entreno

def evaluar_filas(armas_array, y_verdadero, predicciones):
    if len(y_verdadero) == 0:
        return {"n": 0, "armas": 0}
    errores = np.log(y_verdadero)[:, None] - np.log(predicciones)
    pinball_total = 0
    for indice, cuantil in enumerate(CUANTILES):
        diferencias = errores[:, indice]
        pinball_total += np.maximum(cuantil * diferencias, (cuantil - 1) * diferencias)
    pinball_medio = np.mean(pinball_total) / len(CUANTILES)
    dentro_intervalo = (predicciones[:, 0] <= y_verdadero) & (y_verdadero <= predicciones[:, 3])
    por_debajo_mediana = y_verdadero <= predicciones[:, 1]
    sesgos_log = np.log(y_verdadero / predicciones[:, 1])
    return {
        "n": len(y_verdadero),
        "armas": len(np.unique(armas_array)),
        "pinball_log": float(pinball_medio),
        "cobertura_25_90": float(np.mean(dentro_intervalo)),
        "bajo_p50": float(np.mean(por_debajo_mediana)),
        "sesgo_p50": float(np.exp(np.median(sesgos_log)))
    }

def imprimir_informe(informe_datos):
    for conjunto_nombre, bases_resultados in informe_datos["evaluacion"].items():
        print(f"\nevaluación sobre {conjunto_nombre}")
        print(f"  {'variante':<32} {'n':>7} {'armas':>6} {'pinball':>8} {'cob25-90':>9} {'bajo_p50':>9} {'sesgo_p50':>10}")
        for base_nombre, metricas in bases_resultados.items():
            if metricas["n"]:
                print(f"  {base_nombre:<32} {metricas['n']:>7} {metricas['armas']:>6} {metricas['pinball_log']:>8.4f} {metricas['cobertura_25_90']:>9.4f} {metricas['bajo_p50']:>9.4f} {metricas['sesgo_p50']:>10.4f}")

def main():
    tabla_anuncios = leer_anuncios()
    variantes_modelos = {}
    armas_en_variantes = []
    armas_totales_set = set(tabla_anuncios["weapon"])
    variantes_modelos["price_bands"] = banda_publicada(armas_totales_set)
    armas_en_variantes.append(set(variantes_modelos["price_bands"].keys()))
    indices_entreno_puro = tabla_anuncios[tabla_anuncios["entreno"]].index
    pares_entreno_puro = tabla_anuncios.loc[indices_entreno_puro, ["weapon", "precio_primero"]].values
    variantes_modelos["anuncios_banda"] = banda_por_arma(pares_entreno_puro)
    armas_en_variantes.append(set(variantes_modelos["anuncios_banda"].keys()))
    mascara_frescos_banda = tabla_anuncios["entreno"] & (tabla_anuncios["censurado"] == 0) & (tabla_anuncios["edad_al_verla"].isna() | (tabla_anuncios["edad_al_verla"] <= EDAD_FRESCO))
    indices_frescos_banda = tabla_anuncios[mascara_frescos_banda].index
    pares_frescos_banda = tabla_anuncios.loc[indices_frescos_banda, ["weapon", "precio_primero"]].values
    variantes_modelos["frescos_banda"] = banda_por_arma(pares_frescos_banda)
    armas_en_variantes.append(set(variantes_modelos["frescos_banda"].keys()))
    mascara_frescos = tabla_anuncios["entreno"] & tabla_anuncios["fresco"]
    mascara_frescos_pv = tabla_anuncios["entreno"] & (tabla_anuncios["fresco"] | tabla_anuncios["primera_vista"])
    diccionario_arboles = {}
    diccionario_pendientes = {}
    funciones_predictoras = {}
    configuraciones_modelos = [
        ("solo_nivel_sin_tendencia", mascara_frescos, False, False),
        ("solo_nivel", mascara_frescos, True, False),
        ("nivel_y_tirada_sin_tendencia", mascara_frescos, False, True),
        ("nivel_y_tirada", mascara_frescos, True, True),
        ("nivel_y_tirada_mas_primera_vista", mascara_frescos_pv, False, True),
    ]
    modelo_principal = None
    conteos_principal = None
    for nombre_variante, mascara_uso, usar_tendencia, usar_xg in configuraciones_modelos:
        funcion_pred, niveles_var, conteos_var, pendiente_var, modelo_var, arboles_var, matriz_var = correr_variante(tabla_anuncios, mascara_uso, usar_tendencia, usar_xg)
        funciones_predictoras[nombre_variante] = funcion_pred
        diccionario_pendientes[nombre_variante] = pendiente_var * 30
        if usar_xg:
            diccionario_arboles[nombre_variante] = int(arboles_var)
        armas_en_variantes.append(set(niveles_var.keys()))
        if nombre_variante == PRINCIPAL:
            modelo_principal = modelo_var
            conteos_principal = conteos_var
    armas_comunes_todas = set.intersection(*armas_en_variantes)
    tabla_anuncios["evaluable"] = tabla_anuncios["weapon"].isin(armas_comunes_todas)
    mascara_nuevas_frescas = tabla_anuncios["prueba"] & tabla_anuncios["fresco"]
    mascara_nuevas = tabla_anuncios["prueba"]
    mascara_desaparecidas = tabla_anuncios["prueba"] & (tabla_anuncios["desaparecida_precio"] > 0)
    conjuntos_evaluacion = {
        "nuevas_frescas": (mascara_nuevas_frescas, "precio_primero"),
        "nuevas": (mascara_nuevas, "precio_primero"),
        "desaparecidas": (mascara_desaparecidas, "desaparecida_precio")
    }
    resultados_evaluacion = {}
    for nombre_conjunto, (mascara_conjunto, columna_objetivo) in conjuntos_evaluacion.items():
        tabla_evaluacion = tabla_anuncios[mascara_conjunto & tabla_anuncios["evaluable"]]
        resultados_evaluacion[nombre_conjunto] = {}
        valores_y = tabla_evaluacion[columna_objetivo].values
        armas_eval = tabla_evaluacion["weapon"].values
        for nombre_banda in ["price_bands", "anuncios_banda", "frescos_banda"]:
            diccionario_banda = variantes_modelos[nombre_banda]
            predicciones_banda = np.array([[diccionario_banda[arma_eval][cuantil] for cuantil in CUANTILES] for arma_eval in armas_eval])
            resultados_evaluacion[nombre_conjunto][nombre_banda] = evaluar_filas(armas_eval, valores_y, predicciones_banda)
        for configuracion in configuraciones_modelos:
            nombre_conf = configuracion[0]
            predicciones_modelo = funciones_predictoras[nombre_conf](tabla_evaluacion)
            resultados_evaluacion[nombre_conjunto][nombre_conf] = evaluar_filas(armas_eval, valores_y, predicciones_modelo)
    tabla_nuevas_frescas_ev = tabla_anuncios[mascara_nuevas_frescas & tabla_anuncios["evaluable"]].copy()
    tabla_nuevas_frescas_ev["quincena"] = tabla_nuevas_frescas_ev["primera_fecha"].str[:7] + np.where(tabla_nuevas_frescas_ev["primera_fecha"].str[8:10].astype(int) <= 15, "a", "b")
    desglose_por_quincena = {}
    for quincena_unica in sorted(tabla_nuevas_frescas_ev["quincena"].unique()):
        mascara_quincena = tabla_nuevas_frescas_ev["quincena"] == quincena_unica
        valores_y_quincena = tabla_nuevas_frescas_ev.loc[mascara_quincena, "precio_primero"].values
        armas_quincena = tabla_nuevas_frescas_ev.loc[mascara_quincena, "weapon"].values
        predicciones_fb = np.array([[variantes_modelos["frescos_banda"][arma_q][cuantil] for cuantil in CUANTILES] for arma_q in armas_quincena])
        predicciones_nyt = funciones_predictoras["nivel_y_tirada"](tabla_nuevas_frescas_ev[mascara_quincena])
        predicciones_prin = funciones_predictoras[PRINCIPAL](tabla_nuevas_frescas_ev[mascara_quincena])
        desglose_por_quincena[quincena_unica] = {
            "frescos_banda": evaluar_filas(armas_quincena, valores_y_quincena, predicciones_fb),
            PRINCIPAL: evaluar_filas(armas_quincena, valores_y_quincena, predicciones_prin),
            "nivel_y_tirada": evaluar_filas(armas_quincena, valores_y_quincena, predicciones_nyt)
        }
    conteos_entreno_array = np.array(list(conteos_principal.values()))
    percentil_33, percentil_66 = np.percentile(conteos_entreno_array, [33, 66])
    def clasificar_liquidez(cantidad):
        if cantidad <= percentil_33: return "poca"
        if cantidad <= percentil_66: return "media"
        return "mucha"
    tabla_nuevas_frescas_ev["liquidez"] = tabla_nuevas_frescas_ev["weapon"].map(conteos_principal).fillna(0).apply(clasificar_liquidez)
    desglose_por_liquidez = {}
    for nivel_liquidez in ["poca", "media", "mucha"]:
        mascara_liquidez = tabla_nuevas_frescas_ev["liquidez"] == nivel_liquidez
        if not mascara_liquidez.any(): continue
        valores_y_liq = tabla_nuevas_frescas_ev.loc[mascara_liquidez, "precio_primero"].values
        armas_liq = tabla_nuevas_frescas_ev.loc[mascara_liquidez, "weapon"].values
        predicciones_fb_liq = np.array([[variantes_modelos["frescos_banda"][arma_l][cuantil] for cuantil in CUANTILES] for arma_l in armas_liq])
        predicciones_nyt_liq = funciones_predictoras["nivel_y_tirada"](tabla_nuevas_frescas_ev[mascara_liquidez])
        predicciones_prin_liq = funciones_predictoras[PRINCIPAL](tabla_nuevas_frescas_ev[mascara_liquidez])
        desglose_por_liquidez[nivel_liquidez] = {
            "frescos_banda": evaluar_filas(armas_liq, valores_y_liq, predicciones_fb_liq),
            PRINCIPAL: evaluar_filas(armas_liq, valores_y_liq, predicciones_prin_liq),
            "nivel_y_tirada": evaluar_filas(armas_liq, valores_y_liq, predicciones_nyt_liq)
        }
    tabla_prueba_roladas = tabla_anuncios[tabla_anuncios["prueba"] & tabla_anuncios["evaluable"] & tabla_anuncios["tiradas"].notna()].copy()
    predicciones_roladas = funciones_predictoras[PRINCIPAL](tabla_prueba_roladas)
    valores_y_roladas = tabla_prueba_roladas["precio_primero"].values
    mediana_prevista = predicciones_roladas[:, 1]
    logaritmo_cocientes = np.log(valores_y_roladas / mediana_prevista)
    mascara_cero_tiradas = tabla_prueba_roladas["tiradas"] == 0
    mascara_mas_tiradas = tabla_prueba_roladas["tiradas"] >= 1
    mediana_cero = np.exp(np.median(logaritmo_cocientes[mascara_cero_tiradas])) if mascara_cero_tiradas.sum() > 0 else 0.0
    mediana_mas = np.exp(np.median(logaritmo_cocientes[mascara_mas_tiradas])) if mascara_mas_tiradas.sum() > 0 else 0.0
    datos_prima_rolar = {
        "tiradas_0": {"n": int(mascara_cero_tiradas.sum()), "relativo": float(mediana_cero)},
        "tiradas_mas": {"n": int(mascara_mas_tiradas.sum()), "relativo": float(mediana_mas)},
        "cociente": float(mediana_cero / mediana_mas) if mediana_mas > 0 else 0.0
    }
    booster_principal = modelo_principal.get_booster()
    puntuaciones_importancia = booster_principal.get_score(importance_type="gain")
    mejores_20_importancia = sorted(puntuaciones_importancia.items(), key=lambda tupla: tupla[1], reverse=True)[:20]
    diccionario_importancia = {clave_col: float(valor_imp) for clave_col, valor_imp in mejores_20_importancia}
    diccionario_filas = {
        "entreno": {
            "anuncios_banda": int(tabla_anuncios["entreno"].sum()),
            "frescos_banda": int(mascara_frescos_banda.sum()),
            "solo_nivel": int(mascara_frescos.sum()),
            PRINCIPAL: int(mascara_frescos.sum()),
            "nivel_y_tirada_mas_primera_vista": int(mascara_frescos_pv.sum())
        },
        "evaluables": int(tabla_anuncios["evaluable"].sum()),
        "fuera": int((~tabla_anuncios["evaluable"]).sum())
    }
    informe_final = {
        "principal": PRINCIPAL,
        "filas": diccionario_filas,
        "pendiente_por_mes": diccionario_pendientes,
        "n_arboles": diccionario_arboles,
        "evaluacion": resultados_evaluacion,
        "desglose_quincena": desglose_por_quincena,
        "desglose_liquidez": desglose_por_liquidez,
        "prima_sin_rolar": datos_prima_rolar,
        "importancia": diccionario_importancia
    }
    with open(os.path.join(SALIDA, "informe_nivel_y_tirada.json"), "w", encoding="utf-8") as archivo_json:
        json.dump(informe_final, archivo_json, indent=2, ensure_ascii=False)
    imprimir_informe(informe_final)

if __name__ == "__main__":
    main()
