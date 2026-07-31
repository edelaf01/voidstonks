# Guía de Mantenimiento: Recomendador de Fisuras por Sets

Bloque "Fisuras para tus sets" en el panel lateral de Inventario, pestaña **PRIME INVENTORY** (`#prime-inv-controls`, dentro de `#inventory-container`): cruza las fisuras activas ahora mismo con los sets Prime incompletos del inventario del usuario, para indicar qué fisura correr y qué pieza consigue, con runs esperados y comparativa de precio (farmear vs comprar suelta).

Historial de ubicación: vivió primero en el panel lateral de Fisuras, luego se movió a la pestaña "Set" del menú superior (`#mode-set`, el buscador de sets) y finalmente aquí, al panel de Inventario — es donde el usuario realmente mira sus sets incompletos y sus piezas Prime.

## Arquitectura

- **`deploy/js/services/set_recommendations.service.js`**: lógica pura, sin DOM.
  - `getFissureSetRecommendations(activeFissures)`: agrupa las fisuras activas por tier (normalizando `Vanguard` → `Axi`, ya que Railjack no tiene reliquia clásica propia). Para cada set en `state.setsDatabase` con piezas faltantes (`state.primeInventory[parte] <= 0`), busca en `state.itemsDatabase[parte]` qué reliquias la sueltan y si el tier de esas reliquias coincide con alguna fisura activa. Cada pieza faltante lleva `avgRuns` (runs esperados con reliquia radiante, squad de 4, vía `calculatePartExpectedRuns`). Devuelve los sets ordenados por menos piezas restantes primero, y dentro de eso por más fisuras disponibles.
  - `attachSetPrices(recommendations)`: añade `setPricePlat` (precio del set completo) y, por cada pieza faltante, `buyPricePlat` (precio de la pieza suelta) y `betterToBuy` — true cuando `buyPricePlat / setPricePlat <= BUY_INSTEAD_RATIO` (15% por defecto): la pieza suelta es tan barata frente al set que sale más a cuenta comprarla que farmear. Todo vía `getPriceValue` (mismo caché IndexedDB/memoria que usa el resto de la app).
  - `getSetRecsPrefs`/`saveSetRecsPrefs`/`filterSetRecommendations`: preferencias de filtro (`maxMissing`, `buyOnly`) persistidas en `localStorage` bajo `vs_fissure_set_recs_prefs`, mismo patrón que `getFissurePrefs`/`saveFissurePrefs` de `fissures.service.js`.
- **`deploy/js/utils/relic_drop_odds.utils.js`**: `getPartRarity`, `calculatePartExpectedRuns`, `DROP_RATES_BY_RARITY`. Extraído de `ui_sets.js` a un módulo hoja para romper un ciclo de import: `ui_sets.js` necesita el servicio de recomendaciones (para pintar el bloque) y el servicio necesita `calculatePartExpectedRuns` — si ese cálculo siguiera viviendo en `ui_sets.js`, ambos módulos se importarían mutuamente. `ui_sets.js` reexporta `getPartRarity`/`calculatePartExpectedRuns` para no romper a quien ya los importaba de ahí.
- **`deploy/js/ui.components/ui_sets.js`**: `renderFissureSetRecommendations()` pinta el bloque colapsable dentro de `#fissure-set-recs` (contenedor estático en `index.html`, dentro de `#prime-inv-controls`, antes de la lista de partes Prime). El guard interno `_setRecsLoaded` evita recalcular precios/fisuras en cada render — se ejecuta una vez por sesión de página y luego solo re-lee `_lastSetRecs` en memoria; el dato tampoco queda muy stale porque `fetchAllFissures` cachea 2 min por su cuenta.
  - Se invoca desde `deploy/js/ui.components/ui_inventory.js` → `renderPrimeInventory()`, que corre cada vez que el panel de Inventario se abre en la vista "PRIME INVENTORY" (`switchInvView('parts')`) y cada vez que cambia el inventario/búsqueda/orden en esa vista. No aparece en la vista "RELICS" del mismo panel ni en la pestaña "Set" del menú superior (el buscador de sets), que es un buscador distinto.
  - Limitado a `MAX_SET_RECS = 12` sets (con precios calculados para todos ellos) para que el filtro "solo comprar" tenga universo suficiente donde buscar; solo se renderizan visualmente los que pasan `filterSetRecommendations`.
  - `_lastSetRecs` guarda el último lote con precios ya resuelto; los `<select>`/checkbox de filtro (`renderSetRecFilters`) solo re-filtran ese array local y repintan `#fissure-set-recs-cards` — no vuelven a llamar a `getPriceValue` ni a recalcular fisuras.
  - `renderSetRecGuide()` pinta un `<details>` colapsable ("¿Cómo funciona esto?") con la explicación en lenguaje llano de qué hace el bloque, arriba de los filtros.
- Textos en `TEXTS[lang].fissureSetRecs` (`deploy/js/config.js`), incluida la guía (`guideTitle`/`guideText`).
- Estilos en `deploy/styles.css`, bloque `.fissure-set-recs*` / `.set-rec-*`.

## Comportamiento en carga

Si `state.setsDatabase`/`state.itemsDatabase` aún no están poblados (antes de que `downloadRelics()` termine), la función devuelve sin pintar nada y el bloque queda oculto (`display:none`) sin marcar `_setRecsLoaded` — a diferencia de un guard prematuro, esto es intencional: como `renderPrimeInventory()` se vuelve a llamar cada vez que el usuario interactúa con esa vista (búsqueda, orden, cambio de inventario), el siguiente intento sí encuentra los datos ya cargados y pinta el bloque, sin necesidad de recargar la página.

## Limitaciones conocidas

- No se refresca solo tras el primer render exitoso (guard `_setRecsLoaded`) — si escaneas piezas nuevas después de que el bloque ya se pintó una vez, no se recalcula hasta recargar la página.
- No distingue radiante/intacta/etc. para saber qué fisuras mostrar como fuente: cualquier reliquia del tier correcto cuenta, independientemente de la refinación. `avgRuns` sí asume radiante+squad 4 (el caso más eficiente) como referencia.
- No pondera por drop chance ni por rareza de la pieza (común/poco común/raro) al elegir qué fisuras mostrar: solo mira si la fisura activa *puede* soltarla.
- `betterToBuy` es una heurística de umbral fijo (15% del precio del set), no un cálculo de valor del tiempo de farmeo — no sabe cuánto vale una hora de tu tiempo, solo compara precios de mercado.
- El filtro "solo comprar" oculta piezas de un set (no el set completo) si ninguna de sus piezas faltantes tiene `betterToBuy`; si un set tiene 3 piezas faltantes y solo 1 es barata, se muestra ese set con solo esa pieza.
