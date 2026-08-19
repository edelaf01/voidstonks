# Arquitectura de VoidStonks — reglas

Este documento fija **dónde va cada cosa y qué puede importar qué**. `CLAUDE.md` sigue siendo
la guía de trabajo (comentarios, trampas concretas, XSS, CSS); esto es el contrato estructural.

Casi todo lo de aquí lo comprueba [`tests/architecture.test.mjs`](tests/architecture.test.mjs).
Si rompes una regla, `npm test` te dice cuál y qué hacer. Las infracciones que ya existían
están congeladas en [`tests/_baseline/architecture-debt.json`](tests/_baseline/architecture-debt.json)
(regenerable con `npm run baseline:arquitectura`) y listadas con plan de ataque en
[`DEUDA.md`](DEUDA.md).

Los detectores viven en [`tests/_helpers/architecture-rules.mjs`](tests/_helpers/architecture-rules.mjs)
y tienen su propio test: relajar una regex de ahí pondría verde media deuda de golpe, y ese es
el diff más barato de colar.

---

## A. Capas: quién puede importar a quién

```
  app          ui.js, main.js            ← orquestan el arranque y las pestañas
  scanner      scanner/*                 ← orquesta OCR (además, scripts planos)
  ui           ui.components/*           ← DOM: render + handlers
  services     services/*                ← lógica de negocio, sin DOM
  repositories repositories/*            ← I/O crudo: fetch, localStorage, workers OCR
  utils        utils/*                   ← funciones puras y reutilizables
  core         config.js, state.js
  store        store/*, assets/*
```

Cada capa importa **hacia abajo**, nunca hacia arriba:

| Capa | Puede importar de | Nunca de |
|---|---|---|
| `store/`, `assets/` | nada | todo |
| `config.js`, `state.js` | `store/`, `utils/` | el resto |
| `utils/` | `core`, `store`, otros `utils/` | `repositories/`, `services/`, `ui.components/` |
| `repositories/` | `core`, `utils/`, otros `repositories/` | `services/`, `ui.components/` |
| `services/` | `core`, `utils/`, `repositories/`, otros `services/` | `ui.components/`, `ui.js` |
| `ui.components/` | `core`, `utils/`, `services/`, otros `ui.components/` | `repositories/` (pasa por un service), `ui.js` |
| `scanner/`, `ui.js`, `main.js` | todo | — |

Dos reglas derivadas, que son las que de verdad se incumplen:

- **Un `ui.component` no hace `fetch()` ni toca `localStorage`.** Eso vive en `repositories/`
  (que ya tiene timeout, caché y manejo de errores) y lo orquesta un `service`. El componente
  que se hace su propio fetch se salta todo eso y reintroduce bugs ya arreglados en otra pestaña.
- **Un `service` no toca el DOM ni pinta toasts.** Devuelve datos; qué se enseña lo decide el
  componente. Es lo que permite testear la lógica sin navegador.

Excepción documentada: `ui.js` ejecuta código al importarse, así que **desde `ui.components/`
se llama a `globalThis.switchTab(...)`, nunca con `import`** (ver `CLAUDE.md`, sección de ciclos;
lo vigila `tests/import-graph.test.mjs`).

`import()` dinámico es la vía legítima para romper un ciclo (`rivens.service` ↔
`riven_market.service` la usan a propósito), **pero no exime de la tabla de arriba**: se mide
en una lista aparte y con el mismo criterio. Sin eso, cualquier import prohibido se "arregla"
convirtiéndolo en dinámico — test verde, acoplamiento intacto.

Hubo una tercera vía y ya no existe: `api.js` era una fachada que reexportaba símbolos de
`repositories/`, así que un componente llegaba al repositorio pasando por ella sin que saltara
nada. Se terminó la migración y se borró; el test `api.js no amplía lo que reexporta` sigue ahí
como guardia por si vuelve. El detalle, en [`DEUDA.md`](DEUDA.md) §7.

## B. Compartimentación: un módulo, una cosa

### Dentro de cada capa, subcarpeta por dominio

La capa dice **qué tipo de cosa** es un módulo; la subcarpeta, **de qué va**. Las capas siguen
siendo el primer segmento de la ruta —de ahí las lee `layerOf()`, así que el contrato de arriba
no cambia— y por debajo se agrupa por dominio:

```
services/      farms/ inventory/ market/ rivens/ scanner/   + 5 en la raíz
ui.components/ farms/ inventory/ market/ rivens/            + 12 en la raíz
utils/         inventory/ rivens/ vision/                   + 14 en la raíz
```

