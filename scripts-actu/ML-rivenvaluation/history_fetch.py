# -*- coding: utf-8 -*-
"""Descarga la serie diaria COMPLETA de /api/history para todas las armas del dataset
y la cachea en history_series.json: { weapon_lower: [ {date, wfm_avg_price, official_median,
liquidity_score, wfm_market_sample, rerolled_premium_ratio, volatility_index}, ... ] }.

Se une luego por (arma, fecha) a cada fila de entrenamiento como NIVEL DE MERCADO de ese día
(medición independiente del precio de la propia subasta -> sin fuga). Captura la deriva diaria.
"""
import json
import os, json, time, sys
import pandas as pd
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

API_HISTORY = "https://soft-mountain-28fe.edelamf0.workers.dev/api/history"
LOCAL_CSV = os.environ.get("VOIDSTONKS_CSV",
    "/var/home/ppsoy/Documentos/GitHub/Voidstonks-cron/historial_precios/dataset_raw_ml.csv")
OUT = "history_series.json"
KEEP = ["date", "wfm_avg_price", "official_median", "liquidity_score",
        "wfm_market_sample", "rerolled_premium_ratio", "volatility_index"]

# El CSV solo aporta la LISTA de armas (el histórico viene del worker, sin autenticación), así que
# si no está se saca del catálogo de este mismo repo. Con eso el job de curiosidades ya no necesita
# clonar el repo privado del oráculo ni su PAT: era la única razón del checkout, y fallaba con "Bad
# credentials" cuando el secreto no estaba configurado.
if os.path.exists(LOCAL_CSV):
    weapons = sorted(pd.read_csv(LOCAL_CSV, usecols=["weapon"]).weapon.dropna().unique())
else:
    _cat = os.environ.get("VOIDSTONKS_WEAPONS",
        os.path.join(os.path.dirname(__file__), "..", "..", "deploy", "assets", "json",
                     "cleaned_weapons.json"))
    with open(_cat, encoding="utf-8") as _f:
        weapons = sorted({str(w.get("name", "")).strip() for w in json.load(_f) if w.get("name")})
    print(f"(sin CSV) lista de armas desde el catálogo: {_cat}")
print(f"armas a consultar: {len(weapons)}")

sess = requests.Session()
sess.headers.update({"User-Agent": "Mozilla/5.0"})

def fetch(w):
    try:
        r = sess.get(API_HISTORY, params={"weapon": str(w).strip().lower()}, timeout=20)
        data = r.json().get("data") if r.ok else None
        if not data:
            return w, None
        slim = [{k: d.get(k) for k in KEEP} for d in data]
        return w, slim
    except Exception:
        return w, None

out, ok, fail = {}, 0, 0
with ThreadPoolExecutor(max_workers=8) as ex:
    futs = {ex.submit(fetch, w): w for w in weapons}
    for i, f in enumerate(as_completed(futs), 1):
        w, series = f.result()
        if series:
            out[str(w).strip().lower()] = series; ok += 1
        else:
            fail += 1
        if i % 50 == 0:
            print(f"  {i}/{len(weapons)} (ok={ok} fail={fail})")

json.dump(out, open(OUT, "w"))
dias = [len(v) for v in out.values()]
print(f"guardado {OUT}: armas={ok} fail={fail} | dias/arma min={min(dias) if dias else 0} "
      f"max={max(dias) if dias else 0} med={int(pd.Series(dias).median()) if dias else 0}")
