# -*- coding: utf-8 -*-
"""EXPERIMENTO: modelo POR ARMA (partial pooling) en vez de un global con one-hot.

Idea: el precio de un riven = nivel de mercado del arma  ×  calidad del roll.
  - NIVEL del arma: la mediana (log) de precios de esa arma (de los datos) -> el "mercado".
  - CALIDAD del roll: efecto de cada stat/negativa, aprendido POR ARMA con una Ridge local,
    y MEZCLADO (shrinkage) con el efecto GLOBAL por volumen -> armas con pocos datos heredan
    el efecto global; armas con muchos datos confían en el suyo. (Antídoto de sobreajuste.)
  - REFUERZO de mercado: la popularidad entra como feature ligera del efecto de roll.

Objetivo: subir el R² INTRA-ARMA (cuánto explica la calidad del roll DENTRO de cada arma),
que en el XGBoost global es ~0.50. Comparamos contra esa cifra.

Corre con el venv (sklearn/pandas/numpy). Usa el dataset local + cache de API (popularidad).
"""
import json
import os
import re
import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge
from sklearn.model_selection import train_test_split
from sklearn.metrics import r2_score, mean_absolute_error

CSV = os.environ.get("VOIDSTONKS_CSV",
                     "/var/home/ppsoy/Documentos/GitHub/Voidstonks-cron/historial_precios/dataset_raw_ml.csv")
CACHE = "cache_datos_api.json"  # generado por ML_local.py (api_map con popularidad/dynamic_weights)
MIN_ROWS = 25      # armas con >= N filas entran
K_SHRINK = float(os.environ.get("KSHRINK", 40))
RIDGE_A = 8.0

print("Cargando dataset...")
df = pd.read_csv(CSV)
df = df[pd.to_numeric(df["price"], errors="coerce").notna()]
df["price"] = df["price"].astype(float)
df = df[df["price"] > 0]
dedup = [c for c in ["weapon", "stat_pos1", "stat_pos2", "stat_pos3", "stat_neg", "price"] if c in df.columns]
df = df.drop_duplicates(subset=dedup, keep="last")
vc = df["weapon"].value_counts()
df = df[df["weapon"].isin(vc[vc >= MIN_ROWS].index)].copy()
# winsorize cola alta por arma (listados troll)
df["price"] = df.groupby("weapon")["price"].transform(lambda s: s.clip(upper=s.quantile(0.90)))
df["logp"] = np.log1p(df["price"])
print(f"  filas: {len(df)} | armas: {df['weapon'].nunique()}")

# --- features de ROLL (binarias por stat) ---
pos_cols = ["stat_pos1", "stat_pos2", "stat_pos3"]
pos_stats = sorted({s for c in pos_cols for s in df[c].dropna().unique() if s and s != "None"})
neg_stats = sorted({s for s in df["stat_neg"].dropna().unique() if s and s != "None"})
for s in pos_stats:
    df[f"p::{s}"] = ((df["stat_pos1"] == s) | (df["stat_pos2"] == s) | (df["stat_pos3"] == s)).astype(int)
for s in neg_stats:
    df[f"n::{s}"] = (df["stat_neg"] == s).astype(int)
feat = [c for c in df.columns if c.startswith("p::") or c.startswith("n::")]

# --- refuerzo de mercado: popularidad desde la cache de API ---
pop_map = {}
if os.path.exists(CACHE):
    api_map = json.load(open(CACHE)).get("api_map", {})
    for w, v in api_map.items():
        de = (v.get("de_unrolled") or {}).get("pop") or 0
        dr = (v.get("de_rerolled") or {}).get("pop") or 0
        pop_map[w] = float(de) + float(dr)
df["pop"] = df["weapon"].map(lambda w: pop_map.get(str(w).strip().lower(), 0.0))
df["pop_n"] = np.clip(df["pop"] / 50.0, 0, 2)  # normalizada, refuerzo suave
feat_g = feat + ["pop_n"]  # el global usa popularidad; el local solo stats

