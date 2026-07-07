# -*- coding: utf-8 -*-
"""Model search harness. Loads exp_matrix.pkl, evaluates a model config with an
honest stratified-by-weapon split, prints metrics. Usage:
  python exp_run.py <config> [seed]
Configs registered in MODELS below. Metrics:
  R2log         : global R2 in log space (inflated by knowing 'which weapon')
  R2intra       : R2 vs per-weapon mean -> the honest roll-quality number
  MAPEmed       : median per-weapon MAPE (% price error)
  AUCgod        : ranking of godrolls (price>=weapon p90)
"""
import sys, pickle, numpy as np, pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import r2_score, mean_absolute_error, roc_auc_score

D=pickle.load(open("exp_matrix.pkl","rb"))
X=D["X"]; price=D["price"]; weapon=D["weapon"]; feat=D["feat"]
y=np.log1p(price)

def sample_weights(idx):
    """per (weapon,tier) inverse-freq * sqrt(pop) so each weapon & tier ~equal."""
    w_=weapon[idx]; p_=price[idx]
    dfw=pd.DataFrame({"w":w_,"p":p_})
    def tw(g):
        try: t=pd.qcut(g,3,labels=False,duplicates="drop")
        except Exception: t=pd.Series(0,index=g.index)
        tc=t.value_counts(); wt=t.map(lambda x:1.0/tc.get(x,1)); return wt/wt.mean()
    sw=dfw.groupby("w").p.transform(tw)
    pop=dfw.w.map(dfw.w.value_counts()); pw=np.sqrt(pop); pw=pw/pw.mean()
    sw=sw*pw; sw=sw/dfw.w.map(dfw.w.value_counts()); return (sw/sw.mean()).values

def make(cfg):
    if cfg.startswith("xgb"):
        import xgboost as xgb
        # xgb:<n>:<depth>:<lr>:<subsample>:<colsample>:<minchild>:<reg>
        parts=cfg.split(":")
        g=lambda i,d:(float(parts[i]) if i<len(parts) and parts[i] else d)
        obj="reg:pseudohubererror" if parts[0]=="xgbh" else "reg:squarederror"
        return xgb.XGBRegressor(
            n_estimators=int(g(1,1200)),max_depth=int(g(2,8)),learning_rate=g(3,0.03),
            subsample=g(4,0.8),colsample_bytree=g(5,0.7),min_child_weight=g(6,3),
            reg_lambda=g(7,1.0),reg_alpha=g(8,0.0),gamma=g(9,0.0),
            objective=obj,
            tree_method="hist",n_jobs=-1,random_state=SEED,eval_metric="rmse")
    if cfg.startswith("hgb"):
        from sklearn.ensemble import HistGradientBoostingRegressor
        parts=cfg.split(":"); g=lambda i,d:(float(parts[i]) if i<len(parts) and parts[i] else d)
        return HistGradientBoostingRegressor(max_iter=int(g(1,1500)),max_depth=None if g(2,0)==0 else int(g(2,0)),
            learning_rate=g(3,0.05),l2_regularization=g(4,1.0),max_leaf_nodes=int(g(5,63)),
            min_samples_leaf=int(g(6,20)),random_state=SEED,early_stopping=True,validation_fraction=0.1,n_iter_no_change=40)
    if cfg.startswith("rf"):
        from sklearn.ensemble import RandomForestRegressor
        parts=cfg.split(":"); g=lambda i,d:(float(parts[i]) if i<len(parts) and parts[i] else d)
        return RandomForestRegressor(n_estimators=int(g(1,600)),max_depth=None if g(2,0)==0 else int(g(2,0)),
            min_samples_leaf=int(g(3,2)),max_features=g(4,0.5),n_jobs=-1,random_state=SEED)
    raise ValueError(cfg)

def evaluate(cfg, use_es=True, use_w=True):
    idx=np.arange(len(y))
    tr,te=train_test_split(idx,test_size=0.18,random_state=SEED,stratify=weapon)
    Xtr,Xte=X.iloc[tr],X.iloc[te]; ytr,yte=y[tr],y[te]
    wtr=sample_weights(tr) if use_w else None
    m=make(cfg)
    if cfg.startswith("xgb") and use_es:
        tr2,es=train_test_split(np.arange(len(tr)),test_size=0.12,random_state=SEED,stratify=weapon[tr])
        fit_kw=dict(eval_set=[(Xtr.iloc[es],ytr[es])],verbose=False)
        sw2=wtr[tr2] if wtr is not None else None
        m.set_params(early_stopping_rounds=60)
        m.fit(Xtr.iloc[tr2],ytr[tr2],sample_weight=sw2,**fit_kw)
    else:
        m.fit(Xtr,ytr,sample_weight=wtr)
    pred=m.predict(Xte)
    r2=r2_score(yte,pred)
    wt=weapon[te]; dft=pd.DataFrame({"w":wt,"y":yte,"p":pred})
    mu=dft.groupby("w").y.transform("mean")
    ss_res=((dft.y-dft.p)**2).sum(); ss_tot=((dft.y-mu)**2).sum()
    r2intra=1-ss_res/ss_tot if ss_tot>0 else float("nan")
    real=np.expm1(yte); pr=np.expm1(pred)
    ape=(np.abs(pr-real)/np.clip(real,5,None))
    dft["ape"]=ape
    per=dft.groupby("w").apply(lambda g:g.ape.mean()*100 if len(g)>=6 else np.nan).dropna()
    mape_med=per.median(); mape_mean=ape.mean()*100
    p90=pd.Series(price[tr]).groupby(weapon[tr]).quantile(0.90)
    thr=pd.Series(wt).map(p90).fillna(np.quantile(price[tr],0.90)).values
    gt=(real>=thr).astype(int)
    auc=roc_auc_score(gt,pred) if len(set(gt))>1 else float("nan")
    return dict(r2=r2,r2intra=r2intra,mape_med=mape_med,mape_mean=mape_mean,auc=auc,
                n_test=len(te),n_weap_eval=len(per),frac_under40=(per<40).mean())

if __name__=="__main__":
    cfg=sys.argv[1] if len(sys.argv)>1 else "xgb"
    SEED=int(sys.argv[2]) if len(sys.argv)>2 else 42
    import os
    use_w=os.environ.get("USE_W","1")=="1"
    r=evaluate(cfg,use_w=use_w)
    print(f"[{cfg}] seed={SEED} w={use_w}")
    print(f"  R2log={r['r2']:.4f}  R2intra={r['r2intra']:.4f}  MAPEmed={r['mape_med']:.1f}%  "
          f"MAPEmean={r['mape_mean']:.0f}%  AUCgod={r['auc']:.3f}  <40%:{r['frac_under40']:.0%}  "
          f"(test={r['n_test']}, weap={r['n_weap_eval']})")
