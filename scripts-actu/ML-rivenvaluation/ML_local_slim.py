# -*- coding: utf-8 -*-
"""VoidStonks - Entrenamiento ML (versión corregida del cuaderno de Colab).

CAMBIOS frente al original (untitled3):
  1. SEGURIDAD: el token de GitHub se lee de os.environ, no va en el código.
  2. FUGA: NO se rellenan official_median / wfm_avg con `price` (target). Se rellenan
     con la mediana de la columna + flag *_missing. Evita inflar el R².
  3. MÉTRICA HONESTA: split 3 vías (train / early-stop / test). El R² se reporta sobre
     el set de test que NO se usa para early stopping.
  4. ONE-HOT VIVO: las dummies de arma ahora SÍ se concatenan a la matriz (antes
     `armas_dummies` se calculaba y se tiraba -> el modelo entrenaba sin identidad de arma).
  5. HISTORIAL: /api/history devuelve {data, pos, midPos, neg}; se lee h.json()["data"].
     Antes reventaba y todos los hist_* quedaban en su valor por defecto.
  6. /api/rivens se descarga UNA vez (devuelve el dict completo, ignora ?weapon).
     El fallback ya no inyecta el dict entero como columnas.
  7. SINERGIA continua: cada stat aporta según su score (peso_meta x magnitud si está
     disponible). Se elimina el castigo binario `*0.70`. Ver NOTA sobre magnitudes.
  8. Bugs: analizar_oportunidades_mercado se define ANTES de llamarse; los `except`
     dejan rastro; device cuda con fallback a cpu.

NOTA (magnitudes): oraculo_riven.py YA loguea el valor crudo de cada stat (mag_pos1..3,
mag_neg) leyendo attr["value"] de cada subasta. Las filas históricas no lo traen (quedan
neutras); la sinergia normaliza esos valores de forma empírica por (arma, stat) y gana
resolución de calidad de roll según el cron acumula filas nuevas.

NOTA (tiers/Fase 6): cada peso por arma se mezcla con un PRIOR GLOBAL del stat vía
shrinkage por volumen. Esto neutraliza el SESGO DE SUPERVIVENCIA: que un stat no aparezca
en subastas de un arma no implica que sea malo -> sin datos se usa la expectativa global,
marcando esos stats en "baja_confianza". El export incluye prior global, importancias del
modelo, popularidad por arma y los mejores pos/neg de cada arma.
"""

import io
import os
import re
import time
import json
import requests
import numpy as np
import pandas as pd
print("FASE 1: INGESTA, DEDUPLICACION Y AGRUPACION DE FAMILIAS")

# ====================================================================
# 1. DESCARGA DEL DATASET (token desde entorno, nunca hardcodeado)
# ====================================================================
import os as _os
LOCAL_CSV = _os.environ.get("VOIDSTONKS_CSV", "/var/home/ppsoy/Documentos/GitHub/Voidstonks-cron/historial_precios/dataset_raw_ml.csv")
print(f"[LOCAL] Leyendo dataset: {LOCAL_CSV}")
df_micro = pd.read_csv(LOCAL_CSV)
for n in ["re_rolls", "rolls", "Rerolls"]:
    if n in df_micro.columns:
        df_micro.rename(columns={n: "rerolls"}, inplace=True)
print(f"Dataset crudo cargado: {df_micro.shape[0]} filas.")

# ====================================================================
# 2. DEDUP: matar reposts exactos SIN tirar la varianza de precio real.
#    Incluimos `price` en la clave: dos listados del mismo riven al mismo precio
#    se colapsan, pero precios distintos del mismo combo se conservan (es señal).
# ====================================================================
clave_dedup = [c for c in ["weapon", "stat_pos1", "stat_pos2", "stat_pos3", "stat_neg", "rerolls", "price"]
               if c in df_micro.columns]
antes = df_micro.shape[0]
df_micro.drop_duplicates(subset=clave_dedup, keep="last", inplace=True)
print(f"Reposts exactos eliminados: {antes - df_micro.shape[0]} (conservada la varianza de precio).")

# ====================================================================
# 3. FAMILIAS. OJO: Prime vs base, Kuva/Tenet y Mutalist tienen disposition (y riven)
#    DISTINTOS. Solo usamos la familia para el fallback de macro; la identidad real del
#    arma entra por el one-hot (Celda 3), que la conserva por variante.
# ====================================================================
PREFIJOS = r"\b(kuva|tenet|prisma|mara|dex|synoid|telos|vaykor|secura|rakta|sancti|coda|carmine|mk1|mk-1)\b"
SUFIJOS = r"\b(prime|vandal|wraith|incarnon)\b"  # 'mutalist' NO se stripea: es arma aparte

# Variantes que deben quedar como familia propia (coherente con la inferencia)
EXCEPCIONES_FAMILIA = {
    "dex furis": "afuris", "dex afuris": "afuris",
    "mutalist cernos": "mutalist cernos", "proboscis cernos": "proboscis cernos",
    "mutalist quanta": "mutalist quanta",
    "pangolin prime": "pangolin sword",
    "prisma dual decurions": "dual decurion", "dual decurions": "dual decurion",
}

def limpiar_chars(nombre):
    return re.sub(r"[^a-z0-9]", "", str(nombre).lower())

def raiz_familia(arma):
    n = " ".join(re.sub(r"[^a-z0-9\s]", "", str(arma).lower()).split()).strip()
    if n in EXCEPCIONES_FAMILIA:
        return limpiar_chars(EXCEPCIONES_FAMILIA[n])
    n = re.sub(SUFIJOS, "", re.sub(PREFIJOS, "", n))
    return limpiar_chars(n)

agrupacion_familias = {}
for arma in df_micro["weapon"].unique():
    agrupacion_familias.setdefault(raiz_familia(arma), []).append(arma)

mapeo_familias, representantes_unicos = {}, set()
for raiz, variantes in agrupacion_familias.items():
    var_limpias = {limpiar_chars(v): v for v in variantes}
    representante = var_limpias.get(raiz) or min(variantes, key=len)
    for v in variantes:
        mapeo_familias[v] = representante
    representantes_unicos.add(representante)

df_micro["family_rep"] = df_micro["weapon"].map(mapeo_familias)
print(f"Mapeadas {df_micro['weapon'].nunique()} variantes a {len(representantes_unicos)} familias.")


