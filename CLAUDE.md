# VoidStonks — guía para trabajar en este repo

## Lo que hay que saber antes de tocar nada

- **`deploy/` es a la vez el código fuente Y lo que se publica.** Cloudflare Pages sirve
  la carpeta tal cual; no hay paso de build en local. Un error en `deploy/` va directo a
  producción. La minificación (que quita los comentarios) ocurre solo en CI vía
  `scripts-actu/build-dist.mjs`, así que **los comentarios de `deploy/` no cuestan bytes en prod**.
- **Antes de dar algo por terminado: `npm test`.** Son ~1640 tests y tardan ~65s.
- **`npm run lint`** (ESLint ya instalado). El objetivo es **0 errores**; los warnings
  restantes son casi todos `no-unused-vars` heredados.
- **Dónde va cada cosa y qué puede importar qué: [`ARCHITECTURE.md`](ARCHITECTURE.md).**
  En corto: la carpeta de primer nivel es la **capa** (`services/`, `repositories/`,
  `ui.components/`, `utils/`) y la de segundo el **dominio** (`rivens/`, `market/`, `inventory/`,
  `farms/`, `vision/`…). Solo hay subcarpeta a partir de 4 ficheros; lo transversal se queda en
  la raíz de su capa.
  Casi todas esas reglas las comprueba `tests/architecture.test.mjs`, así que romperlas pone
  `npm test` en rojo con el nombre de la regla. Lo que ya estaba mal el día que se escribieron
  está congelado en `tests/_baseline/architecture-debt.json` e inventariado en
  [`DEUDA.md`](DEUDA.md): no puede crecer, y al arreglar algo hay que borrarlo del baseline.
- El usuario hace sus propios commits. No hagas `git add` / `commit` / `push`.

## Tests: qué se exige a un test

El objetivo no es tener tests, es que **un cambio de comportamiento salga en rojo**. Un test que
solo comprueba que una función existe o que no lanza deja pasar exactamente el bug que iba a
detectar, y encima cuenta como cobertura.

**Objetivos** (medir con `node --test --experimental-test-coverage`):

- **≥ 70% de cobertura de ramas** en `deploy/js`. La rama es lo que importa: el `if` que nadie
  recorre es donde vive el bug, y el porcentaje de líneas lo esconde.
- **100% de métodos**: toda función exportada tiene al menos un test que la llama de verdad.

**Punto de partida (2026-08-25):** de los 159 `.js` de `deploy/js`, 107 los carga algún test y en
esos la cobertura media de ramas es del 86%. Los otros 52 no los importa nadie y **ni siquiera
aparecen en el informe** — contarlos como 0 deja el conjunto en **~58% de ramas y ~53% de
métodos**. Lo que falta es casi todo `ui.components/` y los puntos de entrada de `scanner/`.
Del cómputo se excluyen `tesseract*.js` (vendorizado) y `assets/*.js` (datos, no lógica).

**Qué cuenta y qué no:**

- Cuenta: importar el módulo real, llamar a la función y comparar el resultado con un valor
  escrito a mano — `assert.equal(calculateRealPotential(POPULAR), 5.8)`. Cada rama, su caso.
- No cuenta: `doesNotThrow` como única aserción, `ok()` sobre la existencia de algo, ni leer el
  fuente con `readFileSync` y buscar una cadena con regex. Lo último solo se admite cuando montar
  el entorno cuesta más que lo que protege (`worker-code.js`, el orden de arranque de las
  pestañas) y va justificado en la cabecera del fichero, como en `tests/tab-boot.test.mjs`.

**Al editar código:**

1. Si cambias el comportamiento a propósito, el test se actualiza **en el mismo cambio**, y su
   diff es lo que documenta qué cambió.
2. Si un test se pone en rojo y no tocaste ese test, **es una regresión**: se arregla el código.
   Bajar una aserción, ampliar un margen o meter la infracción en
   `tests/_baseline/architecture-debt.json` para que pase es tapar el síntoma — y es justo el
   caso en el que la suite estaba haciendo su trabajo.
3. Función nueva o rama nueva → caso nuevo en el mismo cambio. Un `if` sin test no está
   terminado.
4. Si un cambio pequeño obliga a tocar muchos tests, el problema suele ser que los tests fijan
   la implementación en vez del resultado. Arregla el test, no lo repitas quince veces.

## Comentarios: convención

El repo ya tiene buena documentación en las zonas difíciles (visión, OCR, worker). La regla
es **explicar el porqué, no el qué**.

**Escribe un comentario cuando:**

