# -*- coding: utf-8 -*-
"""tests predicting a relative riven_score (intra-weapon price percentile 0-1) instead of absolute price
decouples transferable roll quality from weapon price level and asks noise, mapping score to price via
weapon quantile bands
"""
import os
import re
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from xgboost import XGBRegressor
from sklearn.metrics import r2_score, mean_absolute_error

CSV = os.environ.get("VOIDSTONKS_CSV",
                     "/var/home/ppsoy/Documentos/GitHub/Voidstonks-cron/historial_precios/dataset_raw_ml.csv")
CW = "/var/home/ppsoy/Escritorio/voidstonks/deploy/assets/json/cleaned_weapons.json"

print("Cargando...")
df = pd.read_csv(CSV)
df = df[pd.to_numeric(df["price"], errors="coerce").notna()]
df["price"] = df["price"].astype(float)
df = df[df["price"] > 0]
df = df.drop_duplicates(subset=[c for c in ["weapon", "stat_pos1", "stat_pos2", "stat_pos3", "stat_neg", "price"] if c in df.columns], keep="last")
vc = df["weapon"].value_counts()
df = df[df["weapon"].isin(vc[vc >= 40].index)].copy()  # >=40 for stable percentiles and score
df["price"] = df.groupby("weapon")["price"].transform(lambda s: s.clip(upper=s.quantile(0.95)))
print(f"  filas {len(df)} | armas {df['weapon'].nunique()}")

# 1) trash, average and godroll correlation across weapons
band = df.groupby("weapon")["price"].agg(
    trash=lambda s: s.quantile(0.15), avg="median", god=lambda s: s.quantile(0.88))
print("\n=== CORRELACIÓN entre tiers (log, entre armas) ===")
lb = np.log1p(band)
print(f"  trash~god : {lb['trash'].corr(lb['god']):.3f}")
print(f"  avg~god   : {lb['avg'].corr(lb['god']):.3f}")
print(f"  trash~avg : {lb['trash'].corr(lb['avg']):.3f}")
print(f"  ratio god/trash mediano: {(band['god']/band['trash'].clip(lower=1)).median():.1f}x | avg/trash: {(band['avg']/band['trash'].clip(lower=1)).median():.1f}x")

# 2) target: riven_score (price percentile within weapon)
df["score"] = df.groupby("weapon")["price"].rank(pct=True)

# roll-ONLY features without weapon price level
pos_cols = ["stat_pos1", "stat_pos2", "stat_pos3"]
pos_stats = sorted({s for c in pos_cols for s in df[c].dropna().unique() if s and s != "None"})
neg_stats = sorted({s for s in df["stat_neg"].dropna().unique() if s and s != "None"})
for s in pos_stats:
    df[f"p::{s}"] = ((df["stat_pos1"] == s) | (df["stat_pos2"] == s) | (df["stat_pos3"] == s)).astype(int)
for s in neg_stats:
    df[f"n::{s}"] = (df["stat_neg"] == s).astype(int)
df["num_pos"] = sum(((df[f"stat_pos{i}"].notna()) & (df[f"stat_pos{i}"] != "None")).astype(int) for i in (1, 2, 3))
df["has_neg"] = ((df["stat_neg"].notna()) & (df["stat_neg"] != "None")).astype(int)

# stat BUDGET multiplier by (num_pos, has_neg): higher coefficient gives larger positives (+2/-1 boosts
# positives ~+30%)
BUDGET = {(2, 0): 0.99, (2, 1): 1.2375, (3, 0): 0.75, (3, 1): 0.9375, (1, 0): 1.0, (1, 1): 1.5}
df["budget_coef"] = [BUDGET.get((int(p), int(n)), 1.0) for p, n in zip(df["num_pos"], df["has_neg"])]
# HARMLESS negative: free catalyst boosting positives without combat penalty
_HARMLESS = re.compile(r"zoom|recoil|impact|puncture|ammo|magazine|reload|projectile|combo dur", re.I)
df["harmless_neg"] = df["stat_neg"].fillna("").map(lambda s: 1 if (s and s != "None" and _HARMLESS.search(s)) else 0)

