# Notas de parche — Refinado de la tasación de rivens

Fecha: 2026-08-04 · Ficheros: `deploy/js/utils/riven_logic.js`, `deploy/js/utils/riven_ml.js`,
`scripts-actu/ML-rivenvaluation/ML_local.py`

Resumen: el tasador sobreestimaba y el sesgo crecía con la popularidad del arma. La causa de fondo
era que **todo el pipeline aprendía y anclaba sobre precios de ASK** (lo que pide el vendedor), no
sobre ventas. Se corrige en las dos capas y se retiran las listas de stats en duro.

---

## 1. El origen: el target del ML eran asks

`price` del dataset (`Voidstonks-cron/historial_precios/dataset_raw_ml.csv`) lo rellena
`oraculo_riven.py` con `auction["buyout_price"]`. Medido sobre 443k filas / 379 armas con ventas
reales de DE:

| target de entrenamiento / ventas reales | antes |
| :-- | :-- |
| global | 2.7× |
| cuartil superior de liquidez | **7.1×** |
| cuartil inferior (nicho) | 1.1× |

En armas populares la venta real cae en el **p0** de los asks: ningún ask del dataset baja al precio
al que el arma se vende de verdad (Torid vende a ~450pl con asks a 7966pl).

**Un factor global no servía**: en nicho el ask ya está casi en precio de venta (1.1×) y lo habría
hundido. El calibrado es **por arma**.

### ⚠️ ESTADO: el calibrado queda DESACTIVADO por defecto (`CAL_VENTA=0`)

Revisión posterior: el escalar por arma era un **error de categoría**. La mediana de `de_rerolled` es
el centro de mezclar trash y godrolls — Dual Toxocyst registra ventas reales de **21p a 9000p** con
mediana 243p — así que multiplicar el arma entera por 0.08 aplastaba el godroll de 9000p a 720p
cuando DE tiene ventas de godroll a 9000p. Medido: el combo CC+Multishot+CD de esa arma está en el
**percentil 69** de sus asks, no en la mediana.

Se reescribió como mapeo **percentil→percentil** (anclas `min`/`median`/`max` de DE, interpolación en
log), que sí preserva la dispersión (34× frente a la comprimida del escalar). Pero se deja apagado
porque descansa en dos supuestos no verificables:

1. DE publica **3 números por arma**; las etiquetas son 100% asks. Todo el reescalado cuelga de esos
   3 puntos.
2. Asume que el **orden** de los asks es el orden de las ventas, y **no lo es**: los rivens sin
   maldición se piden por debajo de la mediana de su arma en el **85% del catálogo** (mediana 120p sin
   negativa contra 400p con negativa) porque valen menos para rolar, no porque se vendan por menos.

Con el mapeo activo, un CC/Multishot/CD sin negativa de Dual Toxocyst sale ~89p cuando el mercado
pide ~2750p por ese roll, y **no hay forma de comprobar cuál se acerca al precio pagado**: DE no
desglosa ventas por combo. Se activa en cuanto haya señal de ventas por roll (ver *Pendiente*).

### Calibrado ask→venta (`ML_local.py`)

Factor por arma = `de_rerolled.median / mediana de asks del arma`, aplicado al target antes de los
pesos de muestra y de `y = log1p(price)`. Requisitos del ancla: `re_pop >= 3` y `re_med > 0`; sin
ancla el arma se queda en escala de ask y se marca `fiable: false`.

Resultado (mismo dataset):

| target / ventas reales | antes | después |
| :-- | :-- | :-- |
| global | 4.55× | **1.00×** |
| armas populares | 8.65× | **1.00×** |
| nicho | 1.84× | **1.00×** |
| p90 por arma | 2.05× | **1.10×** |

El suelo del factor es `0.08`, no `0.15`: con 0.15 el clamp mordía en el 36% de las armas calibradas
y dejaba el target aún a 1.38× en el cuartil popular. Hay factores reales de 0.04 (Strun: ventas 78pl
vs asks 2000pl) y el p5 de la distribución es 0.060.