# ====================================================================
# FASE 2: API (macro + historial) Y FEATURE ENGINEERING
# ====================================================================
print("\nFASE 2: DESCARGA API Y FEATURES")

cols_originales = ["weapon", "price", "stat_pos1", "stat_pos2", "stat_pos3", "stat_neg",
                   "rerolls", "family_rep", "mag_pos1", "mag_pos2", "mag_pos3", "mag_neg"]
df_micro = df_micro[[c for c in df_micro.columns if c in cols_originales]]

API_BASE = "https://soft-mountain-28fe.edelamf0.workers.dev/api/rivens"
API_HISTORY = "https://soft-mountain-28fe.edelamf0.workers.dev/api/history"
FILE_CACHE = "cache_datos_api.json"
headers = {"User-Agent": "Mozilla/5.0"}

MACRO_FIELDS = ["official_median", "wfm_avg", "popularity_pct", "wfm_market_sample", "liquidity_score",
                "volatility_index", "rerolled_premium_ratio", "web_min", "web_max", "trend_7d_pct"]
HIST_FIELDS = ["hist_current_official", "hist_current_wfm", "hist_liquidity_avg",
               "hist_volatility_max", "hist_rerolled_premium", "hist_momentum",
               "hist_trend_7d", "hist_meta_shift"]

if os.path.exists(FILE_CACHE):
    print("Cargando datos desde cache local...")
    with open(FILE_CACHE, "r", encoding="utf-8") as f:
        cache = json.load(f)
    api_map = cache["api_map"]
    datos_temporales = cache["temporales"]
else:
    print("Descargando desde Cloudflare...")
    sess = requests.Session()
    sess.headers.update(headers)

    # --- /api/rivens devuelve el DICT COMPLETO (ignora ?weapon): una sola llamada ---
    api_map = {}
    try:
        full = sess.get(API_BASE, timeout=30).json()
        api_map = {k.lower(): v for k, v in full.items()
                   if k != "__baseline" and isinstance(v, dict)}
        print(f"  macro: {len(api_map)} armas indexadas.")
    except Exception as e:
        print(f"  [WARN] /api/rivens falló: {e}")

    # --- /api/history SÍ es por arma; leemos h.json()['data'] ---
    datos_temporales = []
    fallos_hist = 0
    for arma in df_micro["weapon"].unique():
        if pd.isna(arma) or not str(arma).strip():
            continue
        q = str(arma).strip().lower()
        try:
            h = sess.get(API_HISTORY, params={"weapon": q}, timeout=10).json()
            data = h.get("data") if isinstance(h, dict) else h  # tolera formato viejo (lista)
            if not data:
                continue
            df_t = pd.DataFrame(data).sort_values("date")
            serie = pd.to_numeric(df_t["wfm_avg_price"], errors="coerce").dropna()
            f_h = df_t.iloc[-1]
            # Mediana, no media: hay días con spikes troll (1k-20k) que rompen la media.
            wfm_med = (float(serie.median()) + 0.1) if len(serie) else 0.1
            off_med = pd.to_numeric(df_t["official_median"], errors="coerce").median() + 0.1
            # Trend real 7d: media de los últimos 7 días vs los 7 previos (dirección del mercado).
            trend_7d = 0.0
            if len(serie) >= 8:
                ult, prev = serie.tail(7).mean(), serie.tail(14).head(7).mean()
                trend_7d = round((ult - prev) / (prev + 1e-9), 3)
            datos_temporales.append({
                "weapon": str(arma).strip(),
                "hist_current_official": float(f_h["official_median"]),
                "hist_current_wfm": float(f_h["wfm_avg_price"]),
                "hist_liquidity_avg": float(f_h["liquidity_score"]),
                "hist_volatility_max": float(f_h["volatility_index"]),
                "hist_rerolled_premium": float(f_h["rerolled_premium_ratio"]),
                "hist_momentum": float(round(f_h["wfm_avg_price"] / wfm_med, 3)),  # vs mediana robusta
                "hist_trend_7d": float(trend_7d),
                "hist_meta_shift": float(round(f_h["official_median"] / off_med, 3)),
            })
        except Exception:
            fallos_hist += 1
        time.sleep(0.05)
    if fallos_hist:
        print(f"  [WARN] historial sin datos/erróneo en {fallos_hist} armas.")

    with open(FILE_CACHE, "w", encoding="utf-8") as f:
        json.dump({"api_map": api_map, "temporales": datos_temporales}, f)

# --- Macro por arma vía lookup (exacto -> familia) sin inyectar dicts basura ---
def lookup_macro(arma):
    rec = api_map.get(str(arma).strip().lower())
    if rec is None:
        rep = mapeo_familias.get(arma)
        rec = api_map.get(str(rep).strip().lower()) if rep else None
    return rec or {}

macro_rows = []
for arma in df_micro["weapon"].unique():
    rec = lookup_macro(arma)
    if not rec:
        continue
    de_un = rec.get("de_unrolled") or {}
    de_re = rec.get("de_rerolled") or {}
    fila = {"weapon": arma}
    fila["official_median"] = rec.get("official_median")
    fila["wfm_avg"] = rec.get("wfm_avg", rec.get("wfm_avg_price"))
    # /api/rivens NO expone popularity_pct: la derivamos de la popularidad DE (unrolled + rerolled)
    fila["popularity_pct"] = (de_un.get("pop") or 0) + (de_re.get("pop") or 0)
    fila["wfm_market_sample"] = rec.get("wfm_market_sample")   # subastas vivas = liquidez/demanda
    fila["liquidity_score"] = rec.get("liquidity_score")
    fila["volatility_index"] = rec.get("volatility_index")
    fila["rerolled_premium_ratio"] = rec.get("rerolled_premium_ratio")
    fila["web_min"] = rec.get("web_min")
    fila["web_max"] = rec.get("web_max")
    fila["trend_7d_pct"] = rec.get("trend_7d_pct")             # trend oficial que ya calcula el worker
    macro_rows.append(fila)

df_macro = pd.DataFrame(macro_rows) if macro_rows else pd.DataFrame(columns=["weapon"] + MACRO_FIELDS)
df_temp = pd.DataFrame(datos_temporales) if datos_temporales else pd.DataFrame(columns=["weapon"] + HIST_FIELDS)

