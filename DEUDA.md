# Deuda de arquitectura — inventario

Medido el **2026-08-12**. Las reglas están en [`ARCHITECTURE.md`](ARCHITECTURE.md); las infracciones que
aquí se listan están congeladas en [`tests/_baseline/architecture-debt.json`](tests/_baseline/architecture-debt.json)
para que **no puedan crecer**, y este documento dice qué hacer con cada una.

Al arreglar algo: bórralo del baseline (el test falla si sigue listado) y táchalo aquí.
Regenerar la medición: `npm run baseline:arquitectura`.

Los tamaños de fichero son `wc -l`.

---

## 1. ~~Exports muertos~~ — HECHO (339 líneas fuera)

Se borraron siete funciones que no usaba nadie. Tres eran además copias de una función viva, y
ese era el daño real: quien buscaba `calculateHybridTiers` encontraba dos, y la que salía
primero era la que no corría.

| Función | Estaba en | Copia viva que sí corre |
|---|---|---|
| `calculateAdvancedPredictivePrice` | `services/rivens.service.js` (3 params) | `utils/riven_logic.js:293` (6 params) |
| `calculateHybridTiers` | `services/rivens.service.js` | `utils/riven_logic.js:696` |
| `calculatePotentialScore` | `services/rivens.service.js` | — |
| `computeAndDisplayPrices` | `services/rivens.service.js` (ni exportada) | — |
| `preloadCriticalAssets` | `ui.js` | `ui.components/ui_components.js:10` |
| `getLivePrice` (por slug) | `services/wfm_live_prices.service.js` | — |
| `getLivePrice` (por itemId) | `services/wfm_watch.service.js` | — |

`rivens.service.js` pasó de **801 a 489 líneas** y salió de la lista de módulos gigantes. De
paso cayó el import huérfano de `TIER_URLS` en `ui.js`, que solo usaba la función borrada.

Los dos `getLivePrice` no se renombraron porque ya no existen; si algún día hace falta uno, que
nazca con nombre propio (`getLivePriceBySlug` / `getWatchedPrice`). Uno recibía un slug y el
otro un itemId: importar el que no es compilaba, pasaba el lint y devolvía `undefined`.

Resuelto también el resto menor: `fetchWeaponCombatStats` estaba exportada y solo se usa dentro
de su propio módulo; se le quitó el `export`.

## 2. Capas cruzadas — 4 estáticos + 2 dinámicos (eran 16 + 4)

**Resueltas 13, y tres de ellas destaparon bugs:**

- `kubrow_translations.js` era una tabla de datos (247 líneas, sin DOM, sin imports) viviendo en
  `ui.components/`. Movida a `utils/`, con test propio (`tests/kubrow-translations.test.mjs`).
- **`escapeHTML` bajó a [`utils/escape_html.js`](deploy/js/utils/escape_html.js) sin DOM**, lo
  que cerró las violaciones de `ui_utils.js`, `pip_overlay.js` y una de `scanner.service.js`.
  Al reimplementarlo apareció el problema de fondo: la versión vieja hacía
  `p.textContent = str; return p.innerHTML`, que **no escapa comillas**, y la salida entra en
  ~106 sitios *dentro* de un atributo (`title="${escapeHTML(p.text)}"` en `ui_lfg.js:293`,
  `href="${escapeHTML(w.wikiUrl)}"` en `ui_lich_weapons.js:134`). Un preset de trade guardado
  como `" onmouseover=alert(1) x="` cerraba el atributo y se convertía en un handler real;
  `p.text` lo teclea el usuario y `w.wikiUrl` viene del worker. Ahora escapa también `"` y `'`,
  con tests en `xss-escaping.test.mjs`.

- `server_clock.js` y `opencv_engine.js` no eran utils: hacían I/O contra un repositorio.
  Movidos a `services/server_clock.service.js` y `services/opencv_engine.service.js`
  (ninguno toca el DOM, así que no cambian una violación por otra).
- `clipboard.service.js` pintaba un toast desde la cola diferida. Ahora expone
  `onPendingCopied` y el aviso lo pone `ui_scanner_modal.js`, su único consumidor. **El service
  se quedó sin un solo import** y salió también de la lista de services que tocan el DOM.

- `ui_sync.js` hablaba con `api.repository.js` y decidía qué pintar mirando `res.status === 429`
  y `res.ok`, con ese mapeo repetido en el emisor y en el receptor y textos distintos en cada
  uno. Ahora [`services/sync.service.js`](deploy/js/services/sync.service.js) traduce una vez a
  un resultado con nombre (`{ok}` / `{reason: "rate-limit"|"server"}` y
  `{status: "waiting"|"received"|"rate-limit"|"server"}`) y el componente solo elige el mensaje.
  Con test propio: los tres desenlaces se parecen mucho en pantalla y confundirlos manda al
  usuario a esperar un minuto cuando el problema era otro.

- `utils/scanner.js` → `scanner/scanner_controller.js`. De util no tenía nada: monta un
  `<canvas>`, abre la cámara, pinta toasts, refresca el panel de inventario y guarda estado. Es
  un orquestador, hermano de `live_scanner.js` y `mobile_scanner.js`. Cerró sus dos violaciones
  estáticas y una dinámica (`→ repositories/ocr.repository.js`), y solo hubo que tocar el import
  de `main.js`.

  **No es esquivar la regla:** `scanner/` es la capa que ARCHITECTURE.md define como
  orquestadora, y la exención es de la carpeta entera, no de un fichero suelto — mover ahí algo
  que sí fuera un util sería justo el abuso que esto no es. Efecto secundario honesto: al salir
  de `utils/` también salió de la lista de módulos que **deben** tener test (la regla aplica a
  `services/`, `utils/` y `repositories/`), así que el contador de `untested` bajó de 30 a 29
  sin que se haya escrito ni un test para él. Sigue sin tenerlo.

- `ui_rivens.js` importaba **seis** cosas de `riven.repository.js`. Se resolvió en dos partes:
  `extractFamilyName` y las listas de variantes eran **lógica pura viviendo en la capa de I/O**
  (ni una petición: tablas y manipulación de cadenas), así que bajaron a
  [`utils/riven_family.js`](deploy/js/utils/rivens/riven_family.js); y los dos `fetch` pasaron por
  [`services/riven_index.service.js`](deploy/js/services/rivens/riven_index.service.js). `RIVEN_API_BASE`
  estaba importado y no se usaba. El componente ya no conoce el repositorio.

- `ui_utils.js` era dos módulos en uno: cálculo puro (`getSetName`, `getRequiredCount`,
  `calculateTotalFullSets`, `getItemIcon`) que usan `utils/relic_set_value.js` y
  `wfm_link.service.js`, y generación de HTML que pedía precios — que era lo que obligaba a un
  `utils/` a importar de `services/`. El cálculo se queda donde puede usarlo todo el mundo y el
  markup subió a [`ui.components/ui_tooltips.js`](deploy/js/ui.components/ui_tooltips.js), que
  sí puede pedirle cosas a un service. De 408 líneas a 175 + 249.

  **Y ahí apareció un bug:** `getRelicDropTooltip` se invocaba por `globalThis` desde dos
  sitios y **nadie lo publicaba**. En `ui_components.js:200` iba tras una guarda, así que el
  tooltip de drops de reliquia no salía nunca; en `ui_relics.js:190` iba **sin guarda**, o sea
  `TypeError` al pintar el badge de una reliquia activa. Ahora se importa de verdad.

`ui_components.js` sigue exportando `escapeHTML` (importa y reexporta) para no tocar los ~20
sitios que lo piden de ahí.

### Lo que queda

Ninguno rompe nada hoy; el coste es que la lógica se duplica cuando el atajo se repite. Las 6
que quedan ya no son mecánicas: cada una pide crear un service que hoy no existe o partir
un módulo.

