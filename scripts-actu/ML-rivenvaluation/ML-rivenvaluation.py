# -*- coding: utf-8 -*-
"""trains the riven valuation ML model on market auctions and exports frontend bundles
stat weights mix with a GLOBAL PRIOR via volume shrinkage to prevent survivorship bias
synergy normalizes raw stat magnitudes empirically by (weapon, stat)
"""

import io
import os
import re
import time
import json
import requests
import numpy as np
import pandas as pd
from google.colab import userdata
print("FASE 1: INGESTA, DEDUPLICACION Y AGRUPACION DE FAMILIAS")

# dataset download: token comes from the environment, never hardcoded
GITHUB_TOKEN =userdata.get('GITHUB_TOKEN')
if not GITHUB_TOKEN:
    raise SystemExit(
        "Falta GITHUB_TOKEN. En Colab: from google.colab import userdata; "
        "os.environ['GITHUB_TOKEN']=userdata.get('GITHUB_TOKEN'). En local: export GITHUB_TOKEN=..."
    )

USER, REPO = "edelaf01", "Voidstonks-cron"
PATH = "historial_precios/dataset_raw_ml.csv"
url_github = f"https://api.github.com/repos/{USER}/{REPO}/contents/{PATH}"
headers_github = {"Authorization": f"Bearer {GITHUB_TOKEN}", "Accept": "application/vnd.github.v3.raw"}

res_gh = requests.get(url_github, headers=headers_github, timeout=30)
if res_gh.status_code != 200:
    raise SystemExit(f"Fallo en GitHub: {res_gh.status_code} {res_gh.text[:200]}")

df_micro = pd.read_csv(io.StringIO(res_gh.text))
for n in ["re_rolls", "rolls", "Rerolls"]:
    if n in df_micro.columns:
        df_micro.rename(columns={n: "rerolls"}, inplace=True)
print(f"Dataset crudo cargado: {df_micro.shape[0]} filas.")

# drops exact reposts WITHOUT losing real price variance: including `price` in the key collapses identical
# listings at the same price but keeps different prices for the same combo
clave_dedup = [c for c in ["weapon", "stat_pos1", "stat_pos2", "stat_pos3", "stat_neg", "rerolls", "price"]
               if c in df_micro.columns]
antes = df_micro.shape[0]
df_micro.drop_duplicates(subset=clave_dedup, keep="last", inplace=True)
print(f"Reposts exactos eliminados: {antes - df_micro.shape[0]} (conservada la varianza de precio).")

# prime vs base, Kuva/Tenet and Mutalist have DIFFERENT dispositions and rivens: family is only used for
# macro fallback
PREFIJOS = r"\b(kuva|tenet|prisma|mara|dex|synoid|telos|vaykor|secura|rakta|sancti|coda|carmine|mk1|mk-1)\b"
SUFIJOS = r"\b(prime|vandal|wraith|incarnon)\b"  # 'mutalist' is NOT stripped: it is a separate weapon

# variants kept as their own family, matching inference
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

    # /api/rivens returns the FULL dictionary and ignores ?weapon, so a single call fetches all
    api_map = {}
    try:
        full = sess.get(API_BASE, timeout=30).json()
        api_map = {k.lower(): v for k, v in full.items()
                   if k != "__baseline" and isinstance(v, dict)}
        print(f"  macro: {len(api_map)} armas indexadas.")
    except Exception as e:
        print(f"  [WARN] /api/rivens falló: {e}")

    # /api/history is per weapon; reads h.json()['data']
    datos_temporales = []
    fallos_hist = 0
    for arma in df_micro["weapon"].unique():
        if pd.isna(arma) or not str(arma).strip():
            continue
        q = str(arma).strip().lower()
        try:
            h = sess.get(API_HISTORY, params={"weapon": q}, timeout=10).json()
            data = h.get("data") if isinstance(h, dict) else h  # tolerates old list format
            if not data:
                continue
            df_t = pd.DataFrame(data).sort_values("date")
            serie = pd.to_numeric(df_t["wfm_avg_price"], errors="coerce").dropna()
            f_h = df_t.iloc[-1]
            # median instead of mean: troll spikes (1k-20k) distort the mean
            wfm_med = (float(serie.median()) + 0.1) if len(serie) else 0.1
            off_med = pd.to_numeric(df_t["official_median"], errors="coerce").median() + 0.1
            # 7d trend: mean of the last 7 days vs the previous 7 days to capture market direction
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
                "hist_momentum": float(round(f_h["wfm_avg_price"] / wfm_med, 3)),  # vs robust median
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