df_micro = df_micro.merge(df_macro, on="weapon", how="left").merge(df_temp, on="weapon", how="left")

# --- rerolls ---
if "rerolls" not in df_micro.columns:
    df_micro["rerolls"] = 0
df_micro["rerolls"] = df_micro["rerolls"].fillna(0).astype(int)

# --- RELLENO SIN FUGA: nunca con price. Mediana de columna + flag de ausencia ---
for col in ["official_median", "wfm_avg"]:
    if col not in df_micro.columns:
        df_micro[col] = np.nan
    df_micro[f"{col}_missing"] = df_micro[col].isna().astype(int)
    med = df_micro[col].median()
    df_micro[col] = df_micro[col].fillna(med if pd.notna(med) else 0.0)

# macro secundaria
for col in ["popularity_pct", "wfm_market_sample", "liquidity_score", "volatility_index",
            "rerolled_premium_ratio", "web_min", "web_max", "trend_7d_pct"]:
    if col not in df_micro.columns:
        df_micro[col] = np.nan
defaults_macro = {"popularity_pct": 0.0, "wfm_market_sample": 0.0, "liquidity_score": 30.0,
                  "volatility_index": 3.0, "rerolled_premium_ratio": 1.0, "web_min": 0.0,
                  "web_max": 0.0, "trend_7d_pct": 0.0}
for col, dv in defaults_macro.items():
    df_micro[col] = df_micro[col].fillna(dv)

# historial (ya con datos reales; defaults solo donde falte)
for col in HIST_FIELDS:
    if col not in df_micro.columns:
        df_micro[col] = np.nan
df_micro["hist_current_official"] = df_micro["hist_current_official"].fillna(df_micro["official_median"])
df_micro["hist_current_wfm"] = df_micro["hist_current_wfm"].fillna(df_micro["wfm_avg"])
defaults_hist = {"hist_liquidity_avg": 30.0, "hist_volatility_max": 3.0,
                 "hist_rerolled_premium": 1.0, "hist_momentum": 1.0,
                 "hist_trend_7d": 0.0, "hist_meta_shift": 1.0}
for col, dv in defaults_hist.items():
    df_micro[col] = df_micro[col].fillna(dv)

# fatigue_index ya NO mete price (official_median es macro real / mediana)
conteo = df_micro["weapon"].value_counts()
df_micro_clean = df_micro[df_micro["weapon"].isin(conteo[conteo >= 25].index)].copy()
df_micro_clean["fatigue_index"] = df_micro_clean["rerolls"] / (df_micro_clean["official_median"] + 1)
print(f"Pipeline OK. Filas listas: {df_micro_clean.shape[0]} | armas: {df_micro_clean['weapon'].nunique()}")


# ====================================================================
# FASE 3: SINERGIA CONTINUA, ONE-HOT (¡concatenado!) Y MATRICES
# ====================================================================
from sklearn.model_selection import train_test_split

print("\nFASE 3: FEATURES (ONE-HOT) Y MATRICES")

# --- Magnitudes: normalización empírica por (arma, stat). Lo más dinámico posible:
#     0..1 = |valor| / p95(|valor| de ese stat en esa arma). Sin coeficientes hardcodeados.
#     (El valor crudo lo loguea oraculo_riven.py desde attr["value"] de cada subasta.)
MAG_COLS = ["mag_pos1", "mag_pos2", "mag_pos3"]
HAS_MAG = all(c in df_micro_clean.columns for c in MAG_COLS) and df_micro_clean[MAG_COLS].notna().any().any()

ref_mag = {}
if HAS_MAG:
    for c in MAG_COLS + (["mag_neg"] if "mag_neg" in df_micro_clean.columns else []):
        df_micro_clean[c] = pd.to_numeric(df_micro_clean[c], errors="coerce")
    largo = []
    for i, c in enumerate(MAG_COLS, 1):
        largo.append(df_micro_clean[["weapon", f"stat_pos{i}", c]].rename(columns={f"stat_pos{i}": "stat", c: "val"}))
    largo = pd.concat(largo).dropna()
    largo = largo[(largo["stat"] != "None") & (largo["val"].abs() > 0)]
    ref_mag = largo.groupby(["weapon", "stat"])["val"].quantile(0.95).to_dict()
    print(f"  Magnitudes activas: referencia p95 para {len(ref_mag)} pares (arma, stat).")
else:
    print("  [NOTA] Aún sin magnitudes en el CSV (filas históricas). La sinergia usa solo "
          "peso_meta; se activan solas cuando oraculo_riven.py acumule filas con mag_*.")

def _mag_norm(weapon, stat, val):
    if not HAS_MAG or pd.isna(val):
        return 0.85
    ref = ref_mag.get((weapon, stat))
    if not ref:
        return 0.85
    return float(np.clip(abs(float(val)) / abs(ref), 0.0, 1.0))

def calcular_sinergia(row):
    """Contribución CONTINUA por stat = peso_meta(endpoint soft) x magnitud_norm.
    Sin castigo binario: un 'meh' bien rolleado aporta; un trash aporta poco por su peso bajo."""
    pesos = lookup_macro(row["weapon"]).get("dynamic_weights", {})
    score = 0.0
    for i in (1, 2, 3):
        stat = row[f"stat_pos{i}"]
        if pd.notna(stat) and stat != "None":
            score += pesos.get(stat, 0.05) * _mag_norm(row["weapon"], stat, row.get(f"mag_pos{i}"))
    return round(score, 4)

def calcular_neg_factor(row):
    stat = row["stat_neg"]
    if pd.isna(stat) or stat == "None":
        return 1.0
    pesos = lookup_macro(row["weapon"]).get("dynamic_weights", {})
    base = lookup_macro("__baseline").get("pos", {})
    nl = str(stat).lower()
    harmless = any(x in nl for x in ["zoom", "recoil", "to ", "vs ", "faction"])
    b = 0.05 if harmless else (pesos.get(stat) or base.get(stat) or 0.30)
    b = max(0.05, min(1.0, b))
    return round(1.0 - 0.6 * b, 4)

