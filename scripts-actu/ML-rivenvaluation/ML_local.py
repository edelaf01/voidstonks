# -*- coding: utf-8 -*-
"""trains the riven valuation ML model on market auctions and exports frontend bundles"""

import io
import os
import re
import time
import json
import requests
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
print("FASE 1: INGESTA, DEDUPLICACION Y AGRUPACION DE FAMILIAS")

import os as _os
LOCAL_CSV = _os.environ.get("VOIDSTONKS_CSV", "/var/home/ppsoy/Documentos/GitHub/Voidstonks-cron/historial_precios/dataset_raw_ml.csv")
print(f"[LOCAL] Leyendo dataset: {LOCAL_CSV}")
df_micro = pd.read_csv(LOCAL_CSV)
for n in ["re_rolls", "rolls", "Rerolls"]:
    if n in df_micro.columns:
        df_micro.rename(columns={n: "rerolls"}, inplace=True)
print(f"Dataset crudo cargado: {df_micro.shape[0]} filas.")

clave_dedup = [c for c in ["weapon", "stat_pos1", "stat_pos2", "stat_pos3", "stat_neg", "rerolls", "price"]
               if c in df_micro.columns]
antes = df_micro.shape[0]
df_micro["primera_fecha"] = df_micro.groupby(clave_dedup)["fecha"].transform("min")
df_micro.drop_duplicates(subset=clave_dedup, keep="last", inplace=True)
print(f"Reposts exactos eliminados: {antes - df_micro.shape[0]} (conservada la varianza de precio).")

PREFIJOS = r"\b(kuva|tenet|prisma|mara|dex|synoid|telos|vaykor|secura|rakta|sancti|coda|carmine|ceti|mk1|mk-1)\b"
SUFIJOS = r"\b(prime|vandal|wraith|incarnon)\b"

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