**`services/` → `ui.components/`**

- `scanner.service.js` → `ui_scanner_hud.js`, `ui_scanner_modal.js`. Instancia el HUD y el modal,
  o sea que el service dirige la UI. Invertirlo es rediseñar quién manda en el escaneo, no
  cambiar un import.

**`utils/` → capas superiores**

- `kubrow_color_extractor.js` → `repositories/opencv.repository.js`. Ver abajo: puede que sobre
  entero.

**`ui.components/` → `repositories/`** (se salta el service, y con él caché y errores):

- `ui_arbitrage.js` → `riven.repository.js`. **Caso aparte: su pestaña está comentada en
  `index.html`** (línea 1148, "DESACTIVADO temporalmente (descomentar para reactivar)"), así que
  las 277 líneas del módulo son hoy inalcanzables salvo `applyArbTexts()`, que `ui.js` llama al
  cambiar de idioma y que no hace nada si no encuentra los elementos.

  No se toca: el comentario dice que es una pausa, no un abandono. Pero conviene saberlo antes
  de invertir en refactorizarlo — el service de rivens que necesita ya existe
  ([`riven_index.service.js`](deploy/js/services/rivens/riven_index.service.js)), así que si la pestaña
  vuelve, esto se resuelve cambiando dos imports.

**Y por vía dinámica, otras 2** (`import()` no es una puerta trasera: la regla es la misma):
`repositories/api.repository.js` → `services/relics.service.js` y
`ui.components/ui_riven_scanner_hud.js` → `repositories/riven.repository.js`.

La tercera, `services/riven_ocr.service.js` → `ui.components/ui_rivens.js`, se cerró al bajar la
tasación a un service (ver §3).

### `kubrow_color_extractor.js`: es trabajo a medias, no código muerto — CONFIRMADO

De sus 7 exports solo `PALETA_WARFRAME` y `COLOR_DESCRIPTIONS` los usa alguien
(`ui_ee_log_parser.js`). `hexToRgb`, `rgbToLab`, `colorMasCercanoLab`, `parseKubrowHeader` y
`extraerColoresConsenso` tienen cero usos fuera del fichero: son 454 líneas de extracción de
color por imagen sin enganchar.

**No es código muerto: está a medias** (confirmado por el dueño del repo). Se queda tal cual, y
con ello su violación de capa (`→ repositories/opencv.repository.js`), que se resolverá cuando
se termine — probablemente moviéndolo a `services/`, que es donde encaja algo que hace I/O
contra OpenCV.

Lo que sí conviene: cuando se retome, decidir si `extraerColoresConsenso` sigue teniendo sentido
frente a leer los colores del EE.log directamente, que es lo que hace hoy la app.

### ~~Resto: `globalThis.OpenCVEngine` no lo asigna nadie~~ — HECHO

`scanner.service.js` tenía `if (globalThis.OpenCVEngine?.isReady) { …OpenCV… } else { …JS… }` y
**ningún módulo escribe ese global**, así que la binarización de recompensas siempre ha sido la
rama `else`. Borrada la rama muerta (y la declaración de `OpenCVEngine` en `eslint.config.mjs`).

Ojo con "arreglarlo" enchufando OpenCV ahí: no es una limpieza, es cambiar el OCR. La pasada de
nombres está calibrada sobre esta binarización, y habría que medirlo contra las capturas de
`tests/_fixtures`.

## 3. Módulos que ya no son un módulo — 9 (eran 15)

**`config.js`: 3154 → 455 líneas. HECHO.** Casi todo eran datos, no configuración:

- `UPDATE_HISTORY_DATA` (1041 líneas de changelog en HTML) → `assets/update_history.js`
- `TEXTS` (1662 líneas de traducciones EN/ES) → `assets/texts.js`

`config.js` los reexporta, así que **ningún import cambió**. Verificado comparando los 24
exports del módulo antes y después: idénticos en contenido y tamaño.

Los dos ficheros nuevos siguen siendo grandes, pero `assets/` está **exento del límite de 800
líneas** y eso es deliberado: el límite existe porque un módulo de lógica enorme son varias
pantallas mezcladas que hay que leer enteras para tocar una, mientras que una tabla se lee por
la clave que buscas. La exención es solo para `assets/`, y lo comprueba
`tests/architecture-rules.test.mjs` — si no, "lo muevo a assets/" sería la forma de saltarse
el límite.

Efecto secundario que conviene saber: **6 tests se pusieron rojos** al mover `TEXTS`, todos del
tipo "leo config.js y cuento que la clave aparece 2 veces". Se reescribieron para mirar el
objeto `TEXTS` importado (helper `tests/_helpers/texts.mjs`), que es el invariante real y no se
rompe al mover código. Es el mismo problema que describe §5.


**El resto de `ui_rivens.js` sigue pendiente.** Son seis pantallas, pero **los cortes no son
tan limpios como parecen** (las líneas de la tabla son de antes de sacar el diccionario): los comentarios de sección del fichero (312, 1937, 2175, 4429) no
coinciden con las fronteras reales.

| Líneas | Qué hay de verdad | Destino |
|---|---|---|
| 1–313 | constantes SVG, tooltips, `normalizeStatName`, helpers de pesos, `RIVEN_NAMING_DICT`, `generateRivenName` | `ui_rivens_core.js` |
| 314–502 | selects e init (`populateRivenSelects`, `initSearchableSelects`) | el módulo que compone |
| 503–1936 | preview, showcase, historial, tarjeta | `ui_rivens_preview.js` |
| 1937–2174 | nombres y variantes | `ui_rivens_variants.js` |
| 2175–4428 | grading, tasación y mercado | `ui_rivens_grader.js` |
| 4429–4697 | carrusel de curiosidades | `ui_rivens_curiosidades.js` |
| **4699**–5920 | índice de rivens (el comentario `// Riven Market Index … Variables` está en 4698, no en 4861) | `ui_rivens_index.js` |

Dos trampas al ejecutarlo: `refreshCurrentRivenMetaStats` (4685–4697) es de meta-stats, no del
carrusel; y su estado `_curioCache` está declarado en la **línea 34** con un comentario que
explica que está ahí a propósito por la TDZ. Sacar el bloque sin mover eso rompe la carga.

**Dos que estaban justo por encima del límite y ya no lo están:**

- `ui_bounties.js` 838 → **776**. Las preferencias de Farms (sindicatos ocultos, grupos plegados
  y óptimas marcadas por el usuario) no pintan nada: son leer y escribir `localStorage` con
  validación. A [`services/farms_prefs.service.js`](deploy/js/services/farms/farms_prefs.service.js),
  con [11 tests](tests/farms-prefs-service.test.mjs) que fijan lo que no se ve — sobre todo que
  la clave de una óptima sea el PATRÓN (facción|tier|tipo) y no la rotación: si llevara el nodo,
  el usuario tendría que volver a marcarla cada dos horas y media.
- `ui_fissures.js` 878 → **790**. Los catálogos (tipos de misión, planetas, eras) a
  `assets/fissure_catalogs.js`, y los avisos de alarma a
  [`ui_fissure_alarms.js`](deploy/js/ui.components/farms/ui_fissure_alarms.js) — `alerts.service`
  decide QUÉ dispara, eso decide cómo se enseña.

### Por qué `ui_rivens` no se parte en pantallas

Medido, no supuesto: **el índice usa 19 cosas del resto del módulo y el resto usa 4 del índice**.
Partirlo en dos ficheros crea un ciclo de imports entre ellos, que es justo el fallo que
`CLAUDE.md` documenta como fatal. Y no es accidental: hacer clic en un arma del índice abre el
tasador, y el tasador sincroniza el filtro del índice. Están acopladas **por diseño de la
interfaz**.