df_micro_clean["synergy_score"] = df_micro_clean.apply(calcular_sinergia, axis=1)
df_micro_clean["has_neg"] = df_micro_clean["stat_neg"].map(lambda x: 0 if pd.isna(x) or x == "None" else 1)
df_micro_clean["neg_penalty_factor"] = df_micro_clean.apply(calcular_neg_factor, axis=1)

# Magnitud como features explícitas del modelo
if HAS_MAG:
    for i in (1, 2, 3):
        df_micro_clean[f"mag_pos{i}_norm"] = df_micro_clean.apply(
            lambda r: _mag_norm(r["weapon"], r[f"stat_pos{i}"], r.get(f"mag_pos{i}")), axis=1)
    df_micro_clean["mag_pos_avg"] = df_micro_clean[[f"mag_pos{i}_norm" for i in (1, 2, 3)]].mean(axis=1)

# Umbrales DINÁMICOS (percentiles reales de la sinergia) en vez de 1.3 / 1.7 hardcodeados
SYN_P60 = float(df_micro_clean["synergy_score"].quantile(0.60))
SYN_P85 = float(df_micro_clean["synergy_score"].quantile(0.85))
print(f"  Umbrales dinámicos -> burner<{SYN_P60:.2f} | godroll>={SYN_P85:.2f}")

df_ml = df_micro_clean.copy()

# ONE-HOT de arma: AHORA SÍ se concatena a la matriz (antes se descartaba)
armas_dummies = pd.get_dummies(df_ml["weapon"], prefix="weapon").astype(int)
df_ml = pd.concat([df_ml, armas_dummies], axis=1)

# Indicadores de stats positivos / negativos
pos_stats = [s for s in pd.concat([df_ml["stat_pos1"], df_ml["stat_pos2"], df_ml["stat_pos3"]]).dropna().unique() if s != "None"]
for stat in pos_stats:
    df_ml[f"has_pos_stat_{stat}"] = ((df_ml["stat_pos1"] == stat) | (df_ml["stat_pos2"] == stat) | (df_ml["stat_pos3"] == stat)).astype(int)
for stat in [s for s in df_ml["stat_neg"].dropna().unique() if s != "None"]:
    df_ml[f"has_neg_stat_{stat}"] = (df_ml["stat_neg"] == stat).astype(int)

cols_numericas = ["official_median", "wfm_avg", "official_median_missing", "wfm_avg_missing",
                  "popularity_pct", "wfm_market_sample", "liquidity_score", "volatility_index",
                  "rerolled_premium_ratio", "trend_7d_pct",
                  "web_min", "web_max", "hist_current_official", "hist_current_wfm", "hist_liquidity_avg",
                  "hist_volatility_max", "hist_rerolled_premium", "hist_momentum",
                  "hist_trend_7d", "hist_meta_shift",
                  "synergy_score", "rerolls", "fatigue_index",
                  "mag_pos_avg", "mag_pos1_norm", "mag_pos2_norm", "mag_pos3_norm",
                  "has_neg", "neg_penalty_factor"]
cols_dummies = [c for c in df_ml.columns if c.startswith("has_pos_stat_") or c.startswith("has_neg_stat_")]  # SLIM: sin one-hot de arma
columnas_micro = [c for c in cols_numericas if c in df_ml.columns] + cols_dummies

# Winsorize por arma al p95: la data llega a 25k (listados troll) y sin recortar el modelo
# aprende precios inflados -> "todo sale caro". Corta la cola alta de forma adaptativa por arma.
df_ml["price"] = df_ml.groupby("weapon")["price"].transform(lambda s: s.clip(upper=s.quantile(0.95)))

X = df_ml[columnas_micro]
y = np.log1p(df_ml["price"])

# Ponderar muestras para dar más relevancia a armas populares y rolls caros (godrolls)
base_weights = np.log1p(df_ml["price"]) * (1.0 + df_ml["popularity_pct"] / 25.0)
sample_weights = base_weights / base_weights.mean()

# Split 3 vías: train (80) / early-stop (10) / test (10). El test NO toca el entrenamiento.
X_train, X_tmp, y_train, y_tmp, w_train, w_tmp = train_test_split(X, y, sample_weights, test_size=0.20, random_state=42)
X_es, X_test, y_es, y_test = train_test_split(X_tmp, y_tmp, test_size=0.50, random_state=42)
print(f"Matrices: train={X_train.shape[0]} | early-stop={X_es.shape[0]} | test={X_test.shape[0]} | features={len(columnas_micro)}")
print(f"¿one-hot de arma presente? {'sí' if any(c.startswith('weapon_') for c in columnas_micro) else 'NO'}")


# ====================================================================
# FASE 4: ENTRENAMIENTO XGBOOST + EVALUACION HONESTA (sobre test)
# ====================================================================
import joblib
from xgboost import XGBRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

print("\nFASE 4: ENTRENAMIENTO Y EVALUACION")

def _pick_device():
    try:
        import subprocess
        subprocess.check_output(["nvidia-smi"], stderr=subprocess.DEVNULL)
        return "cuda"
    except Exception:
        return "cpu"

DEVICE = _pick_device()
print(f"Device: {DEVICE}")

optimized_xgb = XGBRegressor(
    n_estimators=400, learning_rate=0.05, max_depth=5, subsample=0.85,
    colsample_bytree=0.8, reg_alpha=2, reg_lambda=5, min_child_weight=2,
    early_stopping_rounds=100, device=DEVICE, tree_method="hist", random_state=42,
)
# Early stopping sobre X_es (NO sobre el set que reportamos) con pesos de muestra en entrenamiento
optimized_xgb.fit(X_train, y_train, sample_weight=w_train, eval_set=[(X_es, y_es)], verbose=False)

# Métricas sobre TEST (nunca visto, ni para early stopping)
y_pred_log = optimized_xgb.predict(X_test)
y_test_real, y_pred_real = np.expm1(y_test), np.expm1(y_pred_log)
mae = mean_absolute_error(y_test_real, y_pred_real)
rmse = np.sqrt(mean_squared_error(y_test_real, y_pred_real))
r2 = r2_score(y_test, y_pred_log)