- La decisión no se deduce del código y alguien la desharía por error. Este es el caso más
  importante — el patrón a imitar:
  ```js
  // wait=true a propósito: con ctx.waitUntil el contador se lee antes de escribirse
  // y varias peticiones en paralelo se saltarían el límite.
  ```
- Hay un caso real detrás. Cita el síntoma, que es lo que permite verificarlo:
  ```js
  // "LIMBO" contiene "LIMB" y la penalización por substring mataba
  // "Limbo Prime Blueprint" (-0.8) siempre.
  ```
- Una línea parece inútil y no lo es (`void box.offsetHeight` para forzar reflow).
- Un número mágico sale de una medición o de una regla del juego.

**No escribas:**

- Paráfrasis del código (`// incrementa el contador`).
- `//TODO FIX LINT` y demás marcadores sin contenido: o se arregla, o se explica qué falta
  y por qué no se hizo. Un TODO sin acción concreta es ruido que sobrevive años.
- Código comentado. Para eso está git.
- Comentario en cada función solo por tenerlo. Una firma clara ya se explica sola; el
  comentario va **en la línea concreta** que no se deduce, no encabezando todo el bloque.
- JSDoc que repita los tipos que ya se ven (`@param {string} name  el nombre`). Documenta
  el parámetro solo si su valor tiene una restricción o un efecto que no se ve en la firma.

**Densidad:** menos comentarios y mejor colocados. Si al releer el diff un comentario no
cambia lo que haría quien lo lea, sobra.

**Por defecto, ninguno.** El comentario es la excepción y hay que justificarla con uno de
los casos de arriba: es el criterio explícito del dueño del repo, no una preferencia de
estilo. Aplica también a las explicaciones largas de cabecera — un bloque de 15 líneas para
justificar un endpoint se queda en 5 con lo que de verdad no se deduce del código.

**Idioma:** español para las explicaciones nuevas (es lo mayoritario). No traduzcas los
comentarios en inglés que ya existen: no aporta y ensucia el diff.

**Textos de UI:** siempre bilingües (EN + ES vía `state.currentLang`), nunca hardcodeados
en un idioma.

## Trampas concretas de este repo

### Ciclos de imports (rompe la app entera)

`deploy/js/ui.js` ejecuta `updateUILabels()` **a nivel de módulo**, y esa función llama a
`renderInventory()` / `renderPrimeInventory()`. Como `ui.js` ya importa `ui_inventory.js` y
`ui_sets.js`, **añadir el import inverso rompe la carga**: el módulo queda a medio evaluar
y sus `let` explotan con `Cannot access 'X' before initialization`.

- Desde `ui_inventory.js` / `ui_sets.js`, usa `globalThis.switchTab(...)` — nunca `import`.
- `main.js` sí puede importar de quien quiera: es raíz y nadie lo importa.
- Declara el global en `eslint.config.mjs` para que `no-undef` no lo marque.

`tests/import-graph.test.mjs` detecta estos ciclos, pero solo falla ante los peligrosos
(los que incluyen un módulo con ejecución top-level). Ni el lint ni `node --check` los ven:
solo se manifiestan al recargar el navegador.

### XSS: datos que no controla el código

Todo lo que venga de la API (warframe.market, worldstate), del OCR o del usuario y acabe en
`innerHTML` va con `escapeHTML(...)`.

Hoy el OCR no es explotable porque resuelve contra catálogos cerrados
(`getValidItemMatch`, `parseRelicSelection`, `_matchStatAnchored` devuelven un nombre
canónico o `null`), pero el escape se pone igual: si mañana un catálogo cambia de origen,
la defensa ya está puesta.

`showToast(msg)` **escapa por defecto**. Los avisos que montan markup (`<b>`, `<br>`) pasan
`html: true` y son responsables de escapar cada dato que interpolan. `tests/xss-escaping.test.mjs`
lo verifica.

### Logs de consola

Los ~95 `console.log` **no se borran**: `deploy/js/utils/debug_log.js` los silencia en
producción (`console.error` siempre sobrevive). Para depurar sin tocar código:

```js
localStorage.setItem("vs_debug_logs", "1")   // y recarga
```

Excepción: `js/scanner/live_calibration.js` se carga como `<script>` plano **antes** que el
módulo, así que sus logs escapan al silenciador.

### Publicar en globalThis: usa el registro

`index.html` tiene ~118 handlers inline (`onclick="foo()"`) que el navegador resuelve contra
`globalThis`. Por eso hay ~96 asignaciones `globalThis.X = ...`: no es descuido, es el único
mecanismo posible sin reescribir el HTML a `addEventListener`.

Para publicar algo nuevo, usa el registro en vez de asignar a pelo:

