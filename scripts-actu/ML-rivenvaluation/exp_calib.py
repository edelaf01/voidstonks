# -*- coding: utf-8 -*-
"""Stage-2 per-weapon reinforcement with reward.

Global XGB gives a base prediction. Then for EACH weapon we fit an isotonic map
pred->real on the weapon's TRAIN rows (out-of-fold) and KEEP it only if it beats
the raw global model on that weapon's OOF rows (the 'reward' gate). Weapons that
don't improve keep the global prediction. This corrects per-weapon scale/shape
bias without overfitting weapons with thin/noisy data.
"""
import sys,pickle,numpy as np,pandas as pd
from sklearn.model_selection import train_test_split,KFold
from sklearn.metrics import r2_score,roc_auc_score
from sklearn.isotonic import IsotonicRegression
import xgboost as xgb

D=pickle.load(open("exp_matrix.pkl","rb"))
X=D["X"];price=D["price"];weapon=D["weapon"]
y=np.log1p(price)
SEED=int(sys.argv[1]) if len(sys.argv)>1 else 42

def base_model():
    return xgb.XGBRegressor(n_estimators=1500,max_depth=10,learning_rate=0.03,subsample=0.8,
        colsample_bytree=0.6,min_child_weight=4,reg_lambda=2.0,reg_alpha=0.0,
        tree_method="hist",n_jobs=-1,random_state=SEED,eval_metric="rmse")

idx=np.arange(len(y))
tr,te=train_test_split(idx,test_size=0.18,random_state=SEED,stratify=weapon)

# --- OOF predictions on train (for honest per-weapon calibration fitting) ---
oof=np.zeros(len(tr))
kf=KFold(5,shuffle=True,random_state=SEED)
Xtr=X.iloc[tr].reset_index(drop=True);ytr=y[tr];wtr=weapon[tr]
for a,b in kf.split(Xtr):
    m=base_model();m.fit(Xtr.iloc[a],ytr[a]);oof[b]=m.predict(Xtr.iloc[b])
# full model for test
full=base_model();full.fit(Xtr,ytr)
pred_te=full.predict(X.iloc[te]);yte=y[te];wte=weapon[te]

def metrics(pred,tag):
    r2=r2_score(yte,pred)
    dft=pd.DataFrame({"w":wte,"y":yte,"p":pred});mu=dft.groupby("w").y.transform("mean")
    r2i=1-((dft.y-dft.p)**2).sum()/((dft.y-mu)**2).sum()
    real=np.expm1(yte);pr=np.expm1(pred);ape=np.abs(pr-real)/np.clip(real,5,None)
    per=dft.assign(ape=ape).groupby("w").apply(lambda g:g.ape.mean()*100 if len(g)>=6 else np.nan).dropna()
    p90=pd.Series(price[tr]).groupby(weapon[tr]).quantile(0.90)
    thr=pd.Series(wte).map(p90).fillna(np.quantile(price[tr],0.90)).values
    gt=(real>=thr).astype(int);auc=roc_auc_score(gt,pred)
    print(f"  [{tag}] R2log={r2:.4f} R2intra={r2i:.4f} MAPEmed={per.median():.1f}% AUC={auc:.3f} <40%:{(per<40).mean():.0%}")
    return per

metrics(pred_te,"global")

# --- per-weapon isotonic with reward gate ---
oof_df=pd.DataFrame({"w":wtr,"oof":oof,"y":ytr})
cal={}; kept=0
for w,g in oof_df.groupby("w"):
    if len(g)<40: continue   # need volume to trust a per-weapon map
    # reward: split weapon rows, fit iso on half, test on other half vs raw
    ga,gb=train_test_split(g,test_size=0.4,random_state=SEED)
    iso=IsotonicRegression(out_of_bounds="clip").fit(ga.oof,ga.y)
    raw_err=((gb.y-gb.oof)**2).mean()
    cal_err=((gb.y-iso.predict(gb.oof))**2).mean()
    if cal_err < raw_err*0.98:   # must beat raw by >2%
        cal[w]=IsotonicRegression(out_of_bounds="clip").fit(g.oof,g.y);kept+=1
print(f"  calibrated weapons: {kept}/{oof_df.w.nunique()}")

pred_cal=pred_te.copy()
for i,(w,p) in enumerate(zip(wte,pred_te)):
    if w in cal: pred_cal[i]=cal[w].predict([p])[0]
metrics(pred_cal,"global+iso")