# weapon macro lookup with fallback to family without injecting raw dictionaries
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
    # /api/rivens does NOT expose popularity_pct: derived from DE popularity (unrolled + rerolled)
    fila["popularity_pct"] = (de_un.get("pop") or 0) + (de_re.get("pop") or 0)
    fila["wfm_market_sample"] = rec.get("wfm_market_sample")   # live auctions indicate liquidity and demand
    fila["liquidity_score"] = rec.get("liquidity_score")
    fila["volatility_index"] = rec.get("volatility_index")
    fila["rerolled_premium_ratio"] = rec.get("rerolled_premium_ratio")
    fila["web_min"] = rec.get("web_min")
    fila["web_max"] = rec.get("web_max")
    fila["trend_7d_pct"] = rec.get("trend_7d_pct")             # official trend precomputed by the worker
    macro_rows.append(fila)

df_macro = pd.DataFrame(macro_rows) if macro_rows else pd.DataFrame(columns=["weapon"] + MACRO_FIELDS)
df_temp = pd.DataFrame(datos_temporales) if datos_temporales else pd.DataFrame(columns=["weapon"] + HIST_FIELDS)

df_micro = df_micro.merge(df_macro, on="weapon", how="left").merge(df_temp, on="weapon", how="left")

if "rerolls" not in df_micro.columns:
    df_micro["rerolls"] = 0
df_micro["rerolls"] = df_micro["rerolls"].fillna(0).astype(int)

# imputation WITHOUT leakage: never with price, uses column median plus missing flag
for col in ["official_median", "wfm_avg"]:
    if col not in df_micro.columns:
        df_micro[col] = np.nan
    df_micro[f"{col}_missing"] = df_micro[col].isna().astype(int)
    med = df_micro[col].median()
    df_micro[col] = df_micro[col].fillna(med if pd.notna(med) else 0.0)

# secondary macro signals
for col in ["popularity_pct", "wfm_market_sample", "liquidity_score", "volatility_index",
            "rerolled_premium_ratio", "web_min", "web_max", "trend_7d_pct"]:
    if col not in df_micro.columns:
        df_micro[col] = np.nan
defaults_macro = {"popularity_pct": 0.0, "wfm_market_sample": 0.0, "liquidity_score": 30.0,
                  "volatility_index": 3.0, "rerolled_premium_ratio": 1.0, "web_min": 0.0,
                  "web_max": 0.0, "trend_7d_pct": 0.0}
for col, dv in defaults_macro.items():
    df_micro[col] = df_micro[col].fillna(dv)

# history features with defaults only where missing
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

# fatigue_index does NOT use price: official_median uses macro median
conteo = df_micro["weapon"].value_counts()
df_micro_clean = df_micro[df_micro["weapon"].isin(conteo[conteo >= 25].index)].copy()
df_micro_clean["fatigue_index"] = df_micro_clean["rerolls"] / (df_micro_clean["official_median"] + 1)
print(f"Pipeline OK. Filas listas: {df_micro_clean.shape[0]} | armas: {df_micro_clean['weapon'].nunique()}")


from sklearn.model_selection import train_test_split

print("\nFASE 3: FEATURES (ONE-HOT) Y MATRICES")

# empirical magnitude normalization by (weapon, stat): 0..1 = |val| / p95(|val|) without hardcoded
# coefficients
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
        return 1.0
    ref = ref_mag.get((weapon, stat))
    if not ref:
        return 1.0
    return float(np.clip(abs(float(val)) / abs(ref), 0.0, 1.0))