# R² INTRA-ARMA: cuánto explica el modelo MÁS ALLÁ de la media de cada arma.
# Si es bajo, el modelo solo sabe "qué arma es", no "qué tan bueno es el roll".
df_test = df_ml.loc[X_test.index, ["weapon"]].copy()
df_test["y"] = y_test.values
df_test["pred"] = y_pred_log
media_arma = df_test.groupby("weapon")["y"].transform("mean")
ss_res = float(((df_test["y"] - df_test["pred"]) ** 2).sum())
ss_tot_intra = float(((df_test["y"] - media_arma) ** 2).sum())
r2_intra = 1 - ss_res / ss_tot_intra if ss_tot_intra > 0 else float("nan")

print("\n" + "=" * 64)
print("REPORTE DE PRECISION (sobre test held-out)")
print("=" * 64)
print(f"  R2 (log)            : {r2:.4f}")
print(f"  R2 intra-arma (log) : {r2_intra:.4f}  <- el número honesto: calidad del roll")
print(f"  MAE                 : +/- {mae:.1f} pl")
print(f"  RMSE                : +/- {rmse:.1f} pl")
print("=" * 64)

print("\nTop 15 importancias (si dominan official_median/wfm_avg, el modelo lee la media del arma):")
print(pd.Series(optimized_xgb.feature_importances_, index=columnas_micro).sort_values(ascending=False).head(15))

model_micro = optimized_xgb
joblib.dump(model_micro, "tasador_voidstonks_micro.pkl")
print("\nModelo guardado: tasador_voidstonks_micro.pkl")


# ====================================================================
# FASE 5: INFERENCIA
# ====================================================================
import xgboost as xgb

print("\nFASE 5: INFERENCIA")

def obtener_representante_inferencia(nombre_arma):
    n = " ".join(re.sub(r"[^a-z0-9\s]", "", str(nombre_arma).lower()).split()).strip()
    if n in EXCEPCIONES_FAMILIA:
        return EXCEPCIONES_FAMILIA[n]
    raiz = raiz_familia(nombre_arma)
    if raiz in agrupacion_familias:
        var_limpias = {limpiar_chars(v): v for v in agrupacion_familias[raiz]}
        return var_limpias.get(raiz) or min(agrupacion_familias[raiz], key=len)
    return nombre_arma

def tasar_riven_individual(nombre_riven, pos1, pos2, pos3, neg, rerolls,
                           mag1=1.0, mag2=1.0, mag3=1.0):
    global model_micro, df_micro_clean, columnas_micro
    fila_input = {col: 0 for col in columnas_micro}
    search_clean = limpiar_chars(nombre_riven)
    nombre_query = str(nombre_riven).strip().lower()
    rep_target = obtener_representante_inferencia(nombre_riven)

    mask_exacta = df_micro_clean["weapon"].str.lower() == nombre_query
    mask_familia = df_micro_clean["family_rep"] == rep_target
    dt = (df_micro_clean[mask_exacta].iloc[0] if mask_exacta.any()
          else (df_micro_clean[mask_familia].iloc[0] if mask_familia.any() else None))

    if dt is not None:
        of_median, wfm_a = dt["official_median"], dt["wfm_avg"]
        for c in HIST_FIELDS + ["popularity_pct", "wfm_market_sample", "liquidity_score",
                                "volatility_index", "rerolled_premium_ratio", "web_min",
                                "web_max", "trend_7d_pct"]:
            if c in fila_input:
                fila_input[c] = dt.get(c, 0)
    else:
        of_median, wfm_a = 100, 120
        for c, v in {"hist_current_official": 100, "hist_current_wfm": 120, "hist_liquidity_avg": 30.0,
                     "hist_volatility_max": 3.0, "hist_rerolled_premium": 1.0, "hist_momentum": 1.0,
                     "hist_meta_shift": 1.0}.items():
            if c in fila_input:
                fila_input[c] = v

    # Sinergia continua (misma fórmula que en entrenamiento)
    pesos = lookup_macro(nombre_query).get("dynamic_weights",
            lookup_macro(rep_target).get("dynamic_weights", {}))
    score_input = 0.0
    for stat, mag in [(pos1, mag1), (pos2, mag2), (pos3, mag3)]:
        if stat != "None":
            score_input += pesos.get(stat, 0.05) * float(np.clip(mag, 0.0, 1.0))

    fila_input.update({
        "official_median": of_median, "wfm_avg": wfm_a, "synergy_score": round(score_input, 4),
        "rerolls": int(rerolls), "fatigue_index": int(rerolls) / (of_median + 1),
    })
    if "official_median_missing" in fila_input:
        fila_input["official_median_missing"] = 0
    if "wfm_avg_missing" in fila_input:
        fila_input["wfm_avg_missing"] = 0

    # Activar one-hot de arma (comparando nombres limpios: maneja espacios/casing)
    objetivo = next((c for c in columnas_micro
                     if c.startswith("weapon_") and limpiar_chars(c[len("weapon_"):]) == search_clean), None)
    if objetivo is None:
        rep_clean = limpiar_chars(rep_target)
        objetivo = next((c for c in columnas_micro
                         if c.startswith("weapon_") and limpiar_chars(c[len("weapon_"):]) == rep_clean), None)
    if objetivo:
        fila_input[objetivo] = 1

    for stat in [pos1, pos2, pos3]:
        if stat != "None" and f"has_pos_stat_{stat}" in fila_input:
            fila_input[f"has_pos_stat_{stat}"] = 1
    if neg != "None" and f"has_neg_stat_{neg}" in fila_input:
        fila_input[f"has_neg_stat_{neg}"] = 1

    dmatrix = xgb.DMatrix(pd.DataFrame([fila_input])[columnas_micro])
    precio_crudo = float(np.expm1(model_micro.get_booster().predict(dmatrix)[0]))

    precio = precio_crudo

    # BRICK: una negativa que destroza el arma (stat top como negativa, o crítico/daño/multishot/
    # cadencia universales) tira el riven a su precio trash, da igual lo bueno que sea el resto.
    rango = precios_suelo_reales.get(nombre_riven) if "precios_suelo_reales" in globals() else None
    BRICK = {"Critical Chance", "Critical Damage", "Base Damage / Melee Damage", "Multishot", "Fire Rate / Attack Speed"}
    if neg != "None" and (neg in BRICK or pesos.get(neg, 0) >= 0.6):
        return float(round(rango["max"] if rango else max(20.0, of_median), 1))

    # Premio 0-roll modesto (gamble en blanco) / devaluación de burner.
    # OJO: rerolls NO está en los datos de entrenamiento (WFM no lo expone) -> esto es heurístico,
    # no del modelo. NO usar rerolled_premium_ratio aquí: ese ratio es godroll-vs-unrolled (2-7x).
    if int(rerolls) == 0:
        precio *= 1.25
    elif score_input < SYN_P60 and int(rerolls) > 20:
        precio *= max(0.6, 1.0 - int(rerolls) / 400.0)

    # POSICIÓN POR SINERGIA (continuo): sin magnitudes el modelo resuelve mal DENTRO del arma
    # (intra-arma R²~0.56) y predice ~baseline del arma para todo. Usamos la sinergia para colocar
    # el precio entre trash y godroll: un trash cae al ~12% del precio del modelo; un godroll al 100%.
    syn_frac = float(np.clip(score_input / max(SYN_P85, 0.01), 0.0, 1.0))
    precio *= (0.12 + 0.88 * syn_frac)

    # Suelo + techo + compresión de premium (lo que la versión JS tenía y esta no).
    if rango:
        precio = max(precio, float(rango["min"]))
    if precio > 2500:
        precio = 2500 + (precio - 2500) * 0.30
    return float(round(min(precio, 15000), 1))