`price_bands.json` se genera de `df_ml["price"]`, así que sus deciles pasan a ser de venta
automáticamente (antes eran deciles de ASKS y el front los usaba como si fueran ventas).

Se exporta `venta` en `calibracion_por_arma.json` (factor + `fiable` por arma) y se añade
`CAL_VENTA=0` para poder repetir el A/B con el mismo dataset.

---

## 2. El modelo entrenado ya fija el precio

`rawPredictModel` existía pero **no se llamaba desde ningún sitio**: la app descargaba ~8MB de
árboles y los ignoraba; el precio salía entero de la curva heurística. Estaba desconectado a
propósito porque el modelo predecía asks inflados.

Con el target ya en escala de venta se reconecta:

- armas con calibrado fiable → **p50 del modelo** (`expm1` sobre la predicción en log1p);
- armas sin ancla → curva anclada a DE, como antes;
- el retorno expone `fuente: "ml" | "curva"` para poder auditar cuál se usó.

Con el bundle actual (sin `venta`) **todo sigue por la curva**: el cambio es inerte hasta que corra
`retrain-ml.yml`.

---

## 3. Sesgo del score y de la curva de precio

Tres defectos que se multiplicaban entre sí:

- **Score saturado.** `rawScore` pesaba meta 85% / magnitud 15%, así que un CC/CD rolado al *mínimo*
  puntuaba 85/100 y un roll medio salía 93/100 en 317 de 379 armas. Ahora **55/45**: el meta sigue
  mandando, pero la magnitud ya separa el godroll del roll mediocre.
- **Curva godroll sin magnitud.** Entraba solo con stats meta y su suelo era el 50% de
  `tiers.godroll` (~9.7× las ventas reales en armas populares). Ahora exige además
  `avgRollQuality >= 0.60`.
- **Ask amplificado.** `baseWfmScale` multiplicaba el ask (ya 17.7× la venta) por otro 1.2–2.7× y lo
  mezclaba al 50%. Ahora entra sin amplificar y con el dato real de DE al 70%.

| roll medio / ventas reales | antes | después |
| :-- | :-- | :-- |
| heurística, armas populares | 11.06× | **3.06×** |
| heurística, nicho | 3.54× | 2.28× |
| banda ML, populares | 5.25× | **2.03×** |

---

## 4. La cola alta de los no-godroll (el volumen de trading)

Causa: **`de_rerolled.median` con 1–2 ventas se usaba como "precio típico del arma"**, y de ese
valor cuelga toda la banda. Casos reales: Attica `median=1150` de **una** venta sobre un unrolled de
14pl (82×); Akzani 1210 de una venta sobre 4pl (**302×**).

Afecta al **21% del catálogo** (124 de 581 armas). Con `pop < 3` el rerolled se acota a 4× el
unrolled (el premium por rolar es 2–4×, no 80×), tanto en `riven_ml.js` (ancla de la banda) como en
`calculateHybridTiers`. Se añade también un tope al `goodReroll` derivado de asks (`trash * 5`).

| caso (p90 del ratio) | antes | después |
| :-- | :-- | :-- |
| 1 meta + relleno | 3.75× | **1.00×** |
| 3 positivos mixtos | 4.14× | **1.21×** |
| 2 meta magnitud baja | 4.82× | **1.36×** |
| 2 meta magnitud media | 6.50× | **2.39×** |

El p10 sube de 0.13–0.36 a 0.52–1.10: ya no hay armas donde el mismo roll se tase 10× por debajo.

Medianas por tramo, tras el arreglo:

| caso | score | p50 / ventas DE |
| :-- | :-: | :-: |
| negativa mala + stats ok | 8 | 0.53× |
| utilidad pura | 23 | 0.57× |
| elemental + status | 24 | 0.71× |
| 1 meta magnitud baja | 38 | 0.80× |
| 1 meta + relleno | 50 | **1.00×** |
| 3 positivos mixtos | 60 | 1.08× |
| 2 meta magnitud baja | 64 | 1.27× |
| 2 meta magnitud media | 78 | 1.96× |
| godroll (referencia) | 91 | 3.21× |