**Subcarpeta a partir de 4 ficheros.** Con menos estorba más de lo que ordena: una carpeta con
dos módulos obliga a abrirla para saber qué hay. Lo que no llega a cuatro se queda en la raíz de
su capa, y ahí también van los módulos **transversales** — los que no son de ningún dominio
(`ui_components.js`, `global_registry.js`, `escape_html.js`, `tap.js`).

Al mover un módulo a una subcarpeta hay dos cosas que se rompen en silencio y no las ve el lint:
los `readFileSync` de los tests que leen su fuente por ruta, y la etiqueta de propietario de
`exposeGlobals(...)`. Lo primero lo caza `npm test`; lo segundo no lo caza nada, así que se
actualiza a mano.

- Un fichero de `ui.components/` = **una pestaña o un widget**: su render, sus handlers y su
  estado local. Nada más.
- **Límite de 800 líneas.** Al pasarlo se parte por secciones (`ui_rivens_index.js`,
  `ui_rivens_grader.js`, …) y queda un módulo delgado que compone. Los ficheros que ya estaban
  por encima pueden encoger, nunca crecer — el test lo vigila fichero a fichero.
- **`assets/` está exento del límite**: son tablas de datos sin dependencias (traducciones,
  changelog, imágenes en base64). El límite existe porque un módulo de lógica enorme son varias
  pantallas mezcladas que hay que leer enteras; una tabla se lee por la clave que buscas. La
  exención vale **solo** para `assets/` — si no, mover un módulo ahí sería la forma de saltarse
  la regla. Y si algo de `assets/` tiene lógica, deja de ser un asset.
- **La lógica pura no vive en el componente.** Cálculo, parsing y matching bajan a `utils/` o
  `services/`: es lo único que se puede testear sin DOM, y es donde se reutiliza.
- Una **clase por fichero**, el fichero se llama como la clase (`MobileScanner` →
  `mobile_scanner.js`), y sus dependencias entran **por el constructor**, no se leen de
  `globalThis` dentro de los métodos. Así la clase se puede instanciar en un test con dobles.
- Sufijos que indican la capa: `*.service.js`, `*.repository.js`, `*.utils.js`, `ui_*.js`.

## C. Reutilización: buscar antes de escribir

**Ningún nombre exportado puede definirse en dos módulos.** Si dos sitios necesitan lo mismo,
uno importa del otro. No es un capricho de estilo: `calculateHybridTiers` existe hoy en
`services/rivens.service.js` y en `utils/riven_logic.js` con firmas distintas, y la del service
está muerta — quien la abre cree estar leyendo la que corre.

Cómo buscar antes de crear algo:

```bash
grep -rn "export function loQueBusco" deploy/js
```

o, mejor, el MCP del grafo de código, que encuentra por concepto lo que el grep no ve:

```
search_graph(query="precio medio de un riven")       # BM25 sobre nombres troceados
search_graph(semantic_query=["publish","send"])      # cruza vocabulario
trace_path(function_name="getSlug", mode="calls")    # quién lo llama ya
```

Helpers canónicos que **no se re-implementan**:

| Para | Usa | En |
|---|---|---|
| Escapar HTML | `escapeHTML` | `utils/escape_html.js` |
| Avisos | `showToast` | `ui.components/ui_components.js` |
| Slug de warframe.market | `getSlug`, `getRivenSlug` | `utils/slugs.utils.js` |
| Petición con timeout | `fetchWithTimeout` | `repositories/api.repository.js` |
| Click que funciona en táctil | `onTap` | `utils/tap.js` |
| Publicar en `globalThis` | `exposeGlobals` | `utils/global_registry.js` |
| Iconos de platino / ducados | `.plat-icon-inline`, `.ducat-icon-inline` | `styles.css` |
| Hora del servidor | `serverNow`, `syncServerClock` | `services/server_clock.service.js` |

## D. Globals

`index.html` resuelve ~104 handlers inline (`onclick="foo()"`) contra `globalThis`. Todo lo
nuevo se publica **por el registro**, nunca a pelo:

```js
import { exposeGlobals } from "../utils/global_registry.js";
exposeGlobals({ closeScanner, captureRelics }, "scanner/scanner_controller.js");
```

El registro avisa si dos módulos publican el mismo nombre (antes el segundo pisaba al primero
en silencio) y deja el listado inspeccionable con `__vsRegistry.list()`. Las asignaciones
sueltas que quedan se migran **al tocar su módulo**, no en una pasada masiva; el test solo
impide que crezcan.