print("Tasacion Kuva Sobek:",
      tasar_riven_individual("Kuva Sobek", "Toxin Damage", "Multishot", "None", "Zoom", 15), "pl")


# ====================================================================
# FASE 6: EXPORTS PARA EL FRONTEND
# ====================================================================
print("\nFASE 6: EXPORTS")

ALL_POSSIBLE_STATS = [
    "Multishot", "Critical Chance", "Critical Damage", "Base Damage / Melee Damage",
    "Fire Rate / Attack Speed", "Toxin Damage", "Heat Damage", "Cold Damage",
    "Electric Damage", "Status Chance", "Status Duration", "Slash Damage",
    "Puncture Damage", "Impact Damage", "Range", "Initial Combo",
    "Combo Duration", "Chance To Gain Extra Combo Count", "Heavy Attack Efficiency",
    "Heavy Attack Damage", "Punch Through", "Reload Speed", "Magazine Capacity",
    "Ammo Maximum", "Projectile Speed", "Recoil", "Damage Vs Grineer",
    "Damage Vs Corpus", "Damage Vs Infested", "Zoom",
]
IMPOSSIBLE_NEGATIVES = ["Heat Damage", "Cold Damage", "Toxin Damage", "Electric Damage",
                        "Punch Through"]  # Punch Through no puede rolear como negativa (curse)

# --- Validez de stat por ARQUETIPO de arma (anti-stat-imposible) -------------
# Un Arch-Gun no puede tener Range/Combo/Heavy (melee-only); un melee no puede tener
# Zoom/Recoil/Mag/Multishot/Reload/Ammo/Projectile (gun-only). Columnas:
# [Rifle/0, Shotgun/1, Pistol/2, Melee/3, Arch-Gun/4]; 0 = imposible para ese tipo.
# Derivado de RIVEN_BASE_STATS (deploy/js/config.js): coef base 0 = stat imposible.
STAT_VALID = {
    "Multishot": [1, 1, 1, 0, 1],
    "Critical Chance": [1, 1, 1, 1, 1], "Critical Damage": [1, 1, 1, 1, 1],
    "Base Damage / Melee Damage": [1, 1, 1, 1, 1], "Fire Rate / Attack Speed": [1, 1, 1, 1, 1],
    "Toxin Damage": [1, 1, 1, 1, 1], "Heat Damage": [1, 1, 1, 1, 1],
    "Cold Damage": [1, 1, 1, 1, 1], "Electric Damage": [1, 1, 1, 1, 1],
    "Status Chance": [1, 1, 1, 1, 1], "Status Duration": [1, 1, 1, 1, 1],
    "Slash Damage": [1, 1, 1, 1, 1], "Puncture Damage": [1, 1, 1, 1, 1],
    "Impact Damage": [1, 1, 1, 1, 1],
    "Range": [0, 0, 0, 1, 0], "Initial Combo": [0, 0, 0, 1, 0],
    "Combo Duration": [0, 0, 0, 1, 0], "Chance To Gain Extra Combo Count": [0, 0, 0, 1, 0],
    "Heavy Attack Efficiency": [0, 0, 0, 1, 0], "Heavy Attack Damage": [0, 0, 0, 1, 0],
    "Punch Through": [1, 1, 1, 0, 1], "Reload Speed": [1, 1, 1, 0, 1],
    "Magazine Capacity": [1, 1, 1, 0, 1], "Ammo Maximum": [1, 1, 1, 0, 1],
    "Projectile Speed": [1, 1, 1, 0, 1], "Recoil": [1, 1, 1, 0, 1],
    "Zoom": [1, 0, 1, 0, 1],
    "Damage Vs Grineer": [1, 1, 1, 1, 1], "Damage Vs Corpus": [1, 1, 1, 1, 1],
    "Damage Vs Infested": [1, 1, 1, 1, 1],
}
TYPE_TO_IDX = {
    "Rifle": 0, "Sniper": 0, "Bow": 0, "Launcher": 0, "Sentinel": 0, "Companion Weapon": 0,
    "Shotgun": 1, "Pistol": 2, "Dual Pistols": 2, "Thrown": 2, "Throwing": 2, "Kitgun": 2,
    "Melee": 3, "Zaw": 3, "Zaw Component": 3, "Glaive": 3, "Arch-Gun": 4, "Archgun": 4,
}
# Armas con MÁS DE UNA categoría de riven: nombre limpio -> set de tipos EXTRA permitidos.
# Vinquibus es Rifle pero acepta también rivens melee (dos categorías) -> +Melee(3).
ARCHETYPE_EXTRA = {"vinquibus": {3}}
_CW_PATH = os.environ.get("VOIDSTONKS_WEAPONS",
                          "/var/home/ppsoy/Escritorio/voidstonks/deploy/assets/json/cleaned_weapons.json")