---

## 5. Fuera las listas de stats en duro

Se retiran `universalCriticalNegs`, `brickNegs`, `mitigableNegs` (en `riven_logic.js`) y el regex
`/zoom|recoil|\bto |vs |faction/` (dos sitios en `riven_ml.js`). El peso del stat **como positivo en
esa arma** ya clasifica lo mismo y con datos — en el prior global los tres grupos no se solapan:

- CC / CD / Damage / Multishot / BaseDamage → 0.70–1.00 (stat-killer)
- status chance, projectile speed → 0.28–0.37 (mitigable)
- ammo, magazine, impact, zoom, recoil → 0.01–0.18 (inofensiva)

Las listas además fallaban por los dos lados: `range` y `status duration` estaban entre las
"críticas universales" con pesos globales de 0.89 (solo melee) y 0.16; y `recoil` / `vs Corpus` eran
inofensivas por decreto cuando llegan a **0.65** y **0.81** según el arma.

El brick y el stat-killer pasan a ser **relativos al arma**, no un umbral absoluto: un corte fijo en
0.60 dejaba sin brickear 239 de 608 armas donde el stat sí es top (multishot tiene mediana 1.00 pero
p10 0.01, porque en escopetas/melees de verdad no aporta). Ahora entra si el peso está en el tercio
alto de esa arma.

Comportamiento resultante (620 armas):

| negativa | brickean | score mediano |
| :-- | :-: | :-: |
| −Multishot | 367/620 | 10 |
| −Critical Chance | 492/620 | 10 |
| −Zoom | 2/620 | 100 |
| −Recoil | 2/620 | 100 |
| −Damage Vs Corpus | 6/620 | 100 |

Es decir: Torid y Bubonico (multishot 1.00) brickean con −Multishot; Amphis (0.01, melee) no. El
hardcodeo brickeaba las tres por igual.

---

## 6. Regla: stats deseados nunca por debajo de la mediana

Un riven con los mejores positivos de su arma no puede tasarse por debajo de la mediana de ese arma.
Comprobado sobre las 602 armas con datos: ya se cumplía en 600, y las 2 excepciones (Seer y Kuva
Seer) eran un bug real.

Con poco volumen los pesos por arma **saturan**: Seer trae 8 de 30 stats empatados a 1.0 — Zoom y
Recoil junto a Critical Damage — así que cualquier negativa contaba como "perder un stat top" y
brickeaba el riven, dejándolo a 0.25× su mediana. Pasa en 31 de 608 armas (5%).

Ahora, si ≥25% de los pesos (y al menos 6) están pegados al máximo, la tabla no discrimina y se
descarta en favor del prior global. El mínimo de 6 empates evita el falso positivo en tablas cortas:
un arma legítima con CC/CD/Multishot a 1.0 son 3 empates sobre ~30 stats (10%), y debe conservar sus
pesos. Resultado: **602/602 armas cumplen la regla** en magnitud baja, media y alta.

También se reforzó el fallback de `posWeightOf`: sin `dynamic_weights` ni `rivenStatBaseline` (que
viene del worker y puede no llegar) el score de un CC+Multishot+CD se hundía a 37/100 y el precio a
~113-288p. Ahora cae al prior global de `stat_weights` y el mismo caso puntúa 89.

## 7. Bugs colaterales encontrados y corregidos

- **`mlBandEstimate` no protegía `floor > med`.** En armas de poco volumen el unrolled puede superar
  al rerolled (Amphis 135 vs 90) y el `Math.max(floor, sale)` aplastaba la banda entera a un punto:
  godroll y trash daban los dos 135pl.
- **σ con `pop=1` es 0**, que no significa "sin dispersión" sino "no lo sabemos". Colapsaba el techo
  godroll; ahora exige `pop >= 3` y mantiene un suelo de 3× sobre la mediana.
- **`max_price` es una sola venta** (el récord del arma): 178 de 346 armas superaban el cap y todas
  acababan con el mismo `skew=8`, dando el mismo multiplicador al arma con dispersión real 2× que a
  la de 50×. El techo pasa a ser robusto (mediana + 2σ), acotado por `max_price`.