def calcular_sinergia(row):
    """continuous stat contribution = peso_meta * magnitud_norm without binary penalties: a well-rolled meh
    adds value, while trash contributes little
    """
    pesos = lookup_macro(row["weapon"]).get("dynamic_weights", {})
    score = 0.0
    for i in (1, 2, 3):
        stat = row[f"stat_pos{i}"]
        if pd.notna(stat) and stat != "None":
            score += pesos.get(stat, 0.05) * _mag_norm(row["weapon"], stat, row.get(f"mag_pos{i}"))
    return round(score, 4)

df_micro_clean["synergy_score"] = df_micro_clean.apply(calcular_sinergia, axis=1)

# explicit magnitude features for the model
if HAS_MAG:
    for i in (1, 2, 3):
        df_micro_clean[f"mag_pos{i}_norm"] = df_micro_clean.apply(
            lambda r: _mag_norm(r["weapon"], r[f"stat_pos{i}"], r.get(f"mag_pos{i}")), axis=1)
    df_micro_clean["mag_pos_avg"] = df_micro_clean[[f"mag_pos{i}_norm" for i in (1, 2, 3)]].mean(axis=1)

# DYNAMIC thresholds from actual synergy percentiles instead of hardcoded 1.3 and 1.7
SYN_P60 = float(df_micro_clean["synergy_score"].quantile(0.60))
SYN_P85 = float(df_micro_clean["synergy_score"].quantile(0.85))
print(f"  Umbrales dinámicos -> burner<{SYN_P60:.2f} | godroll>={SYN_P85:.2f}")

df_ml = df_micro_clean.copy()

# weapon ONE-HOT concatenated to the matrix
armas_dummies = pd.get_dummies(df_ml["weapon"], prefix="weapon").astype(int)
df_ml = pd.concat([df_ml, armas_dummies], axis=1)

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
                  "mag_pos_avg", "mag_pos1_norm", "mag_pos2_norm", "mag_pos3_norm"]
cols_dummies = [c for c in df_ml.columns if c.startswith("weapon_") or c.startswith("has_pos_stat_") or c.startswith("has_neg_stat_")]
columnas_micro = [c for c in cols_numericas if c in df_ml.columns] + cols_dummies

# p95 winsorization per weapon: listings reach 25k troll asks and unclipped the model learns inflated
# prices, cutting the high tail adaptively
df_ml["price"] = df_ml.groupby("weapon")["price"].transform(lambda s: s.clip(upper=s.quantile(0.90)))

X = df_ml[columnas_micro]
y = np.log1p(df_ml["price"])

# 3-way split: train (80) / early-stop (10) / test (10); test does NOT touch training
X_train, X_tmp, y_train, y_tmp = train_test_split(X, y, test_size=0.20, random_state=42)
X_es, X_test, y_es, y_test = train_test_split(X_tmp, y_tmp, test_size=0.50, random_state=42)
print(f"Matrices: train={X_train.shape[0]} | early-stop={X_es.shape[0]} | test={X_test.shape[0]} | features={len(columnas_micro)}")
print(f"¿one-hot de arma presente? {'sí' if any(c.startswith('weapon_') for c in columnas_micro) else 'NO'}")


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
    n_estimators=1500, learning_rate=0.03, max_depth=7, subsample=0.85,
    colsample_bytree=0.8, reg_alpha=2, reg_lambda=5, min_child_weight=2,
    early_stopping_rounds=100, device=DEVICE, tree_method="hist", random_state=42,
)
# early stopping on X_es, NOT on the test set we report
optimized_xgb.fit(X_train, y_train, eval_set=[(X_es, y_es)], verbose=False)

# metrics on TEST, unseen even for early stopping
y_pred_log = optimized_xgb.predict(X_test)
y_test_real, y_pred_real = np.expm1(y_test), np.expm1(y_pred_log)
mae = mean_absolute_error(y_test_real, y_pred_real)
rmse = np.sqrt(mean_squared_error(y_test_real, y_pred_real))
r2 = r2_score(y_test, y_pred_log)