```js
import { exposeGlobals } from "../utils/global_registry.js";
exposeGlobals({ closeScanner, captureRelics }, "utils/scanner.js");
```

Gana sobre `globalThis.foo = foo`: avisa si dos módulos publican el mismo nombre (antes el
segundo pisaba al primero en silencio) y deja el listado inspeccionable en la consola con
`__vsRegistry.list()` / `__vsRegistry.ownerOf("foo")`.

`tests/global-registry.test.mjs` cruza lo que el HTML invoca contra lo que el JS publica y
falla si un botón se queda sin función. Este fallo no lo detectan ni el lint ni la carga de
la página: solo aparece al pulsar. Ya pasó dos veces (`resetVisionSettings` era un botón sin
implementación; `closeOrokinConfirm` estaba exportada pero sin publicar, así que "Cancelar"
no cerraba el modal).

Las asignaciones sueltas que quedan son las anteriores al registro: migra la que toques, sin
hacer una pasada masiva.

### Scripts planos vs módulos

`live_calibration.js` se carga con `<script>` normal, no como módulo: no puede usar
`import`. Lo que necesite debe estar publicado en `globalThis` (p. ej. `ui_components.js`
expone `showToast` ahí justo por esto).

### Dónde vive el CSS

No hay una regla única y es fácil equivocarse de archivo:

- `deploy/styles.css` — hoja monolítica (~6.7k líneas) con casi todo, incluida la pestaña
  **Ducados** (`.ducat-*` para los filtros, `.duc-*` para la lista).
- `deploy/css/components/*.css` — solo lo que se extrajo después (`orders.css`, `vosfor.css`,
  `relics.css`, `sets.css`, `scanner.css`, `riven-*.css`, `header.css`, `modals.css`,
  `inventory.css`).

Antes de añadir estilos, `grep` de la clase: si el bloque ya está en `styles.css`, amplíalo
ahí en vez de abrir un componente nuevo a medias.

**Los `.css` de componentes no están aislados.** Todos se cargan en la misma cascada y
`index.html` los mete **después** de `styles.css` en varios casos (`orders.css`,
`riven-*.css`, `vosfor.css`, `lich-weapons.css`, `ui-kit.css`). Un selector desnudo con un
nombre genérico se aplica a toda la app, y al ir después gana a igualdad de especificidad.
Ya pasó: `orders.css` definía `.inv-row` / `.inv-name` / `.inv-meta`, que también son las
filas del panel lateral de reliquias, y les imponía nombres cortados con ellipsis y meta en
gris.

Al añadir estilos a un componente, **ancla la regla al contenedor de su pestaña**
(`#orders-content .inv-row`) salvo que el nombre sea claramente exclusivo. Antes de crear
una clase, `grep` del nombre: si ya existe en otro archivo, o la reutilizas de verdad o
eliges otro nombre.

**Cuidado con encadenar `em`.** Los tamaños se multiplican por anidamiento y es fácil bajar
de lo legible sin darse cuenta: `.inv-meta` (0.7em) → `.ratio-tag` (0.85em) → `.ratio-unit`
(0.6em) dejaba el sufijo en **5.7px**. Si un bloque ya reduce el tamaño, sus hijos usan
`1em` o `rem`, no otro `0.x em`.

Iconos de moneda: `.plat-icon-inline` y `.ducat-icon-inline` (definidos al principio de
`styles.css`, disponibles en toda la app) en lugar de escribir "p" o "d" a mano. Se dimensionan
en `em`, así que heredan el tamaño del contexto.

### Órdenes de warframe.market

`ui_orders.js` es el único módulo que pinta **datos de una API autenticada**, y lo hace todo
con `createElement`/`textContent` — nunca `innerHTML`. Mantén esa vía al añadir nada: es la
razón de que el helper `plat(value, className)` devuelva nodos en vez de una cadena.

La vista es una máquina de estados (`VIEW` + `RENDERERS`); una pantalla nueva es un render
más en el mapa, sin tocar los existentes.

Los chips de filtro salen de `FILTER_TESTS`: el mismo predicado filtra la lista y calcula el
contador del chip, para que no puedan discrepar. Un chip se oculta al quedarse en 0, así que
`filters.type` (que persiste entre recargas) cae a `"all"` si su filtro se vacía — sin eso la
lista quedaba vacía y sin ningún chip activo tras ocultar la última orden.

El worker ya acepta `visible` en la allowlist del PATCH (`wfm_order_edit`), igual que
`platinum`, `quantity`, `perTrade`, `rank` y `subtype`: para exponer uno de esos campos en la
UI no hace falta tocar `worker-code.js`.