# disposition and archetype
import json
T2I = {"Rifle": 0, "Sniper": 0, "Bow": 0, "Launcher": 0, "Sentinel": 0, "Companion Weapon": 0,
       "Shotgun": 1, "Pistol": 2, "Dual Pistols": 2, "Thrown": 2, "Throwing": 2, "Kitgun": 2,
       "Melee": 3, "Zaw": 3, "Zaw Component": 3, "Glaive": 3, "Arch-Gun": 4, "Archgun": 4}
dispo, arch = {}, {}
for w in json.load(open(CW)):
    c = re.sub(r"[^a-z0-9]", "", str(w.get("name", "")).lower())
    dispo[c] = float(w.get("omegaAttenuation") or 1.0); arch[c] = T2I.get(w.get("type"), 0)
cl = df["weapon"].map(lambda w: re.sub(r"[^a-z0-9]", "", str(w).lower()))
df["disposition"] = cl.map(lambda c: dispo.get(c, 1.0))
df["archetype"] = cl.map(lambda c: arch.get(c, 0))

feat = [c for c in df.columns if c.startswith("p::") or c.startswith("n::")] + ["num_pos", "has_neg", "disposition", "archetype", "budget_coef", "harmless_neg"]

# 3) weapon-stratified split
tr, te = train_test_split(df, test_size=0.2, random_state=42, stratify=df["weapon"])
tr = tr.copy(); te = te.copy()

# WEAPON-AWARE: stat value for THIS weapon computed strictly on train (no leakage) as mean score of rolls
# with that stat
_long = []
for i in (1, 2, 3):
    _long.append(tr[[f"stat_pos{i}", "weapon", "score"]].rename(columns={f"stat_pos{i}": "stat"}))
_long = pd.concat(_long)
_long = _long[(_long["stat"].notna()) & (_long["stat"] != "None")]
wstat = _long.groupby(["weapon", "stat"])["score"].mean().to_dict()   # stat value PER WEAPON
gstat = _long.groupby("stat")["score"].mean().to_dict()               # global fallback
def _synergy(row):
    vals = [wstat.get((row["weapon"], row[f"stat_pos{i}"]), gstat.get(row[f"stat_pos{i}"], 0.5))
            for i in (1, 2, 3) if row[f"stat_pos{i}"] and row[f"stat_pos{i}"] != "None"]
    return float(np.mean(vals)) if vals else 0.5
def _topw(row):
    vals = [wstat.get((row["weapon"], row[f"stat_pos{i}"]), gstat.get(row[f"stat_pos{i}"], 0.5))
            for i in (1, 2, 3) if row[f"stat_pos{i}"] and row[f"stat_pos{i}"] != "None"]
    return float(np.max(vals)) if vals else 0.5
def _negbad(row):
    s = row["stat_neg"]
    if not s or s == "None": return 0.0
    return float(wstat.get((row["weapon"], s), gstat.get(s, 0.3)))  # how desired the negative stat is
for d in (tr, te):
    d["synergy_w"] = d.apply(_synergy, axis=1)
    d["topstat_w"] = d.apply(_topw, axis=1)
    d["neg_bad"] = d.apply(_negbad, axis=1)
feat = feat + ["synergy_w", "topstat_w", "neg_bad"]

m = XGBRegressor(n_estimators=600, learning_rate=0.05, max_depth=6, subsample=0.85,
                 colsample_bytree=0.8, reg_alpha=1, reg_lambda=3, tree_method="hist", random_state=42)
m.fit(tr[feat], tr["score"])
te["score_pred"] = np.clip(m.predict(te[feat]), 0, 1)

# 4) evaluate SCORE
r2s = r2_score(te["score"], te["score_pred"])
# intra-weapon Spearman rank correlation
def _spear(g):
    if len(g) < 6: return np.nan
    return g["score"].corr(g["score_pred"], method="spearman")