Cortarlo de verdad pide un mediador o un store compartido entre las cinco pantallas —rediseño,
no reorganización— y toca la tasación. Lo que sí se ha sacado son las tres piezas que no
dependían de ese estado: los nombres de riven, la resolución de pesos y el acceso al worker.


**`ui.components/ui_rivens.js`: 5921 → 5719 líneas.** Dos cortes. El primero es el que más ha
dado de sí: el diccionario de nombres de riven y `generateRivenName` salieron a
[`utils/riven_naming.js`](deploy/js/utils/rivens/riven_naming.js).

No fue mover líneas. **La tabla estaba duplicada** en `ui_rivens.js` y `riven_ocr.service.js`
—28 y 30 entradas— y el detector de duplicados no la veía porque ninguna de las dos está
exportada. Al juntarlas salieron **cuatro claves muertas**, slugs que no existen en
`RIVEN_STATS`:

| En la tabla | Slug real |
|---|---|
| `melee_range` | `range` |
| `flight_speed` | `projectile_flight_speed` |
| `slide_crit_chance` | `critical_chance_on_slide_attack` |
| `combo_count_chance` | `chance_to_gain_extra_combo_count` |

`generateRivenName` busca `RIVEN_NAMING_DICT[statDef.slug]`, así que una clave muerta significa
que **ese stat desaparece del nombre sin avisar**: un riven con Alcance se nombraba con los otros
dos stats, y el nombre que enseñaba la app no era el del juego. En el escáner es peor, porque ese
nombre se usa para corregir el OCR por Levenshtein: "corregía" hacia un nombre inexistente.

Las cuatro arregladas. Quedan **tres stats sin nombre en la tabla** (`initial_combo`,
`heavy_attack_efficiency`, `finisher_damage`): no se inventan sus fragmentos —uno equivocado
reintroduce el problema del escáner— y están congelados en el test, para que al añadir uno se
note.

El guardarraíl que faltaba y ahora existe:
[tests/riven-naming.test.mjs](tests/riven-naming.test.mjs) comprueba que **cada clave del
diccionario sea un slug real**. Es lo que habría cazado la deriva el día que se escribió.

El segundo corte: la resolución de pesos de stats
(`metaConPesosDeFamilia`, `pesosFinosDeArma`, `statsSinDatoPropio`,
`isStatAllowedForWeaponType`) a
[`services/riven_weights.service.js`](deploy/js/services/rivens/riven_weights.service.js). Va a
`services/` y no a `utils/` porque necesita `extractFamilyName` del repositorio y `state`, que es
justo lo que un util no puede tocar.

Es de lo que más historia de bugs acumula el repo —cada función lleva el suyo escrito en el
código— y todos son el mismo de fondo: los datos se indexan por nombre EXACTO de arma, pero un
riven vale para toda la familia. Con [18 tests](tests/riven-weights-service.test.mjs) que fijan
los casos que ya mordieron: que Prisma Obex herede las listas de Obex pero **no** su disposición
ni su precio, que los tiers S/A/B/F se aplanen (los `dynamic_weights` saturan a 1.00 y no dejan
ordenar dentro del tier), y que la lista `baja_confianza` de positivos **no** se aplique a las
negativas — que era lo que borraba -Zoom de Torid teniendo 561 subastas.


**`ui.components/ui_vosfor.js`: 2643 → 2299 líneas.** Dos cortes hechos, y el resto no se toca
todavía:

- **El easter egg de Jade** → [`ui_vosfor_jade.js`](deploy/js/ui.components/ui_vosfor_jade.js).
  265 líneas de canvas que no compartían nada con la pestaña —ni estado, ni textos, ni datos de
  arcanos—: solo se cruzaban en la llamada de `renderVosforTab()`. De paso, su
  `globalThis.toggleHunhowMemeQuote` pasó al registro.
- **La matemática** → [`utils/vosfor_math.js`](deploy/js/utils/vosfor_math.js). `binomialGe`,
  `targetSimProbabilities` y `calculateR5Realism` son puras y estaban enterradas entre el
  render, así que no había forma de comprobarlas. Ahora tienen
  [18 tests](tests/vosfor-math.test.mjs) — y es el único número de esa pestaña que el usuario
  no puede verificar a ojo: un "72,3 %" mal calculado se lee igual de creíble que el bueno.

**Lo que queda dentro no se parte igual de fácil.** Calculadora, simulador de objetivo, simulador
de venta, ranking y tarjetas de pack comparten `vosData`, el estado de UI del módulo
(`packSort`, `activeRankTab`, `sellArcSlug`…) y una familia de helpers de formato. Sacar el
ranking, que era el candidato, exigiría exportar media docena de helpers y pasarle el estado:
más acoplamiento del que quita. El paso previo de verdad es extraer ese estado a un store
pequeño, y eso ya es rediseño.

**`ui.components/ui_sets.js`: 1391 → 494 líneas.** Era la pestaña entera —búsqueda, escaparate,
tracker y recomendaciones— en un fichero. Los cuatro cortes salieron limpios porque cada trozo
resultó tener **una sola dirección de dependencia**, que es lo que se midió antes de cortar:

| Nuevo módulo | Qué se llevó |
|---|---|
| [`ui_set_recs.js`](deploy/js/ui.components/inventory/ui_set_recs.js) | recomendaciones por fisura activa (nadie más las usaba) |
| [`ui_sets_showcase.js`](deploy/js/ui.components/inventory/ui_sets_showcase.js) | el carrusel de sets populares |
| [`ui_set_tracker.js`](deploy/js/ui.components/inventory/ui_set_tracker.js) | el tracker, su simulador de runs y el macro-tracker |
| [`ui_ducanator.js`](deploy/js/ui.components/inventory/ui_ducanator.js) | (desde `ui_inventory`) la pestaña de Ducados |

El escaparate llamaba a `searchSet()`, que se queda en `ui_sets`: sacarlo tal cual habría creado
un ciclo. Como ya lo invocaba por `globalThis.selectShowcaseSet`, el corte pasó por ahí y de paso
esa asignación suelta se migró al registro.

**`ui.components/ui_inventory.js`: 1561 → 472 líneas.** El mismo método:

| Nuevo módulo | Qué se llevó |
|---|---|
| [`ui_prime_inventory.js`](deploy/js/ui.components/inventory/ui_prime_inventory.js) | la vista Prime completa (render, handlers de pieza y set, total) |
| [`ui_inventory_live.js`](deploy/js/ui.components/inventory/ui_inventory_live.js) | precios en vivo y el chip de "precio viejo" |
| [`services/inventory_value.service.js`](deploy/js/services/inventory/inventory_value.service.js) | cuánto vale un grupo del inventario |

Lo que quedó en `ui_inventory.js` es la vista de reliquias, el conmutador entre vistas y el
import/export. Las seis funciones de la vista Prime que otros módulos invocan por `globalThis`
(el escáner en vivo, el tracker de sets, las órdenes) se publican ahora desde su módulo con
`exposeGlobals`, no desde el inventario.

El único trozo con test es el tercero, y es donde estaba el riesgo real: el total del inventario
**no es la suma de los precios**. Si hay piezas para armar un set, ese set vale su precio de
"… Set" y solo lo que sobra se cuenta suelto; sin eso un inventario completo se infravalora.
Los [11 tests](tests/inventory-value-service.test.mjs) fijan las tres caídas a suma simple (set
desconocido, precio del set aún sin llegar, ninguna pieza completa) y los dos detalles que no se
ven en pantalla: que las piezas que van por partida doble cuenten doble al calcular cuántos sets
salen, y que el centinela interno `999` no se escape como "999 sets".

**`ui.components/ui_orders.js`: 1864 → 1599 líneas.** No se partió la máquina de estados —sigue
siendo una pieza sola, y ahí el veredicto no ha cambiado—: lo que salió fue la tabla de textos
EN/ES a [`assets/orders_texts.js`](deploy/js/assets/orders_texts.js), 268 líneas de datos que
solo lee `txt()`.

