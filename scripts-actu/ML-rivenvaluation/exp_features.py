# -*- coding: utf-8 -*-
"""Feature builder for VoidStonks riven valuation experiments.

Builds the design matrix ONCE and caches it to exp_matrix.pkl so the model
search (exp_run.py) can iterate fast without re-doing feature engineering.

Target: log1p(price). Honest eval is done downstream with a stratified-by-weapon
split (every weapon present in train AND test) -> intra-weapon R2 / MAPE measure
roll-quality discrimination, which is what the tasador actually needs.
"""
import os, re, json, numpy as np, pandas as pd

LOCAL_CSV = os.environ.get("VOIDSTONKS_CSV",
    "/var/home/ppsoy/Documentos/GitHub/Voidstonks-cron/historial_precios/dataset_raw_ml.csv")
FILE_CACHE = "cache_datos_api.json"
CW_FEAT = os.environ.get("VOIDSTONKS_WEAPONS",
    "/var/home/ppsoy/Escritorio/voidstonks/deploy/assets/json/cleaned_weapons.json")

# ---------------- ingest + dedup + families ----------------
df = pd.read_csv(LOCAL_CSV)
for n in ["re_rolls", "rolls", "Rerolls"]:
    if n in df.columns:
        df.rename(columns={n: "rerolls"}, inplace=True)
clave = [c for c in ["weapon","stat_pos1","stat_pos2","stat_pos3","stat_neg","rerolls","price"] if c in df.columns]
df.drop_duplicates(subset=clave, keep="last", inplace=True)

PREFIJOS = r"\b(kuva|tenet|prisma|mara|dex|synoid|telos|vaykor|secura|rakta|sancti|coda|carmine|mk1|mk-1)\b"
SUFIJOS = r"\b(prime|vandal|wraith|incarnon)\b"
EXC = {"dex furis":"afuris","dex afuris":"afuris","mutalist cernos":"mutalist cernos",
       "proboscis cernos":"proboscis cernos","mutalist quanta":"mutalist quanta",
       "pangolin prime":"pangolin sword","prisma dual decurions":"dual decurion","dual decurions":"dual decurion"}
def clean(n): return re.sub(r"[^a-z0-9]","",str(n).lower())
def raiz(a):
    n=" ".join(re.sub(r"[^a-z0-9\s]","",str(a).lower()).split()).strip()
    if n in EXC: return clean(EXC[n])
    return clean(re.sub(SUFIJOS,"",re.sub(PREFIJOS,"",n)))
agr={}
for a in df.weapon.unique(): agr.setdefault(raiz(a),[]).append(a)
mapeo={}; reps=set()
for r,vs in agr.items():
    vl={clean(v):v for v in vs}; rep=vl.get(r) or min(vs,key=len)
    for v in vs: mapeo[v]=rep
    reps.add(rep)
df["family_rep"]=df.weapon.map(mapeo)

cols=["weapon","fecha","price","stat_pos1","stat_pos2","stat_pos3","stat_neg","rerolls","family_rep",
      "mag_pos1","mag_pos2","mag_pos3","mag_neg"]
df=df[[c for c in df.columns if c in cols]]

# ---------------- macro + hist from cache ----------------
cache=json.load(open(FILE_CACHE,encoding="utf-8"))
api_map=cache["api_map"]; temporales=cache["temporales"]
def lookup(a):
    rec=api_map.get(str(a).strip().lower())
    if rec is None:
        rep=mapeo.get(a); rec=api_map.get(str(rep).strip().lower()) if rep else None
    return rec or {}
MACRO=["official_median","wfm_avg","popularity_pct","wfm_market_sample","liquidity_score",
       "volatility_index","rerolled_premium_ratio","web_min","web_max","trend_7d_pct"]
HIST=["hist_current_official","hist_current_wfm","hist_liquidity_avg","hist_volatility_max",
      "hist_rerolled_premium","hist_momentum","hist_trend_7d","hist_meta_shift"]