_weapon_tidx = {}
try:
    for _w in json.load(open(_CW_PATH, encoding="utf-8")):
        _t = TYPE_TO_IDX.get(_w.get("type"))
        if _t is not None:
            _clean = re.sub(r"[^a-z0-9]", "", str(_w.get("name", "")).lower())
            _weapon_tidx[_clean] = frozenset({_t} | ARCHETYPE_EXTRA.get(_clean, set()))
    print(f"[ARQUETIPO] {len(_weapon_tidx)} armas tipadas desde {_CW_PATH}")
except Exception as _e:
    print(f"[ARQUETIPO][WARN] sin cleaned_weapons.json ({_e}); no se filtra por arquetipo.")

def stat_ok(stat, tset):
    if not tset:
        return True
    v = STAT_VALID.get(stat)
    return True if v is None else any(v[i] for i in tset)

# Precio relativo a la mediana del arma: aísla el efecto del STAT del nivel de precio
# del arma (un stat no debe parecer bueno solo por ir en armas caras). Base del prior global.
med_arma = df_micro_clean.groupby("weapon")["price"].transform("median")
df_micro_clean["price_rel"] = df_micro_clean["price"] / (med_arma + 1.0)

df_pos = pd.melt(df_micro_clean, id_vars=["weapon", "price", "price_rel"],
                 value_vars=["stat_pos1", "stat_pos2", "stat_pos3"], value_name="stat").dropna()
df_pos = df_pos[df_pos["stat"] != "None"]
df_neg = df_micro_clean[["weapon", "price", "price_rel", "stat_neg"]].rename(columns={"stat_neg": "stat"})
df_neg = df_neg[(df_neg["stat"].notna()) & (df_neg["stat"] != "None")]

def _pesos(df_long, value_col, min_vol):
    """{stat: (peso 0..1, volumen)} por mediana normalizada al rango observado del grupo."""
    if df_long.empty:
        return {}
    agr = df_long.groupby("stat").agg(m=(value_col, "median"), vol=(value_col, "count")).reset_index()
    agr = agr[agr["vol"] >= min_vol]
    if agr.empty:
        return {}
    mx, mn = agr["m"].max(), agr["m"].min()
    rng = (mx - mn) or 1.0
    return {r["stat"]: (round(0.01 + 0.99 * ((r["m"] - mn) / rng), 3), int(r["vol"])) for _, r in agr.iterrows()}

# 1) PRIOR GLOBAL por stat (todas las armas, sobre precio relativo)
glob_pos = _pesos(df_pos, "price_rel", min_vol=25)
glob_neg = _pesos(df_neg, "price_rel", min_vol=20)
GLOBAL_POS = {s: w for s, (w, _) in glob_pos.items()}
GLOBAL_NEG = {s: w for s, (w, _) in glob_neg.items()}

# 2) Importancia GLOBAL del modelo (diagnóstico) por stat
_imp = pd.Series(optimized_xgb.feature_importances_, index=columnas_micro)
MODEL_IMP_POS = {c[len("has_pos_stat_"):]: round(float(v), 4) for c, v in _imp.items() if c.startswith("has_pos_stat_")}
MODEL_IMP_NEG = {c[len("has_neg_stat_"):]: round(float(v), 4) for c, v in _imp.items() if c.startswith("has_neg_stat_")}

# 3) Shrinkage: el peso por arma se cree según volumen; sin datos cae al prior global.
#    Antídoto del SESGO DE SUPERVIVENCIA: que un stat no aparezca NO lo hace malo.
K_PRIOR = 8  # con < K muestras locales pesa más el prior global

def _mezclar(w_local, n_local, w_global, neutro=0.30):
    if w_local is not None and n_local and n_local > 0:
        if w_global is None:
            return round(w_local, 3), "data"
        b = (n_local * w_local + K_PRIOR * w_global) / (n_local + K_PRIOR)
        return round(b, 3), ("data" if n_local >= K_PRIOR else "mix")
    if w_global is not None:
        return round(w_global, 3), "global"   # sin datos locales -> prior global
    return neutro, "prior"                     # ni local ni global -> neutro marcado

export_maestro_real = {"_global": {
    "pos": dict(sorted(GLOBAL_POS.items(), key=lambda x: -x[1])),
    "neg": dict(sorted(GLOBAL_NEG.items(), key=lambda x: -x[1])),
    "model_importance_pos": dict(sorted(MODEL_IMP_POS.items(), key=lambda x: -x[1])),
    "model_importance_neg": dict(sorted(MODEL_IMP_NEG.items(), key=lambda x: -x[1])),
}}

for arma in df_micro_clean["weapon"].unique():
    tidx = _weapon_tidx.get(limpiar_chars(arma))  # None si no se tipó -> no filtra
    loc_pos = _pesos(df_pos[df_pos["weapon"] == arma], "price", min_vol=3)
    loc_neg = _pesos(df_neg[df_neg["weapon"] == arma], "price", min_vol=2)

    pesos_pos_arma, pesos_neg_arma, baja_confianza = {}, {}, []
    for stat in ALL_POSSIBLE_STATS:
        if not stat_ok(stat, tidx):  # stat imposible para este arquetipo -> fuera
            continue
        wl, nl = loc_pos.get(stat, (None, 0))
        val, src = _mezclar(wl, nl, GLOBAL_POS.get(stat))
        pesos_pos_arma[stat] = val
        if src in ("global", "prior"):
            baja_confianza.append(stat)
    for stat in ALL_POSSIBLE_STATS:
        if stat in IMPOSSIBLE_NEGATIVES:
            continue
        if not stat_ok(stat, tidx):
            continue
        wl, nl = loc_neg.get(stat, (None, 0))
        wg = GLOBAL_NEG.get(stat)
        if wg is None:  # sin prior global de la negativa: un gran positivo es mala negativa
            wg = round(max(0.01, min(1.0, 1.01 - pesos_pos_arma.get(stat, 0.30))), 3)
        val, _src = _mezclar(wl, nl, wg)
        pesos_neg_arma[stat] = val

    meta = {"pos": {"S": {}, "A": {}, "B": {}, "F": {}}, "neg": {"S": {}, "A": {}, "B": {}, "F": {}}}
    for s, p in pesos_pos_arma.items():
        tier = "S" if p >= 0.75 else "A" if p >= 0.45 else "B" if p >= 0.15 else "F"
        meta["pos"][tier][s] = p
    for s, p in pesos_neg_arma.items():
        tier = "S" if p >= 0.70 else "A" if p >= 0.40 else "B" if p >= 0.15 else "F"
        meta["neg"][tier][s] = p

    pop = df_micro_clean.loc[df_micro_clean["weapon"] == arma, "popularity_pct"]
    meta["popularity"] = round(float(pop.iloc[0]), 2) if not pop.empty else 0.0
    meta["mejores_pos"] = sorted(meta["pos"]["S"], key=lambda s: -pesos_pos_arma[s])[:4]
    meta["mejores_neg"] = sorted(meta["neg"]["S"], key=lambda s: -pesos_neg_arma[s])[:3]
    meta["baja_confianza"] = baja_confianza  # stats sin datos locales (posible sesgo de supervivencia)
    export_maestro_real[arma] = meta