El efecto secundario mereció la pena por sí solo: **siete tests se pusieron rojos** sin que
faltara ningún texto. Comprobaban la traducción contando `clave:` en el fuente del componente y
exigiendo exactamente 2 apariciones. Es el mismo fallo que §5 describe con `config.js`, y la
lección es la misma: **un test que cuenta ocurrencias en un fichero verifica dónde está el
código, no lo que hace.** Ahora [`tests/_helpers/orders-texts.mjs`](tests/_helpers/orders-texts.mjs)
importa el objeto y comprueba lo que de verdad importa —que la clave exista y no esté vacía en
los dos idiomas—, y eso ya no se rompe al mover nada.

**`ui.components/ui_rivens.js`: 5719 → 5433 líneas.** El carrusel de curiosidades de mercado
salió a [`ui_riven_curiosidades.js`](deploy/js/ui.components/rivens/ui_riven_curiosidades.js). Fue el
corte que la tabla de arriba daba por hecho, pero exigió resolver antes dos cosas:

- **Su `fetch` no podía viajar con él.** `ui_rivens.js` ya está en la lista de componentes que
  hacen I/O, así que el fichero nuevo habría *añadido* una infracción y el trinquete la habría
  parado. La carga del JSON está ahora en
  [`services/curiosidades.service.js`](deploy/js/services/rivens/curiosidades.service.js), con
  [5 tests](tests/curiosidades-service.test.mjs). El detalle que fijan: **un fallo no se
  memoriza**. El generador publica el JSON a diario; si la app arranca justo en ese hueco y el
  `null` se cachea, el carrusel no vuelve hasta que el usuario recarga la página.
- **`getWeaponImagePath` era lógica pura enterrada en el componente** y la usan ocho sitios. A
  [`utils/weapon_image.js`](deploy/js/utils/rivens/weapon_image.js) con
  [8 tests](tests/weapon-image.test.mjs). Su fallo nunca es un error: el `<img>` dispara su
  `onerror` y sale el SVG genérico, así que una regla de slug rota significa "esta familia de
  armas sale sin foto" y solo se ve mirando pantalla por pantalla. Fijadas las tres que se
  añadieron por casos concretos: las variantes de modo (`Vinquibus (Melee)`) reutilizan la
  imagen del arma base, el `&` va a doble guion bajo, y el resto de separadores se colapsan.

De paso desaparece el `let _curioCache` de la línea 45 con su comentario sobre la zona muerta
temporal: era un apaño para que un `let` declarado abajo no explotara durante la evaluación del
módulo, y en un módulo propio deja de hacer falta.

**Segunda pasada: 5433 → 4859.** La ficha de meta-stats (`renderMetaStats` y su refresco, 484
líneas) a [`ui_riven_meta_stats.js`](deploy/js/ui.components/rivens/ui_riven_meta_stats.js). El corte no
existía hasta que salieron de en medio los tres ayudantes que compartía con el resto:

| A dónde fue | Qué es |
|---|---|
| [`utils/riven_tooltips.js`](deploy/js/utils/rivens/riven_tooltips.js) | las explicaciones de las cifras del arma (tendencia, precio sin ciclar, techo) |
| [`utils/riven_stat_display.js`](deploy/js/utils/rivens/riven_stat_display.js) | el nombre localizado de un stat y el filtro de maldiciones imposibles |

Con eso la dependencia quedó **en una sola dirección** y el bloque salió entero.

`riven_stat_display` entró con [9 tests](tests/riven-stat-display.test.mjs) porque sus dos
funciones fallan calladas: una deja el nombre en inglés dentro de una app en español, y la otra
—`CANT_BE_NEGATIVE`— cuela una maldición que el juego no puede generar en la lista de negativos
recomendados, y manda al usuario a ciclar buscando algo que no existe. El test fija también la
normalización de los nombres de la era del *channeling*, que se aplica **antes** de traducir y
por eso arregla el inglés además del español.

Los tooltips traían el mismo vicio que `ui_orders`: su test raspaba `const tooltips = {…}` del
fuente de `ui_rivens.js` con una regex y se puso rojo al mover la tabla, sin faltar un texto.
Ahora el módulo exporta `RIVEN_TOOLTIPS` y el test comprueba el objeto — sigue vigilando lo que
importa (bilingüe, sin HTML porque se pintan con `innerText`, sin comillas dobles porque van
dentro de `data-tooltip="…"`, ni demasiado cortos ni ensayos).

**Tercera pasada: 4859 → 4381, y aquí el trinquete se ganó el sueldo.** La tarjeta de tasación
(489 líneas: multiplicador de deseabilidad, tabla de stats, chips de ML y de mercado) salió a
[`ui_riven_appraisal.js`](deploy/js/ui.components/rivens/ui_riven_appraisal.js) — no usaba **nada** del
resto del módulo.

Al mirar qué se llevaba apareció que dos de esas funciones no pintan nada: `appraiseParsedRiven`
y `computeDesirabilityMultiplier` reciben un roll y devuelven datos. Son un **service**, y
estaban en la capa equivocada con consecuencias reales: `services/riven_ocr.service.js` las
alcanzaba con `await import("../ui.components/ui_rivens.js")`, uno de los saltos de capa
dinámicos del inventario. Ahora viven en
[`services/riven_appraisal.service.js`](deploy/js/services/rivens/riven_appraisal.service.js) y **ese
cruce está cerrado** (los dinámicos bajan de 3 a 2).

El detalle que justifica la regla entera: al partir `ui_rivens.js`, `appraiseParsedRiven` dejó de
estar entre sus exports. Los dos `await import(...)` habrían seguido cargando el módulo, habrían
destructurado `undefined` y el escáner habría dejado de tasar **sin un solo error hasta el
momento de usarlo**. Ni el lint ni la carga de la página lo ven.

Entró con [11 tests](tests/riven-appraisal-service.test.mjs). Es la función que decide si la app
te dice que un riven vale 40 o 400 platino, y la usan las tres vistas (pestaña, HUD del escáner,
comparación de dos rolls): si divergen, el escáner tasa distinto que la pestaña sobre el mismo
riven y no hay forma de saber cuál miente. Los tests fijan comportamiento, no constantes —qué
ordena por encima de qué— incluidas las reglas que el propio código documenta con su historia:
que una negativa sobre un stat clave hunde el roll, que el daño por facción no cuenta como
maldición, que `"Damage"` a secas no se confunde con Critical Damage, y que melee y arma de fuego
no valoran los mismos stats.

El resto (`vision.service.js` 2088, `scanner.service.js` 1941, `riven_market.service.js` 1145,
`grid_detect.js` 1073, `riven_logic.js` 1045, `mobile_scanner.js` 1039) son grandes pero
coherentes: no urge partirlos.

## 4. Globals sin registro — 79 asignaciones en 27 ficheros (eran 93)

**Corrección importante: no son todos lo mismo, y la guía anterior era errónea para un cuarto
de ellos.** Medido:

- **~70 son funciones publicadas a pelo** (más 9 bloques `Object.assign(globalThis, {…})`, que
  publican varias de golpe). Esas sí son candidatas a `exposeGlobals`.
- **23 son ESTADO compartido**, no funciones: `_serverTimeOffset`, `MEMORY_CACHE`,
  `_kubrowHelperCvs`, `_lastFetchedMeta`… La convención del repo es el guion bajo delante.
  **El registro no es su sitio** —es para funciones que el HTML invoca— así que decir "migra
  todo a exposeGlobals" mandaba a hacer lo incorrecto en una de cada cuatro.