# intra-weapon R²: how much the model explains BEYOND the weapon mean
# if low, the model only knows which weapon it is rather than how good the roll is
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

    # continuous synergy using the same formula as training
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

    # activates weapon one-hot by matching sanitized names for spaces and casing
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

    # BRICK: a devastating negative (top stat as curse, or universal crit/damage/multishot/fire rate) drops
    # the riven to trash price regardless of the other stats
    rango = precios_suelo_reales.get(nombre_riven) if "precios_suelo_reales" in globals() else None
    BRICK = {"Critical Chance", "Critical Damage", "Base Damage / Melee Damage", "Multishot", "Fire Rate / Attack Speed"}
    if neg != "None" and (neg in BRICK or pesos.get(neg, 0) >= 0.6):
        return float(round(rango["max"] if rango else max(20.0, of_median), 1))

    # modest 0-roll premium for unrolled gamble and burner discount
    # rerolls is NOT in training data (WFM omits it) so this is heuristic; do NOT use rerolled_premium_ratio
    # here (that is godroll-vs-unrolled 2-7x)
    if int(rerolls) == 0:
        precio *= 1.25
    elif score_input < SYN_P60 and int(rerolls) > 20:
        precio *= max(0.6, 1.0 - int(rerolls) / 400.0)

    # continuous synergy positioning: without magnitudes the model resolves poorly WITHIN a weapon
    # (intra-weapon R²~0.56) and predicts baseline for everything
    # synergy places price between trash (~12% of model price) and godroll (100%)
    syn_frac = float(np.clip(score_input / max(SYN_P85, 0.01), 0.0, 1.0))
    precio *= (0.12 + 0.88 * syn_frac)

    # floor, ceiling and premium compression matching the JS version
    if rango:
        precio = max(precio, float(rango["min"]))
    if precio > 2500:
        precio = 2500 + (precio - 2500) * 0.30
    return float(round(min(precio, 15000), 1))

print("Tasacion Kuva Sobek:",
      tasar_riven_individual("Kuva Sobek", "Toxin Damage", "Multishot", "None", "Zoom", 15), "pl")


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
                        "Punch Through"]  # Punch Through cannot roll as a negative curse

# stat validity by weapon archetype to filter out impossible rolls: derived from RIVEN_BASE_STATS where 0
# means impossible
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
# weapons with multiple riven categories: Vinquibus is a Rifle that also accepts melee rivens
ARCHETYPE_EXTRA = {"vinquibus": {3}}

def _load_weapon_types():
    """returns {clean(name): typeIdx} from local path (env VOIDSTONKS_WEAPONS / cleaned_weapons.json) or GitHub"""
    raw = None
    for p in [os.environ.get("VOIDSTONKS_WEAPONS"), "cleaned_weapons.json"]:
        if p and os.path.exists(p):
            try:
                raw = json.load(open(p, encoding="utf-8")); break
            except Exception:
                pass
    if raw is None:  # downloads from the same repo as the dataset
        try:
            _u = f"https://api.github.com/repos/{USER}/{REPO}/contents/cleaned_weapons.json"
            _r = requests.get(_u, headers=headers_github, timeout=30)
            if _r.status_code == 200:
                raw = json.loads(_r.text)
        except Exception:
            pass
    out = {}
    for w in (raw or []):
        t = TYPE_TO_IDX.get(w.get("type"))
        if t is not None:
            clean = limpiar_chars(w.get("name", ""))
            out[clean] = frozenset({t} | ARCHETYPE_EXTRA.get(clean, set()))
    print(f"[ARQUETIPO] {len(out)} armas tipadas" + ("" if out else " — SIN filtro (cleaned_weapons.json no disponible)"))
    return out

_weapon_tidx = _load_weapon_types()

def stat_ok(stat, tset):
    if not tset:
        return True
    v = STAT_VALID.get(stat)
    return True if v is None else any(v[i] for i in tset)

# price relative to weapon median: isolates stat effect from weapon price level as the base for the global
# prior
med_arma = df_micro_clean.groupby("weapon")["price"].transform("median")
df_micro_clean["price_rel"] = df_micro_clean["price"] / (med_arma + 1.0)

df_pos = pd.melt(df_micro_clean, id_vars=["weapon", "price", "price_rel"],
                 value_vars=["stat_pos1", "stat_pos2", "stat_pos3"], value_name="stat").dropna()
df_pos = df_pos[df_pos["stat"] != "None"]
df_neg = df_micro_clean[["weapon", "price", "price_rel", "stat_neg"]].rename(columns={"stat_neg": "stat"})
df_neg = df_neg[(df_neg["stat"].notna()) & (df_neg["stat"] != "None")]