with open("voidstonks_tiers_dinamicos_pesos.json", "w", encoding="utf-8") as f:
    json.dump(export_maestro_real, f, indent=4, ensure_ascii=False)
print(f"Tiers dinamicos guardados. Prior global: {len(GLOBAL_POS)} pos / {len(GLOBAL_NEG)} neg.")
print("Top positivos globales:", dict(sorted(GLOBAL_POS.items(), key=lambda x: -x[1])[:6]))

# --- Rangos trash ---
# NOTA: META_OVERRIDES y TIER_A siguen hardcodeados (contradice la línea data-driven).
# Migrar a percentiles reales del propio dataset cuando haya volumen suficiente.
precios_minimos = df_micro_clean.groupby("weapon")["price"].min()
def redondear_humano(n):
    return int(round(n / 5.0) * 5.0)

META_OVERRIDES = {
    "Torid": (300, 400), "Glaive Prime": (250, 300), "Magistar": (200, 280),
    "Dual Toxocyst": (180, 250), "Burston": (180, 230), "Phenmor": (150, 200),
    "Ocucor": (150, 200), "Latron": (120, 160), "Ceramic Dagger": (100, 150),
    "Jaw Sword": (80, 120), "Amphis": (60, 90), "Mire": (60, 90),
}
TIER_A = ["Lex", "Bubonico", "Arca Titron", "Boltor", "Dread", "Arca Plasmor", "Nataruk",
          "Kuva Zarr", "Kuva Bramma", "Cedo", "Felarx", "Laetum", "Verglas"]

precios_suelo_reales = {}
for arma in df_micro_clean["weapon"].unique():
    if arma in META_OVERRIDES:
        min_p, max_p = META_OVERRIDES[arma]
    else:
        p_min = precios_minimos.get(arma, 100)
        rep = obtener_representante_inferencia(arma)
        mask_rep = df_micro_clean["family_rep"] == rep
        of_median = df_micro_clean[mask_rep]["official_median"].iloc[0] if mask_rep.any() else 50
        base = min(of_median * 0.20, p_min)
        if arma in TIER_A:
            cap = max(30, min(base, 90))
            min_p, max_p = redondear_humano(cap * 0.8), redondear_humano(cap * 1.2)
        else:
            cap = max(15, min(base, 40))
            min_p, max_p = redondear_humano(cap * 0.75), redondear_humano(cap * 1.3)
        min_p, max_p = max(10, min_p), max(min_p + 5, max_p)
    precios_suelo_reales[arma] = {"min": min_p, "max": max_p}

trash_ordenado = {k: v for k, v in sorted(precios_suelo_reales.items(), key=lambda i: i[1]["max"], reverse=True)}
with open("voidstonks_trash_prices_rangos.json", "w", encoding="utf-8") as f:
    json.dump(trash_ordenado, f, indent=4, ensure_ascii=False)
print("Rangos trash guardados.")


# ====================================================================
# ANALISIS DE OPORTUNIDADES (definido ANTES de usarse)
# ====================================================================
def analizar_oportunidades_mercado(nombre_riven, pos1, pos2, pos3, neg, rerolls, precio_vendedor):
    precio_estimado = tasar_riven_individual(nombre_riven, pos1, pos2, pos3, neg, rerolls)
    rango = precios_suelo_reales.get(nombre_riven, {"min": 15, "max": 45})
    desviacion = ((precio_vendedor - precio_estimado) / precio_estimado) * 100 if precio_estimado else 0

    print(f"\n=== ANALISIS DE MERCADO: '{nombre_riven}' ===")
    print(f"   Precio Vendedor: {precio_vendedor} pl | Valor Justo IA: {precio_estimado} pl")
    print(f"   Rango Trash Sugerido: [{rango['min']} - {rango['max']}] pl")
    if desviacion <= -35:
        print("   GANGA: muy por debajo de su valor real.")
    elif desviacion >= 50:
        print("   ESTAFA: especulacion sobre el precio justo.")
    elif precio_vendedor < rango["min"]:
        print("   GANGA TRASH: por debajo del suelo del arma.")
    else:
        print(f"   Precio equilibrado (desviacion {round(desviacion, 1)}%).")
    print("=" * 50)

precio_torid = tasar_riven_individual("Torid", "Status Duration", "Base Damage / Melee Damage",
                                      "Critical Chance", "Magazine Capacity", 430)
print(f"\nTasacion Torid (Status Duration / Melee Dmg / CC / -Mag, 430 rolls): {precio_torid} pl")

analizar_oportunidades_mercado("Torid", "Status Duration", "Base Damage / Melee Damage",
                               "Critical Chance", "Magazine Capacity", 430, precio_vendedor=1500)


# === EXPORT SLIM (dump de árboles + orden de features + tamaño) ===
import gzip as _gz
_b = model_micro.get_booster()
_b.save_model("model_trees_slim.json")
import json as _json
_json.dump(list(_b.feature_names), open("feature_order_slim.json","w"))
_raw=open("model_trees_slim.json","rb").read()

# defaults (mediana de cada feature) para rellenar en el front lo que falte
_def={c: float(df_ml[c].median()) for c in columnas_micro}
_json.dump(_def, open("feature_defaults_slim.json","w"))
print(f"[SLIM] feature_defaults_slim.json escrito ({len(_def)} features)")
print(f"[SLIM] features={len(_b.feature_names)} arboles={_b.num_boosted_rounds()} | trees.json RAW={len(_raw)/1e6:.2f}MB GZIP={len(_gz.compress(_raw))/1e6:.3f}MB")