Y algunos tienen su motivo escrito: `_serverTimeOffset` vive en `globalThis` **a propósito**
para que `fissures.service` y `server_clock.service` no se importen entre sí y formen un ciclo
(está comentado en el código).

### Estado tras la migración

**De las funciones ya no queda ninguna migrable.** Las tres que siguen a pelo
(`openGridEditor`, `closeGridEditor`, `resetGridOffsets`) están en
`scanner/live_grid_editor.js`, que se carga como `<script>` **plano** y por tanto no puede
importar el registro: ahí `globalThis` no es un descuido, es el único mecanismo disponible (ver
`CLAUDE.md`). Todo lo demás que queda es **estado compartido**.

Migrados en esta pasada: los dos bloques `Object.assign(globalThis, {…})` de `main.js` (24
nombres) y `ui.js` (9), más `changeHistoryRange`, `switchGradingRoll` y `loadMoreRivenIndex`
(`ui_rivens.js`), `updateTrackerSim` (`ui_set_tracker.js`), `selectShowcaseSet` (`ui_sets.js`),
`toggleStaleFilter` (`ui_inventory_live.js`) y los seis de la vista Prime.

**Y al pasarlos por el registro salieron los pisotones que justifican que exista.** Ocho nombres
estaban publicados **dos veces**, y hasta ahora ganaba en silencio el módulo que se evaluara el
último:

| Nombre | Lo publicaban |
|---|---|
| `saveAppState` | `main.js` y `ui.js` |
| `showToast` | `ui.js` y `ui_components.js` |
| `captureRelics` | `main.js` y `scanner_controller.js` |
| `renderInventory`, `clearInventory`, `toggleInventoryPanel`, `renderPrimeInventory`, `closeScanner` | `main.js` y el módulo que los define |

En todos los casos era la misma función, así que el efecto de hoy era inocuo — pero es
exactamente el fallo que el registro existe para cazar. Ahora cada nombre lo publica un solo
módulo: el que lo define.

**2026-08-25:** migrado también el bloque `Object.assign(globalThis, {…})` de `ui_lfg.js`
(11 nombres), que se quedó fuera de aquella pasada. Salió al tocar `copyText` para que avise
cuando el portapapeles falla; su entrada ya no está en el baseline.

**Tres funciones muertas, borradas:** `clearRivenSearch`, `previewRivenIndexWeapon` y
`restoreRivenIndexPreview` (`ui_rivens.js`) estaban publicadas y **no las llamaba nadie** — cero
apariciones en todo `deploy/`, y el botón `btn-clear-riven-search` que la primera manipulaba ya
no existe en `index.html`. A una función global solo se la puede invocar por su nombre, así que
sin ninguna aparición no hay forma de que corran.

Y una **duplicada dentro del mismo fichero**: `ui.js` asignaba `globalThis.selectRelicFromPreview`
en dos sitios (líneas 477 y 671) con cuerpos idénticos salvo espacios. La segunda pisaba a la
primera desde siempre.

El estado compartido que queda tiene otro arreglo —pasarlo por parámetro o por un store— y es
más caro. El trinquete lo sigue contando, porque añadirlo a la ligera es acoplamiento invisible.

## 5. Lógica sin test que la ejecute — 1 módulo (eran 34)

Queda `utils/kubrow_color_extractor.js`, y a propósito: es **trabajo a medias** (confirmado por
el dueño del repo, ver §2). Escribirle tests ahora fijaría un contrato que aún no existe.

**Qué cuenta como testeado:** que un test lo **importe y lo ejecute**. Varios de estos sí
aparecen en `tests/`, pero leídos con `readFileSync` para asertar con regex sobre su texto
(`server-clock.test.mjs`, `prices-snapshot.test.mjs`, `lich-weapons.test.mjs`…). Eso comprueba
que una línea existe, no que la función haga lo que dice: un refactor que conserve la forma del
código y rompa el comportamiento pasa esos tests.

Por eso la cifra subió de 21 a 34 al afinar el detector — **no creció la deuda, mejoró la
medición**. Los tests por regex no son inútiles (documentan el bug que arreglaron), pero no
cuentan como cobertura.

Cubiertos (43 módulos, ~570 tests nuevos):

| Módulo | Test | Qué fija |
|---|---|---|
| `repositories/storage.repository.js` | [prices-cache](tests/prices-cache.test.mjs) | La caché que usa media app: dedup de peticiones simultáneas, lotes de 25 en orden alfabético (la URL es la clave de caché del edge), el snapshot que no pisa lo que ya hay, y que un slug desconocido resuelva 0 en vez de dejar el precio "cargando" para siempre |
| `utils/wfm_crypto.js` | [wfm-crypto](tests/wfm-crypto.test.mjs) | Abre el sobre con la privada de verdad: `wfm-credentials.test.mjs` reimplementaba el cifrado, así que seguía verde aunque el real se rompiera. Comprueba que el par efímero y el IV no se reutilizan |
| `services/clipboard.service.js` | [clipboard-service](tests/clipboard-service.test.mjs) | La cascada extensión → portapapeles → cola al recuperar el foco, el timeout si la extensión no contesta, y que el `postMessage` lleve origen explícito y no `*` |
| `utils/relic_drop_odds.utils.js` | [relic-drop-odds](tests/relic-drop-odds.test.mjs) | Las probabilidades. Destapó un bug (ver abajo) |
| `utils/tap.js` | [tap](tests/tap.test.mjs) | El slop de 10 px y la deduplicación pointerup/click que arreglaron el doble toque en móvil |
| `utils/damage_types.js` | [damage-types](tests/damage-types.test.mjs) | Que la tabla siga siendo única (estaba copiada 3 veces en `ui_rivens.js`) y que el tipo no pueda salirse del atributo del icono |
| `services/wfm_auth.service.js` | [wfm-auth-session](tests/wfm-auth-session.test.mjs) | Que la caducidad local (3 h) mande sobre la del JWT (60 días) — es la única mitigación real ante un XSS, y parece redundante; que al caducar se borre la sesión entera; que `logout` revoque en WFM y limpie aunque no haya red; y que un `sessionStorage` bloqueado deje la app sin sesión en vez de rota |
| `services/set_recommendations.service.js` | [set-recommendations](tests/set-recommendations.test.mjs) | Reglas del juego que no se deducen del código: Vanguard cuenta como Axi, la misma fisura no se lista dos veces aunque la pieza salga de varias reliquias, las runs usan TU refinamiento y TU escuadra, y "mejor comprarlo" es ≤15 % del precio del set |
| `services/sync.service.js` | [sync-service](tests/sync-service.test.mjs) | Los tres desenlaces del buzón, que se parecen mucho en pantalla |
| `services/wfm_live_prices.service.js` | [wfm-live-prices.behaviour](tests/wfm-live-prices.behaviour.test.mjs) | Los dos umbrales del chip "precio desactualizado": pasarse marca medio inventario y el chip deja de significar nada; quedarse corto y vendes a un precio de hace horas. Fija que hagan falta **las dos** condiciones (20 % Y 5 platino), que una compra no cuente como precio de venta, y que 0 en la caché sea "sin datos" y no "vale 0" |
| `services/wfm_watch.service.js` | [wfm-watch-service](tests/wfm-watch-service.test.mjs) | Vigilancia en vivo: ~250 órdenes por minuto filtradas en el cliente. Se conduce por el socket real con un WebSocket falso, así que también prueba el cableado entre los dos services. Fija que un vendedor desconectado no cuente, que una compra barata no sea un chollo, que en mods y arcanos cada rango sea un mercado aparte, y que te rebajen solo en TU lado del libro |
| `services/alerts.service.js` | [alerts-service](tests/alerts-service.test.mjs) | Las alarmas fallan en los dos sentidos y las dos en silencio: si el matcher se pasa, no suena nunca y te enteras al perder la rotación; si se queda corto, suena con lo que no pediste y acabas apagándolas. Fija que NARMER/CODA valgan más que cualquier tier numérico, que Vanguard dispare una alarma de Axi, que "Dark Sector Defense" cuente como Defense, que sin tier comunitario conocido NO se prometa un mínimo, y que el deduplicado incluya el nombre del arma (sin él, dos armas de la misma tienda comparten clave y solo avisa de la primera) |
| `services/relics.service.js` | [relics-service](tests/relics-service.test.mjs) | Los dos números que ordenan la lista de reliquias. El reparto es por HUECO, no por ítem (1 raro, 2 poco comunes, 3 comunes): sin dividir entre los huecos, una reliquia con muchos comunes se infla al triple y la lista queda ordenada por el criterio equivocado sin cambiar de aspecto. Y en el catálogo de ducados, que las piezas genéricas lleven delante el nombre del arma — si no, el "Barrel" de la última procesada pisa el de todas las demás |
| `repositories/api.repository.js` | [api-repository](tests/api-repository.test.mjs) | La política de caché, comprobada **ejecutándola** y no grepeando el fuente: que lo que rota vaya con `no-cache`, que `force` estrene clave para esquivar el stale-while-revalidate del edge, que lo que solo vale ahora vaya con `no-store`, y que el catálogo SÍ se cachee. Un endpoint nuevo en la clase equivocada reabre el bug de las bounties clavadas en "ROTATING" |
| `services/riven_market.service.js` (`getBaseWeaponName`) | [riven-base-weapon-name](tests/riven-base-weapon-name.test.mjs) | La clave con la que se buscan las stats meta. Falla devolviendo `null` y la tasación cae a pesos genéricos: precio plausible, calculado sin los datos del arma. Fija los quirks del juego (Dex Furis usa el riven de Afuris), MK1 con guion y con espacio, y los overrides de familia sobre el despiece genérico |
| `services/fissures.service.js` | [fissures-service](tests/fissures-service.test.mjs) | Que una tormenta del vacío no se cuele por llamarse igual que una misión normal ("Extermination" está en las dos listas), que Omnia se vea aunque su tipo no esté marcado, que un fallo del worker deje lo último bueno en pantalla en vez de vaciar el panel, y el rescate por desfase de reloj que evita que las fisuras vivas desaparezcan |
| `services/inventory.service.js` | [inventory-service](tests/inventory-service.test.mjs) | Qué slugs salen a la red: pedir de más gasta cuota, pedir de menos deja filas en "cargando". Lotes de 25 (el worker recorta con `slice(0,25)` y la segunda mitad se perdía en silencio), un lote que falla no corta los siguientes, y un precio 0 no se cachea (significa "sin dato", no "vale 0") |
| `services/wfm_orders.service.js` | [wfm-orders-service](tests/wfm-orders-service.test.mjs) | El camino de escritura sobre la cuenta. Su fallo típico no es una excepción: es que la lista salga vacía y parezca que no hay órdenes. Fija que `data` se acepte como array **y** como `{sell,buy}` (la v2 devuelve las dos), el troceo de 25 ids que evita el 500 del worker, que un fallo al resolver nombres deje las órdenes sin nombre pero visibles, y que `rank: 0` sea un rango válido y no "sin rango" |

