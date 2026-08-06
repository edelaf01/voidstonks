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
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
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

cols_originales = ["weapon", "fecha", "price", "stat_pos1", "stat_pos2", "stat_pos3", "stat_neg",
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

# TTL de la caché: entrenar con macro/historial congelados de días atrás desanclaba la
# tasación del mercado actual (la caché se usaba para siempre mientras existiera el fichero).
CACHE_TTL_H = float(os.environ.get("VOIDSTONKS_CACHE_TTL_H", "24"))
_cache_fresca = (os.path.exists(FILE_CACHE)
                 and (time.time() - os.path.getmtime(FILE_CACHE)) < CACHE_TTL_H * 3600)
if os.path.exists(FILE_CACHE) and not _cache_fresca:
    print(f"Cache con más de {CACHE_TTL_H:.0f}h: se refresca desde la API "
          f"(VOIDSTONKS_CACHE_TTL_H para ajustar).")


def agregar_historial(arma, data):
    """Agregados hist_* de la serie diaria de un arma (mismo cálculo se use red o JSON local)."""
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
    return {
        "weapon": str(arma).strip(),
        "hist_current_official": float(f_h["official_median"]),
        "hist_current_wfm": float(f_h["wfm_avg_price"]),
        "hist_liquidity_avg": float(f_h["liquidity_score"]),
        "hist_volatility_max": float(f_h["volatility_index"]),
        "hist_rerolled_premium": float(f_h["rerolled_premium_ratio"]),
        "hist_momentum": float(round(f_h["wfm_avg_price"] / wfm_med, 3)),  # vs mediana robusta
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

    # --- /api/rivens devuelve el DICT COMPLETO (ignora ?weapon): una sola llamada ---
    api_map = {}
    try:
        full = sess.get(API_BASE, timeout=30).json()
        api_map = {k.lower(): v for k, v in full.items()
                   if k != "__baseline" and isinstance(v, dict)}
        print(f"  macro: {len(api_map)} armas indexadas.")
    except Exception as e:
        print(f"  [WARN] /api/rivens falló: {e}")

    # --- Historial por arma: PRIMERO del JSON local de history_fetch.py (misma serie completa,
    #     cero red); solo va a la API, en serie, para las armas que falten en el JSON. Antes se
    #     descargaba TODO el endpoint dos veces (aquí en serie + history_fetch.py en paralelo).
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
                data = h.get("data") if isinstance(h, dict) else h  # tolera formato viejo (lista)
                time.sleep(0.05)  # solo ratelimit cuando hay red de por medio
            if not data:
                continue
            datos_temporales.append(agregar_historial(arma, data))
        except Exception:
            fallos_hist += 1
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
    # SEÑALES NUEVAS data-driven (análisis de correlación con precio, jun 2026):
    #   re_* = godrolls oficiales DE (median/std/pop/max). wfm_vs_off = prima meta (corr 0.50).
    #   ceil_mult = headroom de godroll re_max/re_med (corr 0.69).
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

# macro secundaria (incluye las señales nuevas; web_min/max/volatility/trend se siguen
# descargando pero NO entran como features: ruido/redundancia comprobada por correlación)
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

# ====================================================================
# HISTORY por (arma, fecha): NIVEL DE MERCADO de ese día (serie diaria completa de /api/history,
# descargada por history_fetch.py). Es el wfm_avg del MERCADO ese día, no el precio de la fila
# -> sin fuga. Captura la deriva diaria. Medido: aporte pequeño hoy (~4% varianza intra, casi
# ruido) pero usa TODOS los datos del endpoint y escala según se acumulan más días.
HIST_SERIES = os.environ.get("VOIDSTONKS_HIST_SERIES", "history_series.json")
_hist_day_cols = ["hist_day_drift", "hist_day_offdrift", "hist_day_liq", "hist_day_sample", "hist_day_rerprem"]
_hcons = {}   # consistencia de la mediana por arma (1 = estable, ->0 = errática)
if "fecha" in df_micro.columns and os.path.exists(HIST_SERIES):
    _hs = json.load(open(HIST_SERIES, encoding="utf-8"))
    _hday, _hmed = {}, {}
    for _wl, _serie in _hs.items():
        _wfm = [s.get("wfm_avg_price") or 0 for s in _serie if s.get("wfm_avg_price")]
        _off = [s.get("official_median") or 0 for s in _serie if s.get("official_median")]
        _hmed[_wl] = {"wfm": float(np.median(_wfm)) if _wfm else 0.0,
                      "off": float(np.median(_off)) if _off else 0.0}
        # CONSISTENCIA: 1/(1+CV) de la mediana oficial diaria. Mediana alta Y estable
        # (junto a dispo baja) = arma meta asentada -> rivens caros de forma sostenida.
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

# fatigue_index ya NO mete price (official_median es macro real / mediana)
conteo = df_micro["weapon"].value_counts()
df_micro_clean = df_micro[df_micro["weapon"].isin(conteo[conteo >= 25].index)].copy()
df_micro_clean["fatigue_index"] = df_micro_clean["rerolls"] / (df_micro_clean["official_median"] + 1)

# REFUERZO GLOBAL: disposición (omegaAttenuation) + arquetipo por arma (de cleaned_weapons.json).
# A diferencia del one-hot (cada arma independiente), estas features dejan al modelo GENERALIZAR
# entre armas parecidas: "dispo baja + combo elemental = valioso" se transfiere a armas con pocos
# datos. Disposición es un value-driver real (escala la potencia de cada stat).
_CW_FEAT = os.environ.get("VOIDSTONKS_WEAPONS",
                          "/var/home/ppsoy/Escritorio/voidstonks/deploy/assets/json/cleaned_weapons.json")
_TYPE2IDX = {"Rifle": 0, "Sniper": 0, "Bow": 0, "Launcher": 0, "Sentinel": 0, "Companion Weapon": 0,
             "Shotgun": 1, "Pistol": 2, "Dual Pistols": 2, "Thrown": 2, "Throwing": 2, "Kitgun": 2,
             "Melee": 3, "Zaw": 3, "Zaw Component": 3, "Glaive": 3, "Arch-Gun": 4, "Archgun": 4}
_dispo_map, _arch_map = {}, {}
try:
    for _w in json.load(open(_CW_FEAT, encoding="utf-8")):
        _cn = re.sub(r"[^a-z0-9]", "", str(_w.get("name", "")).lower())
        _dispo_map[_cn] = float(_w.get("omegaAttenuation") or 1.0)
        _arch_map[_cn] = _TYPE2IDX.get(_w.get("type"), 0)
    print(f"  refuerzo global: disposición+arquetipo para {len(_dispo_map)} armas.")
except Exception as _e:
    print("  [WARN] sin cleaned_weapons.json para dispo/arquetipo:", _e)
_clean_w = df_micro_clean["weapon"].map(lambda w: re.sub(r"[^a-z0-9]", "", str(w).lower()))
df_micro_clean["disposition"] = _clean_w.map(lambda c: _dispo_map.get(c, 1.0))
df_micro_clean["archetype"] = _clean_w.map(lambda c: _arch_map.get(c, 0))

# SEÑAL META (idea: dispo + mediana consistente => arma meta cara). La dispo baja la pone DE
# precisamente a las armas más usadas; si además la mediana es alta Y estable en el historial,
# el arma es meta asentada y sus rivens cotizan caro de forma sostenida (no burbuja de un día).
# meta_signal = (2 - dispo) * log1p(mediana) * consistencia -> crece con uso, nivel y estabilidad.
_wl_col = df_micro_clean["weapon"].map(lambda w: str(w).strip().lower())
df_micro_clean["median_consistency"] = _wl_col.map(lambda w: _hcons.get(w, 0.5))
df_micro_clean["meta_signal"] = ((2.0 - df_micro_clean["disposition"])
                                 * np.log1p(df_micro_clean["official_median"])
                                 * df_micro_clean["median_consistency"])
print(f"  señal meta: consistencia de mediana para {len(_hcons)} armas "
      f"(mediana consistencia={np.median(list(_hcons.values())) if _hcons else 0:.2f}).")

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

def _mag_norm(weapon, stat, val, default=np.nan):
    """Magnitud normalizada 0..1 vs p95(arma,stat). Por DEFECTO devuelve NaN cuando
    no hay magnitud: XGBoost rutea los NaN nativamente, así 'desconocido' NO se confunde
    con 'godroll' (antes default=1.0 inflaba la sinergia y mataba la importancia del feature)."""
    if not HAS_MAG or pd.isna(val):
        return default
    ref = ref_mag.get((weapon, stat))
    if not ref:
        return default
    return float(np.clip(abs(float(val)) / abs(ref), 0.0, 1.0))

def calcular_sinergia(row):
    """Contribución CONTINUA por stat = peso_meta(endpoint soft) x magnitud_norm.
    Sin castigo binario. Sin magnitud usa 0.6 (roll mediano) para que la sinergia siga
    siendo finita; la señal de 'magnitud desconocida' la llevan los mag_*_norm (NaN)."""
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

# Magnitud como features explícitas del modelo (NaN cuando falta -> XGB splitea en missing)
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

# Umbrales DINÁMICOS (percentiles reales de la sinergia) en vez de 1.3 / 1.7 hardcodeados
SYN_P60 = float(df_micro_clean["synergy_score"].quantile(0.60))
SYN_P85 = float(df_micro_clean["synergy_score"].quantile(0.85))
print(f"  Umbrales dinámicos -> burner<{SYN_P60:.2f} | godroll>={SYN_P85:.2f}")

df_ml = df_micro_clean.copy()

# ONE-HOT de arma: RETIRADO (jul 2026). Verificado con exp_matrix (100k filas): quitar los ~414
# one-hots deja R2intra igual o mejor (0.5612->0.5655) y MAPE>30pl igual (46%), con 514->100
# features. Motivo: el nivel por arma ya lo capturan los baselines numéricos (official_median,
# re_med, hist_current_wfm...), y ADEMÁS el navegador (buildFeatureVector en riven_ml.js) nunca
# seteaba weapon_*: recibían siempre el default -> ya estaban MUERTOS en inferencia. Quitarlos
# alinea el modelo con lo que se usa, reduce el JSON servido y acelera el front. Para volver:
#   armas_dummies = pd.get_dummies(df_ml["weapon"], prefix="weapon").astype(int)
#   df_ml = pd.concat([df_ml, armas_dummies], axis=1)

# Indicadores de stats positivos / negativos
pos_stats = [s for s in pd.concat([df_ml["stat_pos1"], df_ml["stat_pos2"], df_ml["stat_pos3"]]).dropna().unique() if s != "None"]
for stat in pos_stats:
    df_ml[f"has_pos_stat_{stat}"] = ((df_ml["stat_pos1"] == stat) | (df_ml["stat_pos2"] == stat) | (df_ml["stat_pos3"] == stat)).astype(int)
for stat in [s for s in df_ml["stat_neg"].dropna().unique() if s != "None"]:
    df_ml[f"has_neg_stat_{stat}"] = (df_ml["stat_neg"] == stat).astype(int)

# ESTRUCTURA DEL ROLL: nº de positivos (2 vs 3) y si tiene negativa. Afecta MUCHO al valor —
# un 2-pos+negativa tiene stats más fuertes (RIVEN_WEIGHTS) que un 3-pos sin negativa (diluido).
# XGBoost aprende las COMBINACIONES de stats nativamente vía los has_pos_stat_* (splits en árbol);
# estas dos features le dan además el conteo/estructura explícito.
df_ml["num_pos"] = sum(((df_ml[f"stat_pos{i}"].notna()) & (df_ml[f"stat_pos{i}"] != "None")).astype(int) for i in (1, 2, 3))
df_ml["has_neg"] = ((df_ml["stat_neg"].notna()) & (df_ml["stat_neg"] != "None")).astype(int)

# NO añadir aquí interacciones de num_pos/has_neg (seg, seg_x_synergy, npos_x_synergy,
# neg_x_synergy, seg_x_nivel, neg_x_dispo): probadas y descartadas en 2026-08-04. Entraban
# altísimas en importancia (seg_x_synergy 2ª global, 0.067) y desplazaban a num_pos/has_neg del
# top 15, pero el A/B con dataset IDÉNTICO (167362 filas, mismo split) no movió nada:
# R2intra 0.5543->0.5542, MAPEtrade 47.2->47.1, AUC 0.801->0.802. Importancia alta con métrica
# plana = reparto distinto de la misma señal, no señal nueva; las dummies has_pos_stat_* y
# synergy_score ya la contenían. El margen real está en el target (asks, no ventas), no en
# recombinar features existentes.
# FEATURES CURADAS (jun 2026): fuera volatility_index/trend_7d_pct/web_min/web_max (ruido o
# redundancia colineal con wfm_avg) y los hist_* de volatilidad/trend/meta_shift (corr ~0).
# Dentro: re_pop/re_std/re_med/re_max (godrolls oficiales), wfm_vs_off (prima meta), ceil_mult.
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
# Solo dummies de STAT (has_pos_stat_/has_neg_stat_): SÍ importan (quitarlas hunde R2intra a 0.48).
# El one-hot de arma (weapon_*) se retiró arriba; ya no existe en df_ml.
cols_dummies = [c for c in df_ml.columns if c.startswith("has_pos_stat_") or c.startswith("has_neg_stat_")]
# Magnitudes SÍ entran (la magnitud es lo que separa el precio entre rolls de mismos stats:
# +/- multishot p.ej.). Van como NaN cuando faltan y XGBoost rutea el missing nativamente.
columnas_micro = [c for c in cols_numericas if c in df_ml.columns] + cols_dummies

# Winsorize por arma al p98, pero RELATIVO AL NIVEL DE MERCADO DEL DÍA (hist_day_wfm de la
# serie diaria). Distingue outlier de cambio de meta: un 20k pl un día en que el arma cotiza
# a 200 es troll (ratio 100 -> se recorta); tras un salto de meta (Incarnon, buff) el nivel
# del día sube CON los precios, el ratio queda normal y los precios nuevos NO se recortan
# hacia el régimen viejo (el p98 plano sobre todo el mes sí lo hacía). Fallback al winsor
# clásico por arma para filas sin nivel del día.
_nivel_dia = pd.to_numeric(df_ml.get("hist_day_wfm", pd.Series(0.0, index=df_ml.index)), errors="coerce").fillna(0.0)
_tiene_nivel = _nivel_dia > 0
_cap_clasico = df_ml.groupby("weapon")["price"].transform(lambda s: s.quantile(0.98))
_ratio = pd.Series(np.nan, index=df_ml.index, dtype=float)
_ratio[_tiene_nivel] = df_ml.loc[_tiene_nivel, "price"] / _nivel_dia[_tiene_nivel]
_cap_ratio = _ratio.groupby(df_ml["weapon"]).transform(lambda s: s.quantile(0.98))
_cap_regimen = (_cap_ratio * _nivel_dia).where(_tiene_nivel & _cap_ratio.notna())
# Tope efectivo: el de régimen donde existe, el clásico en el resto. Suelo en la mediana
# del arma: un nivel-del-día espuriamente bajo nunca recorta por debajo de la mediana.
_med_arma = df_ml.groupby("weapon")["price"].transform("median")
_cap_final = np.where(_cap_regimen.notna(), np.maximum(_cap_regimen.fillna(0), _med_arma), _cap_clasico)
_recortadas = int((df_ml["price"] > _cap_final).sum())
df_ml["price"] = np.minimum(df_ml["price"], _cap_final)
print(f"  Winsor consciente de régimen: {int(_tiene_nivel.sum())} filas con nivel del día "
      f"({_tiene_nivel.mean()*100:.0f}%), {_recortadas} precios recortados.")

# ====================================================================
# CALIBRADO A PRECIO DE VENTA (por arma)
# ====================================================================
# `price` viene de buyout_price de las subastas de WFM: es lo que PIDE el vendedor, no lo que se
# paga. Medido (ago 2026, 443k filas / 379 armas con ventas reales): la mediana de asks está a
# 2.7× la mediana de ventas reales de DE, pero el sesgo NO es uniforme — 7.1× en el cuartil
# superior de liquidez frente a 1.1× en el inferior. En las armas populares la venta real cae en
# el p0 de los asks: NINGÚN ask baja al precio real. Por eso el modelo (entrenado sobre asks)
# sobreestimaba justo en las armas populares, y por eso el front lo tenía DESCONECTADO y fijaba
# el precio con una curva heurística.
#
# Un factor global NO sirve: en armas nicho el ask ya está casi en precio de venta (1.1×) y lo
# hundiría. La calibración es POR ARMA.
#
# OJO — POR QUÉ NO ES UN ESCALAR. La primera versión hacía factor = de_med / ask_med y lo
# multiplicaba a TODOS los listings del arma. Eso mete un error de categoría: la mediana de DE es el
# centro de MEZCLAR trash y godrolls (Dual Toxocyst: DE registra ventas de 21p a 9000p, mediana
# 243p), así que aplastar el arma entera con 0.08 dejaba el godroll de 9000p en 720p cuando DE tiene
# ventas reales de godroll a 9000p. Medido: el combo CC+Multishot+CD de esa arma está en el
# percentil 69 de sus asks, NO en la mediana.
#
# Lo correcto es mapear RANGO a RANGO conservando la posición del roll dentro de su arma:
#   pos = percentil del ask dentro de su arma  ->  precio de venta al MISMO percentil.
# DE da tres anclas (min_price, median, max_price) y se interpola en log entre ellas, así que un
# trash cae cerca del mínimo vendido, un roll medio en la mediana y un godroll cerca del máximo
# realmente vendido. El nivel global baja (deja de predecir asks) sin comprimir la dispersión, que
# es justo lo que el tasador necesita para distinguir un godroll de un trash.
_CAL_MIN_POP = float(os.environ.get("CAL_VENTA_MIN_POP", "3"))

# DESACTIVADO POR DEFECTO (CAL_VENTA=1 para activarlo). El mapeo de arriba es correcto en su idea,
# pero descansa en dos cosas que HOY no se pueden verificar:
#   1. DE solo publica 3 números por arma (min/median/max de de_rerolled). Todo el reescalado de un
#      arma cuelga de esos 3 puntos, mientras las etiquetas son 100% asks.
#   2. Asume que el ORDEN de los asks es el orden de las ventas. Y sabemos que no lo es: los rivens
#      SIN maldición se piden más baratos que la mediana de su arma en el 85% del catálogo (mediana
#      120p sin negativa contra 400p con negativa), porque valen menos para rolar, no porque se
#      vendan por menos. El percentil de ask no es la calidad del roll.
# Con el mapeo activo un CC/Multishot/CD sin negativa de Dual Toxocyst sale ~89p cuando el mercado
# pide ~2750p por ese mismo roll, y no hay forma de comprobar cuál se acerca al precio pagado: DE no
# desglosa sus ventas por combo de stats.
#
# Se deja implementado y medido para poder activarlo en cuanto haya señal de VENTAS por roll (ver
# NOTAS-PARCHE: guardar el id de subasta permite detectar listings que desaparecen, y una venta
# confirmada sí ordena por calidad). Mientras tanto el target sigue en asks, que al menos es
# internamente consistente y comparable con lo que el usuario ve en warframe.market.
_CAL_ON = os.environ.get("CAL_VENTA", "0") != "0"
VENTA_INFO = {}
df_ml["price_ask"] = df_ml["price"]          # se conserva para diagnóstico/comparativas
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

    # Anclas de VENTA reales de DE. Sin min/max usables se cae a múltiplos de la mediana: la
    # dispersión típica medida en el catálogo es ~0.45× la mediana abajo y ~5× arriba.
    _lo = _rmin if 0 < _rmin < _rmed else max(1.0, _rmed * 0.45)
    _hi = _rmax if _rmax > _rmed else _rmed * 5.0
    # El max de DE es UNA venta (el récord), así que se acota para que un outlier no estire el techo.
    _hi = min(_hi, _rmed * 8.0)

    # Percentil de cada ask DENTRO de su arma -> mismo percentil en la escala de ventas.
    # Interpolación en log (los precios son multiplicativos) con la mediana como punto central,
    # así el p50 de asks cae exactamente en la mediana de ventas de DE.
    _p = _asks.rank(pct=True).to_numpy()
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

# ENTRENAMIENTO BALANCEADO: peso por muestra para que cada ARMA y cada TIER (trash/mid/godroll)
# contribuyan ~igual. Sin esto, las armas con muchos listados y su rango de precio dominante mandan
# y el modelo ignora godrolls/trash raros. (1) tier = tercil de precio DENTRO del arma; peso inverso
# al tamaño del tercil. (2) peso inverso al nº de filas del arma -> cada arma pesa ~igual en total.
def _tier_weights(g):
    try:
        tier = pd.qcut(g, 3, labels=False, duplicates="drop")
    except Exception:
        tier = pd.Series(0, index=g.index)
    tc = tier.value_counts()
    wt = tier.map(lambda t: 1.0 / tc.get(t, 1))
    return wt / wt.mean()
# Filter to weapons with sufficient data (e.g., at least 50 rows)
min_samples = 50
weapon_counts = df_ml["weapon"].value_counts()
sufficient_weapons = weapon_counts[weapon_counts >= min_samples].index
df_ml = df_ml[df_ml["weapon"].isin(sufficient_weapons)].reset_index(drop=True)

# Compute tier-based weights
df_ml["sample_w"] = df_ml.groupby("weapon")["price"].transform(_tier_weights)
# Popularity weighting (sqrt of counts)
pop_counts = df_ml["weapon"].map(df_ml["weapon"].value_counts())
pop_wt = np.sqrt(pop_counts)
pop_wt = pop_wt / pop_wt.mean()
# Combine weights
df_ml["sample_w"] = df_ml["sample_w"] * pop_wt
# Additional boost for godrolls: raise weight for rolls above weapon p90 using log scaling
_gp90 = df_ml.groupby("weapon")["price"].transform(lambda s: s.quantile(0.90))
_godroll_mask = df_ml["price"] >= _gp90
# Weight factor = 1 + log1p(price - p90) (scaled)
df_ml.loc[_godroll_mask, "sample_w"] *= (1 + np.log1p(df_ml.loc[_godroll_mask, "price"] - _gp90[_godroll_mask]))
# Normalize by weapon count and global mean (as before)
_wcount = df_ml["weapon"].map(df_ml["weapon"].value_counts())
df_ml["sample_w"] = df_ml["sample_w"] / _wcount
df_ml["sample_w"] = df_ml["sample_w"] / df_ml["sample_w"].mean()

X = df_ml[columnas_micro]
# y = np.sqrt(df_ml["price"]) removed; using log1p target defined later
w = df_ml["sample_w"]

# Split ESTRATIFICADO POR ARMA: cada arma aporta ~82% a train y ~18% a test, así el test
# evalúa TODAS las armas (no solo las populares) y el one-hot del arma SÍ está entrenado para
# cada arma del test (un split weapon-wise dejaba el one-hot a cero en test -> rompía intra-arma).
y_all = np.log1p(df_ml["price"])
idx_all = np.arange(len(df_ml))
tr_idx, te_idx = train_test_split(idx_all, test_size=0.18, random_state=42,
                                  stratify=df_ml["weapon"])
# Early-stop interno dentro de train (estratificado por arma)
tr2_idx, es_idx = train_test_split(tr_idx, test_size=0.12, random_state=42,
                                   stratify=df_ml["weapon"].values[tr_idx])

X_train = df_ml.iloc[tr2_idx][columnas_micro]; y_train = y_all.values[tr2_idx]; w_train = df_ml["sample_w"].values[tr2_idx]
X_es = df_ml.iloc[es_idx][columnas_micro];     y_es = y_all.values[es_idx]
X_test = df_ml.iloc[te_idx][columnas_micro];   y_test = y_all.values[te_idx]
weapon_test = df_ml["weapon"].values[te_idx]

# FUGA DE COMBOS entre train y test. El dedup es por (arma, stats, precio), así que el MISMO riven
# listado a precios distintos deja varias filas y el split estratificado puede repartirlas a ambos
# lados: el modelo ve el combo en train y lo "reconoce" en test. Medido (ago 2026, 167k filas): el
# 36% del dataset son combos con >1 fila (CV de precio intra-combo 0.28) y el 32% del test tiene su
# combo ya visto en train, donde un oráculo que memoriza la mediana del combo comete 30% de error
# frente al 67% en combos inéditos. No se cambia el split (estratificar por arma es necesario para
# que el one-hot del arma esté entrenado en test), pero SÍ se reporta el desglose: sin él, el MAPE
# publicado parece mejor de lo que generaliza y se optimiza contra una métrica que se autoengaña.
_kcombo = [c for c in ["weapon", "stat_pos1", "stat_pos2", "stat_pos3", "stat_neg"] if c in df_ml.columns]
_combo_all = df_ml[_kcombo].fillna("None").astype(str).agg("|".join, axis=1).values
_combos_tr = set(_combo_all[tr2_idx]) | set(_combo_all[es_idx])
_visto_te = np.array([c in _combos_tr for c in _combo_all[te_idx]])
print(f"  Fuga de combos en test: {_visto_te.sum()}/{len(_visto_te)} ({_visto_te.mean()*100:.0f}%) "
      f"con su combo ya visto en train.")
print(f"Matrices: train={X_train.shape[0]} | early-stop={X_es.shape[0]} | test={X_test.shape[0]} | features={len(columnas_micro)}")
print(f"¿one-hot de arma presente? {'sí' if any(c.startswith('weapon_') for c in columnas_micro) else 'NO'}")


# ====================================================================
# FASE 4: ENTRENAMIENTO XGBOOST (ENSEMBLE) + EVALUACION HONESTA (sobre test)
# ====================================================================
# Objetivo: log1p(price). Ensemble de 3 XGB con seeds/profundidades distintas: promediar
# árboles decorrelacionados sube R2 de forma gratuita y estabiliza la tasación entre runs.
import joblib
import xgboost as xgb

ENSEMBLE_SPECS = [
    dict(random_state=42,   max_depth=10, colsample_bytree=0.60),
    dict(random_state=7,    max_depth=12, colsample_bytree=0.50),
    dict(random_state=2024, max_depth=8,  colsample_bytree=0.70),
]
COMMON = dict(n_estimators=int(os.environ.get("XGB_N", "2000")), learning_rate=0.025, subsample=0.85,
              min_child_weight=4, reg_lambda=2.5, reg_alpha=0.1,
              tree_method="hist", n_jobs=-1, eval_metric="rmse",
              early_stopping_rounds=60,
              # GPU: en máquina NVIDIA usar XGB_DEVICE=cuda (xgboost 2.0+). OJO: este equipo tiene
              # AMD RX 6700 XT -> XGBoost CUDA NO aplica; para GPU AMD usar LightGBM OpenCL.
              device=os.environ.get("XGB_DEVICE", "cpu"))

# ENTRENAMIENTO POR CUANTILES (p25/p50/p80): el modelo aprende la BANDA de precio de cada roll.
#   p25 = venta rápida/conservador | p50 = precio justo | p80 = techo/optimista.
# Es intrínsecamente roll-aware (la banda se ensancha según features del roll) y anclado al mercado
# real (entrenado sobre precios reales). Métrica clave: COBERTURA (% reales <= cuantil ≈ alpha).
QUANTILES = [0.25, 0.50, 0.80, 0.90, 0.95]   # p90/p95 = techo godroll (precio real, no ask troll)
_QPARAMS = dict(n_estimators=int(os.environ.get("XGB_N", "2000")), learning_rate=0.03,
                max_depth=10, subsample=0.85, colsample_bytree=0.6, min_child_weight=4,
                reg_lambda=2.5, reg_alpha=0.1, tree_method="hist", n_jobs=-1,
                device=os.environ.get("XGB_DEVICE", "cpu"), early_stopping_rounds=80)

class QuantileModel:
    """3 XGBRegressor (reg:quantileerror) para p25/p50/p80 en espacio log. .predict devuelve p50
    (compat con FASE 5/6). .predict_quantiles devuelve la banda ordenada (sin cruces)."""
    def __init__(self, models, quantiles, feat):
        self.models = models; self.quantiles = quantiles; self.feature_names = feat
    def _mat(self, X):
        Xc = X[self.feature_names] if hasattr(X, "columns") else X
        cols = [self.models[a].predict(Xc) for a in self.quantiles]
        return np.sort(np.vstack(cols).T, axis=1)   # ordena por fila -> p25<=p50<=p80
    def predict(self, X):
        return self._mat(X)[:, self.quantiles.index(0.50)]
    def predict_quantiles(self, X):
        m = self._mat(X)
        return {a: m[:, i] for i, a in enumerate(self.quantiles)}
    @property
    def feature_importances_(self):
        return self.models[0.50].feature_importances_

# El winsor + dificultad de la cola hacen que la cobertura empírica quede ~3-5pts corta en los
# cuantiles altos. Se entrena con un alpha algo MÁS alto (overshoot) para que la cobertura REAL
# clave en el objetivo etiquetado. Los modelos se guardan con su etiqueta (0.8, 0.9, 0.95).
_ALPHA_TRAIN = {0.25: 0.25, 0.50: 0.50, 0.80: 0.845, 0.90: 0.935, 0.95: 0.975}
qmodels = {}
for a in QUANTILES:
    a_tr = _ALPHA_TRAIN.get(a, a)
    m = xgb.XGBRegressor(objective="reg:quantileerror", quantile_alpha=a_tr, random_state=42, **_QPARAMS)
    m.fit(X_train, y_train, eval_set=[(X_es, y_es)], verbose=False)
    qmodels[a] = m
    print(f"  XGB cuantil etiqueta={a} (α_train={a_tr}) best_iter={getattr(m, 'best_iteration', '?')}")
optimized_xgb = QuantileModel(qmodels, QUANTILES, columnas_micro)

# --- Cobertura + pinball por cuantil (calidad de la banda) ---
_qpred_test = optimized_xgb.predict_quantiles(X_test)
print("\n  COBERTURA por cuantil (objetivo = alpha; mide si la banda es correcta):")
for a in QUANTILES:
    cov = float((y_test <= _qpred_test[a]).mean())
    pin = float(np.mean(np.maximum(a * (y_test - _qpred_test[a]), (a - 1) * (y_test - _qpred_test[a]))))
    print(f"    p{int(a*100):>2}: cobertura={cov*100:4.1f}%  (target {int(a*100)}%)  pinball(log)={pin:.4f}")
# banda [p25,p80]: % de reales dentro
_in_band = float(((y_test >= _qpred_test[0.25]) & (y_test <= _qpred_test[0.80])).mean())
print(f"    reales dentro de [p25,p80]: {_in_band*100:.1f}%  (esperado ~55%)")

# Predicciones de test (p50) para las métricas de punto de siempre
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
# MAPE sobre rolls TRADEABLES (>=200pl): el número que importa para comprar/vender.
# El MAPE global lo infla el trash barato (un 10pl vs 30pl = 200% de error y da igual).
mask_trade = real_test >= 200
mape_trade = float(ape_all[mask_trade].mean() * 100) if mask_trade.any() else float("nan")

# MAPE partido por si el combo del test ya se vio en train. El de combos INÉDITOS es el que dice
# cómo se comporta con un roll que nunca ha visto, que es el caso real del tasador.
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

# TECHO IRREDUCIBLE: dos rivens IDÉNTICOS (misma arma, mismos pos, misma neg) se listan a precios
# distintos porque cada vendedor pone lo que quiere. Ese desacuerdo es varianza DENTRO del target:
# ningún modelo puede predecirlo con estas features. Se mide como el MAPE que cometería un oráculo
# que acertase la mediana de cada combo. Medido en ago 2026: ~25% (y la magnitud no lo explica —
# combos con magnitud dan 25.0% vs 24.3% sin ella, y la correlación magnitud-precio intra-combo es
# ~-0.28). Sirve para saber cuánto margen queda de verdad: perseguir un MAPE por debajo de este
# suelo es perseguir ruido, y sobreajustaría.
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
# AUC de detección de godroll (precio real >= p90 del arma en train)
_gp90_tr = pd.Series(np.expm1(y_train)).groupby(df_ml["weapon"].values[tr2_idx]).quantile(0.90)
_thr = pd.Series(weapon_test).map(_gp90_tr).fillna(np.quantile(np.expm1(y_train), 0.90)).values
_god_true = (real_test >= _thr).astype(int)
def _auc(yt, ys):
    from sklearn.metrics import roc_auc_score
    return roc_auc_score(yt, ys)
auc_god = _auc(_god_true, y_pred_log) if len(set(_god_true)) > 1 else float("nan")

# SPEARMAN INTRA-ARMA: ¿ordena bien los rolls DENTRO de cada arma según sus stats?
# Es la métrica limpia de "criterio": no la contamina ni el trash barato (como al MAPE)
# ni el nivel de precio del arma (como al R2 global). Validada en exp_percentile.py:
# el target de percentil da la MISMA ordenación, así que esta métrica captura el techo real.
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

# ====================================================================
# PRECISION POR ARMA: cómo de bien tasa el modelo global en CADA arma (su test held-out).
# Identifica armas fiables (MAPE bajo = datos limpios) vs ruidosas (MAPE alto = caer a listings vivos).
# ====================================================================
df_test["real"] = np.expm1(df_test["y"])
df_test["pred_real"] = np.expm1(df_test["pred"])
df_test["ape"] = (df_test["pred_real"] - df_test["real"]).abs() / df_test["real"].clip(lower=5)
per = (df_test.groupby("weapon")
       .agg(n=("y", "size"), mape=("ape", lambda s: float(s.mean() * 100)),
            med_real=("real", "median"), med_pred=("pred_real", "median"))
       .reset_index())
per = per[per["n"] >= 8].sort_values("mape")
# PRECISION POR ARMA horneada para el frontend (badge de fiabilidad): MAPE del p50 + n de test.
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

# --- HISTÓRICO DE MÉTRICAS: una entrada por run para ver el PROGRESO según crece el dataset.
#     (metrics_history.json; comparar r2_intra/mape_trade/coberturas entre fechas.)
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
    # suelo del mercado + cuánto del margen real (mape_trade - piso) se ha cerrado
    "mape_piso": (round(float(mape_piso), 1) if np.isfinite(mape_piso) else None),
    # honestidad de la métrica: cuánto del MAPE sale de combos ya vistos en train
    "mape_trade_inedito": (round(float(mape_inedito), 1) if np.isfinite(mape_inedito) else None),
    "fuga_combos_pct": round(float(_visto_te.mean()) * 100, 1),
    "venta_calibrada": _n_fiable, "venta_armas": len(VENTA_INFO),
    "cobertura": {f"p{int(a*100)}": round(float((y_test <= _qpred_test[a]).mean()) * 100, 1) for a in QUANTILES},
    "winsor_recortadas": _recortadas,
})
json.dump(_hist_runs, open(_METRICS_LOG, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
if len(_hist_runs) >= 2:
    _prev_run, _cur_run = _hist_runs[-2], _hist_runs[-1]
    print(f"PROGRESO vs run anterior ({_prev_run['ts']}, {_prev_run['filas']} filas): "
          f"R2intra {_prev_run['r2_intra']:.3f}->{_cur_run['r2_intra']:.3f} | "
          f"MAPEtrade {_prev_run['mape_trade']:.0f}%->{_cur_run['mape_trade']:.0f}% | "
          f"filas +{_cur_run['filas'] - _prev_run['filas']}")
    # Margen REAL que queda: la distancia al suelo del mercado, no a 0%.
    if _cur_run.get("mape_piso"):
        _gap = _cur_run["mape_trade"] - _cur_run["mape_piso"]
        print(f"  MARGEN vs techo irreducible: {_cur_run['mape_trade']:.0f}% actual - "
              f"{_cur_run['mape_piso']:.0f}% suelo = {_gap:.0f} puntos de mejora POSIBLE. "
              f"Por debajo del suelo solo hay ruido de vendedor.")
print(f"  histórico de métricas: {_METRICS_LOG} ({len(_hist_runs)} runs)")


# ====================================================================
# FASE 5: INFERENCIA
# ====================================================================
# xgboost not used; using sklearn GradientBoostingRegressor

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

# Calibración POR ARMA roll-aware POR SCORE (se llena en FASE 6 con mercado p55 + drift history).
# El modelo predice la BANDA de cuantiles por roll (p25/p50/p80); aquí solo se aplica el DRIFT
# por arma (history reciente vs todo) para mover la banda al mercado de hoy.
CAL_DRIFT = {}
CAL_SYNLO = {}    # score de sinergia p30 por arma -> umbral "trash" para el aviso de confianza
CAL_NSAMP = {}    # nº de filas de entrenamiento por arma -> confianza por volumen de datos
# (legacy, conservados para diagnóstico/export; el tasador ya usa la banda de cuantiles + drift)
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
    # Magnitudes del input (ya 0..1) hacia los mismos features que vio el modelo.
    _mags = [float(np.clip(m, 0.0, 1.0)) for m in (mag1, mag2, mag3)]
    for i, mv in enumerate(_mags, 1):
        if f"mag_pos{i}_norm" in fila_input:
            fila_input[f"mag_pos{i}_norm"] = mv
    if "mag_pos_avg" in fila_input:
        fila_input["mag_pos_avg"] = float(np.mean(_mags))
    if "has_mag" in fila_input:
        fila_input["has_mag"] = 1
    # history del día: en inferencia (sin fecha) se asume día normal -> drift/ratios neutros = 1.0
    for _hc in ("hist_day_drift", "hist_day_offdrift", "hist_day_rerprem"):
        if _hc in fila_input:
            fila_input[_hc] = 1.0
    if "popularity_pct_x_synergy" in fila_input:
        fila_input["popularity_pct_x_synergy"] = fila_input.get("popularity_pct", 0) * round(score_input, 4)
    # BUG FIX: disposition arrancaba en 0 (init de fila_input) y nunca se rellenaba ->
    # dispo_x_synergy salía 0 SIEMPRE en la inferencia Python (el front sí la seteaba).
    _dispo_inf = float(dt["disposition"]) if (dt is not None and "disposition" in dt) \
        else _dispo_map.get(limpiar_chars(nombre_riven), 1.0)
    if "disposition" in fila_input:
        fila_input["disposition"] = _dispo_inf
    if "archetype" in fila_input:
        fila_input["archetype"] = float(dt["archetype"]) if (dt is not None and "archetype" in dt) \
            else _arch_map.get(limpiar_chars(nombre_riven), 0)
    if "dispo_x_synergy" in fila_input:
        fila_input["dispo_x_synergy"] = _dispo_inf * round(score_input, 4)
    # Señal meta (misma fórmula que en entrenamiento): dispo baja + mediana alta y consistente.
    _cons_inf = _hcons.get(nombre_query, _hcons.get(str(rep_target).strip().lower(), 0.5))
    if "median_consistency" in fila_input:
        fila_input["median_consistency"] = _cons_inf
    if "meta_signal" in fila_input:
        fila_input["meta_signal"] = (2.0 - _dispo_inf) * float(np.log1p(of_median)) * _cons_inf
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

    # BANDA POR CUANTILES: el modelo predice p25/p50/p80 del precio de ESTE roll (roll-aware nativo,
    # entrenado sobre precios reales). p50 = precio justo, p25 = venta rápida, p80 = techo.
    _Xrow = pd.DataFrame([fila_input])[columnas_micro]
    _ql = model_micro.predict_quantiles(_Xrow)
    banda = {a: float(np.expm1(_ql[a][0])) for a in QUANTILES}
    precio_crudo = banda[0.50]

    # DRIFT por arma (history reciente vs todo): mueve la banda al mercado de HOY.
    _dr = _cal_lookup(nombre_riven, CAL_DRIFT) or 1.0
    banda = {a: v * _dr for a, v in banda.items()}

    # Ajustes multiplicativos (se aplican a TODA la banda para preservar su forma):
    _mult = 1.0
    rango = precios_suelo_reales.get(nombre_riven) if "precios_suelo_reales" in globals() else None
    _SOFT = os.environ.get("HARD_HEUR") != "1"
    BRICK = {"Critical Chance", "Critical Damage", "Base Damage / Melee Damage", "Multishot", "Fire Rate / Attack Speed"}
    _es_brick = neg != "None" and (neg in BRICK or pesos.get(neg, 0) >= 0.6)
    if _es_brick:
        _mult *= 0.55 if _SOFT else 0.30          # negativa que rompe el arma: descuenta (SOFT) la banda
    if int(rerolls) == 0:
        _mult *= 1.25                             # gamble en blanco (rerolls NO está en el modelo)
    elif int(rerolls) > 20 and score_input < SYN_P60:
        _mult *= max(0.6, 1.0 - int(rerolls) / 400.0)   # burner rolleado a muerte
    banda = {a: v * _mult for a, v in banda.items()}

    # Suelo del arma + cap absoluto, por cuantil
    _floor = float(rango["min"]) if rango else 0.0
    banda = {a: float(round(min(max(v, _floor), 15000), 1)) for a, v in banda.items()}

    # El valor titular lo da el ML (p50); NO se fuerza por heurística. Pero se marca la CONFIANZA:
    # baja para rolls de gama baja (score en el fondo del arma), armas con pocos datos, o banda muy
    # ancha -> ahí el precio puede estar mal. Aviso explícito de las limitaciones del modelo.
    _final = banda[0.50]
    _synlo = _cal_lookup(nombre_riven, CAL_SYNLO)
    _nsamp = _cal_lookup(nombre_riven, CAL_NSAMP) or 0
    _es_trash = (_synlo is not None) and (score_input <= _synlo)   # score en el fondo del arma
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


# ====================================================================
# CALIBRACION POR ARMA (mercado + history). Ancla el nivel del modelo al mercado REAL de cada arma.
#   ref_mercado[arma]  = central robusto del history reciente (mediana de wfm_avg_price últimos N días).
#   ref_modelo[arma]   = mediana de la predicción del modelo sobre las filas de esa arma.
#   factor[arma]       = clip(ref_mercado / ref_modelo, 0.5, 4.0), amortiguado ^GAMMA para no
#                        perseguir asks troll. Se preserva la diferencia roll-a-roll (escalar por arma).
# ====================================================================
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
            # SHIFT SOSTENIDO vs ruido: si la ventana reciente Y la previa tienen datos
            # suficientes y la reciente está claramente por encima/debajo de la previa,
            # es un cambio de régimen (Incarnon, buff/nerf), no un outlier de unos días:
            # se abre el clip a [0.5, 3.5] para SEGUIR el salto. Con evidencia fina o
            # ruido de días sueltos se mantiene el clip conservador [0.7, 2.0].
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
# DRIFT por arma: lo que usa el tasador para mover la banda de cuantiles al mercado de hoy.
CAL_DRIFT.update({k: round(v, 3) for k, v in _drift.items()})
# Umbral trash (score p30 por arma) y volumen de datos por arma -> aviso de confianza.
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
# FASE 8: EXPORT UNIFICADO PARA EL NAVEGADOR (bundle deploy en el MISMO run)
# Reemplaza a ML_local_slim.py (que divergía). Entrena versiones COMPACTAS (depth 5, ~400 árboles)
# de los MISMOS 5 cuantiles y saca: árboles + feature order/defaults + calibración por arma.
# Publicar directo a deploy con DEPLOY_ML_DIR=/ruta/deploy/assets/ml (por defecto -> ./generado).
# ====================================================================
if os.environ.get("SLIM_EXPORT", "1") == "1":
    print("\nFASE 8: EXPORT NAVEGADOR (cuantiles slim)")
    import gzip as _gz
    _OUT = os.environ.get("DEPLOY_ML_DIR", "generado")
    os.makedirs(_OUT, exist_ok=True)
    _SN = int(os.environ.get("SLIM_N", "400")); _SD = int(os.environ.get("SLIM_DEPTH", "5"))
    _sp = dict(n_estimators=_SN, learning_rate=0.05, max_depth=_SD, subsample=0.85,
               colsample_bytree=0.6, min_child_weight=4, reg_lambda=2.5, reg_alpha=0.1,
               tree_method="hist", n_jobs=-1, device=os.environ.get("XGB_DEVICE", "cpu"))
    _bundle = {"quantiles": QUANTILES, "alpha_train": _ALPHA_TRAIN, "models": {}}
    for a in QUANTILES:
        _sm = xgb.XGBRegressor(objective="reg:quantileerror", quantile_alpha=_ALPHA_TRAIN.get(a, a),
                               random_state=42, **_sp)
        _sm.fit(X_train, y_train)
        _tmp = os.path.join(_OUT, f"_q{int(a*100)}.json"); _sm.get_booster().save_model(_tmp)
        _bundle["models"][str(a)] = json.load(open(_tmp)); os.remove(_tmp)
    json.dump(_bundle, open(os.path.join(_OUT, "model_quantiles_slim.json"), "w"))
    json.dump(list(columnas_micro), open(os.path.join(_OUT, "feature_order_slim.json"), "w"))
    _def = {}
    for c in columnas_micro:
        _m = pd.to_numeric(df_ml[c], errors="coerce").median()
        _def[c] = float(_m) if pd.notna(_m) else 0.0
    json.dump(_def, open(os.path.join(_OUT, "feature_defaults_slim.json"), "w"))
    # `venta` = factor de calibrado ask->venta por arma y si su ancla es fiable. El front lo usa para
    # decidir si se fía del p50 del modelo (arma calibrada) o cae a la curva anclada a DE.
    json.dump({"drift": CAL_DRIFT, "synlo": CAL_SYNLO, "nsamp": CAL_NSAMP,
               "precision": (PRECISION_ARMA if "PRECISION_ARMA" in dir() else {}),
               "quantiles": QUANTILES, "venta": VENTA_INFO,
               "venta_min_pop": _CAL_MIN_POP},
              open(os.path.join(_OUT, "calibracion_por_arma.json"), "w"))
    # price_bands.json: deciles de df_ml["price"], que YA está calibrado a precio de venta arriba,
    # así que floor/typical/ceiling dejan de ser deciles de ASKS (antes lo eran, y el front los
    # usaba como si fueran ventas). stat_weights.json = tiers -> bundle deploy completo.
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
    print(f"  {_OUT}/ -> model_quantiles_slim.json ({len(QUANTILES)} cuantiles, depth{_SD} n{_SN}) "
          f"RAW={len(_raw)/1e6:.1f}MB GZIP={len(_gz.compress(_raw))/1e6:.2f}MB | feats={len(columnas_micro)}")
    print(f"  + feature_order_slim.json, feature_defaults_slim.json, calibracion_por_arma.json, "
          f"price_bands.json, stat_weights.json")


# ====================================================================
# PRUEBAS DE TASACION CONTROLADAS: mismo arma, rolls trash/mid/godroll/brick con magnitud alta/baja.
# Verifica que la BANDA (p25..p95) escala con la calidad del roll y su magnitud. PRUEBAS=1.
# ====================================================================
if os.environ.get("PRUEBAS", "1") == "1":
    print("\n" + "=" * 90)
    print("PRUEBAS DE TASACION (banda p25/p50/p80/p90/p95 por calidad de roll)")
    print("=" * 90)
    # (etiqueta, pos1, pos2, pos3, neg, mag1, mag2, mag3)
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


# ====================================================================
# FASE 7: COMPARATIVA TASACION vs LISTINGS REALES (WFM en vivo)
# Mide el tasador contra el mercado vivo: para cada subasta real toma sus stats, MAGNITUDES y
# rerolls reales, tasa, y compara contra el buyout del vendedor. Activar con COMPARAR_LISTINGS=1.
# ====================================================================
if os.environ.get("COMPARAR_LISTINGS") == "1":
    print("\n" + "=" * 72)
    print("FASE 7: COMPARATIVA TASACION vs LISTINGS REALES (WFM en vivo)")
    print("=" * 72)
    WFM_SEARCH = "https://api.warframe.market/v1/auctions/search?type=riven&weapon_url_name="
    _LEGACY = {"Channeling Damage": "Initial Combo", "Channeling Efficiency": "Heavy Attack Efficiency",
               "Charge Damage": "Heavy Attack Damage"}
    def _wfm_stat(url_name):
        s = " ".join([w.capitalize() for w in str(url_name).split("_")])
        return _LEGACY.get(s, s)
    def _wfm_slug(name):
        s = str(name).lower().strip().replace("&", "and").replace(" ", "_")
        return re.sub(r"[^a-z0-9_]", "", s)
    def _fetch_auctions(weapon):
        try:
            r = requests.get(WFM_SEARCH + _wfm_slug(weapon),
                             headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"}, timeout=20)
            pl = r.json().get("payload", {}).get("auctions", [])
        except Exception:
            return []
        return [a for a in pl if a.get("visible") and (a.get("owner") or {}).get("status") != "offline"
                and a.get("buyout_price") and 0 < a["buyout_price"] <= 25000]

    # Muestra: armas con más datos (señal fiable), repartidas; configurable por env.
    _n_weap = int(os.environ.get("COMPARAR_N_WEAPONS", "20"))
    _per_weap = int(os.environ.get("COMPARAR_PER_WEAPON", "6"))
    _sample_weapons = df_micro_clean["weapon"].value_counts().head(60).index.tolist()
    import random as _rnd; _rnd.seed(7); _rnd.shuffle(_sample_weapons)
    _sample_weapons = _sample_weapons[:_n_weap]

    filas, n_fetch = [], 0
    for _w in _sample_weapons:
        aucs = _fetch_auctions(_w)
        if not aucs:
            continue
        n_fetch += 1
        aucs.sort(key=lambda a: a["buyout_price"])
        # repartir la muestra a lo largo del rango de precios (trash..godroll)
        idxs = sorted(set(int(i) for i in np.linspace(0, len(aucs) - 1, min(_per_weap, len(aucs)))))
        for a in [aucs[i] for i in idxs]:
            it = a["item"]; pos, neg = [], "None"
            mraw = {}
            for at in it.get("attributes", []):
                st = _wfm_stat(at["url_name"]); val = at.get("value")
                if at.get("positive"):
                    pos.append(st); mraw[st] = val
                else:
                    neg = st; mraw[st] = val
            while len(pos) < 3:
                pos.append("None")
            rerolls = int(it.get("re_rolls") or 0)
            def _mn(st):
                if st == "None":
                    return 1.0
                v = _mag_norm(_w, st, mraw.get(st))
                return 0.6 if (v is None or (isinstance(v, float) and np.isnan(v))) else v
            dg = tasar_riven_individual(_w, pos[0], pos[1], pos[2], neg, rerolls,
                                        _mn(pos[0]), _mn(pos[1]), _mn(pos[2]), desglose=True)
            real = float(a["buyout_price"])
            filas.append({"weapon": _w, "pos": pos, "neg": neg, "rr": rerolls, "real": real,
                          "p25": dg["p25"], "p50": dg["p50"], "p80": dg["p80"], "p95": dg["p95"],
                          "conf": dg["confianza"], "regla": dg["regla"],
                          "ape": abs(dg["p50"] - real) / max(real, 5.0),
                          "in_band": 1 if (dg["p25"] <= real <= dg["p95"]) else 0})
        time.sleep(0.15)

    if not filas:
        print("  [WARN] no se pudieron traer listings (rate-limit/slug). Reintenta más tarde.")
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
        # GODROLL real: listings en el top (>= p80 de asks del arma) -> ¿los cubre [p80,p95]?
        _gmask = dfc.real >= dfc.groupby("weapon").real.transform(lambda s: s.quantile(0.80))
        if _gmask.sum() > 3:
            _g = dfc[_gmask]
            print(f"    GODROLLS (top asks, n={int(_gmask.sum())}): real dentro de [p80,p95]="
                  f"{((_g.real>=_g.p80)&(_g.real<=_g.p95)).mean()*100:.0f}%  p95/real={(_g.p95/_g.real).median():.2f}")
        print("=" * 72)