# --- split ---
tr, te = train_test_split(df, test_size=0.2, random_state=42)
gmean = tr["logp"].mean()
wbase = tr.groupby("weapon")["logp"].mean()  # NIVEL de mercado del arma (de train)
def base_of(w):
    return wbase.get(w, gmean)

tr = tr.copy(); te = te.copy()
tr["res"] = tr["logp"] - tr["weapon"].map(base_of)

# --- efecto GLOBAL de stats (+popularidad) sobre el residuo ---
gm = Ridge(alpha=RIDGE_A).fit(tr[feat_g], tr["res"])
gcoef = dict(zip(feat_g, gm.coef_)); gint = gm.intercept_

# --- efecto POR ARMA con shrinkage al global ---
local_coef = {}
for w, g in tr.groupby("weapon"):
    if len(g) >= 12:
        lm = Ridge(alpha=RIDGE_A).fit(g[feat], g["res"])
        a = len(g) / (len(g) + K_SHRINK)
        c = {f: a * lm.coef_[i] + (1 - a) * gcoef.get(f, 0.0) for i, f in enumerate(feat)}
    else:
        c = {f: gcoef.get(f, 0.0) for f in feat}
    local_coef[w] = c

# --- predicción en test ---
fmat = te[feat].values
def predict_row(i, row):
    c = local_coef.get(row["weapon"])
    roll = gint + gcoef.get("pop_n", 0.0) * row["pop_n"]
    if c:
        roll += float(np.dot(fmat[i], np.array([c[f] for f in feat])))
    return base_of(row["weapon"]) + roll
te = te.reset_index(drop=True)
fmat = te[feat].values
te["pred"] = [predict_row(i, r) for i, r in te.iterrows()]

# --- métricas ---
mean_arma = te["weapon"].map(base_of)
ss_res = float(((te["logp"] - te["pred"]) ** 2).sum())
ss_tot_intra = float(((te["logp"] - mean_arma) ** 2).sum())
r2_intra = 1 - ss_res / ss_tot_intra if ss_tot_intra > 0 else float("nan")
r2 = r2_score(te["logp"], te["pred"])
mae = mean_absolute_error(np.expm1(te["logp"]), np.expm1(te["pred"]))
rmse = float(np.sqrt(((np.expm1(te["logp"]) - np.expm1(te["pred"])) ** 2).mean()))

print("\n" + "=" * 60)
print("MODELO POR ARMA (partial pooling) — test held-out")
print("=" * 60)
print(f"  R2 (log)            : {r2:.4f}")
print(f"  R2 intra-arma (log) : {r2_intra:.4f}   <- comparar con XGBoost global ~0.50")
print(f"  MAE                 : +/- {mae:.1f} pl")
print(f"  RMSE                : +/- {rmse:.1f} pl")
print("=" * 60)
print(f"  armas con modelo local propio: {sum(1 for w,g in tr.groupby('weapon') if len(g)>=12)}")
print(f"  features de roll: {len(feat)}  | refuerzo: popularidad")

# --- Guardar resultados en archivo de comparación ---
comparison_path = "../../tests/model_comparison.md"
with open(comparison_path, "w", encoding="utf-8") as f:
    f.write("# Comparativa de Modelos de Tasación ML\n\n")
    f.write("## Modelo por Arma (Ridge Partial Pooling)\n\n")
    f.write(f"- **R² (log)**: {r2:.4f}\n")
    f.write(f"- **R² Intra-Arma (log)**: {r2_intra:.4f} (Calidad del roll dentro de cada arma)\n")
    f.write(f"- **MAE**: +/- {mae:.1f} pl\n")
    f.write(f"- **RMSE**: +/- {rmse:.1f} pl\n")
    f.write(f"- **Armas con modelo local**: {sum(1 for w,g in tr.groupby('weapon') if len(g)>=12)}\n")
print(f"\n[TEST] Comparación de modelo guardada en {comparison_path}")