rows=[]
for a in df.weapon.unique():
    rec=lookup(a)
    if not rec: continue
    de_un=rec.get("de_unrolled") or {}; de_re=rec.get("de_rerolled") or {}
    om=rec.get("official_median") or 0; wa=rec.get("wfm_avg",rec.get("wfm_avg_price")) or 0
    re_med=de_re.get("median") or 0; re_max=de_re.get("max_price") or 0
    rows.append({"weapon":a,"official_median":om,"wfm_avg":wa,
        "popularity_pct":(de_un.get("pop") or 0)+(de_re.get("pop") or 0),
        "wfm_market_sample":rec.get("wfm_market_sample"),"liquidity_score":rec.get("liquidity_score"),
        "rerolled_premium_ratio":rec.get("rerolled_premium_ratio"),
        # señales fuertes nuevas (del análisis de correlación):
        "re_pop":de_re.get("pop") or 0,"re_std":de_re.get("stddev") or 0,
        "re_med":re_med,"re_max":re_max,
        "wfm_vs_off":wa/(om+1.0),                       # prima meta (corr 0.50)
        "ceil_mult":re_max/(re_med+1.0)})               # headroom godroll (corr 0.69)
df_macro=pd.DataFrame(rows) if rows else pd.DataFrame(columns=["weapon"]+MACRO)
df_temp=pd.DataFrame(temporales) if temporales else pd.DataFrame(columns=["weapon"]+HIST)
df=df.merge(df_macro,on="weapon",how="left").merge(df_temp,on="weapon",how="left")

if "rerolls" not in df.columns: df["rerolls"]=0
df["rerolls"]=df["rerolls"].fillna(0).astype(int)
for col in ["official_median","wfm_avg"]:
    if col not in df.columns: df[col]=np.nan
    df[f"{col}_missing"]=df[col].isna().astype(int)
    m=df[col].median(); df[col]=df[col].fillna(m if pd.notna(m) else 0.0)
# Curado: fuera ruido (volatility_index, trend_7d_pct, web_min/max redundantes con wfm_avg).
defm={"popularity_pct":0.0,"wfm_market_sample":0.0,"liquidity_score":30.0,
      "rerolled_premium_ratio":1.0,"re_pop":0.0,"re_std":0.0,"re_med":0.0,"re_max":0.0,
      "wfm_vs_off":1.0,"ceil_mult":1.0}
for c,dv in defm.items():
    if c not in df.columns: df[c]=np.nan
    df[c]=df[c].fillna(dv)
# Historial: solo current_official/current_wfm + liquidez/momentum (lo demás era ruido).
for c in HIST:
    if c not in df.columns: df[c]=np.nan
df["hist_current_official"]=df["hist_current_official"].fillna(df["official_median"])
df["hist_current_wfm"]=df["hist_current_wfm"].fillna(df["wfm_avg"])
defh={"hist_liquidity_avg":30.0,"hist_rerolled_premium":1.0,"hist_momentum":1.0}
for c,dv in defh.items(): df[c]=df[c].fillna(dv)

# ---------------- HISTORY por (arma, fecha): nivel de mercado de ESE día ----------------
# Mide la deriva diaria sin fuga (es el wfm_avg del mercado ese día, no el precio de la fila).
# Features: drift = wfm_dia / mediana_serie (1.0=día normal, >1=día caro), liquidez/sample del día.
HIST_SERIES = "history_series.json"
hday = {}   # (weapon_lower, date) -> dict
hmed = {}   # weapon_lower -> {wfm_med, off_med}
if "fecha" in df.columns and os.path.exists(HIST_SERIES):
    hs = json.load(open(HIST_SERIES, encoding="utf-8"))
    for wl, serie in hs.items():
        wfm = [s.get("wfm_avg_price") or 0 for s in serie if s.get("wfm_avg_price")]
        off = [s.get("official_median") or 0 for s in serie if s.get("official_median")]
        hmed[wl] = {"wfm": float(np.median(wfm)) if wfm else 0.0,
                    "off": float(np.median(off)) if off else 0.0}
        for s in serie:
            hday[(wl, s.get("date"))] = s
    wl_col = df.weapon.map(lambda w: str(w).strip().lower())
    keys = list(zip(wl_col, df["fecha"].astype(str)))
    def _hd(k, field, default=0.0):
        d = hday.get(k); v = d.get(field) if d else None
        return float(v) if v not in (None, "") else default
    df["hist_day_wfm"] = [_hd(k, "wfm_avg_price") for k in keys]
    df["hist_day_liq"] = [_hd(k, "liquidity_score", 30.0) for k in keys]
    df["hist_day_sample"] = [_hd(k, "wfm_market_sample") for k in keys]
    df["hist_day_rerprem"] = [_hd(k, "rerolled_premium_ratio", 1.0) for k in keys]
    _wfm_med = wl_col.map(lambda w: (hmed.get(w) or {}).get("wfm", 0.0))
    _off_med = wl_col.map(lambda w: (hmed.get(w) or {}).get("off", 0.0))
    df["hist_day_off"] = [_hd(k, "official_median") for k in keys]
    # drift relativo a la mediana de la propia serie del arma (escala-libre)
    df["hist_day_drift"] = df["hist_day_wfm"] / (_wfm_med + 1.0)
    df["hist_day_offdrift"] = df["hist_day_off"] / (_off_med + 1.0)
    df.loc[df["hist_day_wfm"] <= 0, "hist_day_drift"] = 1.0       # día sin dato -> neutro
    df.loc[df["hist_day_off"] <= 0, "hist_day_offdrift"] = 1.0
    print(f"  history unido: {len(hday)} pares (arma,fecha), {len(hmed)} armas con serie.")