cols_originales = ["weapon", "fecha", "primera_fecha", "price", "stat_pos1", "stat_pos2", "stat_pos3", "stat_neg",
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

CACHE_TTL_H = float(os.environ.get("VOIDSTONKS_CACHE_TTL_H", "24"))
_cache_fresca = (os.path.exists(FILE_CACHE)
                 and (time.time() - os.path.getmtime(FILE_CACHE)) < CACHE_TTL_H * 3600)
if os.path.exists(FILE_CACHE) and not _cache_fresca:
    print(f"Cache con más de {CACHE_TTL_H:.0f}h: se refresca desde la API "
          f"(VOIDSTONKS_CACHE_TTL_H para ajustar).")


def agregar_historial(arma, data):
    df_t = pd.DataFrame(data).sort_values("date")
    serie = pd.to_numeric(df_t["wfm_avg_price"], errors="coerce").dropna()
    f_h = df_t.iloc[-1]
    wfm_med = (float(serie.median()) + 0.1) if len(serie) else 0.1
    off_med = pd.to_numeric(df_t["official_median"], errors="coerce").median() + 0.1
    trend_7d = 0.0
    if len(serie) >= 8:
        ult, prev = serie.tail(7).mean(), serie.tail(14).head(7).mean()
        trend_7d = round((ult - prev) / (prev + 1e-9), 3)
    return {
        "weapon": str(arma).strip(),
        "hist_current_official": float(f_h["official_median"]),
        "hist_current_wfm": float(f_h["wfm_avg_price"]),
        "hist_liquidity_avg": float(f_h["liquidity_score"]),
        "hist_volatility_max": float(f_h["volatility_index"]),
        "hist_rerolled_premium": float(f_h["rerolled_premium_ratio"]),
        "hist_momentum": float(round(f_h["wfm_avg_price"] / wfm_med, 3)),
        "hist_trend_7d": float(trend_7d),
        "hist_meta_shift": float(round(f_h["official_median"] / off_med, 3)),
    }


if _cache_fresca:
    print("Cargando datos desde cache local...")
    with open(FILE_CACHE, "r", encoding="utf-8") as f:
        cache = json.load(f)
    api_map = cache["api_map"]
    datos_temporales = cache["temporales"]
else:
    print("Descargando desde Cloudflare...")
    sess = requests.Session()
    sess.headers.update(headers)

    # /api/rivens returns the full dictionary and ignores ?weapon, so a single call fetches all
    api_map = {}
    try:
        full = sess.get(API_BASE, timeout=30).json()
        api_map = {k.lower(): v for k, v in full.items()
                   if k != "__baseline" and isinstance(v, dict)}
        print(f"  macro: {len(api_map)} armas indexadas.")
    except Exception as e:
        print(f"  [WARN] /api/rivens falló: {e}")

    _HS_F2 = os.environ.get("VOIDSTONKS_HIST_SERIES", "history_series.json")
    series_local = {}
    if os.path.exists(_HS_F2):
        with open(_HS_F2, encoding="utf-8") as f:
            series_local = json.load(f)
        print(f"  historial: derivando de {_HS_F2} ({len(series_local)} armas, sin red).")
    else:
        print(f"  [NOTA] sin {_HS_F2}: historial por red arma a arma (lento). "
              f"Corre history_fetch.py primero para evitarlo.")

    datos_temporales = []
    fallos_hist = 0
    for arma in df_micro["weapon"].unique():
        if pd.isna(arma) or not str(arma).strip():
            continue
        q = str(arma).strip().lower()
        try:
            data = series_local.get(q)
            if data is None:
                h = sess.get(API_HISTORY, params={"weapon": q}, timeout=10).json()
                data = h.get("data") if isinstance(h, dict) else h
                time.sleep(0.05)
            if not data:
                continue
            datos_temporales.append(agregar_historial(arma, data))
        except Exception:
            fallos_hist += 1
    if fallos_hist:
        print(f"  [WARN] historial sin datos/erróneo en {fallos_hist} armas.")

    with open(FILE_CACHE, "w", encoding="utf-8") as f:
        json.dump({"api_map": api_map, "temporales": datos_temporales}, f)

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
    fila["popularity_pct"] = (de_un.get("pop") or 0) + (de_re.get("pop") or 0)
    fila["wfm_market_sample"] = rec.get("wfm_market_sample")
    fila["liquidity_score"] = rec.get("liquidity_score")
    fila["volatility_index"] = rec.get("volatility_index")
    fila["rerolled_premium_ratio"] = rec.get("rerolled_premium_ratio")
    fila["web_min"] = rec.get("web_min")
    fila["web_max"] = rec.get("web_max")
    fila["trend_7d_pct"] = rec.get("trend_7d_pct")
    _om = rec.get("official_median") or 0
    _wa = rec.get("wfm_avg", rec.get("wfm_avg_price")) or 0
    _rm = de_re.get("median") or 0
    _rx = de_re.get("max_price") or 0
    fila["re_pop"] = de_re.get("pop") or 0
    fila["re_std"] = de_re.get("stddev") or 0
    fila["re_med"] = _rm
    fila["re_max"] = _rx
    fila["wfm_vs_off"] = _wa / (_om + 1.0)
    fila["ceil_mult"] = _rx / (_rm + 1.0)
    macro_rows.append(fila)

df_macro = pd.DataFrame(macro_rows) if macro_rows else pd.DataFrame(columns=["weapon"] + MACRO_FIELDS)
df_temp = pd.DataFrame(datos_temporales) if datos_temporales else pd.DataFrame(columns=["weapon"] + HIST_FIELDS)

df_micro = df_micro.merge(df_macro, on="weapon", how="left").merge(df_temp, on="weapon", how="left")

if "rerolls" not in df_micro.columns:
    df_micro["rerolls"] = 0
df_micro["rerolls"] = df_micro["rerolls"].fillna(0).astype(int)

for col in ["official_median", "wfm_avg"]:
    if col not in df_micro.columns:
        df_micro[col] = np.nan
    df_micro[f"{col}_missing"] = df_micro[col].isna().astype(int)
    med = df_micro[col].median()
    df_micro[col] = df_micro[col].fillna(med if pd.notna(med) else 0.0)

for col in ["popularity_pct", "wfm_market_sample", "liquidity_score", "volatility_index",
            "rerolled_premium_ratio", "web_min", "web_max", "trend_7d_pct",
            "re_pop", "re_std", "re_med", "re_max", "wfm_vs_off", "ceil_mult"]:
    if col not in df_micro.columns:
        df_micro[col] = np.nan
defaults_macro = {"popularity_pct": 0.0, "wfm_market_sample": 0.0, "liquidity_score": 30.0,
                  "volatility_index": 3.0, "rerolled_premium_ratio": 1.0, "web_min": 0.0,
                  "web_max": 0.0, "trend_7d_pct": 0.0,
                  "re_pop": 0.0, "re_std": 0.0, "re_med": 0.0, "re_max": 0.0,
                  "wfm_vs_off": 1.0, "ceil_mult": 1.0}
for col, dv in defaults_macro.items():
    df_micro[col] = df_micro[col].fillna(dv)

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

HIST_SERIES = os.environ.get("VOIDSTONKS_HIST_SERIES", "history_series.json")
_hist_day_cols = ["hist_day_drift", "hist_day_offdrift", "hist_day_liq", "hist_day_sample", "hist_day_rerprem"]
_hcons = {}
if "fecha" in df_micro.columns and os.path.exists(HIST_SERIES):
    _hs = json.load(open(HIST_SERIES, encoding="utf-8"))
    _hday, _hmed = {}, {}
    for _wl, _serie in _hs.items():
        _wfm = [s.get("wfm_avg_price") or 0 for s in _serie if s.get("wfm_avg_price")]
        _off = [s.get("official_median") or 0 for s in _serie if s.get("official_median")]
        _hmed[_wl] = {"wfm": float(np.median(_wfm)) if _wfm else 0.0,
                      "off": float(np.median(_off)) if _off else 0.0}
        if len(_off) >= 5:
            _mu, _sd = float(np.mean(_off)), float(np.std(_off))
            _hcons[_wl] = float(1.0 / (1.0 + (_sd / _mu if _mu > 0 else 1.0)))
        for s in _serie:
            _hday[(_wl, s.get("date"))] = s
    _wlc = df_micro["weapon"].map(lambda w: str(w).strip().lower())
    _keys = list(zip(_wlc, df_micro["fecha"].astype(str)))
    def _hd(k, f, dv=0.0):
        d = _hday.get(k); v = d.get(f) if d else None
        return float(v) if v not in (None, "") else dv
    df_micro["hist_day_wfm"] = [_hd(k, "wfm_avg_price") for k in _keys]
    df_micro["hist_day_off"] = [_hd(k, "official_median") for k in _keys]
    df_micro["hist_day_liq"] = [_hd(k, "liquidity_score", 30.0) for k in _keys]
    df_micro["hist_day_sample"] = [_hd(k, "wfm_market_sample") for k in _keys]
    df_micro["hist_day_rerprem"] = [_hd(k, "rerolled_premium_ratio", 1.0) for k in _keys]
    _wm = _wlc.map(lambda w: (_hmed.get(w) or {}).get("wfm", 0.0))
    _om2 = _wlc.map(lambda w: (_hmed.get(w) or {}).get("off", 0.0))
    df_micro["hist_day_drift"] = df_micro["hist_day_wfm"] / (_wm + 1.0)
    df_micro["hist_day_offdrift"] = df_micro["hist_day_off"] / (_om2 + 1.0)
    df_micro.loc[df_micro["hist_day_wfm"] <= 0, "hist_day_drift"] = 1.0
    df_micro.loc[df_micro["hist_day_off"] <= 0, "hist_day_offdrift"] = 1.0
    print(f"  history (serie diaria) unido: {len(_hday)} pares (arma,fecha), {len(_hmed)} armas.")
else:
    for c in _hist_day_cols:
        df_micro[c] = 1.0 if c in ("hist_day_drift", "hist_day_offdrift", "hist_day_rerprem") else 0.0
    print(f"  [NOTA] sin {HIST_SERIES}: features hist_day_* en neutro (corre history_fetch.py para llenarlas).")

conteo = df_micro["weapon"].value_counts()
df_micro_clean = df_micro[df_micro["weapon"].isin(conteo[conteo >= 25].index)].copy()
df_micro_clean["fatigue_index"] = df_micro_clean["rerolls"] / (df_micro_clean["official_median"] + 1)

_CW_FEAT = os.environ.get("VOIDSTONKS_WEAPONS",
                          "/var/home/ppsoy/Escritorio/voidstonks/deploy/assets/json/cleaned_weapons.json")
_TYPE2IDX = {"Rifle": 0, "Sniper": 0, "Bow": 0, "Launcher": 0, "Sentinel": 0, "Companion Weapon": 0,
             "Shotgun": 1, "Pistol": 2, "Dual Pistols": 2, "Thrown": 2, "Throwing": 2, "Kitgun": 2,
             "Melee": 3, "Zaw": 3, "Zaw Component": 3, "Glaive": 3, "Arch-Gun": 4, "Archgun": 4}
_dispo_map, _arch_map = {}, {}
try:
    _dispo_antes = json.load(open("dispo_antes_44_1_3.json", encoding="utf-8"))
    for _w in json.load(open(_CW_FEAT, encoding="utf-8")):
        _cn = re.sub(r"[^a-z0-9]", "", str(_w.get("name", "")).lower())
        _dispo_map[_cn] = float(_dispo_antes.get(_w.get("name")) or 1.2)
        _arch_map[_cn] = _TYPE2IDX.get(_w.get("type"), 0)
    print(f"  refuerzo global: disposición+arquetipo para {len(_dispo_map)} armas.")
except Exception as _e:
    print("  [WARN] sin cleaned_weapons.json para dispo/arquetipo:", _e)
_clean_w = df_micro_clean["weapon"].map(lambda w: re.sub(r"[^a-z0-9]", "", str(w).lower()))
df_micro_clean["disposition"] = _clean_w.map(lambda c: _dispo_map.get(c, 1.2))
df_micro_clean["archetype"] = _clean_w.map(lambda c: _arch_map.get(c, 0))

_wl_col = df_micro_clean["weapon"].map(lambda w: str(w).strip().lower())
df_micro_clean["median_consistency"] = _wl_col.map(lambda w: _hcons.get(w, 0.5))
df_micro_clean["meta_signal"] = ((2.0 - df_micro_clean["disposition"])
                                 * np.log1p(df_micro_clean["official_median"])
                                 * df_micro_clean["median_consistency"])
print(f"  señal meta: consistencia de mediana para {len(_hcons)} armas "
      f"(mediana consistencia={np.median(list(_hcons.values())) if _hcons else 0:.2f}).")

print(f"Pipeline OK. Filas listas: {df_micro_clean.shape[0]} | armas: {df_micro_clean['weapon'].nunique()}")


from sklearn.model_selection import train_test_split

print("\nFASE 3: FEATURES (ONE-HOT) Y MATRICES")

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

def _mag_norm(weapon, stat, val, default=np.nan):
    if not HAS_MAG or pd.isna(val):
        return default
    ref = ref_mag.get((weapon, stat))
    if not ref:
        return default
    return float(np.clip(abs(float(val)) / abs(ref), 0.0, 1.0))

def calcular_sinergia(row):
    pesos = lookup_macro(row["weapon"]).get("dynamic_weights", {})
    score = 0.0
    for i in (1, 2, 3):
        stat = row[f"stat_pos{i}"]
        if pd.notna(stat) and stat != "None":
            score += pesos.get(stat, 0.05) * _mag_norm(row["weapon"], stat, row.get(f"mag_pos{i}"), default=0.6)
    return round(score, 4)

df_micro_clean["synergy_score"] = df_micro_clean.apply(calcular_sinergia, axis=1)
df_micro_clean["dispo_x_synergy"] = df_micro_clean["disposition"] * df_micro_clean["synergy_score"]
df_micro_clean["popularity_pct_x_synergy"] = df_micro_clean["popularity_pct"] * df_micro_clean["synergy_score"]

df_micro_clean["has_mag"] = 0
if HAS_MAG:
    for i in (1, 2, 3):
        df_micro_clean[f"mag_pos{i}_norm"] = df_micro_clean.apply(
            lambda r: _mag_norm(r["weapon"], r[f"stat_pos{i}"], r.get(f"mag_pos{i}")), axis=1)
    df_micro_clean["mag_pos_avg"] = df_micro_clean[[f"mag_pos{i}_norm" for i in (1, 2, 3)]].mean(axis=1)
    if "mag_neg" in df_micro_clean.columns:
        df_micro_clean["mag_neg_norm"] = df_micro_clean.apply(
            lambda r: _mag_norm(r["weapon"], r.get("stat_neg"), r.get("mag_neg")), axis=1)
    df_micro_clean["has_mag"] = df_micro_clean[MAG_COLS].notna().any(axis=1).astype(int)

SYN_P60 = float(df_micro_clean["synergy_score"].quantile(0.60))
SYN_P85 = float(df_micro_clean["synergy_score"].quantile(0.85))
print(f"  Umbrales dinámicos -> burner<{SYN_P60:.2f} | godroll>={SYN_P85:.2f}")

df_ml = df_micro_clean.copy()

pos_stats = [s for s in pd.concat([df_ml["stat_pos1"], df_ml["stat_pos2"], df_ml["stat_pos3"]]).dropna().unique() if s != "None"]
for stat in pos_stats:
    df_ml[f"has_pos_stat_{stat}"] = ((df_ml["stat_pos1"] == stat) | (df_ml["stat_pos2"] == stat) | (df_ml["stat_pos3"] == stat)).astype(int)
for stat in [s for s in df_ml["stat_neg"].dropna().unique() if s != "None"]:
    df_ml[f"has_neg_stat_{stat}"] = (df_ml["stat_neg"] == stat).astype(int)

df_ml["num_pos"] = sum(((df_ml[f"stat_pos{i}"].notna()) & (df_ml[f"stat_pos{i}"] != "None")).astype(int) for i in (1, 2, 3))
df_ml["has_neg"] = ((df_ml["stat_neg"].notna()) & (df_ml["stat_neg"] != "None")).astype(int)

cols_numericas = ["official_median", "wfm_avg", "official_median_missing", "wfm_avg_missing",
                  "popularity_pct", "wfm_market_sample", "liquidity_score",
                  "rerolled_premium_ratio",
                  "re_pop", "re_std", "re_med", "re_max", "wfm_vs_off", "ceil_mult",
                  "hist_current_official", "hist_current_wfm", "hist_liquidity_avg",
                  "hist_rerolled_premium", "hist_momentum",
                  "synergy_score", "rerolls", "fatigue_index", "num_pos", "has_neg",
                  "disposition", "dispo_x_synergy", "archetype", "popularity_pct_x_synergy",
                  "median_consistency", "meta_signal",
                  "has_mag", "mag_pos_avg", "mag_pos1_norm", "mag_pos2_norm", "mag_pos3_norm",
                  "mag_neg_norm",
                  "hist_day_drift", "hist_day_offdrift", "hist_day_liq", "hist_day_sample", "hist_day_rerprem"]
if os.environ.get("CRUDO", "0") != "0":
    _compuestas = {
        "synergy_score", "dispo_x_synergy", "popularity_pct_x_synergy",
        "wfm_vs_off", "ceil_mult", "meta_signal", "fatigue_index",
        "median_consistency", "mag_pos_avg",
        "official_median_missing", "wfm_avg_missing",
    }
    _antes = len(cols_numericas)
    cols_numericas = [c for c in cols_numericas if c not in _compuestas]
    print(f"  CRUDO: fuera {_antes - len(cols_numericas)} features compuestas "
          f"-> {len(cols_numericas)} numéricas (solo medidas directas)")

if os.environ.get("SIN_SYNERGY", "0") != "0":
    _fuera = {"synergy_score", "dispo_x_synergy", "popularity_pct_x_synergy"}
    cols_numericas = [c for c in cols_numericas if c not in _fuera]
    print(f"  SIN_SYNERGY activo: fuera {sorted(_fuera)} -> {len(cols_numericas)} numéricas")

cols_dummies = [c for c in df_ml.columns if c.startswith("has_pos_stat_") or c.startswith("has_neg_stat_")]
columnas_micro = [c for c in cols_numericas if c in df_ml.columns] + cols_dummies

_nivel_dia = pd.to_numeric(df_ml.get("hist_day_wfm", pd.Series(0.0, index=df_ml.index)), errors="coerce").fillna(0.0)
_tiene_nivel = _nivel_dia > 0
_cap_clasico = df_ml.groupby("weapon")["price"].transform(lambda s: s.quantile(0.98))
_ratio = pd.Series(np.nan, index=df_ml.index, dtype=float)
_ratio[_tiene_nivel] = df_ml.loc[_tiene_nivel, "price"] / _nivel_dia[_tiene_nivel]
_cap_ratio = _ratio.groupby(df_ml["weapon"]).transform(lambda s: s.quantile(0.98))
_cap_regimen = (_cap_ratio * _nivel_dia).where(_tiene_nivel & _cap_ratio.notna())
_med_arma = df_ml.groupby("weapon")["price"].transform("median")
_cap_final = np.where(_cap_regimen.notna(), np.maximum(_cap_regimen.fillna(0), _med_arma), _cap_clasico)
_recortadas = int((df_ml["price"] > _cap_final).sum())
df_ml["price"] = np.minimum(df_ml["price"], _cap_final)
print(f"  Winsor consciente de régimen: {int(_tiene_nivel.sum())} filas con nivel del día "
      f"({_tiene_nivel.mean()*100:.0f}%), {_recortadas} precios recortados.")

_CAL_MIN_POP = float(os.environ.get("CAL_VENTA_MIN_POP", "3"))

_CAL_ON = os.environ.get("CAL_VENTA", "0") != "0"
VENTA_INFO = {}
df_ml["price_ask"] = df_ml["price"]
_precio_cal = df_ml["price"].astype(float).copy()

for _w, _idx in df_ml.groupby("weapon").groups.items():
    _rec = lookup_macro(_w)
    _dre = (_rec.get("de_rerolled") or {}) if _rec else {}
    _dun = (_rec.get("de_unrolled") or {}) if _rec else {}
    _rmed = _dre.get("median") or 0
    _rpop = _dre.get("pop") or 0
    _rmin = _dre.get("min_price") or 0
    _rmax = _dre.get("max_price") or 0
    _asks = df_ml.loc[_idx, "price"].astype(float)

    _ok = (_CAL_ON and _rmed > 0 and _rpop >= _CAL_MIN_POP and len(_asks) >= 5)
    if not _ok:
        VENTA_INFO[_w] = {"de_med": _rmed, "pop": _rpop, "fiable": False}
        continue

    _lo = _rmin if 0 < _rmin < _rmed else max(1.0, _rmed * 0.45)
    _hi = _rmax if _rmax > _rmed else _rmed * 5.0
    _hi = min(_hi, _rmed * 8.0)

    _cal_q = df_ml.loc[_idx, "synergy_score"].astype(float)
    _p = (_cal_q.rank(pct=True) if _cal_q.nunique() > 1 else _asks.rank(pct=True)).to_numpy()
    _lg = np.where(
        _p <= 0.5,
        np.log(_lo) + (np.log(_rmed) - np.log(_lo)) * (_p / 0.5),
        np.log(_rmed) + (np.log(_hi) - np.log(_rmed)) * ((_p - 0.5) / 0.5),
    )
    _precio_cal.loc[_idx] = np.exp(_lg)
    VENTA_INFO[_w] = {"de_med": _rmed, "de_lo": round(float(_lo), 1), "de_hi": round(float(_hi), 1),
                      "pop": _rpop, "ask_med": round(float(_asks.median()), 1), "fiable": True}

df_ml["price"] = _precio_cal
_n_fiable = sum(1 for v in VENTA_INFO.values() if v["fiable"])
_rat = (df_ml["price"] / df_ml["price_ask"]).replace([np.inf, -np.inf], np.nan).dropna()
print(f"  Calibrado a precio de VENTA (percentil->percentil): {_n_fiable}/{len(VENTA_INFO)} armas con "
      f"anclas reales de DE (re_pop>={_CAL_MIN_POP:.0f}). "
      f"venta/ask: mediana {_rat.median():.2f}× [p10 {_rat.quantile(.10):.2f}× / p90 {_rat.quantile(.90):.2f}×]. "
      f"El resto se queda en escala de ask (marcado no fiable).")

def _tier_weights(g):
    try:
        tier = pd.qcut(g, 3, labels=False, duplicates="drop")
    except Exception:
        tier = pd.Series(0, index=g.index)
    tc = tier.value_counts()
    wt = tier.map(lambda t: 1.0 / tc.get(t, 1))
    return wt / wt.mean()
min_samples = 50
weapon_counts = df_ml["weapon"].value_counts()
sufficient_weapons = weapon_counts[weapon_counts >= min_samples].index
df_ml = df_ml[df_ml["weapon"].isin(sufficient_weapons)].reset_index(drop=True)

df_ml["sample_w"] = df_ml.groupby("weapon")["price"].transform(_tier_weights)
pop_counts = df_ml["weapon"].map(df_ml["weapon"].value_counts())
pop_wt = np.sqrt(pop_counts)
pop_wt = pop_wt / pop_wt.mean()
df_ml["sample_w"] = df_ml["sample_w"] * pop_wt
_gp90 = df_ml.groupby("weapon")["price"].transform(lambda s: s.quantile(0.90))
_godroll_mask = df_ml["price"] >= _gp90
df_ml.loc[_godroll_mask, "sample_w"] *= (1 + np.log1p(df_ml.loc[_godroll_mask, "price"] - _gp90[_godroll_mask]))
_RECENCIA_ON = os.environ.get("RECENCIA", "0") != "0"
_VIDA_MEDIA_DIAS = float(os.environ.get("RECENCIA_HALFLIFE", "30"))
df_ml["w_recencia"] = 1.0
def pesos_recencia(df, referencia):
    _f = pd.to_datetime(df["fecha"], errors="coerce")
    _edad = (pd.to_datetime(referencia) - _f).dt.days.fillna(_VIDA_MEDIA_DIAS * 2).clip(lower=0)
    _dia = _f.dt.date
    _med_dia = df.groupby(["weapon", _dia])["price"].transform("median")
    _serie_arma = df.assign(_md=_med_dia).drop_duplicates(subset=["weapon", "fecha"])
    _vol = (_serie_arma.groupby("weapon")["_md"].std()
            / _serie_arma.groupby("weapon")["_md"].median().clip(lower=1)).fillna(0.0)
    _cv = df["weapon"].map(_vol).fillna(float(_vol.median())).clip(0, 2)
    _cv_med = float(_cv.median()) or 1.0
    _factor = (_cv_med / _cv.clip(lower=0.05)).clip(1 / 3, 4)
    _hl = (_VIDA_MEDIA_DIAS * _factor).clip(lower=7)
    _w_rec = np.power(0.5, _edad / _hl)
    print(f"  Recencia adaptativa: vida media {_hl.min():.0f}-{_hl.max():.0f}d "
          f"(base {_VIDA_MEDIA_DIAS:.0f}d, cv mediano {_cv_med:.2f})")
    print(f"  Recencia: vida media {_VIDA_MEDIA_DIAS:.0f}d | peso medio "
          f"{_w_rec.mean():.2f} | filas de >60d: {(_edad > 60).sum()}")
    return _w_rec / _w_rec.mean()

if _RECENCIA_ON and "fecha" in df_ml.columns:
    df_ml["w_recencia"] = pesos_recencia(df_ml, pd.to_datetime(df_ml["fecha"], errors="coerce").max())

_wcount = df_ml["weapon"].map(df_ml["weapon"].value_counts())
df_ml["sample_w"] = df_ml["sample_w"] / _wcount
df_ml["sample_w"] = df_ml["sample_w"] / df_ml["sample_w"].mean()

X = df_ml[columnas_micro]
w = df_ml["sample_w"]

y_all = np.log1p(df_ml["price"])
idx_all = np.arange(len(df_ml))
tr_idx, te_idx = train_test_split(idx_all, test_size=0.18, random_state=42,
                                  stratify=df_ml["weapon"])
tr2_idx, es_idx = train_test_split(tr_idx, test_size=0.12, random_state=42,
                                   stratify=df_ml["weapon"].values[tr_idx])

X_train = df_ml.iloc[tr2_idx][columnas_micro]; y_train = y_all.values[tr2_idx]; w_train = df_ml["sample_w"].values[tr2_idx]; w_recencia = df_ml["w_recencia"].values[tr2_idx]
X_es = df_ml.iloc[es_idx][columnas_micro];     y_es = y_all.values[es_idx]
X_test = df_ml.iloc[te_idx][columnas_micro];   y_test = y_all.values[te_idx]
weapon_test = df_ml["weapon"].values[te_idx]

_kcombo = [c for c in ["weapon", "stat_pos1", "stat_pos2", "stat_pos3", "stat_neg"] if c in df_ml.columns]
_combo_all = df_ml[_kcombo].fillna("None").astype(str).agg("|".join, axis=1).values
_combos_tr = set(_combo_all[tr2_idx]) | set(_combo_all[es_idx])
_visto_te = np.array([c in _combos_tr for c in _combo_all[te_idx]])
print(f"  Fuga de combos en test: {_visto_te.sum()}/{len(_visto_te)} ({_visto_te.mean()*100:.0f}%) "
      f"con su combo ya visto en train.")
print(f"Matrices: train={X_train.shape[0]} | early-stop={X_es.shape[0]} | test={X_test.shape[0]} | features={len(columnas_micro)}")
print(f"¿one-hot de arma presente? {'sí' if any(c.startswith('weapon_') for c in columnas_micro) else 'NO'}")


import joblib
import xgboost as xgb

ENSEMBLE_SPECS = [
    dict(random_state=42,   max_depth=10, colsample_bytree=0.60),
    dict(random_state=7,    max_depth=12, colsample_bytree=0.50),
    dict(random_state=2024, max_depth=8,  colsample_bytree=0.70),
]
def _env_num(name, default, cast=int):
    """github actions passes empty strings for unset inputs on cron runs, breaking int("")"""
    raw = os.environ.get(name, "")
    return cast(raw) if str(raw).strip() else cast(default)


COMMON = dict(n_estimators=_env_num("XGB_N", 2000), learning_rate=0.025, subsample=0.85,
              min_child_weight=4, reg_lambda=2.5, reg_alpha=0.1,
              tree_method="hist", n_jobs=-1, eval_metric="rmse",
              early_stopping_rounds=60,
              device=os.environ.get("XGB_DEVICE", "cpu"))

QUANTILES = [0.25, 0.50, 0.80, 0.90, 0.95]
# depth=10 represents stat interactions: depth=7 scores worse even with 2.5x tree budget
_QPARAMS = dict(n_estimators=_env_num("XGB_N", 2000),
                learning_rate=_env_num("XGB_LR", 0.03, float),
                max_depth=_env_num("XGB_DEPTH", 10),
                subsample=_env_num("XGB_SUB", 0.85, float),
                colsample_bytree=_env_num("XGB_COL", 0.6, float),
                min_child_weight=_env_num("XGB_MCW", 4),
                reg_lambda=_env_num("XGB_L2", 2.5, float), reg_alpha=0.1,
                tree_method="hist", n_jobs=-1,
                device=os.environ.get("XGB_DEVICE", "cpu"), early_stopping_rounds=80)
print(f"  Hiperparámetros: depth={_QPARAMS['max_depth']} lr={_QPARAMS['learning_rate']} "
      f"mcw={_QPARAMS['min_child_weight']} col={_QPARAMS['colsample_bytree']} l2={_QPARAMS['reg_lambda']}")

class QuantileModel:
    def __init__(self, models, quantiles, feat):
        self.models = models; self.quantiles = quantiles; self.feature_names = feat
    def _mat(self, X):
        Xc = X[self.feature_names] if hasattr(X, "columns") else X
        cols = [self.models[a].predict(Xc) for a in self.quantiles]
        return np.sort(np.vstack(cols).T, axis=1)
    def predict(self, X):
        return self._mat(X)[:, self.quantiles.index(0.50)]
    def predict_quantiles(self, X):
        m = self._mat(X)
        return {a: m[:, i] for i, a in enumerate(self.quantiles)}
    @property
    def feature_importances_(self):
        return self.models[0.50].feature_importances_

_ALPHA_TRAIN = {0.25: 0.25, 0.50: 0.50, 0.80: 0.845, 0.90: 0.935, 0.95: 0.975}
_N_POR_CUANTIL = {0.25: 1300, 0.50: 2600, 0.80: 1000, 0.90: 500, 0.95: 400}
_SLIM_N = _env_num("SLIM_N", 400)
_SLIM_DEPTH = _env_num("SLIM_DEPTH", 5)
# slim model scales trees because Cloudflare Pages caps the bundle at 25 MB
_SLIM_MULT = {0.25: 1.6, 0.50: 3.0, 0.80: 1.2, 0.90: 0.7, 0.95: 0.5}
_NIVEL_K = _env_num("NIVEL_K", 20, float)
_NIVEL_DIAS = _env_num("NIVEL_DIAS", 7)

def entrena_slim(X, y, pesos=None, cuantiles=QUANTILES):
    params = dict(learning_rate=0.05, max_depth=_SLIM_DEPTH, subsample=0.85, colsample_bytree=0.6,
                  min_child_weight=4, reg_lambda=2.5, reg_alpha=0.1, tree_method="hist", n_jobs=-1,
                  device=os.environ.get("XGB_DEVICE", "cpu"))
    modelos = {}
    for a in cuantiles:
        m = xgb.XGBRegressor(objective="reg:quantileerror", quantile_alpha=_ALPHA_TRAIN.get(a, a), random_state=42,
                             n_estimators=max(120, int(_SLIM_N * _SLIM_MULT.get(a, 1.0))), **params)
        m.fit(X, y, sample_weight=pesos)
        modelos[a] = m
    return modelos

def como_navegador(X):
    X = X.copy()
    for c in ("hist_day_drift", "hist_day_offdrift", "hist_day_rerprem"):
        if c in X.columns:
            X[c] = 1.0
    for c in ("hist_day_liq", "hist_day_sample", "hist_momentum"):
        if c in X.columns:
            X[c] = float(pd.to_numeric(df_ml[c], errors="coerce").median())
    return X

def tercio_liquidez(armas, conteos):
    c = pd.Series(armas).map(conteos).fillna(0).values
    t1, t2 = np.percentile(conteos.values, [33.33, 66.67])
    return np.where(c <= t1, "baja", np.where(c <= t2, "media", "alta"))

def tabla_nivel(armas, tercios, real, pred, k=_NIVEL_K, tope=2.0):
    r = np.log(np.clip(real, 1, None)) - np.log(np.clip(pred, 1, None))
    d = pd.DataFrame({"arma": armas, "tercio": tercios, "r": r})
    lim = np.log(tope)
    por_tercio = {t: float(np.clip(v, -lim, lim)) for t, v in d.groupby("tercio")["r"].median().items()}
    g = d.groupby("arma").agg(n=("r", "size"), med=("r", "median"), tercio=("tercio", "first"))
    base = g["tercio"].map(por_tercio).fillna(0.0)
    por_arma = ((g["n"] * g["med"] + k * base) / (g["n"] + k)).clip(-lim, lim).to_dict()
    return por_arma, por_tercio

def factores_nivel(armas, tercios, por_arma, por_tercio, lam=1.0):
    s = np.array([por_arma.get(a, por_tercio.get(t, 0.0)) for a, t in zip(armas, tercios)])
    return np.exp(lam * s)

def corrige_q(qlog, f):
    return {a: np.log1p(np.expm1(v) * f) for a, v in qlog.items()}

def metricas_banda(real, qlog, tercios):
    y = np.log1p(real)
    p50 = np.expm1(qlog[0.5])
    trade = real >= 200
    ape = np.abs(p50 - real) / np.clip(real, 5, None)
    out = {"cobertura": {f"p{int(a*100)}": round(float((y <= qlog[a]).mean() * 100), 1) for a in qlog},
           "mdape_trade": round(float(np.median(ape[trade]) * 100), 1) if trade.any() else None,
           "sesgo_trade": round(float(np.median(p50[trade] / real[trade])), 3) if trade.any() else None,
           "sesgo_todos": round(float(np.median(p50 / np.clip(real, 1, None))), 3),
           "por_liquidez": {}}
    for t in ("baja", "media", "alta"):
        m = tercios == t
        mt = m & trade
        out["por_liquidez"][t] = {
            "n": int(m.sum()),
            "cob_p50": round(float((y[m] <= qlog[0.5][m]).mean() * 100), 1) if m.any() else None,
            "sesgo_trade": round(float(np.median(p50[mt] / real[mt])), 3) if mt.any() else None}
    return out

qmodels = {}
for a in QUANTILES:
    a_tr = _ALPHA_TRAIN.get(a, a)
    _qp = dict(_QPARAMS)
    if not os.environ.get("XGB_N", "").strip():
        _mult = _env_num("XGB_NMULT", 1, float)
        _qp["n_estimators"] = int(_N_POR_CUANTIL.get(a, _qp["n_estimators"]) * _mult)
    m = xgb.XGBRegressor(objective="reg:quantileerror", quantile_alpha=a_tr, random_state=42, **_qp)
    _fit_kw = {"sample_weight": w_recencia} if _RECENCIA_ON else {}
    m.fit(X_train, y_train, eval_set=[(X_es, y_es)], verbose=False, **_fit_kw)
    qmodels[a] = m
    print(f"  XGB cuantil etiqueta={a} (α_train={a_tr}) best_iter={getattr(m, 'best_iteration', '?')}")
optimized_xgb = QuantileModel(qmodels, QUANTILES, columnas_micro)

_qpred_test = optimized_xgb.predict_quantiles(X_test)
print("\n  COBERTURA por cuantil (objetivo = alpha; mide si la banda es correcta):")
for a in QUANTILES:
    cov = float((y_test <= _qpred_test[a]).mean())
    pin = float(np.mean(np.maximum(a * (y_test - _qpred_test[a]), (a - 1) * (y_test - _qpred_test[a]))))
    print(f"    p{int(a*100):>2}: cobertura={cov*100:4.1f}%  (target {int(a*100)}%)  pinball(log)={pin:.4f}")
_in_band = float(((y_test >= _qpred_test[0.25]) & (y_test <= _qpred_test[0.80])).mean())
print(f"    reales dentro de [p25,p80]: {_in_band*100:.1f}%  (esperado ~55%)")

y_pred_log = optimized_xgb.predict(X_test)

df_test = pd.DataFrame({"weapon": weapon_test, "y": y_test, "pred": y_pred_log})
media_arma = df_test.groupby("weapon")["y"].transform("mean")
ss_res = float(((df_test["y"] - df_test["pred"]) ** 2).sum())
ss_tot_intra = float(((df_test["y"] - media_arma) ** 2).sum())
r2_intra = 1 - ss_res / ss_tot_intra if ss_tot_intra > 0 else float("nan")

real_test = np.expm1(y_test); pred_test = np.expm1(y_pred_log)
ape_all = np.abs(pred_test - real_test) / np.clip(real_test, 5, None)
mae = mean_absolute_error(real_test, pred_test)
rmse = np.sqrt(mean_squared_error(real_test, pred_test))
r2 = r2_score(y_test, y_pred_log)
mape = float(ape_all.mean() * 100)
mask_trade = real_test >= 200
mape_trade = float(ape_all[mask_trade].mean() * 100) if mask_trade.any() else float("nan")

mape_visto = mape_inedito = float("nan")
try:
    _mt = mask_trade & _visto_te
    _mi = mask_trade & (~_visto_te)
    if _mt.any():
        mape_visto = float(ape_all[_mt].mean() * 100)
    if _mi.any():
        mape_inedito = float(ape_all[_mi].mean() * 100)
    print(f"  MAPE trade por fuga: combo visto {mape_visto:.1f}% (n={int(_mt.sum())}) | "
          f"combo INÉDITO {mape_inedito:.1f}% (n={int(_mi.sum())})  <- el honesto")
except Exception as _e:
    print(f"  [WARN] no se pudo desglosar el MAPE por fuga: {_e}")

try:
    _kc = ["weapon", "stat_pos1", "stat_pos2", "stat_pos3", "stat_neg"]
    _dcombo = df_ml[[c for c in _kc if c in df_ml.columns]].fillna("None").astype(str).agg("|".join, axis=1)
    _oracle = []
    for _c, _s in df_ml.groupby(_dcombo)["price"]:
        if len(_s) >= 5:
            _m = _s.median()
            if _m > 0:
                _oracle.append(float(np.mean(np.abs(_s - _m) / np.clip(_s, 5, None)) * 100))
    mape_piso = float(np.median(_oracle)) if _oracle else float("nan")
    print(f"  Techo irreducible (MAPE de un oráculo perfecto): {mape_piso:.1f} % "
          f"sobre {len(_oracle)} combos con >=5 listados.")
except Exception as _e:
    mape_piso = float("nan")
    print(f"  [WARN] no se pudo medir el techo irreducible: {_e}")

try:
    _df_piso = df_ml.assign(
        _combo=_dcombo,
        _iso_week=pd.to_datetime(df_ml["fecha"], errors="coerce").dt.strftime("%G-%V")
    ).dropna(subset=["_iso_week"])
    _oracle_semana = []
    for _c, _s in _df_piso.groupby(["_combo", "_iso_week"])["price"]:
        if len(_s) >= 3:
            _m = _s.median()
            if _m > 0:
                _oracle_semana.append(float(np.mean(np.abs(_s - _m) / np.clip(_s, 5, None)) * 100))
    mape_piso_semana = float(np.median(_oracle_semana)) if _oracle_semana else float("nan")
    print(f"  Suelo temporal (MAPE por semana y combo): {mape_piso_semana:.1f} % "
          f"sobre {len(_oracle_semana)} grupos con >=3 listados.")
except Exception as _e:
    mape_piso_semana = float("nan")
    print(f"  [WARN] no se pudo medir el suelo temporal: {_e}")
_gp90_tr = pd.Series(np.expm1(y_train)).groupby(df_ml["weapon"].values[tr2_idx]).quantile(0.90)
_thr = pd.Series(weapon_test).map(_gp90_tr).fillna(np.quantile(np.expm1(y_train), 0.90)).values
_god_true = (real_test >= _thr).astype(int)
def _auc(yt, ys):
    from sklearn.metrics import roc_auc_score
    return roc_auc_score(yt, ys)
auc_god = _auc(_god_true, y_pred_log) if len(set(_god_true)) > 1 else float("nan")

from scipy.stats import spearmanr as _spearmanr
_sp_vals = []
for _w, _g in df_test.groupby("weapon"):
    if len(_g) >= 8 and _g["y"].nunique() > 2:
        _r = _spearmanr(_g["y"], _g["pred"]).statistic
        if np.isfinite(_r):
            _sp_vals.append(_r)
spearman_intra = float(np.median(_sp_vals)) if _sp_vals else float("nan")

print("\n" + "=" * 64)
print("REPORTE DE PRECISION (sobre test held-out, estratificado por arma)")
print("=" * 64)
print(f"  R2 (log)              : {r2:.4f}   <- incluye 'qué arma' (one-hot)")
print(f"  R2 intra-arma (log)   : {r2_intra:.4f}   <- el número honesto: calidad del roll")
print(f"  Spearman intra-arma   : {spearman_intra:.3f}   <- ¿ordena bien los rolls por stats? ({len(_sp_vals)} armas)")
print(f"  AUC godroll (>=p90)   : {auc_god:.3f}")
print(f"  MAE                   : +/- {mae:.1f} pl")
print(f"  RMSE                  : +/- {rmse:.1f} pl")
print(f"  MAPE (todos)          : {mape:.1f} %   (inflado por trash barato)")
print(f"  MAPE (rolls >=200pl)  : {mape_trade:.1f} %   <- precisión en rolls que se tradean")
print("=" * 64)

df_test["real"] = np.expm1(df_test["y"])
df_test["pred_real"] = np.expm1(df_test["pred"])
df_test["ape"] = (df_test["pred_real"] - df_test["real"]).abs() / df_test["real"].clip(lower=5)
per = (df_test.groupby("weapon")
       .agg(n=("y", "size"), mape=("ape", lambda s: float(s.mean() * 100)),
            med_real=("real", "median"), med_pred=("pred_real", "median"))
       .reset_index())
per = per[per["n"] >= 8].sort_values("mape")
PRECISION_ARMA = {r["weapon"]: {"mape": round(float(r["mape"]), 1), "n": int(r["n"])}
                  for _, r in per.iterrows()}
print("\n" + "=" * 64)
print("PRECISION POR ARMA (MAPE sobre su test held-out)")
print("=" * 64)
print("MEJORES (modelo fiable):")
for _, r in per.head(10).iterrows():
    print(f"  {r['weapon'][:24]:24s} n={int(r['n']):3d}  MAPE={r['mape']:4.0f}%  real~{int(r['med_real'])}p pred~{int(r['med_pred'])}p")
print("PEORES (caer a listings vivos):")
for _, r in per.tail(10).iloc[::-1].iterrows():
    print(f"  {r['weapon'][:24]:24s} n={int(r['n']):3d}  MAPE={r['mape']:4.0f}%  real~{int(r['med_real'])}p pred~{int(r['med_pred'])}p")
print(f"\nMAPE MEDIANO por arma: {per['mape'].median():.0f}%  |  armas evaluadas: {len(per)}  |  armas con MAPE<40%: {(per['mape']<40).sum()}")
print("=" * 64)

print("\nTop 15 importancias (si dominan official_median/wfm_avg, el modelo lee la media del arma):")
print(pd.Series(optimized_xgb.feature_importances_, index=columnas_micro).sort_values(ascending=False).head(15))

model_micro = optimized_xgb
joblib.dump(model_micro, "tasador_voidstonks_micro.pkl")
_full_sz = os.path.getsize("tasador_voidstonks_micro.pkl") / 1e6
print(f"\nModelo guardado: tasador_voidstonks_micro.pkl ({_full_sz:.1f} MB, cuantiles {QUANTILES})")

print("\n" + "=" * 64)
print("RESUMEN MODELO (ensemble XGBoost, split estratificado por arma)")
print("=" * 64)
print(f"  features={len(columnas_micro)}  |  R2log={r2:.4f}  R2intra={r2_intra:.4f}  "
      f"AUCgodroll={auc_god:.3f}")
print(f"  MAPE rolls tradeables(>=200pl)={mape_trade:.1f}%  |  tamaño={_full_sz:.1f} MB")
print("  Nota: el techo intra-arma lo limita el ruido de mercado (mismo roll, distinto vendedor,")
print("  ~39% de spread) y la falta de 'rerolls' en WFM. Las magnitudes (mag_*) suben la precisión")
print("  en las filas donde existen y crecen según oraculo_riven.py acumula capturas en vivo.")
print("=" * 64)

res_adelante = None
if os.environ.get("ADELANTE", "1") != "0":
    try:
        _adelante_dias = int(os.environ.get("ADELANTE_DIAS", 7))
        _primera_f = pd.to_datetime(df_ml["primera_fecha"], errors="coerce")
        _T = _primera_f.max() - pd.Timedelta(days=_adelante_dias)

        mask_entreno = _primera_f < _T
        mask_prueba = _primera_f >= _T

        df_fw_entreno = df_ml[mask_entreno].copy()
        df_fw_prueba = df_ml[mask_prueba].copy()

        if len(df_fw_prueba) < 500 or len(df_fw_entreno) < 5000:
            print(f"\n[WARN] PRUEBA HACIA DELANTE saltada: entreno={len(df_fw_entreno)}, prueba={len(df_fw_prueba)}")
        else:
            print("\n" + "=" * 64)
            print(f"PRUEBA HACIA DELANTE (últimos {_adelante_dias} días, anuncios nuevos)")
            print("=" * 64)
            print(f"  Corte temporal (T): {_T.date().isoformat()} | Entreno: {len(df_fw_entreno)} | Prueba: {len(df_fw_prueba)}")

            from sklearn.model_selection import StratifiedShuffleSplit, train_test_split
            fw_X_all = df_fw_entreno[columnas_micro]
            fw_y_all = np.log1p(df_fw_entreno["price"])

            try:
                sss = StratifiedShuffleSplit(n_splits=1, test_size=0.12, random_state=42)
                tr_idx_fw, es_idx_fw = next(sss.split(fw_X_all, df_fw_entreno["weapon"]))
                fw_X_tr, fw_X_es = fw_X_all.iloc[tr_idx_fw], fw_X_all.iloc[es_idx_fw]
                fw_y_tr, fw_y_es = fw_y_all.iloc[tr_idx_fw], fw_y_all.iloc[es_idx_fw]
            except ValueError:
                tr_idx_fw, es_idx_fw = train_test_split(np.arange(len(fw_X_all)), test_size=0.12, random_state=42)
                fw_X_tr, fw_X_es = fw_X_all.iloc[tr_idx_fw], fw_X_all.iloc[es_idx_fw]
                fw_y_tr, fw_y_es = fw_y_all.iloc[tr_idx_fw], fw_y_all.iloc[es_idx_fw]

            _w_fw = pesos_recencia(df_fw_entreno.iloc[tr_idx_fw], _T).values if _RECENCIA_ON else None
            fw_qmodels = {}
            for a in QUANTILES:
                a_tr = _ALPHA_TRAIN.get(a, a)
                _qp = dict(_QPARAMS)
                if not os.environ.get("XGB_N", "").strip():
                    _mult = _env_num("XGB_NMULT", 1, float)
                    _qp["n_estimators"] = int(_N_POR_CUANTIL.get(a, _qp["n_estimators"]) * _mult)
                m = xgb.XGBRegressor(objective="reg:quantileerror", quantile_alpha=a_tr, random_state=42, **_qp)
                _fit_kw = {"sample_weight": _w_fw} if _RECENCIA_ON else {}
                m.fit(fw_X_tr, fw_y_tr, eval_set=[(fw_X_es, fw_y_es)], verbose=False, **_fit_kw)
                fw_qmodels[a] = m

            fw_opt_xgb = QuantileModel(fw_qmodels, QUANTILES, columnas_micro)

            fw_X_te = df_fw_prueba[columnas_micro]
            fw_y_te = np.log1p(df_fw_prueba["price"])
            fw_real_te = df_fw_prueba["price"].values

            fw_qpred = fw_opt_xgb.predict_quantiles(fw_X_te)
            fw_pred_log = fw_opt_xgb.predict(fw_X_te)
            fw_pred_expm1 = np.expm1(fw_pred_log)

            res_adelante = {
                "dias": _adelante_dias,
                "corte": _T.isoformat(),
                "n_entreno": len(df_fw_entreno),
                "n_prueba": len(df_fw_prueba),
                "recencia": _RECENCIA_ON
            }

            print("\n  Cobertura por cuantil:")
            res_adelante["cobertura"] = {}
            res_adelante["pinball"] = {}
            for a in QUANTILES:
                cov = float((fw_y_te <= fw_qpred[a]).mean())
                pin = float(np.mean(np.maximum(a * (fw_y_te - fw_qpred[a]), (a - 1) * (fw_y_te - fw_qpred[a]))))
                res_adelante["cobertura"][f"p{int(a*100)}"] = round(cov*100, 1)
                res_adelante["pinball"][f"p{int(a*100)}"] = round(pin, 4)
                print(f"    p{int(a*100):>2}: cobertura={cov*100:4.1f}% | pinball={pin:.4f}")

            fw_ape = np.abs(fw_pred_expm1 - fw_real_te) / np.clip(fw_real_te, 5, None)
            fw_mask_trade = fw_real_te >= 200

            mape_fw_trade = float(fw_ape[fw_mask_trade].mean() * 100) if fw_mask_trade.any() else float("nan")
            mdape_fw_trade = float(np.median(fw_ape[fw_mask_trade]) * 100) if fw_mask_trade.any() else float("nan")
            sesgo_trade = float(np.median(fw_pred_expm1[fw_mask_trade] / fw_real_te[fw_mask_trade])) if fw_mask_trade.any() else float("nan")
            sesgo_todos = float(np.median(fw_pred_expm1 / fw_real_te))

            _sp_vals = []
            df_fw_te = pd.DataFrame({"weapon": df_fw_prueba["weapon"].values, "y": fw_y_te.values, "pred": fw_pred_log})
            for _w, _g in df_fw_te.groupby("weapon"):
                if len(_g) >= 8 and _g["y"].nunique() > 2:
                    from scipy.stats import spearmanr as _spearmanr
                    _r = _spearmanr(_g["y"], _g["pred"]).statistic
                    if np.isfinite(_r):
                        _sp_vals.append(_r)
            sp_intra_fw = float(np.median(_sp_vals)) if _sp_vals else float("nan")

            res_adelante.update({
                "mape_trade": round(mape_fw_trade, 1),
                "mdape_trade": round(mdape_fw_trade, 1),
                "sesgo_trade": round(sesgo_trade, 3),
                "sesgo_todos": round(sesgo_todos, 3),
                "spearman_intra": round(sp_intra_fw, 3)
            })
            print(f"  MAPE medio trade: {mape_fw_trade:.1f}% | mediano trade: {mdape_fw_trade:.1f}%")
            print(f"  Sesgo (pred/real) trade: {sesgo_trade:.2f} | todos: {sesgo_todos:.2f}")
            print(f"  Spearman intra-arma: {sp_intra_fw:.3f}")

            print("\n  Por liquidez (tercios en entreno):")
            w_counts = df_fw_entreno["weapon"].value_counts()
            t1, t2 = np.percentile(w_counts.values, [33.33, 66.67])
            res_adelante["por_liquidez"] = {}
            for liq_name, liq_mask in [
                ("baja", df_fw_prueba["weapon"].map(w_counts).fillna(0) <= t1),
                ("media", (df_fw_prueba["weapon"].map(w_counts).fillna(0) > t1) & (df_fw_prueba["weapon"].map(w_counts).fillna(0) <= t2)),
                ("alta", df_fw_prueba["weapon"].map(w_counts).fillna(0) > t2)
            ]:
                if liq_mask.sum() > 0:
                    l_te_y = fw_y_te[liq_mask]
                    l_te_real = fw_real_te[liq_mask]
                    l_te_pred = fw_pred_expm1[liq_mask]
                    l_qpred = fw_opt_xgb.predict_quantiles(fw_X_te[liq_mask])

                    l_trade = l_te_real >= 200
                    l_ape = np.abs(l_te_pred - l_te_real) / np.clip(l_te_real, 5, None)
                    l_mdape = float(np.median(l_ape[l_trade]) * 100) if l_trade.any() else float("nan")
                    l_sesgo = float(np.median(l_te_pred[l_trade] / l_te_real[l_trade])) if l_trade.any() else float("nan")

                    cov25 = float((l_te_y <= l_qpred[0.25]).mean() * 100)
                    cov50 = float((l_te_y <= l_qpred[0.50]).mean() * 100)
                    cov80 = float((l_te_y <= l_qpred[0.80]).mean() * 100)

                    res_adelante["por_liquidez"][liq_name] = {
                        "n": int(liq_mask.sum()),
                        "cobertura": {"p25": round(cov25, 1), "p50": round(cov50, 1), "p80": round(cov80, 1)},
                        "mdape_trade": round(l_mdape, 1),
                        "sesgo_trade": round(l_sesgo, 3)
                    }
                    print(f"    {liq_name:<6}: n={liq_mask.sum():<4} | cov p25={cov25:4.1f}% p50={cov50:4.1f}% p80={cov80:4.1f}% | mdape={l_mdape:4.1f}% | sesgo={l_sesgo:.2f}")

            if os.environ.get("NIVEL_PRUEBA", "1") != "0":
                try:
                    print("\n  NIVEL DEL MODELO SLIM (el del navegador, con el día neutro):")
                    _slim2 = entrena_slim(fw_X_tr, fw_y_tr, _w_fw)
                    _armas_te = df_fw_prueba["weapon"].values
                    _ter_te = tercio_liquidez(_armas_te, w_counts)
                    _X_te_nav = como_navegador(fw_X_te)
                    _q_te = {a: m.predict(_X_te_nav) for a, m in _slim2.items()}
                    _T1 = _T - pd.Timedelta(days=_adelante_dias)
                    _m_cal = (_primera_f >= _T1) & (_primera_f < _T)
                    _df_cal = df_ml[_m_cal]
                    _df_m1 = df_ml[_primera_f < _T1]
                    if len(_df_cal) < 500 or len(_df_m1) < 5000:
                        print(f"  [WARN] nivel saltado: calibración={len(_df_cal)}, entreno T1={len(_df_m1)}")
                    else:
                        print(f"  Calibración: {_T1.date().isoformat()} -> {_T.date().isoformat()} ({len(_df_cal)} filas) | entreno T1: {len(_df_m1)}")
                        _w_m1 = pesos_recencia(_df_m1, _T1).values if _RECENCIA_ON else None
                        _slim1 = entrena_slim(_df_m1[columnas_micro], np.log1p(_df_m1["price"]), _w_m1, cuantiles=[0.5])
                        _armas_cal = _df_cal["weapon"].values
                        _ter_cal = tercio_liquidez(_armas_cal, w_counts)
                        _real_cal = _df_cal["price"].values
                        _X_cal_nav = como_navegador(_df_cal[columnas_micro])
                        _tab_fuera = tabla_nivel(_armas_cal, _ter_cal, _real_cal, np.expm1(_slim1[0.5].predict(_X_cal_nav)))
                        _tab_dentro = tabla_nivel(_armas_cal, _ter_cal, _real_cal, np.expm1(_slim2[0.5].predict(_X_cal_nav)))
                        _variantes = {
                            "base": np.ones(len(_armas_te)),
                            "dentro": factores_nivel(_armas_te, _ter_te, *_tab_dentro),
                            "fuera_0.5": factores_nivel(_armas_te, _ter_te, *_tab_fuera, lam=0.5),
                            "fuera_1": factores_nivel(_armas_te, _ter_te, *_tab_fuera, lam=1.0),
                        }
                        res_adelante["slim"] = {}
                        for _nom, _f in _variantes.items():
                            _mt = metricas_banda(fw_real_te, corrige_q(_q_te, _f), _ter_te)
                            res_adelante["slim"][_nom] = _mt
                            _c, _pl = _mt["cobertura"], _mt["por_liquidez"]
                            print(f"    {_nom:<10} cob p25={_c['p25']} p50={_c['p50']} p80={_c['p80']} p90={_c['p90']} p95={_c['p95']}"
                                  f" | mdape={_mt['mdape_trade']} | sesgo={_mt['sesgo_trade']}"
                                  f" | baja={_pl['baja']['sesgo_trade']} media={_pl['media']['sesgo_trade']} alta={_pl['alta']['sesgo_trade']}")
                except Exception as e:
                    print(f"\n  [ERROR] prueba de nivel falló: {e}")

            try:
                _METRICS_LOG_temp = "metrics_history.json"
                if os.path.exists(_METRICS_LOG_temp):
                    with open(_METRICS_LOG_temp, encoding="utf-8") as f:
                        _h = json.load(f)
                        if _h and len(_h) > 0 and _h[-1].get("adelante"):
                            _prev_ad = _h[-1]["adelante"]
                            print(f"\n  [Comparación vs history run anterior]")
                            print(f"    MDAPE trade : {_prev_ad['mdape_trade']} -> {mdape_fw_trade:.1f}")
                            print(f"    Sesgo trade : {_prev_ad['sesgo_trade']} -> {sesgo_trade:.3f}")
                            for q in ["p25", "p50", "p80"]:
                                print(f"    Cov {q}     : {_prev_ad['cobertura'].get(q)} -> {res_adelante['cobertura'].get(q):.1f}")
            except Exception:
                pass
    except Exception as e:
        print(f"\n[ERROR] PRUEBA HACIA DELANTE falló: {e}")

_METRICS_LOG = "metrics_history.json"
try:
    _hist_runs = json.load(open(_METRICS_LOG, encoding="utf-8")) if os.path.exists(_METRICS_LOG) else []
except Exception:
    _hist_runs = []
_hist_runs.append({
    "ts": time.strftime("%Y-%m-%d %H:%M"),
    "filas": int(len(df_ml)), "armas": int(df_ml["weapon"].nunique()),
    "fecha_min": str(df_ml["fecha"].min()) if "fecha" in df_ml.columns else None,
    "fecha_max": str(df_ml["fecha"].max()) if "fecha" in df_ml.columns else None,
    "pct_mag": round(float(df_ml["has_mag"].mean()), 3) if "has_mag" in df_ml.columns else None,
    "r2_log": round(float(r2), 4), "r2_intra": round(float(r2_intra), 4),
    "spearman_intra": round(spearman_intra, 3),
    "auc_godroll": round(float(auc_god), 3),
    "mape_trade": round(float(mape_trade), 1), "mape_global": round(float(mape), 1),
    "mape_mediano_arma": round(float(per["mape"].median()), 1),
    "mape_piso": (round(float(mape_piso), 1) if np.isfinite(mape_piso) else None),
    "mape_trade_inedito": (round(float(mape_inedito), 1) if np.isfinite(mape_inedito) else None),
    "fuga_combos_pct": round(float(_visto_te.mean()) * 100, 1),
    "venta_calibrada": _n_fiable, "venta_armas": len(VENTA_INFO),
    "cobertura": {f"p{int(a*100)}": round(float((y_test <= _qpred_test[a]).mean()) * 100, 1) for a in QUANTILES},
    "winsor_recortadas": _recortadas,
    "mape_piso_semana": (round(float(mape_piso_semana), 1) if np.isfinite(mape_piso_semana) else None),
    "adelante": res_adelante,
})
json.dump(_hist_runs, open(_METRICS_LOG, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
if len(_hist_runs) >= 2:
    _prev_run, _cur_run = _hist_runs[-2], _hist_runs[-1]
    print(f"PROGRESO vs run anterior ({_prev_run['ts']}, {_prev_run['filas']} filas): "
          f"R2intra {_prev_run['r2_intra']:.3f}->{_cur_run['r2_intra']:.3f} | "
          f"MAPEtrade {_prev_run['mape_trade']:.0f}%->{_cur_run['mape_trade']:.0f}% | "
          f"filas +{_cur_run['filas'] - _prev_run['filas']}")
    if _cur_run.get("mape_piso"):
        _gap = _cur_run["mape_trade"] - _cur_run["mape_piso"]
        print(f"  MARGEN vs techo irreducible: {_cur_run['mape_trade']:.0f}% actual - "
              f"{_cur_run['mape_piso']:.0f}% suelo = {_gap:.0f} puntos de mejora POSIBLE. "
              f"Por debajo del suelo solo hay ruido de vendedor.")
print(f"  histórico de métricas: {_METRICS_LOG} ({len(_hist_runs)} runs)")


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

CAL_DRIFT = {}
CAL_SYNLO = {}
CAL_NSAMP = {}
CAL_ANCHOR, CAL_FLOOR, CAL_CEILING, CAL_SYNREF, CAL_BETA = {}, {}, {}, {}, 1.0
CAL_MULT_LO, CAL_MULT_HI = 0.20, 6.0

def _cal_lookup(nombre_riven, tabla):
    v = tabla.get(nombre_riven)
    if v is None:
        v = tabla.get(obtener_representante_inferencia(nombre_riven))
    return v

def tasar_riven_individual(nombre_riven, pos1, pos2, pos3, neg, rerolls,
                           mag1=1.0, mag2=1.0, mag3=1.0, desglose=False):
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
    _mags = [float(np.clip(m, 0.0, 1.0)) for m in (mag1, mag2, mag3)]
    for i, mv in enumerate(_mags, 1):
        if f"mag_pos{i}_norm" in fila_input:
            fila_input[f"mag_pos{i}_norm"] = mv
    if "mag_pos_avg" in fila_input:
        fila_input["mag_pos_avg"] = float(np.mean(_mags))
    if "has_mag" in fila_input:
        fila_input["has_mag"] = 1
    for _hc in ("hist_day_drift", "hist_day_offdrift", "hist_day_rerprem"):
        if _hc in fila_input:
            fila_input[_hc] = 1.0
    if "popularity_pct_x_synergy" in fila_input:
        fila_input["popularity_pct_x_synergy"] = fila_input.get("popularity_pct", 0) * round(score_input, 4)
    _dispo_inf = float(dt["disposition"]) if (dt is not None and "disposition" in dt) \
        else _dispo_map.get(limpiar_chars(nombre_riven), 1.2)
    if "disposition" in fila_input:
        fila_input["disposition"] = _dispo_inf
    if "archetype" in fila_input:
        fila_input["archetype"] = float(dt["archetype"]) if (dt is not None and "archetype" in dt) \
            else _arch_map.get(limpiar_chars(nombre_riven), 0)
    if "dispo_x_synergy" in fila_input:
        fila_input["dispo_x_synergy"] = _dispo_inf * round(score_input, 4)
    _cons_inf = _hcons.get(nombre_query, _hcons.get(str(rep_target).strip().lower(), 0.5))
    if "median_consistency" in fila_input:
        fila_input["median_consistency"] = _cons_inf
    if "meta_signal" in fila_input:
        fila_input["meta_signal"] = (2.0 - _dispo_inf) * float(np.log1p(of_median)) * _cons_inf
    if "official_median_missing" in fila_input:
        fila_input["official_median_missing"] = 0
    if "wfm_avg_missing" in fila_input:
        fila_input["wfm_avg_missing"] = 0

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

    _Xrow = pd.DataFrame([fila_input])[columnas_micro]
    _ql = model_micro.predict_quantiles(_Xrow)
    banda = {a: float(np.expm1(_ql[a][0])) for a in QUANTILES}
    precio_crudo = banda[0.50]

    _dr = _cal_lookup(nombre_riven, CAL_DRIFT) or 1.0
    banda = {a: v * _dr for a, v in banda.items()}

    _mult = 1.0
    rango = precios_suelo_reales.get(nombre_riven) if "precios_suelo_reales" in globals() else None
    _SOFT = os.environ.get("HARD_HEUR") != "1"
    BRICK = {"Critical Chance", "Critical Damage", "Base Damage / Melee Damage", "Multishot", "Fire Rate / Attack Speed"}
    _es_brick = neg != "None" and (neg in BRICK or pesos.get(neg, 0) >= 0.6)
    if _es_brick:
        _mult *= 0.55 if _SOFT else 0.30
    if int(rerolls) == 0:
        _mult *= 1.25
    elif int(rerolls) > 20 and score_input < SYN_P60:
        _mult *= max(0.6, 1.0 - int(rerolls) / 400.0)
    banda = {a: v * _mult for a, v in banda.items()}

    _floor = float(rango["min"]) if rango else 0.0
    banda = {a: float(round(min(max(v, _floor), 15000), 1)) for a, v in banda.items()}

    _final = banda[0.50]
    _synlo = _cal_lookup(nombre_riven, CAL_SYNLO)
    _nsamp = _cal_lookup(nombre_riven, CAL_NSAMP) or 0
    _es_trash = (_synlo is not None) and (score_input <= _synlo)
    _low_conf = _es_trash or (_nsamp < 40)
    _aviso = None
    if _low_conf:
        _motivo = "roll de gama baja" if _es_trash else "pocos datos del arma"
        _aviso = (f"Baja confianza ({_motivo}): el precio puede estar mal. El modelo NO ajusta por "
                  "la mediana de precio de mercado ni por el escalado log fino según el percentil; "
                  "usa la banda [p25–p95] como referencia, no el valor único.")
    if desglose:
        return {"crudo": round(precio_crudo, 1), "final": _final,
                "p25": banda[0.25], "p50": banda[0.50], "p80": banda[0.80],
                "p90": banda.get(0.90, banda[0.80]), "p95": banda.get(0.95, banda[0.80]),
                "drift": round(_dr, 3), "confianza": ("baja" if _low_conf else "alta"), "aviso": _aviso,
                "regla": ("BRICK" if _es_brick else ("trash" if _es_trash else ("0roll" if int(rerolls) == 0 else "q"))),
                "score": round(score_input, 4)}
    return _final

print("Tasacion Kuva Sobek:",
      tasar_riven_individual("Kuva Sobek", "Toxin Damage", "Multishot", "None", "Zoom", 15), "pl")


print("\nCALIBRACION POR ARMA (roll-aware por SCORE de calidad)")
_CAL_WINDOW = int(os.environ.get("CAL_WINDOW_DIAS", "7"))
_CAL_LO_PCT = float(os.environ.get("CAL_LO_PCT", "0.25"))
_CAL_ANCHOR_PCT = float(os.environ.get("CAL_ANCHOR_PCT", "0.50"))
_CAL_HI_PCT = float(os.environ.get("CAL_HI_PCT", "0.82"))
_CAL_BETA = float(os.environ.get("CAL_BETA", "1.0"))
CAL_SYNREF = df_ml.groupby("weapon")["synergy_score"].median().to_dict()
_pred_all = np.expm1(model_micro.predict(df_ml[columnas_micro]))
CAL_MODELMED = pd.Series(_pred_all, index=df_ml.index).groupby(df_ml["weapon"]).median().to_dict()
_lo_price = df_ml.groupby("weapon")["price"].quantile(_CAL_LO_PCT).to_dict()
_anchor_price = df_ml.groupby("weapon")["price"].quantile(_CAL_ANCHOR_PCT).to_dict()
_hi_price = df_ml.groupby("weapon")["price"].quantile(_CAL_HI_PCT).to_dict()
_drift = {}
_shifts_meta = []
if os.path.exists(HIST_SERIES):
    _hs2 = json.load(open(HIST_SERIES, encoding="utf-8"))
    for _arma in df_ml["weapon"].unique():
        _wl = str(_arma).strip().lower()
        _serie = _hs2.get(_wl) or _hs2.get(str(obtener_representante_inferencia(_arma)).strip().lower())
        if not _serie:
            continue
        _all = [s.get("wfm_avg_price") or 0 for s in _serie if s.get("wfm_avg_price")]
        _rec = [s.get("wfm_avg_price") or 0 for s in _serie[-_CAL_WINDOW:] if s.get("wfm_avg_price")]
        _prev = [s.get("wfm_avg_price") or 0 for s in _serie[-2 * _CAL_WINDOW:-_CAL_WINDOW] if s.get("wfm_avg_price")]
        if _all and _rec and np.median(_all) > 0:
            _ratio_drift = np.median(_rec) / np.median(_all)
            _sostenido = (len(_rec) >= 5 and len(_prev) >= 5
                          and (np.median(_rec) / (np.median(_prev) + 1e-9) >= 1.5
                               or np.median(_rec) / (np.median(_prev) + 1e-9) <= 0.67))
            _lo_clip, _hi_clip = (0.5, 3.5) if _sostenido else (0.7, 2.0)
            _drift[_arma] = float(np.clip(_ratio_drift, _lo_clip, _hi_clip))
            if _sostenido:
                _shifts_meta.append((str(_arma), round(float(np.median(_rec) / (np.median(_prev) + 1e-9)), 2)))
if _shifts_meta:
    _shifts_meta.sort(key=lambda t: -abs(np.log(t[1])))
    print(f"  CAMBIOS DE META detectados ({len(_shifts_meta)} armas, drift ampliado a [0.5,3.5]): "
          + ", ".join(f"{w} ×{r}" for w, r in _shifts_meta[:8]) + ("…" if len(_shifts_meta) > 8 else ""))
CAL_ANCHOR, CAL_FLOOR, CAL_CEILING = {}, {}, {}
for _arma in df_ml["weapon"].unique():
    _dr = _drift.get(_arma, 1.0)
    for _d, _p in ((CAL_ANCHOR, _anchor_price), (CAL_FLOOR, _lo_price), (CAL_CEILING, _hi_price)):
        v = _p.get(_arma)
        if v and v > 0:
            _d[_arma] = round(float(v) * _dr, 2)
CAL_BETA = _CAL_BETA
CAL_DRIFT.update({k: round(v, 3) for k, v in _drift.items()})
CAL_SYNLO.update({k: round(float(v), 4) for k, v in df_ml.groupby("weapon")["synergy_score"].quantile(0.30).items()})
CAL_NSAMP.update({k: int(v) for k, v in df_ml["weapon"].value_counts().items()})
print(f"  drift por arma: {len(CAL_DRIFT)} armas | medio={np.median(list(_drift.values()) or [1]):.2f}")
if CAL_ANCHOR:
    _aser = pd.Series(CAL_ANCHOR)
    print(f"  ancla(p50): {len(CAL_ANCHOR)} armas | p25={pd.Series(CAL_FLOOR).median():.0f}pl "
          f"mediana={_aser.median():.0f}pl p82={pd.Series(CAL_CEILING).median():.0f}pl beta={CAL_BETA}")
    with open("calibracion_por_arma.json", "w", encoding="utf-8") as f:
        json.dump({"anchor": CAL_ANCHOR, "floor": CAL_FLOOR, "ceiling": CAL_CEILING,
                   "synref": {k: round(v, 4) for k, v in CAL_SYNREF.items()},
                   "beta": CAL_BETA}, f, indent=2, ensure_ascii=False)
    print("  guardado: calibracion_por_arma.json")
else:
    print("  [WARN] sin datos -> calibración neutra.")


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
                        "Punch Through"]

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
# vinquibus is a rifle that also accepts melee rivens
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

med_arma = df_micro_clean.groupby("weapon")["price"].transform("median")
df_micro_clean["price_rel"] = df_micro_clean["price"] / (med_arma + 1.0)

df_pos = pd.melt(df_micro_clean, id_vars=["weapon", "price", "price_rel"],
                 value_vars=["stat_pos1", "stat_pos2", "stat_pos3"], value_name="stat").dropna()
df_pos = df_pos[df_pos["stat"] != "None"]
df_neg = df_micro_clean[["weapon", "price", "price_rel", "stat_neg"]].rename(columns={"stat_neg": "stat"})
df_neg = df_neg[(df_neg["stat"].notna()) & (df_neg["stat"] != "None")]

ESCALA_ANCLAS = {"pos": (0.30, 2.00), "neg": (0.25, 3.00)}

MIN_EVIDENCIA = {"pos": 3, "neg": 2}


def _peso_fijo(mediana, base, lado):
    lo, hi = ESCALA_ANCLAS[lado]
    ratio = mediana / (base if base else 1.0)
    w = (np.log(max(ratio, 1e-6)) - np.log(lo)) / (np.log(hi) - np.log(lo))
    return round(float(min(1.0, max(0.01, w))), 3)


def _pesos(df_long, value_col, lado, base=None, min_vol=1):
    if df_long.empty:
        return {}
    agr = df_long.groupby("stat").agg(m=(value_col, "median"), vol=(value_col, "count")).reset_index()
    agr = agr[agr["vol"] >= min_vol]
    if agr.empty:
        return {}
    ref = base if base else float(df_long[value_col].median())
    return {r["stat"]: (_peso_fijo(r["m"], ref, lado), int(r["vol"])) for _, r in agr.iterrows()}


def _promover_lider(pesos, corte, banda=0.90, tope=4):
    if not pesos:
        return pesos
    orden = sorted(pesos.items(), key=lambda kv: -kv[1])
    mx = orden[0][1]
    if mx <= 0:
        return pesos
    lider = {s for s, v in orden[:tope] if v >= banda * mx}
    minimo = min(pesos[s] for s in lider)
    if minimo >= corte:
        return pesos
    f = (corte + 0.005) / minimo
    return {s: (round(min(1.0, v * f), 3) if s in lider else v) for s, v in pesos.items()}

glob_pos = _pesos(df_pos, "price_rel", "pos", min_vol=25)
glob_neg = _pesos(df_neg, "price_rel", "neg", min_vol=20)
GLOBAL_POS = {s: w for s, (w, _) in glob_pos.items()}
GLOBAL_NEG = {s: w for s, (w, _) in glob_neg.items()}

_imp = pd.Series(optimized_xgb.feature_importances_, index=columnas_micro)
MODEL_IMP_POS = {c[len("has_pos_stat_"):]: round(float(v), 4) for c, v in _imp.items() if c.startswith("has_pos_stat_")}
MODEL_IMP_NEG = {c[len("has_neg_stat_"):]: round(float(v), 4) for c, v in _imp.items() if c.startswith("has_neg_stat_")}

K_PRIOR = 8

def _mezclar(w_local, n_local, w_global, neutro=0.30):
    if w_local is not None and n_local and n_local > 0:
        if w_global is None:
            return round(w_local, 3), "data"
        b = (n_local * w_local + K_PRIOR * w_global) / (n_local + K_PRIOR)
        return round(b, 3), ("data" if n_local >= K_PRIOR else "mix")
    if w_global is not None:
        return round(w_global, 3), "global"
    return neutro, "prior"

export_maestro_real = {"_global": {
    "pos": dict(sorted(GLOBAL_POS.items(), key=lambda x: -x[1])),
    "neg": dict(sorted(GLOBAL_NEG.items(), key=lambda x: -x[1])),
    "model_importance_pos": dict(sorted(MODEL_IMP_POS.items(), key=lambda x: -x[1])),
    "model_importance_neg": dict(sorted(MODEL_IMP_NEG.items(), key=lambda x: -x[1])),
}}

_PREV_W = {}
try:
    _prev_path = os.path.join(os.environ.get("DEPLOY_ML_DIR", "generado"), "stat_weights.json")
    with open(_prev_path, encoding="utf-8") as _f:
        for _arma, _m in json.load(_f).items():
            if _arma == "_global" or not isinstance(_m, dict):
                continue
            _PREV_W[_arma] = {lado: {s: v for tier in (_m.get(lado) or {}).values()
                                     for s, v in (tier or {}).items()} for lado in ("pos", "neg")}
    print(f"[HISTÉRESIS] pesos previos de {len(_PREV_W)} armas desde {_prev_path}")
except Exception as _e:
    print(f"[HISTÉRESIS] sin pesos previos ({_e}); primera corrida con cortes limpios.")

HISTERESIS = 0.03

med_por_arma = df_micro_clean.groupby("weapon")["price"].median()

for arma in df_micro_clean["weapon"].unique():
    tidx = _weapon_tidx.get(limpiar_chars(arma))
    _base = float(med_por_arma.get(arma, 0.0) or 0.0)
    loc_pos = _pesos(df_pos[df_pos["weapon"] == arma], "price", "pos", base=_base)
    loc_neg = _pesos(df_neg[df_neg["weapon"] == arma], "price", "neg", base=_base)

    pesos_pos_arma, pesos_neg_arma, baja_confianza = {}, {}, []
    baja_confianza_neg = []
    for stat in ALL_POSSIBLE_STATS:
        if not stat_ok(stat, tidx):
            continue
        wl, nl = loc_pos.get(stat, (None, 0))
        val, src = _mezclar(wl, nl, GLOBAL_POS.get(stat))
        pesos_pos_arma[stat] = val
        if src in ("global", "prior") or nl < MIN_EVIDENCIA["pos"]:
            baja_confianza.append(stat)
    for stat in ALL_POSSIBLE_STATS:
        if stat in IMPOSSIBLE_NEGATIVES:
            continue
        if not stat_ok(stat, tidx):
            continue
        wl, nl = loc_neg.get(stat, (None, 0))
        wg = GLOBAL_NEG.get(stat)
        if wg is None:
            wg = round(max(0.01, min(1.0, 1.01 - pesos_pos_arma.get(stat, 0.30))), 3)
        val, src_n = _mezclar(wl, nl, wg)
        pesos_neg_arma[stat] = val
        if src_n in ("global", "prior") or nl < MIN_EVIDENCIA["neg"]:
            baja_confianza_neg.append(stat)

    pesos_pos_arma = _promover_lider(pesos_pos_arma, 0.75)
    pesos_neg_arma = _promover_lider(pesos_neg_arma, 0.70)

    _prev = _PREV_W.get(arma, {})

    def _tier(stat, p, cortes, lado, previos=_prev):
        nombres = ("S", "A", "B", "F")
        actual = next((n for n, c in zip(nombres, cortes) if p >= c), "F")
        antes = (previos.get(lado) or {}).get(stat)
        if antes is None:
            return actual
        prev_tier = next((n for n, c in zip(nombres, cortes) if antes >= c), "F")
        if nombres.index(prev_tier) < nombres.index(actual):
            corte_prev = cortes[nombres.index(prev_tier)]
            if p >= corte_prev - HISTERESIS:
                return prev_tier
        return actual

    meta = {"pos": {"S": {}, "A": {}, "B": {}, "F": {}}, "neg": {"S": {}, "A": {}, "B": {}, "F": {}}}
    for s, p in pesos_pos_arma.items():
        meta["pos"][_tier(s, p, (0.75, 0.45, 0.15, 0.0), "pos")][s] = p
    for s, p in pesos_neg_arma.items():
        meta["neg"][_tier(s, p, (0.70, 0.40, 0.15, 0.0), "neg")][s] = p

    pop = df_micro_clean.loc[df_micro_clean["weapon"] == arma, "popularity_pct"]
    meta["popularity"] = round(float(pop.iloc[0]), 2) if not pop.empty else 0.0
    meta["mejores_pos"] = sorted(meta["pos"]["S"], key=lambda s: -pesos_pos_arma[s])[:4]
    meta["mejores_neg"] = sorted(meta["neg"]["S"], key=lambda s: -pesos_neg_arma[s])[:3]
    meta["baja_confianza"] = baja_confianza
    meta["baja_confianza_neg"] = baja_confianza_neg
    export_maestro_real[arma] = meta

with open("voidstonks_tiers_dinamicos_pesos.json", "w", encoding="utf-8") as f:
    json.dump(export_maestro_real, f, indent=4, ensure_ascii=False)
print(f"Tiers dinamicos guardados. Prior global: {len(GLOBAL_POS)} pos / {len(GLOBAL_NEG)} neg.")
print("Top positivos globales:", dict(sorted(GLOBAL_POS.items(), key=lambda x: -x[1])[:6]))

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


from curiosidades_gen import _generar_curiosidades  # noqa: E402

_curios = _generar_curiosidades(HIST_SERIES)
if _curios:
    _dest_cur = os.environ.get("DEPLOY_ML_DIR", "generado")
    os.makedirs(_dest_cur, exist_ok=True)
    with open(os.path.join(_dest_cur, "curiosidades.json"), "w", encoding="utf-8") as f:
        json.dump({"generado": str(pd.Timestamp.now("UTC").date()), "eventos": _curios},
                  f, indent=1, ensure_ascii=False)
    print(f"Curiosidades guardadas: {len(_curios)} eventos.")
else:
    print("Curiosidades: sin eventos que superen los filtros de ruido.")


if os.environ.get("SLIM_EXPORT", "1") == "1":
    print("\nFASE 8: EXPORT NAVEGADOR (cuantiles slim)")
    import gzip as _gz
    _OUT = os.environ.get("DEPLOY_ML_DIR", "generado")
    os.makedirs(_OUT, exist_ok=True)
    _bundle = {"quantiles": QUANTILES, "alpha_train": _ALPHA_TRAIN, "models": {}}
    _slim = entrena_slim(X_train, y_train, w_recencia if _RECENCIA_ON else None)
    _pf = pd.to_datetime(df_ml["primera_fecha"], errors="coerce")
    _ult = df_ml[_pf >= _pf.max() - pd.Timedelta(days=_NIVEL_DIAS)]
    _conteos = df_ml["weapon"].value_counts()
    _por_arma, _por_tercio = tabla_nivel(_ult["weapon"].values, tercio_liquidez(_ult["weapon"].values, _conteos),
                                         _ult["price"].values, np.expm1(_slim[0.5].predict(como_navegador(_ult[columnas_micro]))))
    _armas = df_ml["weapon"].unique()
    _f_nivel = factores_nivel(_armas, tercio_liquidez(_armas, _conteos), _por_arma, _por_tercio)
    CAL_NIVEL = {str(a): round(float(f), 3) for a, f in zip(_armas, _f_nivel)}
    print(f"  nivel: {len(CAL_NIVEL)} armas con {len(_ult)} anuncios de {_NIVEL_DIAS} días | mediana ×{np.median(_f_nivel):.2f} | "
          + " ".join(f"{t} ×{np.exp(_por_tercio.get(t, 0.0)):.2f}" for t in ("baja", "media", "alta")))
    _CLAVES_ARBOL = ("split_indices", "split_conditions", "left_children", "right_children", "default_left")
    for a in QUANTILES:
        _tmp = os.path.join(_OUT, f"_q{int(a*100)}.json"); _slim[a].get_booster().save_model(_tmp)
        _lrn = json.load(open(_tmp))["learner"]; os.remove(_tmp)
        _bundle["models"][str(a)] = {"learner": {
            "learner_model_param": {"base_score": _lrn["learner_model_param"]["base_score"]},
            "gradient_booster": {"model": {"trees": [{k: t[k] for k in _CLAVES_ARBOL} for t in _lrn["gradient_booster"]["model"]["trees"]]}}}}
    json.dump(_bundle, open(os.path.join(_OUT, "model_quantiles_slim.json"), "w"))
    json.dump(list(columnas_micro), open(os.path.join(_OUT, "feature_order_slim.json"), "w"))
    _def = {}
    for c in columnas_micro:
        _m = pd.to_numeric(df_ml[c], errors="coerce").median()
        _def[c] = float(_m) if pd.notna(_m) else 0.0
    json.dump(_def, open(os.path.join(_OUT, "feature_defaults_slim.json"), "w"))
    _peso_mag = 0.25
    try:
        _dm = df_micro_clean[df_micro_clean["mag_pos1"].notna()].copy()
        _dm["_combo"] = _dm[["weapon", "stat_pos1", "stat_pos2", "stat_pos3", "stat_neg"]] \
            .fillna("None").astype(str).agg("|".join, axis=1)
        _dm["_mag"] = _dm[["mag_pos1", "mag_pos2", "mag_pos3"]].mean(axis=1)
        _rat = []
        for _c, _g in _dm.groupby("_combo"):
            if len(_g) < 8 or _g["_mag"].std() <= 0:
                continue
            _q = _g["_mag"].quantile([0.25, 0.75])
            _lo = _g[_g["_mag"] <= _q.iloc[0]]["price"].median()
            _hi = _g[_g["_mag"] >= _q.iloc[1]]["price"].median()
            if _lo and _lo > 0 and _hi > 0:
                _rat.append(_hi / _lo)
        _ef_mag = float(np.median(_rat)) if len(_rat) >= 15 else 1.20
        _ef_stat = max(float(np.median(list(GLOBAL_POS.values()) or [1.0])) and 3.33, 1.01)
        _lm, _ls = np.log(max(_ef_mag, 1.01)), np.log(_ef_stat)
        _peso_mag = round(min(0.35, max(0.15, _lm / (_lm + _ls))), 3)
        print(f"  Reparto score: magnitud {_peso_mag:.2f} / meta {1 - _peso_mag:.2f} "
              f"(efecto magnitud {_ef_mag:.2f}x sobre {len(_rat)} combos)")
    except Exception as _e:
        print(f"[WARN] no se pudo medir el reparto del score, se deja 0.25: {_e}")

    json.dump({"drift": CAL_DRIFT, "nivel": CAL_NIVEL, "synlo": CAL_SYNLO, "nsamp": CAL_NSAMP,
               "precision": (PRECISION_ARMA if "PRECISION_ARMA" in dir() else {}),
               "quantiles": QUANTILES, "venta": VENTA_INFO,
               "venta_min_pop": _CAL_MIN_POP, "peso_magnitud": _peso_mag},
              open(os.path.join(_OUT, "calibracion_por_arma.json"), "w"))
    _pb, _grp = {}, df_ml.groupby("weapon")["price"]
    for _wp in df_ml["weapon"].unique():
        _s = _grp.get_group(_wp); _q = [int(round(_s.quantile(x / 10))) for x in range(1, 10)]
        _drp = CAL_DRIFT.get(_wp, 1.0); _nn = int(len(_s))
        _flag = "bubble" if _drp > 1.3 else ("illiquid" if CAL_NSAMP.get(_wp, 0) < 40 else "mid")
        _pb[_wp] = {"floor": _q[0], "typical": int(round(_s.median())), "ceiling": _q[-1],
                    "n": _nn, "q": _q, "vol_dia": 0.0, "trend": round((_drp - 1) * 100, 1),
                    "ratio": 0.0, "flag": _flag}
    json.dump(_pb, open(os.path.join(_OUT, "price_bands.json"), "w"))
    json.dump(export_maestro_real, open(os.path.join(_OUT, "stat_weights.json"), "w"), ensure_ascii=False)
    _raw = json.dumps(_bundle).encode()
    print(f"  {_OUT}/ -> model_quantiles_slim.json ({len(QUANTILES)} cuantiles, depth{_SLIM_DEPTH} n{_SLIM_N}) "
          f"RAW={len(_raw)/1e6:.1f}MB GZIP={len(_gz.compress(_raw))/1e6:.2f}MB | feats={len(columnas_micro)}")
    print(f"  + feature_order_slim.json, feature_defaults_slim.json, calibracion_por_arma.json, "
          f"price_bands.json, stat_weights.json")


if os.environ.get("PRUEBAS", "1") == "1":
    print("\n" + "=" * 90)
    print("PRUEBAS DE TASACION (banda p25/p50/p80/p90/p95 por calidad de roll)")
    print("=" * 90)
    _CASOS = {
        "Kuva Bramma": [
            ("GODROLL mag alta", "Multishot", "Critical Damage", "Critical Chance", "Impact Damage", 1.0, 1.0, 1.0),
            ("GODROLL mag baja", "Multishot", "Critical Damage", "Critical Chance", "Impact Damage", 0.3, 0.3, 0.3),
            ("MID", "Multishot", "Heat Damage", "Reload Speed", "Zoom", 0.7, 0.6, 0.5),
            ("TRASH", "Recoil", "Ammo Maximum", "Zoom", "Multishot", 0.4, 0.4, 0.4),
            ("BRICK (-CD)", "Multishot", "Critical Chance", "Toxin Damage", "Critical Damage", 1.0, 1.0, 1.0),
        ],
        "Torid": [
            ("GODROLL mag alta", "Critical Chance", "Critical Damage", "Multishot", "Zoom", 1.0, 1.0, 1.0),
            ("MID", "Toxin Damage", "Heat Damage", "Status Chance", "Zoom", 0.6, 0.6, 0.6),
            ("TRASH", "Recoil", "Zoom", "Ammo Maximum", "Critical Chance", 0.4, 0.4, 0.4),
        ],
        "Nukor": [
            ("GODROLL mag alta", "Critical Chance", "Critical Damage", "Multishot", "Zoom", 1.0, 1.0, 1.0),
            ("MID", "Heat Damage", "Status Chance", "None", "Magazine Capacity", 0.6, 0.6, 1.0),
            ("TRASH", "Recoil", "Zoom", "Ammo Maximum", "Critical Damage", 0.4, 0.4, 0.4),
        ],
    }
    for _w, _casos in _CASOS.items():
        print(f"\n  === {_w} ===")
        print(f"  {'caso':18s} {'p25':>6s} {'p50':>6s} {'p80':>6s} {'p90':>6s} {'p95':>7s}  conf   regla")
        for _c in _casos:
            _lab, _p1, _p2, _p3, _ng, _m1, _m2, _m3 = _c
            _d = tasar_riven_individual(_w, _p1, _p2, _p3, _ng, 15, _m1, _m2, _m3, desglose=True)
            print(f"  {_lab:18s} {int(_d['p25']):6d} {int(_d['p50']):6d} {int(_d['p80']):6d} "
                  f"{int(_d['p90']):6d} {int(_d['p95']):7d}  {_d['confianza']:5s}  {_d['regla']}")
    print("=" * 90)


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


if os.environ.get("COMPARAR_LISTINGS") == "1":
    print("\n" + "=" * 72)
    print("FASE 7: COMPARATIVA TASACION vs LISTINGS VIVOS (datos del oráculo)")
    print("=" * 72)
    _cols_vivos = ["weapon", "stat_pos1", "stat_pos2", "stat_pos3", "stat_neg", "price",
                   "mag_pos1", "mag_pos2", "mag_pos3", "mag_neg", "auction_id", "tiradas"]
    try:
        _ids_vivos = set(pd.read_csv(os.path.join(os.path.dirname(LOCAL_CSV), "subastas_vivas.csv"),
                                     usecols=["auction_id"])["auction_id"].astype(str))
        _cab = pd.read_csv(LOCAL_CSV, nrows=0).columns
        _vivos = pd.read_csv(LOCAL_CSV, usecols=[c for c in _cols_vivos if c in _cab], low_memory=False)
    except Exception as e:
        print(f"  [WARN] no se pudieron leer los datos del oráculo: {e}")
        _ids_vivos, _vivos = set(), pd.DataFrame(columns=_cols_vivos)
    if "tiradas" not in _vivos.columns:
        _vivos = _vivos.iloc[0:0].assign(tiradas=pd.Series(dtype=float))
    _vivos = _vivos[_vivos["auction_id"].astype(str).isin(_ids_vivos) & _vivos["tiradas"].notna()
                    & (_vivos["price"] > 0) & (_vivos["price"] <= 25000)]
    _vivos = _vivos.drop_duplicates("auction_id", keep="last")

    _n_weap = int(os.environ.get("COMPARAR_N_WEAPONS", "20"))
    _per_weap = int(os.environ.get("COMPARAR_PER_WEAPON", "6"))
    _sample_weapons = df_micro_clean["weapon"].value_counts().head(60).index.tolist()
    import random as _rnd; _rnd.seed(7); _rnd.shuffle(_sample_weapons)
    _sample_weapons = _sample_weapons[:_n_weap]

    filas, n_fetch = [], 0
    for _w in _sample_weapons:
        aucs = _vivos[_vivos["weapon"] == _w].sort_values("price")
        if aucs.empty:
            continue
        n_fetch += 1
        idxs = sorted(set(int(i) for i in np.linspace(0, len(aucs) - 1, min(_per_weap, len(aucs)))))
        for _, a in aucs.iloc[idxs].iterrows():
            pos = [str(a[c]) if pd.notna(a[c]) else "None" for c in ("stat_pos1", "stat_pos2", "stat_pos3")]
            neg = str(a["stat_neg"]) if pd.notna(a["stat_neg"]) else "None"
            mraw = {pos[0]: a["mag_pos1"], pos[1]: a["mag_pos2"], pos[2]: a["mag_pos3"], neg: a["mag_neg"]}
            rerolls = int(a["tiradas"])
            def _mn(st):
                if st == "None":
                    return 1.0
                v = _mag_norm(_w, st, mraw.get(st))
                return 0.6 if (v is None or (isinstance(v, float) and np.isnan(v))) else v
            dg = tasar_riven_individual(_w, pos[0], pos[1], pos[2], neg, rerolls,
                                        _mn(pos[0]), _mn(pos[1]), _mn(pos[2]), desglose=True)
            real = float(a["price"])
            filas.append({"weapon": _w, "pos": pos, "neg": neg, "rr": rerolls, "real": real,
                          "p25": dg["p25"], "p50": dg["p50"], "p80": dg["p80"], "p95": dg["p95"],
                          "conf": dg["confianza"], "regla": dg["regla"],
                          "ape": abs(dg["p50"] - real) / max(real, 5.0),
                          "in_band": 1 if (dg["p25"] <= real <= dg["p95"]) else 0})

    if not filas:
        print("  [WARN] sin listings vivos con tiradas en los datos del oráculo (las guarda desde 2026-10-04).")
    else:
        dfc = pd.DataFrame(filas)
        print(f"\n  Armas con listings: {n_fetch}/{len(_sample_weapons)}  |  listings comparados: {len(dfc)}")
        print(f"  {'arma':15s} {'roll (-neg, rr)':30s} {'real':>7s} {'p25':>6s} {'p50':>6s} {'p80':>6s} {'p95':>6s} ?")
        print("  " + "-" * 96)
        for _, r in dfc.sort_values(["weapon", "real"]).iterrows():
            posdesc = "/".join(p.split()[0][:5] for p in r["pos"] if p != "None")
            roll = f"{posdesc} -{r['neg'].split()[0][:4] if r['neg']!='None' else '—'} rr{r['rr']}"
            mark = "✓" if r["in_band"] else ("↑" if r["real"] > r["p95"] else "↓")
            conf = "!" if r["conf"] == "baja" else " "
            print(f"  {r['weapon'][:15]:15s} {roll[:30]:30s} {int(r['real']):7d} {int(r['p25']):6d} "
                  f"{int(r['p50']):6d} {int(r['p80']):6d} {int(r['p95']):6d} {mark}{conf}")
        print("  " + "-" * 96)
        print(f"  (! = baja confianza: {(dfc.conf=='baja').mean()*100:.0f}% de los listings)")
        print(f"\n  BANDA vs listings reales:")
        print(f"    reales dentro de [p25,p95]: {dfc.in_band.mean()*100:.0f}%")
        print(f"    MAPE de p50 vs ask individual: global={dfc.ape.mean()*100:.0f}%  "
              f">=200pl={dfc[dfc.real>=200].ape.mean()*100:.0f}%")
        dfc["ask_p30"] = dfc.groupby("weapon").real.transform(lambda s: s.quantile(0.30))
        dfc["ask_med"] = dfc.groupby("weapon").real.transform("median")
        print(f"    ratio p50/ask_mediano={(dfc.p50/dfc.ask_med).median():.2f}  "
              f"p80/ask_mediano={(dfc.p80/dfc.ask_med).median():.2f}  "
              f"p95/ask_mediano={(dfc.p95/dfc.ask_med).median():.2f}")
        _gmask = dfc.real >= dfc.groupby("weapon").real.transform(lambda s: s.quantile(0.80))
        if _gmask.sum() > 3:
            _g = dfc[_gmask]
            print(f"    GODROLLS (top asks, n={int(_gmask.sum())}): real dentro de [p80,p95]="
                  f"{((_g.real>=_g.p80)&(_g.real<=_g.p95)).mean()*100:.0f}%  p95/real={(_g.p95/_g.real).median():.2f}")
        print("=" * 72)