Prioridad de lo que queda: **`services/riven_market.service.js`** (1145 líneas, alimenta la
tasación) y **`repositories/api.repository.js`** (la puerta de todo el tráfico al worker).

### ~~Hueco: los listeners de `wfm_watch` no van protegidos~~ — HECHO

`wfm_socket.service.js` envolvía cada listener en `try/catch` a propósito —*"un listener roto no
debe cortar el flujo"*— y `wfm_watch` no. Con ~250 órdenes por minuto, un suscriptor que lanzara
dejaba sin avisar a los que venían detrás; y no explotaba hacia fuera porque el socket se tragaba
la excepción, así que el síntoma era simplemente que dejaban de sonar avisos.

Igualado con un helper `emitir()` para los tres canales (`onDeal`, `onUndercut`, `onPrice`), y el
test pasó de documentar el hueco a exigir el comportamiento nuevo.

**Sigue en pie el segundo detalle del módulo:** `setWatchlist()` limpia `watched` pero no
`livePrices` (eso solo pasa en `stopWatching`). Cambiar la lista de vigilancia deja los mejores
precios anteriores, así que un ítem que vuelva arrastra su récord viejo y no emite hasta
superarlo. No se ha tocado porque no está claro que sea un error: mantenerlos evita perder los
precios de los ítems que siguen en la lista al refrescar las órdenes.

**Y uno nuevo, del mismo tipo:** en `wfm_live_prices`, `checkStale()` sale antes de tiempo cuando
no hay precio guardado, y eso incluye NO retirar una marca que ya hubiera. Un ítem marcado que
luego pierde su precio del worker conserva el chip hasta que vuelva a haber dato.


### Hueco: la pestaña de perfil no tiene sus textos de error

`profile.service.js` avisa con `TEXTS[lang].errProfileNotFound` y `errProfileFetch`, y **ninguna
de las dos claves existe** — ni en ES ni en EN. Los dos avisos salen como `undefined`.

No se inventan los textos porque la función está **aparcada**: se publica en `globalThis` desde
`main.js` pero ningún HTML la llama, y el propio service lleva un TODO diciendo que no está
planteado. Es el mismo caso que `ui_arbitrage`.

Congelado en [tests/profile-service.test.mjs](tests/profile-service.test.mjs): al retomar la
pestaña, lo primero son esas dos claves en los dos idiomas, y el test avisa.

### Bug encontrado al escribir el test de probabilidades

`getPartRarity` hacía `if (r.includes("common")) hasCommon = true;` **antes** de mirar uncommon,
y `"uncommon".includes("common")` es `true`: toda pieza poco común se clasificaba como común. Como
la función devuelve `"common"` en cuanto `hasCommon` está puesto, se le aplicaban las tasas
equivocadas (radiant 0.1667 en vez de 0.20) y el rastreador de sets estimaba **más runs de las
reales**. Mismo patrón que el `"LIMBO"` / `"LIMB"` que documenta `CLAUDE.md`.

Arreglado mirando `uncommon` primero. No se puede confirmar desde el repo cuánto afectaba en
producción: el campo `rarity` lo rellena la API de reliquias en vivo, y no hay datos locales. Si
la API no lo manda, la deducción por probabilidad ya daba bien y el bug estaba latente.

### ~~Hallazgo: dos funciones resuelven la familia de un arma con respuestas distintas~~ — CORREGIDO

Lo dije mal en la primera pasada: parecía una copia sin sincronizar y **no lo es**. Al ir a
unificarlas, los datos dijeron otra cosa.

`extractFamilyName` ([riven.repository.js](deploy/js/repositories/riven.repository.js)) y
`getBaseWeaponName` ([riven_market.service.js](deploy/js/services/rivens/riven_market.service.js))
comparten la tabla de overrides palabra por palabra, pero hacen trabajos distintos:

- **`getBaseWeaponName`** resuelve las stats meta de ESA arma. En `metastats.json` las variantes
  tienen **entrada propia** (están `Lacera` **y** `Ceti Lacera`, `Nikana` **y** `Dragon Nikana`),
  así que despellejar de más le haría usar los datos del arma base para una variante que tiene
  los suyos. Por eso es conservadora.
- **`extractFamilyName`** es el **fallback** de agrupación: se prueba
  `[weaponName, extractFamilyName(weaponName)]` en ese orden, y existe justo para el caso
  contrario — *"Prisma Obex no está en stat_weights.json pero Obex sí: el riven es el mismo"*
  (`ui_rivens.js:164`). Ahí despellejar de más es lo que se busca.

De ahí que una recorra en bucle y la otra quite un prefijo y un sufijo. **Unificarlas sería un
cambio silencioso en la tasación**, no una limpieza.