def _pesos(df_long, value_col, min_vol):
    """returns {stat: (weight 0..1, volume)} by median normalized to the group observed range"""
    if df_long.empty:
        return {}
    agr = df_long.groupby("stat").agg(m=(value_col, "median"), vol=(value_col, "count")).reset_index()
    agr = agr[agr["vol"] >= min_vol]
    if agr.empty:
        return {}
    mx, mn = agr["m"].max(), agr["m"].min()
    rng = (mx - mn) or 1.0
    return {r["stat"]: (round(0.01 + 0.99 * ((r["m"] - mn) / rng), 3), int(r["vol"])) for _, r in agr.iterrows()}

# 1) GLOBAL PRIOR per stat across all weapons on relative price
glob_pos = _pesos(df_pos, "price_rel", min_vol=25)
glob_neg = _pesos(df_neg, "price_rel", min_vol=20)
GLOBAL_POS = {s: w for s, (w, _) in glob_pos.items()}
GLOBAL_NEG = {s: w for s, (w, _) in glob_neg.items()}

# 2) global model feature importance per stat for diagnostics
_imp = pd.Series(optimized_xgb.feature_importances_, index=columnas_micro)
MODEL_IMP_POS = {c[len("has_pos_stat_"):]: round(float(v), 4) for c, v in _imp.items() if c.startswith("has_pos_stat_")}
MODEL_IMP_NEG = {c[len("has_neg_stat_"):]: round(float(v), 4) for c, v in _imp.items() if c.startswith("has_neg_stat_")}

# 3) shrinkage weights weapon evidence by volume, falling back to global prior to counter survivorship
# bias
K_PRIOR = 8  # with < K local samples the global prior dominates

def _mezclar(w_local, n_local, w_global, neutro=0.30):
    if w_local is not None and n_local and n_local > 0:
        if w_global is None:
            return round(w_local, 3), "data"
        b = (n_local * w_local + K_PRIOR * w_global) / (n_local + K_PRIOR)
        return round(b, 3), ("data" if n_local >= K_PRIOR else "mix")
    if w_global is not None:
        return round(w_global, 3), "global"   # no local data falls back to global prior
    return neutro, "prior"                     # neither local nor global data returns neutral

export_maestro_real = {"_global": {
    "pos": dict(sorted(GLOBAL_POS.items(), key=lambda x: -x[1])),
    "neg": dict(sorted(GLOBAL_NEG.items(), key=lambda x: -x[1])),
    "model_importance_pos": dict(sorted(MODEL_IMP_POS.items(), key=lambda x: -x[1])),
    "model_importance_neg": dict(sorted(MODEL_IMP_NEG.items(), key=lambda x: -x[1])),
}}

for arma in df_micro_clean["weapon"].unique():
    tidx = _weapon_tidx.get(limpiar_chars(arma))  # None if untyped, disabling filtering
    loc_pos = _pesos(df_pos[df_pos["weapon"] == arma], "price", min_vol=3)
    loc_neg = _pesos(df_neg[df_neg["weapon"] == arma], "price", min_vol=2)

    pesos_pos_arma, pesos_neg_arma, baja_confianza = {}, {}, []
    for stat in ALL_POSSIBLE_STATS:
        if not stat_ok(stat, tidx):  # drops impossible stats for this archetype
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
        if wg is None:  # missing negative global prior: a strong positive is a bad negative
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
    meta["baja_confianza"] = baja_confianza  # stats without local data (potential survivorship bias)
    export_maestro_real[arma] = meta

with open("voidstonks_tiers_dinamicos_pesos.json", "w", encoding="utf-8") as f:
    json.dump(export_maestro_real, f, indent=4, ensure_ascii=False)
print(f"Tiers dinamicos guardados. Prior global: {len(GLOBAL_POS)} pos / {len(GLOBAL_NEG)} neg.")
print("Top positivos globales:", dict(sorted(GLOBAL_POS.items(), key=lambda x: -x[1])[:6]))

# trash ranges: META_OVERRIDES and TIER_A remain hardcoded until dataset volume allows empirical
# percentiles
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