**No todo lo que hay en `globalThis` es candidato al registro.** De las ~93 asignaciones, unas
23 son **estado compartido**, no funciones: `_serverTimeOffset` (que vive ahí a propósito para
que `fissures.service` y `server_clock.service` no se importen entre sí y formen un ciclo),
`MEMORY_CACHE`, `_kubrowHelperCvs`. La convención es el guion bajo delante. El registro es para
funciones que el HTML invoca; ese estado no va ahí. Sigue contando para el trinquete —cada uno
es un acoplamiento invisible— pero su arreglo es otro: pasarlo por parámetro o por un store.

## E. Tests

**Un módulo nuevo en `services/`, `utils/` o `repositories/` entra con su test.** Los de
`ui.components/` están exentos (pintan DOM), pero la lógica que se les extraiga no.

- Nombre: `tests/<modulo-en-kebab>.test.mjs`.
- `node:test` + `node:assert/strict`, **sin dependencias externas**. Las fixtures van en
  `tests/_fixtures/`, los dobles y utilidades en `tests/_helpers/`.
- El patrón a imitar es [`tests/import-graph.test.mjs`](tests/import-graph.test.mjs): cada
  bloque lleva arriba **el síntoma real** que lo justifica, no una descripción de lo que hace.
- Nombres de test en español y en forma de afirmación
  (`"bounties se piden con versión para no golpear la caché vieja"`).

**Un import roto no lo ve nadie salvo el navegador.** El lint no resuelve módulos, `node --check`
solo mira sintaxis y los `ui.components/` están exentos de test, así que un
`import { X } from "./y.js"` donde `y.js` ya no exporta `X` **tumba la página entera** con un
`Uncaught SyntaxError` que solo aparece al recargar. Lo vigila
[`tests/import-resolve.test.mjs`](tests/import-resolve.test.mjs), que resuelve cada import con
nombre —estático **y dinámico**— contra los exports reales del destino. El dinámico es el peor de
los dos: no da SyntaxError, el destructuring devuelve `undefined` y la llamada revienta cuando el
usuario pulsa el botón.

Un test que lea un fichero **que no está en el repo** (`worker-code.js`, el cache de ML) lo pide
con `optionalSource(...)` de [`tests/_helpers/optional-source.mjs`](tests/_helpers/optional-source.mjs)
y usa el `test` que devuelve. Si el fichero falta, esos casos salen en *skip* con el motivo
escrito; sin eso, un `readFileSync` en top-level tumba el fichero entero al importarlo y quien
clone el repo se encuentra la suite en rojo sin saber por qué.

Antes de dar algo por terminado: `npm test` (~640 tests, ~60 s) y `npm run lint` (0 errores).

## F. Lo que ya estaba y sigue vigente

Recogido aquí para tener las reglas en un solo sitio; el detalle y el porqué están en `CLAUDE.md`:

- **Textos de UI siempre bilingües** (EN + ES vía `state.currentLang`), nunca hardcodeados.
- **XSS**: todo dato de API, OCR o del usuario que acabe en `innerHTML` va con `escapeHTML(...)`.
  `showToast` escapa por defecto; con `html: true` escapas tú cada interpolación.
- **Comentarios**: explican el porqué, con el síntoma real cuando lo hay. Nada de paráfrasis del
  código, ni TODOs sin acción, ni código comentado.
- **CSS**: antes de añadir una clase, `grep` del nombre. Las reglas de `css/components/*.css` se
  anclan al contenedor de su pestaña (`#orders-content .inv-row`) porque todas comparten cascada
  y las que se cargan después de `styles.css` ganan a igualdad de especificidad. Dos reglas de
  `architecture.test.mjs` lo vigilan: un componente nuevo **no puede cargar antes de
  `styles.css`**, y una clase nueva **no puede definirse a la vez en un componente y en la hoja
  grande** (fuera de `@media`; lo de dentro son overrides responsive y no compite). La deuda
  actual —7 componentes y 140 pares— está congelada, ver [`DEUDA.md`](DEUDA.md) §8.
- **`?v=1.9` en los imports** solo sirve para bustear la caché de Cloudflare Pages: se sube al
  tocar el módulo, no se inventa uno nuevo por gusto.
- `deploy/` es fuente **y** lo publicado: no hay build en local, un error va directo a producción.
  Los comentarios no cuestan bytes (los quita `scripts-actu/build-dist.mjs` en CI).