sp = te.groupby("weapon").apply(_spear).dropna()
print("\n=== RIVEN SCORE (calidad del roll) ===")
print(f"  R2 del score (0-1): {r2s:.3f}")
print(f"  Spearman MEDIANO por arma (ranking de rolls): {sp.median():.3f}  (armas {len(sp)})")

# 5) score-to-price mapping via weapon QUANTILE FUNCTION (full distribution, not 3 points)
# score 0.9 maps to p90 price of that weapon, winsorized to p97 on train ONLY (no leakage)
wq = {}
for w, g in tr.groupby("weapon"):
    arr = np.sort(g["price"].clip(upper=g["price"].quantile(0.97)).values)
    if len(arr) >= 8:
        wq[w] = arr
def map_price(row):
    arr = wq.get(row["weapon"])
    if arr is None: return np.nan
    return float(np.quantile(arr, np.clip(row["score_pred"], 0, 1)))
def map_range(row):
    arr = wq.get(row["weapon"])
    if arr is None: return (np.nan, np.nan)
    s = np.clip(row["score_pred"], 0, 1)
    return (float(np.quantile(arr, max(0, s - 0.12))), float(np.quantile(arr, min(1, s + 0.12))))
te["price_pred"] = te.apply(map_price, axis=1)
_rng = te.apply(map_range, axis=1)
te["rng_lo"] = [r[0] for r in _rng]; te["rng_hi"] = [r[1] for r in _rng]
ok = te["price_pred"].notna() & (te["price"] > 5)
mape = float((np.abs(te.loc[ok, "price_pred"] - te.loc[ok, "price"]) / te.loc[ok, "price"]).mean() * 100)
mae = mean_absolute_error(te.loc[ok, "price"], te.loc[ok, "price_pred"])
# percentage of real prices falling within predicted RANGE (score±0.12)
in_rng = float(((te.loc[ok, "price"] >= te.loc[ok, "rng_lo"]) & (te.loc[ok, "price"] <= te.loc[ok, "rng_hi"])).mean() * 100)
print("\n=== SCORE -> PRECIO (función cuantil del arma) ===")
print(f"  MAPE: {mape:.1f} %   (banda 3-puntos: 123% | modelo directo: ~80%)")
print(f"  cobertura del rango (score±0.12): {in_rng:.0f}% de precios reales dentro")
print(f"  MAE : +/- {mae:.0f} pl")
print(f"  features: {len(feat)} (solo roll, sin nivel de precio)")

# 6) GODROLL DETECTION: godroll = price > weapon p90
# classification (godroll yes/no) is more robust to noise than exact price prediction
from sklearn.metrics import roc_auc_score, precision_score, recall_score
_p90 = tr.groupby("weapon")["price"].quantile(0.90)
_p15 = tr.groupby("weapon")["price"].quantile(0.15)
te["godroll_true"] = (te["price"] >= te["weapon"].map(_p90).fillna(te["price"].quantile(0.90))).astype(int)
te["trash_true"] = (te["price"] <= te["weapon"].map(_p15).fillna(te["price"].quantile(0.15))).astype(int)
auc_g = roc_auc_score(te["godroll_true"], te["score_pred"]) if te["godroll_true"].nunique() > 1 else float("nan")
auc_t = roc_auc_score(te["trash_true"], 1 - te["score_pred"]) if te["trash_true"].nunique() > 1 else float("nan")
for thr in (0.80, 0.85, 0.90):
    pg = (te["score_pred"] >= thr).astype(int)
    pr = precision_score(te["godroll_true"], pg, zero_division=0)
    rc = recall_score(te["godroll_true"], pg, zero_division=0)
    print(f"  score>={thr:.2f} -> godroll: precisión {pr*100:4.0f}% | recall {rc*100:4.0f}%")
print("\n=== DETECCIÓN DE TIER (clasificación, no regresión) ===")
print(f"  ROC-AUC GODROLL (>p90): {auc_g:.3f}   <- 0.5 azar, 1 perfecto")
print(f"  ROC-AUC TRASH   (<p15): {auc_t:.3f}")
print("  (clasificar tier es mucho más fiable que el precio exacto con datos ruidosos)")