Lo que sigue mereciendo vigilancia es que sus listas no se separen por descuido: eso lo cubre
[tests/riven-family-name-drift.test.mjs](tests/riven-family-name-drift.test.mjs), que congela
las 6 divergencias conocidas y explica en su cabecera para qué sirve cada función, para que el
siguiente no repita mi error.

Lo que sí queda en pie del hallazgo original: **el detector de duplicados no habría pillado esto
aunque hubieran sido copias, porque se llaman distinto.** Vigila nombres iguales, no propósitos
iguales.


### Segunda tanda: los que "necesitaban imágenes" (y casi ninguno las necesitaba)

Los diez que quedaban estaban aparcados como "piden fixtures de imagen o DOM real". Al mirarlos
de cerca, ocho no las pedían: lo que hacía falta era un canvas y un `document` de mentira, que
ya existían en `tests/_helpers/fake-canvas.mjs`.

| Módulo | Test | Qué fija |
|---|---|---|
| `services/ee_log_reader.service.js` | [ee-log-reader-service](tests/ee-log-reader-service.test.mjs) | Los colores del EE.log son la VERDAD y sustituyen a lo que ve el escáner, así que un fallo enseña un set plausible de OTRO bicho. Fija las reglas que salieron de mirar logs reales: que los slots de visitas distintas se acumulen (el juego no reescribe lo que ya tiene cacheado), que un frame con Eyes reinicie el acumulado (es "estoy viendo otro kubrow"), que el catálogo del arranque no se confunda con un set, y que solo se lea la COLA del fichero y no sus varios MB |
| `services/riven_ocr.service.js` | [riven-ocr-service](tests/riven-ocr-service.test.mjs) | El módulo con más historia de bugs escrita en sus comentarios, todos del mismo tipo: el arte ensucia el texto y la regex se come el curse o inventa un stat. Fija con el texto que los provocaba: el "(x2 for Bows)" que se colaba como stat multiplicador, el decimal perdido (`+822%` → 82.2), el curse de facción que se perdía cuando el arte dejaba basura detrás, el recoil invertido (su buff se muestra en negativo), y que cuatro positivos signifiquen "se comió el signo del último" en vez de tirar la carta |
| `services/rivens.service.js` | [rivens-service](tests/rivens-service.test.mjs) | De aquí salen qué armas existen y con qué stats se tasan sus rivens, cruzando dos fuentes con criterios distintos. Fija que los componentes de zaw no sean armas, que los Hound usen stats de melee y los centinelas de rifle, que los kitguns (que llegan sin categoría) sean secundarias, y el dedup por slug que evitaba que "Ax 52" y "Ax-52" salieran como dos armas |
| `services/riven_appraisal.service.js` | [riven-appraisal-service](tests/riven-appraisal-service.test.mjs) | Ver §3 |
| `services/curiosidades.service.js` | [curiosidades-service](tests/curiosidades-service.test.mjs) | Ver §3 |
| `services/opencv_engine.service.js` | [opencv-engine-service](tests/opencv-engine-service.test.mjs) | La mitad JS puro del motor de visión, que corre con OpenCV o sin él. Fija que el color de acento se DETECTE MEDIDO y no canónico (es lo que captura el desvío por bloom y balance de blancos de la cámara), que el fondo oscuro no arrastre el promedio, que la binarización deje texto negro sobre blanco, y que sin OpenCV cargado ninguno de sus métodos explote |
| `repositories/opencv.repository.js` | [opencv-repository](tests/opencv-repository.test.mjs) | La carga de 8 MB de wasm por CDN mientras el usuario ya escanea. Destapó dos fallos (abajo) |
| `repositories/paddle.repository.js` | [paddle-repository](tests/paddle-repository.test.mjs) | Paddle devuelve una caja por LÍNEA, no por palabra, y a veces pega dos nombres ("YareliPrime"). Todo el módulo es esa traducción al formato de Tesseract; si se desvía, el escáner deja de reconocer recompensas **solo** con Paddle activado, que es el caso que nadie prueba. También fija que la librería se cargue una sola vez y con el modelo pequeño (4,8 MB vs 12 MB) |
| `repositories/riven.repository.js` | [riven-repository](tests/riven-repository.test.mjs) | Cuatro envoltorios de `fetch`, pero contra **dos workers distintos**: confundirlos da un 404 que se lee como "no hay datos de esta arma". Fija a qué base va cada uno y que el historial devuelva un array venga en el formato que venga |
| `services/scanner.service.js` | [scanner-service](tests/scanner-service.test.mjs) | Las decisiones entre frames, que es donde están los fallos que el usuario nota: el contador que baila entre 3 y 31 (consenso por votos, empate a la mayor), la carta de riven que parpadea, y la lectura buena pisada por una peor. Solo la parte pura: la orquestación del OCR sigue pidiendo el stack completo |
| `utils/pip_overlay.js` | [pip-overlay](tests/pip-overlay.test.mjs) | La ventana flotante vive en OTRO documento y el escáner le manda frames aunque el usuario la haya cerrado. Se conduce por `openPiP` con una API de navegador falsa, así que también cubre el montaje. Fija el escapado de los nombres del OCR y que un precio 0 salga como raya y no como cero |
| `utils/canvas.js` | [canvas](tests/canvas.test.mjs) | Decorativo, pero corre en cada arranque: fija que no reviente sin el canvas en la página, con un canvas de 0×0 (pestaña abierta en segundo plano) ni con cualquiera de los tres formatos en que puede llegar el color del tema |

**Dos fallos reales en `opencv.repository.js`**, los dos destapados por el test y arreglados:

1. **El sondeo no paraba nunca.** `waitReady` lanza un `setInterval` cada 100 ms esperando a que
   OpenCV aparezca. El `Promise.race` de fuera resuelve `false` al vencer el timeout, pero eso
   **no paraba el intervalo**: si OpenCV no llegaba (CDN caído, wasm bloqueado por la red),
   seguía despertando cada 100 ms el resto de la sesión. Se notó porque el test de Node no
   terminaba nunca.
2. **Con los dos CDN caídos, RECHAZABA** en vez de devolver `false`. Dos de sus cuatro llamantes
   ya ponían `.catch()`, pero el escáner móvil no: su `try` general capturaba la excepción y
   **cerraba el escáner entero**, saltándose el `if (!success) setVisionStatus("ERROR")` que el
   propio autor había escrito justo debajo. Y sin OpenCV el escáner sigue siendo usable — la
   detección de color y la binarización son JS puro. Ahora se degrada en vez de caerse.

**Una nota sobre `tests/_helpers/fake-canvas.mjs`:** su `drawImage` interpola (bilineal) al
reescalar, igual que el navegador. No es un lujo — media cadena de visión depende de ese
suavizado (el badge de cantidad se amplía y se re-binariza para redondear los trazos) y hay
tests que miden justamente qué se rompe al reescalar un frame. Con vecino más cercano esos
tests pasan por el motivo equivocado.

## 6. `utils/` que en realidad son services

Siete módulos de `utils/` importan `state.js`, así que no son funciones puras y no se pueden
reutilizar fuera de la app: `ui_utils.js`, `relic_drop_odds.utils.js`, `scanner.js`,
`pip_overlay.js`, `riven_ml.js`, `slugs.utils.js`, `riven_logic.js`.

El test no lo prohíbe (serían siete falsos positivos permanentes), pero al tocar uno merece la
pena preguntarse si el estado se puede pasar por parámetro. `riven_logic.js` es el caso claro:
es cálculo puro salvo por un par de lecturas de `state`.

## 7. ~~`api.js`: barrel a medias~~ — HECHO

