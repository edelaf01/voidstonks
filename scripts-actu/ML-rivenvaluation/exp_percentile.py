# -*- coding: utf-8 -*-
"""EXPERIMENTO: target de PERCENTIL INTRA-ARMA ("nube de puntos") vs precio log actual.

Idea (usuario, jul 2026): ciertos combos de stats están consistentemente ARRIBA en la nube
de precios de su arma y otros abajo, sea cual sea el nivel de precios del arma. Entrenar el
percentil (posición en la nube) desacopla "calidad del roll" (estable, aprendible) del
"nivel del arma" (volátil, se toma en vivo). El precio final = curva de cuantiles del arma
evaluada en el percentil predicho.

Métricas (mismo split estratificado por arma que exp_run.py):
  Spearman intra   : mediana por arma de la correlación de rango pred-vs-real (¿ordena bien
                     los rolls por stats?). Independiente del nivel y del MAPE del trash.
  R2intra          : el número honesto de siempre (en log-precio, tras mapear percentil->pl).
  MAPE trade       : error % en rolls >=200pl.
  Calibración pct  : |percentil predicho - percentil real| medio (solo modelo percentil).
Uso:  python exp_percentile.py [n_estimators]
"""
import sys, pickle, numpy as np, pandas as pd
from sklearn.model_selection import train_test_split
from scipy.stats import spearmanr
import xgboost as xgb

N = int(sys.argv[1]) if len(sys.argv) > 1 else 600

D = pickle.load(open("exp_matrix.pkl", "rb"))
X = D["X"]
if hasattr(X, "values"):
    X = X.values  # DataFrame -> ndarray para indexar por posición
price_src = D["price"]; price = np.asarray(price_src, dtype=float); weapon = np.asarray(D["weapon"])
ylog = np.log1p(price)

# Percentil intra-arma del precio (0..1): la "posición en la nube" de cada listado.
s_price = pd.Series(price)
s_weap = pd.Series(weapon)
ypct = s_price.groupby(s_weap).rank(pct=True).values

idx = np.arange(len(price))
tr, te = train_test_split(idx, test_size=0.18, random_state=42, stratify=weapon)

PAR = dict(n_estimators=N, max_depth=9, learning_rate=0.03, subsample=0.85,
           colsample_bytree=0.6, min_child_weight=4, reg_lambda=2.5,
           tree_method="hist", n_jobs=-1, random_state=42)

def fit(y):
    m = xgb.XGBRegressor(objective="reg:squarederror", **PAR)
    m.fit(X[tr], y[tr])
    return m.predict(X[te])

print(f"filas={len(price)} armas={len(set(weapon))} feats={X.shape[1]} n={N}")
print("entrenando modelo A (log-precio, enfoque actual)...")
pred_log = fit(ylog)
print("entrenando modelo B (percentil intra-arma, 'nube de puntos')...")
pred_pct = np.clip(fit(ypct), 0.0, 1.0)

w_te, y_te_log, y_te_pct = weapon[te], ylog[te], ypct[te]
real_te = price[te]

# Mapear percentil -> precio con la curva de cuantiles del ARMA construida SOLO con train
# (en producción esta curva sería la banda viva del endpoint: siempre fresca).
qcurves = {}
tr_df = pd.DataFrame({"w": weapon[tr], "p": price[tr]})
for w, g in tr_df.groupby("w"):
    qcurves[w] = np.sort(g["p"].values)
def pct_to_price(w, p):
    arr = qcurves.get(w)
    if arr is None or len(arr) < 5:
        return np.nan
    return float(np.quantile(arr, p))
pred_price_B = np.array([pct_to_price(w, p) for w, p in zip(w_te, pred_pct)])
ok = ~np.isnan(pred_price_B)

def r2_intra(y_true_log, y_pred_log, w):
    d = pd.DataFrame({"w": w, "y": y_true_log, "p": y_pred_log})
    mu = d.groupby("w")["y"].transform("mean")
    ssr = float(((d["y"] - d["p"]) ** 2).sum()); sst = float(((d["y"] - mu) ** 2).sum())
    return 1 - ssr / sst if sst > 0 else float("nan")

def spearman_intra(y_true, y_pred, w, min_n=8):
    d = pd.DataFrame({"w": w, "y": y_true, "p": y_pred})
    vals = []
    for _, g in d.groupby("w"):
        if len(g) >= min_n and g["y"].nunique() > 2:
            r = spearmanr(g["y"], g["p"]).statistic
            if np.isfinite(r):
                vals.append(r)
    return float(np.median(vals)), len(vals)

def mape_trade(real, pred):
    m = real >= 200
    if not m.any():
        return float("nan")
    return float((np.abs(pred[m] - real[m]) / real[m]).mean() * 100)

# --- Modelo A (actual) ---
predA = np.expm1(pred_log)
spA, nw = spearman_intra(real_te, predA, w_te)
print("\n================ COMPARATIVA ================")
print(f"[A] log-precio  : R2intra={r2_intra(y_te_log, pred_log, w_te):.4f}  "
      f"Spearman intra={spA:.3f} ({nw} armas)  MAPEtrade={mape_trade(real_te, predA):.1f}%")

# --- Modelo B (percentil) ---
r2B = r2_intra(y_te_log[ok], np.log1p(pred_price_B[ok]), w_te[ok])
spB, nwB = spearman_intra(real_te, pred_pct, w_te)   # ranking puro: percentil predicho
calib = float(np.mean(np.abs(pred_pct - y_te_pct)))
print(f"[B] percentil   : R2intra={r2B:.4f}  "
      f"Spearman intra={spB:.3f} ({nwB} armas)  MAPEtrade={mape_trade(real_te[ok], pred_price_B[ok]):.1f}%")
print(f"                  calibración |pct_pred - pct_real| media = {calib:.3f} (0=perfecta, 0.33=azar)")

# ¿Dónde gana cada uno? Spearman por arma A-vs-B
dA = pd.DataFrame({"w": w_te, "y": real_te, "p": predA})
dB = pd.DataFrame({"w": w_te, "y": real_te, "p": pred_pct})
rows = []
for w in set(w_te):
    ga, gb = dA[dA.w == w], dB[dB.w == w]
    if len(ga) >= 8 and ga["y"].nunique() > 2:
        ra = spearmanr(ga["y"], ga["p"]).statistic
        rb = spearmanr(gb["y"], gb["p"]).statistic
        if np.isfinite(ra) and np.isfinite(rb):
            rows.append((w, ra, rb, len(ga)))
per = pd.DataFrame(rows, columns=["w", "spA", "spB", "n"])
mejor_B = (per.spB > per.spA + 0.02).sum(); mejor_A = (per.spA > per.spB + 0.02).sum()
print(f"\narmas donde B ordena mejor: {mejor_B} | donde A ordena mejor: {mejor_A} | empate: {len(per) - mejor_A - mejor_B}")
print("top 5 mejoras de B:")
per["d"] = per.spB - per.spA
for _, r in per.sort_values("d", ascending=False).head(5).iterrows():
    print(f"  {r.w[:24]:24s} spA={r.spA:.2f} -> spB={r.spB:.2f} (n={int(r.n)})")