else:
    for c in ["hist_day_wfm","hist_day_liq","hist_day_sample","hist_day_rerprem",
              "hist_day_off","hist_day_drift","hist_day_offdrift"]:
        df[c] = (1.0 if c in ("hist_day_drift","hist_day_offdrift","hist_day_rerprem") else 0.0)
    print("  [NOTA] sin history_series.json: features hist_day_* en neutro.")

vc=df.weapon.value_counts()
dc=df[df.weapon.isin(vc[vc>=25].index)].copy()
dc["fatigue_index"]=dc.rerolls/(dc.official_median+1)

# dispo + archetype
T2I={"Rifle":0,"Sniper":0,"Bow":0,"Launcher":0,"Sentinel":0,"Companion Weapon":0,"Shotgun":1,
     "Pistol":2,"Dual Pistols":2,"Thrown":2,"Throwing":2,"Kitgun":2,"Melee":3,"Zaw":3,
     "Zaw Component":3,"Glaive":3,"Arch-Gun":4,"Archgun":4}
dispo,arch={},{}
try:
    for w in json.load(open(CW_FEAT,encoding="utf-8")):
        cn=clean(w.get("name","")); dispo[cn]=float(w.get("omegaAttenuation") or 1.0); arch[cn]=T2I.get(w.get("type"),0)
except Exception as e: print("[WARN] cleaned_weapons:",e)
cw=dc.weapon.map(lambda w:clean(w))
dc["disposition"]=cw.map(lambda c:dispo.get(c,1.0))
dc["archetype"]=cw.map(lambda c:arch.get(c,0))

# ---------------- magnitudes (now ~33% populated) ----------------
MAGC=["mag_pos1","mag_pos2","mag_pos3"]
HAS_MAG=all(c in dc.columns for c in MAGC) and dc[MAGC].notna().any().any()
ref_mag={}
if HAS_MAG:
    for c in MAGC+(["mag_neg"] if "mag_neg" in dc.columns else []):
        dc[c]=pd.to_numeric(dc[c],errors="coerce")
    L=[]
    for i,c in enumerate(MAGC,1):
        L.append(dc[["weapon",f"stat_pos{i}",c]].rename(columns={f"stat_pos{i}":"stat",c:"val"}))
    L=pd.concat(L).dropna(); L=L[(L.stat!="None")&(L.val.abs()>0)]
    ref_mag=L.groupby(["weapon","stat"]).val.quantile(0.95).to_dict()
def magn(w,s,v):
    """normalized magnitude 0..1 vs p95(weapon,stat); NaN when unknown so XGB can
    split on missingness instead of conflating 'unknown' with 'max roll'."""
    if not HAS_MAG or pd.isna(v): return np.nan
    r=ref_mag.get((w,s))
    if not r: return np.nan
    return float(np.clip(abs(float(v))/abs(r),0.0,1.0))