Era una fachada "por compatibilidad" de una migración a `repositories/` y `services/` que nunca
se terminó (confirmado por el dueño). El problema no era el tamaño: **era la vía para saltarse
el contrato de capas sin que saltara ninguna alarma**, porque reexportaba 8 símbolos de
repositorios y `ui.components/` sí puede importar del barrel.

Terminada la migración: los 10 importadores apuntan ya al módulo real y `api.js` está borrado.

La parte que no era mecánica: cinco componentes pedían por ahí la caché de precios
(`getPriceValue`, `addToQueue`), que vive en `repositories/`. Repuntarlos al repositorio habría
cambiado un salto de capa encubierto por uno explícito, así que se escribió el intermediario que
faltaba —[`services/prices.service.js`](deploy/js/services/market/prices.service.js)—. Hoy solo
reexpone; su razón de ser es tener un sitio donde poner la política de precios que aún no
existe (descartar un valor sospechoso, mezclar el precio en vivo del socket con el cacheado)
sin que acabe en el componente ni en el repositorio.

Resultado: la categoría `barrelRepositoryReexports` del baseline pasó de 8 a **0**, y
[tests/prices-service.test.mjs](tests/prices-service.test.mjs) impide que el barrel vuelva.

## 8. CSS: el orden de carga decide quién gana

`index.html` (líneas 83–96) carga **7 componentes antes** de `styles.css` y **6 después**. Como
todos comparten cascada, a igualdad de especificidad gana el último. Eso hace que qué regla
manda dependa de la línea del HTML y no de ninguna decisión.

**Solo un caso es deuda real:**

- **`riven-module.css` (carga después) redefine 30 clases que también están en `styles.css`**
  (`.index-item-card`, `.riven-header`, `.riven-stats-list`, `.index-card-*`…), ninguna dentro
  de `@media`. Aquí sí hay solape real — pero **no se puede borrar el bloque de `styles.css` a
  ciegas**: de tres clases revisadas, solo `.riven-stats-list` queda realmente muerta (el
  componente redefine sus 5 propiedades). En `.riven-header` sobreviven `font-size` y
  `font-weight`; y `.index-item-card` es el caso opuesto — `styles.css` tiene 11 reglas frente
  a 4 del componente, y sobreviven el `background` del `:hover` y **7 reglas de descendientes**
  (`:hover .index-card-img-area`, `:hover .index-card-weapon-name`, `.expanded
  .index-expand-indicator`…) sin contrapartida. Borrarlas rompe los hovers del índice.
  (De paso: `.index-item-card:hover .index-card-img-area` está duplicada **dentro** del propio
  `styles.css`.)

**El resto de "duplicados" no lo son.** El conteo por nombre de clase engaña: de las 19 de
`header.css`, **15 solo existen en `styles.css` dentro de bloques `@media (max-width: 768px)`**
— son overrides responsive, no competidores en la misma cascada. Las 4 restantes tampoco chocan
(`.card` aparece en `styles.css` solo como `.card.theme-lfg select.wf-input`; `.action-btn` y
`.dashed-btn` con modificadores distintos y más específicos; `.mini-action-btn` se solapa con
**cero propiedades en común**). Conclusión: **ningún bloque de `header.css` está muerto**, y
borrar sus contrapartidas de `styles.css` se llevaría por delante el layout móvil de la cabecera
y las pestañas. El mismo sesgo afecta a `relics.css` (5 de 8 son solo-`@media`) e `inventory.css`
(1 de 5).

### Convertido en trinquete (sin tocar un píxel)

Reordenar los `<link>` o unificar clases cambia lo que se ve, y eso hay que revisarlo pestaña a
pestaña con la app delante. Lo que sí se puede hacer sin riesgo es **impedir que crezca**, que es
la mitad del problema. `tests/architecture.test.mjs` tiene dos reglas nuevas:

- **`cssBeforeBase`** congela los 7 componentes que hoy cargan antes de `styles.css`. Uno nuevo
  ahí pone el test en rojo con el motivo: sus reglas dependerían de que nadie repita el selector
  en la hoja grande.
- **`cssClassClashes`** congela los **140 pares** (componente, clase) que hoy se definen a la vez
  en un componente y en `styles.css` **fuera de `@media`**. Una clase nueva que choque no entra.

El conteo excluye a propósito lo que solo existe dentro de `@media`: son overrides responsive y
no compiten en la misma cascada. Sin esa distinción el número sale muy inflado y manda a "limpiar"
el layout móvil (de las 19 clases de `header.css`, 15 son de esas).

Los 140 por fichero: `riven-module` 47, `sets` 16, `modals` 14, `relics` 12, `riven-grader` 12,
`header` 9, `inventory` 9, `orders` 7, `vosfor` 5, `scanner` 4, `lich-weapons` 3, `riven-scanner`
1, `ui-kit` 1.

### Reglas ordenadas por jerarquía dentro de cada sección

Las 13 hojas de `css/components/` están reordenadas: dentro de cada sección, primero las reglas
de nivel 1 (incluidas las variantes `.foo.roja`), luego las de nivel 2, luego las de nivel 3.

**Reordenar CSS cambia la cascada**, así que no se hizo a ojo. La garantía es que para una
propiedad dada solo participan en la cascada las reglas que la DECLARAN: si dos reglas no
comparten ninguna propiedad, su orden relativo no puede cambiar el valor calculado de nada. Eso
se impuso por construcción —cada par que comparte propiedad es una restricción "A antes que B" y
el orden nuevo sale de un orden topológico que las respeta— y se verificó después de escribir,
comparando con las copias originales: mismo conjunto de reglas, mismas declaraciones, y **ningún
par que comparta propiedad cambió de orden**.

Se movieron 77 reglas de unas 1.000, y el número es bajo por tres motivos, los tres a propósito:
los comentarios de sección del autor son anclas (nada los cruza, así que su organización se
respeta), el interior de los `@media` no se toca, y cualquier par que comparta una propiedad se
queda como estaba.

Lo que sigue pendiente, y necesita ojos:

1. Mover los `<link>` para que **todos** los componentes carguen después de `styles.css`, y así
   el ganador sea siempre el mismo y no dependa del orden del HTML.
2. Solo entonces, y clase a clase, unificar las 47 de `riven-module.css` comprobando qué
   propiedades y qué descendientes sobreviven en cada caso.

`styles.css` sigue con 8093 líneas. Candidato claro a salir a componente: la pestaña **Ducados**
(`.ducat-*` para filtros, `.duc-*` para la lista, ~62 líneas), que no está en ningún otro sitio.

## 9. Ficheros de más en `deploy/`

`deploy/` se copia entero a `dist/` en CI ([`build-dist.mjs`](scripts-actu/build-dist.mjs)) y de
ahí a Cloudflare, así que **todo lo trackeado se publica**.

Borrados (2,7 MB, cero referencias en todo el repo):

- `assets/ml.bak/` — copia de seguridad del bundle de ML (2,5 MB).
- `assets/json/database_reliquias.json` (164 K) — la app pide las reliquias al worker
  (`type=relics_opt`); este fichero no lo lee nadie.
- `assets/json/warframe_prime_clean.json` (36 K).

Movido también **`kubrows-from-eelog.json`** (12 K) a `data/` en la raíz: sí se usa, pero desde
`ee-log-to-inventory.js`, un script de Node — es la SALIDA de ese script, no un dato que pida el
navegador. Actualizada su ruta por defecto.

**Lo que NO se tocó, y por qué:** las ~700 imágenes de `assets/relic_contents/` salen como
"huérfanas" en cualquier búsqueda de texto porque `getItemIcon()` construye la ruta desde el
nombre del ítem (`assets/relic_contents/${prefijo}${slug}.webp`). Borrar por ese criterio se
lleva por delante iconos vivos. Lo mismo vale para `assets/dmg/`, que arma
`Dmg${Tipo}Small64.webp`.
