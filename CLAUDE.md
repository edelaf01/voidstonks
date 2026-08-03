# VoidStonks — guía para trabajar en este repo

## Lo que hay que saber antes de tocar nada

- **`deploy/` es a la vez el código fuente Y lo que se publica.** Cloudflare Pages sirve
  la carpeta tal cual; no hay paso de build en local. Un error en `deploy/` va directo a
  producción. La minificación (que quita los comentarios) ocurre solo en CI vía
  `scripts-actu/build-dist.mjs`, así que **los comentarios de `deploy/` no cuestan bytes en prod**.
- **Antes de dar algo por terminado: `npm test`.** Son ~340 tests y tardan ~25s.
- **`npm run lint`** (ESLint ya instalado). El objetivo es **0 errores**; los warnings
  restantes son casi todos `no-unused-vars` heredados.
- El usuario hace sus propios commits. No hagas `git add` / `commit` / `push`.

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

`live_calibration.js` y `live_grid_editor.js` se cargan con `<script>` normal, no como
módulos: no pueden usar `import`. Lo que necesiten debe estar publicado en `globalThis`
(p. ej. `ui_components.js` expone `showToast` ahí justo por esto).

### Dónde vive el CSS

No hay una regla única y es fácil equivocarse de archivo:

- `deploy/styles.css` — hoja monolítica (~6.7k líneas) con casi todo, incluida la pestaña
  **Ducados** (`.ducat-*` para los filtros, `.duc-*` para la lista).
- `deploy/css/components/*.css` — solo lo que se extrajo después (`orders.css`, `vosfor.css`,
  `relics.css`, `sets.css`, `scanner.css`, `riven-*.css`, `header.css`, `modals.css`,
  `inventory.css`).

Antes de añadir estilos, `grep` de la clase: si el bloque ya está en `styles.css`, amplíalo
ahí en vez de abrir un componente nuevo a medias.

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