def synergy(row):
    """stat weight x magnitude; missing magnitude uses neutral 0.6 (median roll) so
    synergy stays finite, while the explicit mag_*_norm features carry the NaN signal."""
    pesos=lookup(row.weapon).get("dynamic_weights",{}); s=0.0
    for i in (1,2,3):
        st=row[f"stat_pos{i}"]
        if pd.notna(st) and st!="None":
            mn=magn(row.weapon,st,row.get(f"mag_pos{i}"))
            s+=pesos.get(st,0.05)*(0.6 if pd.isna(mn) else mn)
    return round(s,4)
dc["synergy_score"]=dc.apply(synergy,axis=1)
dc["dispo_x_synergy"]=dc.disposition*dc.synergy_score
dc["pop_x_synergy"]=dc.popularity_pct*dc.synergy_score
if HAS_MAG:
    for i in (1,2,3):
        dc[f"mag_pos{i}_norm"]=dc.apply(lambda r:magn(r.weapon,r[f"stat_pos{i}"],r.get(f"mag_pos{i}")),axis=1)
    dc["mag_pos_avg"]=dc[[f"mag_pos{i}_norm" for i in (1,2,3)]].mean(axis=1)
    dc["mag_neg_norm"]=dc.apply(lambda r:magn(r.weapon,r.get("stat_neg"),r.get("mag_neg")),axis=1) if "mag_neg" in dc.columns else 0.0
    dc["has_mag"]=dc[MAGC].notna().any(axis=1).astype(int)

dml=dc.copy()
# one-hot weapon
dum=pd.get_dummies(dml.weapon,prefix="weapon").astype(np.int8)
dml=pd.concat([dml,dum],axis=1)
pos_stats=[s for s in pd.concat([dml.stat_pos1,dml.stat_pos2,dml.stat_pos3]).dropna().unique() if s!="None"]
for st in pos_stats:
    dml[f"has_pos_stat_{st}"]=((dml.stat_pos1==st)|(dml.stat_pos2==st)|(dml.stat_pos3==st)).astype(np.int8)
for st in [s for s in dml.stat_neg.dropna().unique() if s!="None"]:
    dml[f"has_neg_stat_{st}"]=(dml.stat_neg==st).astype(np.int8)
# stat x synergy interactions help intra-weapon: count of strong stats
dml["num_pos"]=sum(((dml[f"stat_pos{i}"].notna())&(dml[f"stat_pos{i}"]!="None")).astype(int) for i in (1,2,3))
dml["has_neg"]=((dml.stat_neg.notna())&(dml.stat_neg!="None")).astype(int)

numeric=["official_median","wfm_avg","official_median_missing","wfm_avg_missing","popularity_pct",
    "wfm_market_sample","liquidity_score","rerolled_premium_ratio",
    "re_pop","re_std","re_med","re_max","wfm_vs_off","ceil_mult",
    "hist_current_official","hist_current_wfm","hist_liquidity_avg",
    "hist_rerolled_premium","hist_momentum",
    "synergy_score","rerolls","fatigue_index","num_pos","has_neg","disposition","dispo_x_synergy",
    "pop_x_synergy","archetype","mag_pos_avg","mag_pos1_norm","mag_pos2_norm","mag_pos3_norm",
    "mag_neg_norm","has_mag",
    "hist_day_drift","hist_day_offdrift","hist_day_liq","hist_day_sample","hist_day_rerprem"]
dummies=[c for c in dml.columns if c.startswith("weapon_") or c.startswith("has_pos_stat_") or c.startswith("has_neg_stat_")]
feat=[c for c in numeric if c in dml.columns]+dummies

# winsorize price per weapon (keep godroll tail wider than before: p97)
WINSOR=float(os.environ.get("WINSOR","0.97"))
dml["price_w"]=dml.groupby("weapon").price.transform(lambda s:s.clip(upper=s.quantile(WINSOR)))

import pickle
out={"X":dml[feat].astype(np.float32),"price":dml["price_w"].values,"price_raw":dml["price"].values,
     "weapon":dml["weapon"].values,"feat":feat,"has_mag_rows":int(dml.get("has_mag",pd.Series([0])).sum()) if "has_mag" in dml else 0}
pickle.dump(out,open("exp_matrix.pkl","wb"))
print(f"saved exp_matrix.pkl rows={len(dml)} feat={len(feat)} weapons={dml.weapon.nunique()} HAS_MAG={HAS_MAG} winsor={WINSOR}")