- **El test de comparativa no comprobaba nada** (`results.length > 0`), así que un "Trash" de Torid a
  5000pl no hacía fallar nada. Además alimentaba `official_median` con `band.typical`, que es un
  **ask**: el tasador partía ya inflado y hacía lo correcto con datos falsos. Ahora usa ventas reales
  y tiene asertos de orden godroll/trash.

---

## Estado y verificación

- `npm test` **491/491**, `npm run lint` **0 errores** (71 warnings heredados de `no-unused-vars`).
- Monotonía: **0/379 violaciones** (godroll ≥ medio ≥ bajo, y en el score). El godroll sigue valiendo
  **2.57×** un roll medio.
- **Techo irreducible del mercado: 25%.** Dos rivens idénticos se listan a precios que difieren un
  25% de media, así que ningún modelo baja de ahí con estas features (la magnitud no lo explica:
  25.0% con magnitud vs 24.3% sin ella). Con `mape_trade` en ~48%, el margen real de mejora son
  ~23 puntos, no 48. Se añade `mape_piso` a `metrics_history.json` para no volver a comparar contra 0%.
- A/B del calibrado con el MISMO dataset: MAPE mediano por arma 88% → **84.7%**, MAPE global 82.3% →
  **80.6%**, AUC godroll 0.802 → **0.851**, R²intra y Spearman sin cambio. `mape_trade` sube 47.6 →
  49.7, pero es artefacto de escala: el umbral fijo de 200pl selecciona el 67% de las filas en asks y
  solo el 44% en ventas, así que compara subconjuntos distintos.

## Pendiente

- **El bundle de `deploy/assets/ml/` NO se ha regenerado** (los runs usaron `SLIM_EXPORT=0`). El
  calibrado y la vía del modelo se activan cuando corra `retrain-ml.yml` (lunes 04:00 UTC o
  *Run workflow*), que además entrenará con los datos frescos del CI.
- **274 de 414 armas siguen sin ancla fiable** (`re_pop < 3`) y por tanto sin usar el modelo. Para
  cubrirlas hace falta más señal de ventas.
- **Capturar ventas reales bajaría el techo del 25%**, porque ese ruido es desacuerdo entre
  vendedores (asks), no error del modelo.

  **HECHO (2026-08-04)**: `oraculo_riven.py` (repo `Voidstonks-cron`) ya guarda `auction_id` y
  `created` en `dataset_raw_ml.csv`, con migración idempotente de las filas históricas. Verificado
  contra la API real: ids de 24-hex únicos y estables, 40/40 filas con ambos campos, y las filas
  viejas intactas.

  Por qué hacía falta: el endpoint de búsqueda **solo devuelve subastas abiertas** (`closed=False`
  y `winner=None` en las 499 comprobadas), así que una venta no se observa — se deduce de que el
  `id` deja de aparecer. Sin el id no se puede seguir un listing entre días.

  **Cuando haya semanas de histórico**, el análisis es: cruzar los ids de dos capturas; los que
  desaparecen acotan la venta a **≤ su ask** (censura por la derecha, no una venta exacta —
  también puede ser retirada, cambio de precio o vendedor offline). Con eso se puede entrenar con
  etiquetas censuradas, o al menos calibrar por arma contra ventas en vez de contra `de_rerolled`.

  `created` sale gratis y ya es útil por sí solo: los listings vivos tienen una antigüedad mediana
  de **38 días**, con casos de **1176 días**, y los que llevan ≥90 días piden *más* (4100p) que los
  recientes (3500p) en Dual Toxocyst. Un ask que lleva meses colgado no es precio de mercado:
  ponderar por antigüedad (o descartar los rancios) debería mejorar la señal sin esperar a nada.
- Los tests nuevos (`tests/riven-ml-source.test.mjs`, `tests/riven-stat-weights.test.mjs`) son
  locales: `tests/` está en `.gitignore` (línea 43).
