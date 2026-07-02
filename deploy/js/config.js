export const WORKER_URL = "https://api.voidstonks.com/";
export const APP_VERSION = 2.30;
export const UPDATE_HISTORY_DATA = {
  es: `
<div class="update-block">
  <div class="update-header">
    <span class="update-version">v2.3.0 (Actual)</span>
    <span class="update-date">2026-06-21</span>
  </div>
  <ul class="update-list">
    <li><strong> Nueva función: Escáner de Rivens en vivo</strong>
      <ul>
        <li>Escanea rivens directamente desde la pantalla del juego y obtén su tasación de mercado (precio estimado, rango y nota) al instante.</li>
        <li>En la pantalla de reroll escanea las DOS cartas a la vez (roll nuevo vs anterior) y muestra una comparativa lado a lado.</li>
        <li>Indicador de <strong>deseabilidad por stat</strong> según el meta del arma: TOP / GOOD / MID / WEAK (y BRICK / NEG OK en negativas), independiente del grado del roll (cuánto subió dentro de su rango).</li>
        <li>Cada stat en su propia cápsula con el texto completo.</li>
      </ul>
    </li>
    <li><strong>Fisuras:</strong>
      <ul>
        <li>Refresco automático cada ~2-3 minutos.</li>
        <li>Más estables: ya no se quedan vacías ni se bloquean cuando el servidor tarda, y consumen menos llamadas (caché).</li>
      </ul>
    </li>
    <li><strong>Tasación de Rivens:</strong>
      <ul>
        <li>Corregida la sobrevaloración de armas impopulares / fuera del meta.</li>
        <li>Corregido un fallo que rompía la tasación en algunos casos.</li>
      </ul>
    </li>
    <li><strong>Nuevas armas:</strong>
      <ul>
        <li>Añadidos los kitguns (Catchmoon, Gaze, Rattleguts, Tombfinger, Sporelacer, Vermisplicer) para la valoración de rivens.</li>
        <li>Añadidas Primes nuevas con sus ducados: Afentis Prime, Athodai Prime (y War Prime, Pride, Wrath).</li>
      </ul>
    </li>
    <li><strong>Mejoras de backend:</strong> modelo de precios de rivens más preciso y mejor rendimiento y estabilidad del servidor.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.2.1</span>
    <span class="update-date">2026-06-09</span>
  </div>
  <ul class="update-list">
    <li><strong>Corrección de Errores (Bugfixes):</strong>
      <ul>
        <li>Se solucionó un problema en el escáner de recompensas donde sincronizar automáticamente un recuento de 0 no se actualizaba correctamente.</li>
        <li>Se corrigió la recarga asíncrona de precios en la pestaña de inventario, asegurando que se actualicen sin retrasos ni bloqueos.</li>
      </ul>
    </li>
    <li><strong>Mejoras de Rivens:</strong>
      <ul>
        <li>Se eliminaron los números redundantes en la guía de atributos recomendados de Rivens.</li>
        <li>Se mejoró el contraste y resaltado de los mejores atributos recomendados (BEST) para facilitar su visualización rápida.</li>
        <li>Se optimizó la herencia de datos de mercado y de popularidad de las armas base a sus variantes.</li>
      </ul>
    </li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.2.0</span>
    <span class="update-date">2026-05-31</span>
  </div>
  <ul class="update-list">
    <li><strong>Mejoras en estimaciones de precios de rivens.</strong></li>
    <li><strong>Mejoras en el escáner:</strong>
      <ul>
        <li>Detección de objetos prime en el inventario; ahora detecta mejor los objetos y sus cantidades.</li>
        <li>Añadido historial de detecciones para aperturas de reliquias.</li>
      </ul>
    </li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.1.0</span>
    <span class="update-date">2026-05-22</span>
  </div>
  <ul class="update-list">
    <li>
      <strong>Rivens (Lógica y Apariencia):</strong> Sección y tasador de Rivens (Riven Appraisal) completamente rediseñados. La interfaz es mucho más dinámica y limpia, y los campos opcionales (+STAT 3 y -Negativa) ahora se crean y destruyen dinámicamente en el DOM sin recargar la página.
    </li>
    <li>
      <strong>Información Completa de Precios:</strong> Se muestran más datos para informarse en detalle sobre los precios actuales. Ahora puedes ver tanto los precios de transacciones reales completadas en el juego (DE Real) como los precios del mercado activo (WFM Web), con iconos visuales de Platinum.
    </li>
    <li>
      <strong>Tasación Inteligente:</strong> A partir de los datos de WFM y DE, el sistema obtiene el precio medio estimado de un Riven "unrolled" (basura/base) y clasifica automáticamente los mejores y peores modificadores (stats) del arma seleccionada. <em>Nota: El precio es una estimación orientativa; puedes vender tus Rivens por más o por menos según la oferta y la demanda.</em>
    </li>
    <li>
      <strong>Escáner de Recompensas (PC):</strong> Mejoras sustanciales en la detección del Live Scanner para PC. El escaneo ahora es casi instantáneo, con una tasa de falsos positivos y de no-detecciones drásticamente reducida.
    </li>
    <li>
      <strong>Pestaña de Sets:</strong> Se ha rediseñado y embellecido la pestaña de conjuntos de reliquias y partes Prime, ofreciendo una experiencia visual mucho más elegante y fluida.
    </li>
    <li>
      <strong>Optimización General:</strong> Limpieza profunda del codebase, reducción de código spaghetti y mejoras menores en el rendimiento de la aplicación.
    </li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.0.0</span>
    <span class="update-date">2026-04-17</span>
  </div>
  <ul class="update-list">
    <li>
      <strong>Escáner de Inventario:</strong> Mejorada la precisión en cantidades y añadidos cuadros de debug rojos.
    </li>
    <li>
      <strong>Escáner de Recompensas:</strong> Restaurada la lógica de detección estable (filtros CSS) para máxima fiabilidad.
    </li>
    <li>
      <strong>Refactorización:</strong> Mejoras en el backend de fisuras y limpieza de código en servicios OCR/Visión.
    </li>
    <li>
      <strong>Interfaz:</strong> El modal de resultados ahora se cierra automáticamente al elegir recompensa.
    </li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.8.5</span>
    <span class="update-date">2026-03-27</span>
  </div>
  <ul class="update-list">
    <li>
      <strong>Escáner y Recompensas:</strong> Mejoras en el escáner de reliquias en vivo y recompensas, ahora escanea mejor.
    </li>
    <li>
      <strong>Optimización:</strong> Mejoras orientadas a la optimización de llamadas API y su gestión.
    </li>
    <li>
      <strong>Interfaz:</strong> Actualización visual de la pestaña de inventario.
    </li>
    <li>
      <strong>Miscelánea:</strong> Nuevas traducciones y correcciones varias.
    </li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.8.0</span>
    <span class="update-date">2026-03-25</span>
  </div>
  <ul class="update-list">
    <li>
      <strong>Mejoras de inventario:</strong> Ahora se puede escanear el inventario prime via el botón de livescan. Comparte la pantalla de Warframe con el app a través de Live Scanner y el app detecta si estás en el inventario; sale un menú desplegable para escanear de forma manual o automática (esta funciona cuando haces scroll manualmente). Tienes que seguir las instrucciones que salen debajo. <em>Nota: esta funcionalidad es experimental de momento y hay casos en las que el reconocimiento de letras no va a ir bien. Si encontráis algún bug agradecería que me lo dejaseis saber a través del enlace <strong>w/Parcialsobriedad</strong> en los foros de warframe junto a la captura que dio error (modo debug), así puedo tener en consideración ese caso para realizar ajustes necesarios.</em>
    </li>
    <li>
      <strong>Calibración muy importante:</strong> Antes os pedirá realizar una calibración. Tendrías que estar en el inventario (pestaña de partes prime) y ordenado alfabéticamente si es posible. Os pedirá la calibración para seleccionar el primer item a la izquierda y el último item a la derecha de la pantalla. Hay un pequeño error llegando al final de la pantalla que tengo pensado arreglar en un futuro para que no haga falta calibración por tu parte.
    </li>
    <li>
      <strong>Nueva funcionalidad y optimización:</strong> Gestión más fluida del inventario junto a importación y exportación de este. Bastante optimizada, por cierto.
    </li>
    <li>
      <strong>Mejoras en reliquias y sets:</strong> Lo hice más intuitivo y bonito. Pista: puedes arrastrar elementos de la reliquia que hayas seleccionado al set tracker y ver desde esta pantalla o en sets cuántos sets o piezas tienes de lo que buscas.
    </li>
    <li>
      <strong>Mejoras visuales UI:</strong> En el set tracker ahora al dar click en una pieza se muestran las reliquias de donde dropea.
    </li>
    <li>
      <strong>Optimizaciones internas:</strong> Enormes optimizaciones (quité bastante código spaghetti) para mejorar la mantenibilidad de la aplicación.
    </li>
    <li>
      <em>Muchas gracias por usar esta app y cualquier sugerencia no dudéis en poneros en contacto conmigo a través de warframe forums. ¡Disfrutad de la actualización <strong>Shadowgrafter</strong>!</em>
    </li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.7.1</span>
    <span class="update-date">2026-02-18</span>
  </div>
  <ul class="update-list">
    <li>
      <strong>English language fixes</strong> Some text was always shown in spanish, now it should be either spanish or english based on the selected language.
    </li>
  </ul>
</div>
`,
  en: `
<div class="update-block">
  <div class="update-header">
    <span class="update-version">v2.3.0 (Current)</span>
    <span class="update-date">2026-06-21</span>
  </div>
  <ul class="update-list">
    <li><strong> New: Live Riven Scanner</strong>
      <ul>
        <li>Scan rivens straight from the in-game screen and get their market appraisal (estimated price, range and grade) instantly.</li>
        <li>On the reroll screen, scan BOTH cards at once (new vs previous roll) and see a side-by-side comparison.</li>
        <li>Per-stat <strong>desirability</strong> indicator based on the weapon's meta: TOP / GOOD / MID / WEAK (plus BRICK / NEG OK for negatives), separate from the roll grade (how high it rolled within its range).</li>
        <li>Each stat shown in its own capsule with the full text.</li>
      </ul>
    </li>
    <li><strong>Void Fissures:</strong>
      <ul>
        <li>Now auto-refresh every ~2-3 minutes.</li>
        <li>More reliable: no longer go blank or freeze when the server is slow, and use fewer API calls (caching).</li>
      </ul>
    </li>
    <li><strong>Riven Appraisal:</strong>
      <ul>
        <li>Fixed overvaluation of unpopular / off-meta weapons.</li>
        <li>Fixed a bug that broke the appraisal in some cases.</li>
      </ul>
    </li>
    <li><strong>New weapons:</strong>
      <ul>
        <li>Added kitguns (Catchmoon, Gaze, Rattleguts, Tombfinger, Sporelacer, Vermisplicer) for riven appraisal.</li>
        <li>Added new Primes with their ducat values: Afentis Prime, Athodai Prime (plus War Prime, Pride, Wrath).</li>
      </ul>
    </li>
    <li><strong>Backend improvements:</strong> more accurate riven pricing model and better server performance and stability.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.2.1</span>
    <span class="update-date">2026-06-09</span>
  </div>
  <ul class="update-list">
    <li><strong>Bugfixes:</strong>
      <ul>
        <li>Fixed an issue in the reward scanner where auto-syncing an owned count of 0 would fail to update correctly.</li>
        <li>Fixed asynchronous price loading in the inventory panel to ensure prices refresh instantly and reliably.</li>
      </ul>
    </li>
    <li><strong>Riven Improvements:</strong>
      <ul>
        <li>Removed redundant weight numbers from the Riven attributes recommendation guide.</li>
        <li>Improved the visual highlighting and contrast of the BEST recommended attributes for quick scanning.</li>
        <li>Optimized market data and popularity inheritance from baseline weapons to their variants.</li>
      </ul>
    </li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.2.0</span>
    <span class="update-date">2026-05-31</span>
  </div>
  <ul class="update-list">
    <li><strong>Improvements in riven pricing estimates.</strong></li>
    <li><strong>Scanner improvements:</strong>
      <ul>
        <li>Detection of prime objects in the inventory; now detects objects and their quantities better.</li>
        <li>Added detection history for relic runs.</li>
      </ul>
    </li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.1.0</span>
    <span class="update-date">2026-05-22</span>
  </div>
  <ul class="update-list">
    <li>
      <strong>Rivens (Logic & Visuals):</strong> Fully redesigned the Riven section and the Riven Appraisal widget. The interface is much more dynamic and clean.
    </li>
    <li>
      <strong>Rich Price Insights:</strong> More detailed data has been added to provide comprehensive insights on current Riven pricing. You can now see completed real transaction data (DE Real) alongside active market listings (WFM Web).
    </li>
    <li>
      <strong>Smart Appraisal:</strong> Based on market data, the app calculates the estimated average price of unrolled/trash Rivens and automatically tags the best and worst stats according to WFM metrics. <em>Note: The suggested price is an estimate; you can buy or sell your Rivens for more or less than this valuation.</em>
    </li>
    <li>
      <strong>Reward Scanner (PC):</strong> Massive improvements to PC  reward   scanner. Recognition is now near-instantaneous with an extremely low false-positive and non-detection rate.
    </li>
    <li>
      <strong>Sets Tab:</strong> redesigned the Sets tab adding a carrousel thingy.
    </li>
    <li>
      <strong>General Optimization:</strong> Cleaned up the codebase, eliminated legacy code, and implemented miscellaneous minor performance enhancements.
    </li>
    <li>
      <strong>As always this is not abandoned im working on it every other day when i can , just had irl scares related to health of family members and full time job, i want to prioritize  mobile functionality in the future so you console tenno can use a reliable overlay on your phone while playing .
    </li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.0.0</span>
    <span class="update-date">2026-04-17</span>
  </div>
  <ul class="update-list">
    <li>
      <strong>Inventory Scanner:</strong> Improved and fixed inventory scanner problems.
    </li>
    <li>
      <strong>Reward Scanner:</strong> Restored stable detection logic. Now it should scan better.
    </li>
    <li>
      <strong>Refactoring:</strong> Improvements to the fissures backend and code cleanup in OCR/Vision services.
    </li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.9.0</span>
    <span class="update-date">2026-03-27</span>
  </div>
  <ul class="update-list">
    <li>
      Improvements live relic scanner, rewards, now it scans betterer.
    </li>
    <li>
      Improvements towards optimization related to api calls and how the program handles it.
    </li>
    <li>
      Visual update towards the inventory tab.
    </li>
    <li>
      New translations and miscellaneous fixes.
    </li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.8.0</span>
    <span class="update-date">2026-03-25</span>
  </div>
  <ul class="update-list">
    <li>
      <strong>Inventory Improvements:</strong> Now you can scan your prime inventory via the LiveScan button. Share your Warframe screen and the app will detect if you are in the inventory, allowing manual or automatic scanning as you scroll.
    </li>
    <li>
      <strong>Important Calibration:</strong> You'll be asked to calibrate (first item top-left, last item bottom-right) in the Prime parts tab. Note: This is experimental; if it fails, please report it to <strong>w/Parcialsobriedad</strong> on the forums with a debug screenshot.
    </li>
    <li>
      <strong>Fluid Management:</strong> Improved inventory management with optimized import/export.
    </li>
    <li>
      <strong>Relics & Sets:</strong> More intuitive and beautiful interface. You can now drag parts from a relic to the Set Tracker to see your progress instantly.
    </li>
    <li>
      <strong>UI Visuals:</strong> In the set tracker, clicking a piece now shows which relics drop it.
    </li>
    <li>
      <strong>Huge Optimizations:</strong> Removed a lot of spaghetti code to improve app maintainability and performance.
    </li>
    <li>
      <em>Thank you for using the app! Suggestions are welcome on the Warframe forums. Enjoy the <strong>Shadowgrafter</strong> update!</em>
    </li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.7.1</span>
    <span class="update-date">2026-02-18</span>
  </div>
  <ul class="update-list">
    <li>
      <strong>English language fixes:</strong> Some text was always shown in spanish, now it correctly translates based on the selected language.
    </li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.7.0 </span>
    <span class="update-date">2026-01-30</span>
  </div>
  <ul class="update-list">
    <li>
      <strong>UI & Visual Overhaul:</strong> A fresh new interface with images everywhere (huge thanks to the WFCD team!) and improved layout for better readability.
    </li>
    <li>
      <strong>Relics & Sets Upgrade:</strong> Added clearer action buttons, a new "Add to Inventory" feature, Ducat values, and statistics (like avg. ducats per relic).
    </li>
    <li>
      <strong>Set Intuition:</strong> Clicking on a Prime component now visually displays your progress toward completing that specific weapon or frame set.
    </li>
    <li>
      <strong>Riven Features:</strong> A cleaner, carousel-based design for variants (try searching "Cernos"!). Added visible Price (PL), Disposition, <strong>crafting recipes, and direct Wiki links.</strong>
    </li>
    <li>
      <strong>New "Prime Inventory":</strong> A dedicated tab to track your loot and access market data. Features "Smart Logic" that understands complex sets (e.g., distinguishing when a set needs 2x of a part).
    </li>
    <li>
      <strong>Performance:</strong> Major backend optimizations and speed improvements for both the app and the scanner.
    </li>
    <li>
      <em><strong>Note:</strong> This update grew massive! Moving forward, I plan to release smaller updates on a weekly basis.</em>
    </li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.4.1</span>
    <span class="update-date">2026-01-20</span>
  </div>
  <ul class="update-list">
    <li>
      <strong>Fixed relic overlay scan:</strong> There was a backend error and it showed debug settings by showing screen its fixed now.
    </li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.4.0 </span>
    <span class="update-date">2026-01-20</span>
  </div>
  <ul class="update-list">
    <li>
      <strong>New Farms Tab:</strong> The Profile section has been removed and replaced with the Farms tab. This tab currently features curated syndicate missions from Open Worlds, including 1999, Zariman, and Cavia.
    </li>
    <li>
      <strong>Tab Roadmap:</strong> Future updates will integrate alerts and additional functionalities into the Farms section to provide a more comprehensive tracking tool.
    </li>
    <li>
      <strong>Code Quality & Optimization:</strong> Significant refactoring to improve general code readability and internal performance optimizations.
    </li>
    <li>
      <strong>Mobile UI Improvements:</strong> Fixed several issues related to the mobile user interface. I apologize for any display errors or difficulty navigating the app on mobile devices during recent days.
    </li>
    <li>
      <strong>Deployment Stability:</strong> Moving forward, a dedicated development server will be implemented for testing updates before they are deployed to the live environment to prevent app instability.
    </li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.3.0 and v1.3.1 </span>
    <span class="update-date">2026-01-18</span>
  </div>
  <ul class="update-list">
    <li>
      <strong>Mobile AR Scanner (BETA):</strong> You can now point your phone's camera at the screen (relics/inventory) to instantly fetch prices. <em>Note: This is an experimental feature, so bugs or recognition errors may occur.</em>
    </li>
    <li>
      <strong>Maintenance & Refactoring:</strong> Various internal fixes and code cleanup. I am improving the app's maintainability to ensure faster and better development for future updates.
    </li>
    <li>
      <strong>Feedback & Roadmap:</strong> Working on several other features requested through suggestions. Thanks for the feedback!
    </li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.2.4 (Current)</span>
    <span class="update-date">2026-01-14</span>
  </div>
  <ul class="update-list">
    <li>
      <strong>Bug Fix:</strong> Fixed an annoyance where clicking on any tab would incorrectly toggle/close the relic inventory panel. Thanks for the bug report!
    </li>
    <li>
      <strong>Dev Diary (Console OCR):</strong> Progress on Live OCR using the phone as an overlay for consoles. Currently at ~70% reliability; aiming for >90% and hardening scan logic before release.
    </li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.2.3</span>
    <span class="update-date">2026-01-10</span>
  </div>
  <ul class="update-list">
    <li>
      <strong>Small fixes:</strong> Fixes on relic scan now it should cover more cases and correctly recognize more parts, there may be some bugs.
    </li>
    <li>
      <strong>Dev Note:</strong> Should be getting a kind of overlay for consoles in a bit (soonish) using the phone as an overlay.
    </li>
  </ul>
</div>
<div class="update-block old">
 <div class="update-header">
  <span class="update-version">v1.2.1 and 1.2.2</span>
    <span class="update-date">2026-01-07</span>
  </div>
  <ul class="update-list">
      <li>
      <strong>Small fixes:</strong> Fixes towards optimization and small translation errors
    </li>
    <li>
      <strong>Mobile UI fixes:</strong> Broke stuff fixed it now
    </li>
    <li>
      <strong>EXPORT/IMPORT RELIC INVENTORY ADDED:</strong> IF YOU GO THROUGH THE HASSLE OF SCANNING MANUALLY ADDING YOUR RELIC INVENTORY YOU CAN NOW EXPORT YOUR RELIC PROGRESS AND IMPORT LATER ON
    </li>
    <li><strong>Worker optimizations</strong> </li>
    <li><em>Coming soon: Automatic inventory scan via screen recording, half implemented it works bad</em></li>
    <li><em>Inventory scan now can be done inserting multiple photos, mobile scan is broken at the moment so a fix is pending.</em></li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.2.0</span>
    <span class="update-date">2026-01-05</span>
  </div>
  <ul class="update-list">
    <li>
      <strong>Riven Grading:</strong> New dedicated modal to calculate Riven quality.
    </li>
    <li>
      <strong>UI Overhaul:</strong> Improved styling for the Relics tab and overall interface elements.
    </li>
    <li><strong>Bug Fix:</strong> Vaulted/not vaulted logic fixed</li>
    <li><em>Coming soon: Automatic Riven grading via photo scan!</em></li>
    <li><em>Added this update notice just today :P</em></li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.1.5 (Beta)</span>
    <span class="update-date">2026-01-04</span>
  </div>
  <ul class="update-list">
    <li>
      <strong>Live Reward Scanner (BETA):</strong> New OCR feature to scan mission rewards in real-time. Expect potential bugs as it is currently in testing.
    </li>
    <li>
      <strong>New feature Vaulted/Not vaulted relics:</strong> Vaulted/not vaulted logic added
    </li>
    <li>
      <strong>Mobile Optimization:</strong> Significant UI improvements for better navigation on mobile devices.
    </li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.1.0</span>
    <span class="update-date">2025-12-30</span>
  </div>
  <ul class="update-list">
    <li>
      <strong>Inventory Scanner:</strong> Use your phone's camera to scan and add relics to your inventory automatically.
    </li>
    <li>
      <strong>Cloud Sync:</strong> Added a new clipboard synchronization tool (cloud icon) to transfer lfg text between devices instantly.
    </li>
    <li>
      <strong>Side Panels:</strong> Added toggle buttons to easily show or hide the Relic Inventory and Recommended Fissures.
    </li>
    <li>
      <strong>Graphics:</strong> General visual enhancements across all tabs.
    </li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.0.0</span>
    <span class="update-date">2025-12-28</span>
  </div>
  <ul class="update-list">
    <li>
      <strong>LFG Message Generator:</strong> Create professional recruitment messages for chat with one click.
    </li>
    <li>
      <strong>Market Integration:</strong> Real-time price fetching for Prime parts and sets directly from Warframe Market.
    </li>
    <li>
      <strong>Basic Database:</strong> Initial support for all currently active Relics and Prime items.
    </li>
  </ul>
</div>
`
};
export const TIER_URLS = {
  Lith: "https://wiki.warframe.com/images/LithRelicIntact.png?ee7d7",
  Meso: "https://wiki.warframe.com/images/MesoRelicIntact.png?a9b4a",
  Neo: "https://wiki.warframe.com/images/NeoRelicIntact.png?6dc86",
  Axi: "https://wiki.warframe.com/images/AxiRelicIntact.png?6cadf",
  Requiem: "https://wiki.warframe.com/images/RequiemRelicIntact.png?03821",
};

export const DROP_CHANCES = {
  Intact: { rare: 0.02, uncommon: 0.22, common: 0.76 },
  Exceptional: { rare: 0.04, uncommon: 0.26, common: 0.7 },
  Flawless: { rare: 0.06, uncommon: 0.34, common: 0.6 },
  Rad: { rare: 0.1, uncommon: 0.4, common: 0.5 },
};

export const RIVEN_STATS = [
  // --- BÁSICOS ---
  { slug: "critical_chance", name_en: "Crit Chance", name_es: "Prob. Crítica" },
  { slug: "critical_damage", name_en: "Crit Damage", name_es: "Daño Crítico" },
  { slug: "multishot", name_en: "Multishot", name_es: "Multidisparo" },
  {
    slug: "base_damage_/_melee_damage",
    name_en: "Damage",
    name_es: "Daño Base",
  },
  {
    slug: "fire_rate_/_attack_speed",
    name_en: "Fire Rate / Attack Speed",
    name_es: "Cadencia / Vel. Ataque",
  },
  { slug: "status_chance", name_en: "Status Chance", name_es: "Prob. Estado" },
  {
    slug: "status_duration",
    name_en: "Status Duration",
    name_es: "Duración de Estado",
  },

  // --- ELEMENTALES ---
  { slug: "toxin_damage", name_en: "Toxin", name_es: "Toxina" },
  { slug: "heat_damage", name_en: "Heat", name_es: "Calor" },
  { slug: "electric_damage", name_en: "Electric", name_es: "Electricidad" },
  { slug: "cold_damage", name_en: "Cold", name_es: "Frío" },

  // --- FÍSICOS ---
  { slug: "impact_damage", name_en: "Impact", name_es: "Impacto" },
  { slug: "puncture_damage", name_en: "Puncture", name_es: "Perforación" },
  { slug: "slash_damage", name_en: "Slash", name_es: "Cortante" },

  // --- UTILIDAD ARMAS DE FUEGO ---
  { slug: "weapon_recoil", name_en: "Recoil", name_es: "Retroceso" },
  {
    slug: "magazine_capacity",
    name_en: "Magazine Capacity",
    name_es: "Capacidad Cargador",
  },
  { slug: "ammo_maximum", name_en: "Ammo Maximum", name_es: "Munición Máxima" },
  { slug: "reload_speed", name_en: "Reload Speed", name_es: "Vel. Recarga" },
  {
    slug: "projectile_flight_speed",
    name_en: "Projectile Speed",
    name_es: "Vel. Proyectil",
  },
  { slug: "punch_through", name_en: "Punch Through", name_es: "Atravesar" },
  { slug: "zoom", name_en: "Zoom", name_es: "Zoom" },

  // --- MELEE ESPECÍFICOS  ---
  { slug: "range", name_en: "Range", name_es: "Alcance (Rango)" },
  { slug: "initial_combo", name_en: "Initial Combo", name_es: "Combo Inicial" },
  {
    slug: "combo_duration",
    name_en: "Combo Duration",
    name_es: "Duración de Combo",
  },
  {
    slug: "chance_to_gain_extra_combo_count",
    name_en: "Chance not to gain Combo",
    name_es: "Prob. Combo Extra",
  },
  {
    slug: "critical_chance_on_slide_attack",
    name_en: "Slide Attack Critical Chance",
    name_es: "Crit en Deslizamiento",
  },
  {
    slug: "heavy_attack_efficiency",
    name_en: "Heavy Attack Efficiency",
    name_es: "Eficiencia Ataque Pesado",
  },
  {
    slug: "finisher_damage",
    name_en: "Finisher Damage",
    name_es: "Daño de Remate",
  },

  // --- FACCIONES ---
  {
    slug: "damage_vs_grineer",
    name_en: "Damage to Grineer",
    name_es: "Daño a Grineer",
  },
  {
    slug: "damage_vs_corpus",
    name_en: "Damage to Corpus",
    name_es: "Daño a Corpus",
  },
  {
    slug: "damage_vs_infested",
    name_en: "Damage to Infested",
    name_es: "Daño a Infestados",
  },
];
export const WEAPON_TYPE_IDX = {
  Rifle: 0,
  Sniper: 0,
  Bow: 0,
  Launcher: 0,
  Sentinel: 0,
  Shotgun: 1,
  Pistol: 2,
  "Dual Pistols": 2,
  Thrown: 2,
  Throwing: 2,
  Kitgun: 2,
  Melee: 3,
  Zaw: 3,
  "Zaw Component": 3,
  Glaive: 3,
  Archgun: 4,
  "Arch-Gun": 4,
};

export const RIVEN_BASE_STATS = {
  // DMG
  "Critical Chance": [16.7, 10, 16.7, 20, 11.1],
  "Critical Damage": [13.3, 10, 10, 10, 8.9],
  "Status Chance": [10, 10, 10, 10, 6.7],
  "Status Duration": [11.1, 11.1, 11.1, 11.1, 11.1],
  Damage: [18.3, 18.3, 24.4, 18.3, 11.1],
  Multishot: [10, 13.3, 13.3, 0, 6.7],
  "Fire Rate": [6.7, 10, 8.3, 0, 6.7],
  "Attack Speed": [0, 0, 0, 6.1, 0],

  // ELEMENTALS
  Electric: [10, 10, 10, 10, 13.3],
  Toxin: [10, 10, 10, 10, 13.3],
  Heat: [10, 10, 10, 10, 13.3],
  Cold: [10, 10, 10, 10, 13.3],
  Impact: [13.3, 13.3, 13.3, 13.3, 10],
  Puncture: [13.3, 13.3, 13.3, 13.3, 10],
  Slash: [13.3, 13.3, 13.3, 13.3, 10],

  //UTILITY
  "Ammo Maximum": [5.5, 10, 10, 0, 11.1],
  "Magazine Capacity": [5.5, 5.5, 5.5, 0, 6.7],
  "Reload Speed": [5.5, 5.5, 5.5, 0, 11.1],
  "Projectile Speed": [10, 10, 10, 0, 11.1],
  Zoom: [6.7, 0, 8.9, 0, 6.7],
  "Punch Through": [0.3, 0.3, 0.3, 0, 0.3],
  Recoil: [-10, -10, -10, 0, -10],

  // MELEE ONLY
  Range: [0, 0, 0, 0.21, 0],
  "Combo Duration": [0, 0, 0, 0.9, 0],
  "Initial Combo": [0, 0, 0, 2.7, 0],
  "Chance not to gain Combo": [0, 0, 0, 6.5, 0],
  "Slide Attack Critical Chance": [0, 0, 0, 13.3, 0],
  "Finisher Damage": [0, 0, 0, 13.3, 0],
  "Heavy Attack Efficiency": [0, 0, 0, 8.2, 0],

  "Damage to Grineer": [5, 5, 5, 5, 5],
  "Damage to Corpus": [5, 5, 5, 5, 5],
  "Damage to Infested": [5, 5, 5, 5, 5],
};

// Bridges RIVEN_STATS.name_en → RIVEN_BASE_STATS keys where they differ.
// The scanner labels stats with name_en ("Crit Chance"), but the base-stat table is keyed by the
// long form ("Critical Chance"); without this bridge those stats grade as "?".
export const BASE_STAT_ALIAS = {
  "Crit Chance": "Critical Chance",
  "Crit Damage": "Critical Damage",
};

// Resolves the RIVEN_BASE_STATS key for a parsed stat name, given the weapon type index.
// "Fire Rate / Attack Speed" resolves per weapon type (melee idx 3 → Attack Speed, else Fire Rate).
export function resolveBaseStatKey(nameEn, typeIdx) {
  if (nameEn === "Fire Rate / Attack Speed") {
    return typeIdx === 3 ? "Attack Speed" : "Fire Rate";
  }
  return BASE_STAT_ALIAS[nameEn] || nameEn;
}

// (Buffs vs Curses)
export const RIVEN_WEIGHTS = {
  "2-0": { buff: 0.99, curse: 0 },
  "2-1": { buff: 1.2375, curse: 0.495 },
  "3-0": { buff: 0.75, curse: 0 },
  "3-1": { buff: 0.9375, curse: 0.75 },
};
export const TEXTS = {
  es: {
    lblCondition: "Condición:",
    lblEndsIn: "Termina en:",
    btnViewDrops: "VER RECOMPENSAS",
    ayaTags: {
      best: "AYA: ARTEFACTO (MEJOR)",
      fast: "AYA: CAPTURA (RÁPIDA)",
      runnable: "AYA: RESCATE (PASABLE)",
      generic: "AYA: TIER 5 (BUSCAR EN TIENDAS)",
    },
    menuBounties: "Farms",
    lblFastFarms: "Misiones Rápidas Activas",
    inventory: {
      title: "Inventario",
      empty: "Inventario vacío. Usa el escáner.",
      searchPlaceholder: "Filtrar (Ej: G1)...",
      primeSearchPlaceholder: "Buscar Set o Parte...",
      sort: {
        recent: "Recientes",
        valIntact: "Valor (Intacta)",
        valRad: "Valor (Radiante)",
        ducats: "Ducados",
      },
      primeSort: {
        alpha: "Alfabético (A-Z)",
        sets_desc: "Sets completados (Mayor a Menor)",
        sets_asc: "Sets a completar (Cerquitas de terminar)",
        plat_desc: "Valor Total en Platino",
        relic_potential: "Potencial PL (Según Reliquias)",
      },
      tooltips: {
        dropsFor: "Misiones para",
        contentsOf: "Reliquia",
        avgPlat: "Media PL",
        avgDucats: "Media Ducados",
        vaulted: "VAULTED",
        active: "ACTIVA"
      },
      actions: {
        clear: "Borrar Todo",
        deleteConfirm: "¿Seguro que quieres borrar todo el inventario?",
      },
      lblTotalValue: "VALOR TOTAL ESTIMADO",
      confirmDeleteSet: "¿Borrar set completo?",
      lblMarketSet: "PRECIO MERCADO",
    },
    scanner: {
      starting: "INICIANDO...",
      active: "ESCANER ACTIVO",
      toastActive: "Escáner Activo (Auto-Close 12s)",
      relicDetected: "Reliquia Detectada",
      track: "TRACKEAR",
      trackingToast: "Trackeando {relic}",
    },
    scannerHUD: {
      title: "VOIDSCANNER",
      statusIdle: "IDLE",
      statusInventory: "INVENTARIO",
      statusRelics: "RELIQUIAS",
      statusReward: "RECOMPENSA",
      btnDebug: "DBG",
      btnRecalibrate: "⊹ RECALIBRAR",
      btnEditCells: "✎ EDITAR CELDAS",
      btnReset: "↺",
      btnCopyLog: "COPIAR LOG",
      btnDone: "✓ LISTO",
      btnScan: "⌖ SCAN PÁGINA",
      btnSave: "↓ GUARDAR",
      editTitle: "EDITOR DE GRID",
      editGuide: "Arrastra celdas para mover todo el grid · ↑↓←→ (SHIFT=×5)",
      noCalibration: "No hay calibración. Calibra primero.",
      noScanner: "El scanner debe estar activo para editar.",
      scrollWait: "ESPERA...",
      scrollNext: "SIGUIENTE PÁGINA",
      scrollDone: "LISTO",
      lblDetected: "ITEMS DETECTADOS",
      lblEmpty: "PULSA SCAN PÁGINA PARA EMPEZAR",
      btnOpenLog: "LOG IMÁGENES",
      finished: "¡FINALIZADO!",
      saved: "Guardado",
      autoScanOn: "⟳ AUTO SCAN ACTIVO",
      autoScanOff: "AUTO SCAN DESACTIVADO",
      autoScanDesc: "↓ Haz scroll en el inventario. Se escaneará automático al estabilizar. Asegúrate de mostrar filas completas.",
      autoScanDetected: "MOVIMIENTO DETECTADO",
      autoScanDetectedDesc: "Esperando estabilización...",
      autoScanScanning: "ESCANEANDO PÁGINA...",
      autoScanScanningDesc: "Por favor no muevas el inventario ni la pantalla.",
      autoScanDone: "ESCANEO COMPLETADO",
      autoScanDoneDesc: "{count} items únicos en total.<br>Puedes seguir bajando la página para leer más.",
      btnScanNext: "↓ ESCANEAR SIGUIENTE",
      lblNewItemsFound: "↓ {count} NUEVOS ITEMS DETECTADOS",
      lblNoNewItems: "✓ No hay items nuevos en esta página",
      lblTotalUnique: "{total} items únicos detectados en total.",
      btnFinishedSave: "✓ TERMINAR — GUARDAR INVENTARIO",
      btnScrollManualScan: "Haz scroll abajo, y pulsa SCAN PÁGINA de nuevo.",
      toastScanComplete: "¡Escaneo completado! {count} piezas Prime detectadas.",
    },
    rewardScanner: {
      autoSyncLabel: "AUTO-SYNC",
      autoSyncTooltip: "SI: Sincroniza TODO con el VISTO (Prioridad OCR). NO: Solo añade +1 a la pieza que elijas manualmente.",
      autoCopyLabel: "AUTO-COPY",
      autoCopyTooltip: "SI: Copia automáticamente los resultados al portapapeles después de cada escaneo en formato chat de Warframe.",
      rewardSelectedConfirmation: "{item} SELECCIONADA +1",
      addBtn: "✓ AÑADIR AL INVENTARIO",
      lblSeen: "Vista",
      lblInv: "PROPIO",
      tagBestPl: "¡MEJOR PLAT!",
      tagBestDuc: "¡MEJOR DUCAT!",
      tagCompletes: "¡COMPLETA SET!",
      title: "RECOMPENSAS DETECTADAS",
      mobileHint: "Toca 'AÑADIR' para registrar en inventario",
    },
    history: {
      title: "DETECCIONES RECIENTES",
      empty: "No hay ningún escaneo de recompensas reciente.<br><span style='font-size:0.75rem; color:#aaa; opacity:0.8;'>Prueba a hacer una misión de abrir reliquias con el Live Scanner activo.</span>",
      btnView: "VER CAPTURA",
      btnChoose: "ELEGIR",
      btnAdded: "AGREGADO",
      btnClearTooltip: "Limpiar historial",
      toastCleared: "Historial borrado",
      btnLabel: "HISTORIAL"
    },
    calib: {
      title: "CALIBRACIÓN DE ZONA",
      step1: "Dibuja un rectángulo alrededor de TODA el área del grid de items (desde el primer item visible hasta el último). No hace falta ser exacto.",
      btnNext: "CALIBRAR",
      btnSkip: "Omitir Calibración"
    },
    ocr: {
      cameraTitle: "Escáner de Reliquias",
      btnCapture: "Capturar",
      btnUpload: "Subir Foto",
      btnSave: "GUARDAR EN INVENTARIO",
      guide: "Apunta a la lista de reliquias",
      analyzing: "Analizando imagen...",
      results: "Resultados Detectados",
      noText: "No se detectó texto claro. Intenta acercarte.",
      success: "Guardado correctamente.",
    },
    lfgPresets: {
      title: "Mensajes Guardados",
      btnSave: "Save preset",
      placeholder: "Nombre (ej: Eidolon 5x3)",
      empty: "No hay presets guardados.",
      deleteConfirm: "¿Borrar este preset?",
    },
    tradePresets: {
      title: "Mensajes de Trade",
      btnSave: "Guardar",
      placeholderName: "Nombre (ej: WTS Energize)",
      placeholderText: "WTS [Arcane Energize] 100p",
      empty: "No hay mensajes de trade guardados.",
      emptyMsg: "Escribe un mensaje primero.",
      deleteConfirm: "¿Borrar este mensaje?",
      copied: "¡Mensaje copiado!",
    },
    modes: {
      capture: "Captura",
      extermination: "Exterminio",
      exterminate: "Exterminio",
      rescue: "Rescate",
      sabotage: "Sabotaje",
      "void cascade": "Cascada del Vacío",
      "void flood": "Inundación del Vacío",
      "void armageddon": "Armagedón del Vacío",
      disruption: "Interrupción",
      survival: "Supervivencia",
      defense: "Defensa",
      mobile_defense: "Defensa Móvil",
      assault: "Asalto",
      hijack: "Secuestro",
      spy: "Espionaje",
    },
    sync: {
      title: "Sincronización en la Nube",
      btnSend: "ENVIAR",
      btnReceive: " RECIBIR",
      lblCode: "Tu Código:",
      lblInput: "Introduce el código del otro dispositivo:",
      btnActionSend: "Enviar Portapapeles",
      waiting: "Esperando conexión...",
      success: "¡Recibido con éxito!",
      sending: "Enviando...",
      sent: "¡Enviado!",
      error: "Error. Intenta de nuevo.",
      limits: " Límite: 1000 syncs/día (Global). Los códigos expiran en 120s.",
      helpTooltip:
        "Usa esto para pasar textos (LFG, Compras) del Móvil al PC/Consola sin escribir.",
      placeholder: "Ej: 1234",
    },
    msgNoBountiesTitle: "Sin misiones óptimas activas.",
    msgNoBountiesDesc:
      "No hay Exterminios T4/T5 ni cazas de Ángel disponibles en este ciclo.",

    fastFarmGuide:
      "Solo muestra contratos T4/T5 con objetivos rápidos (Exterminio, Ángel, <6min).",
    manualAdd: "Añadir al Inventario",
    addGuide:
      "ℹ Dos formas de añadir: Manualmente (botón +) o Escáner (Cámara). Las fotos se procesan 100% local en tu dispositivo.",
    lblProfit: "Rentabilidad (Media)",
    lblProfitSolo: "Rentabilidad (Solo)",
    lblProfitSquad: "Rentabilidad ({n} Jugadores)",
    lblRecommended: "⚡ Fisuras Recomendadas:",
    lblFissures: "Fisuras Activas",
    lblInventory: "Inventario",
    menuRelic: "Reliquia",
    rivenHud: {
      compareTitle: "COMPARACIÓN DE ROLLS",
      current: "ACTUAL",
      new: "NUEVO",
      score: "Puntuación",
      est: "Est",
      verdictBetter: "ES MEJOR",
      editCurrent: "EDITAR ACTUAL",
      editNew: "EDITAR NUEVO",
      capture: "CAPTURA",
      gradeActual: "GRADING (ACTUAL)",
      gradeNuevo: "GRADING (NUEVO)",
      sideCurrent: "ACTUAL (IZQ)",
      sideNew: "NUEVO (DER)",
      captured: "CAPTURADO"
    },
    menuSet: "Set",
    menuRiven: "Riven",
    menuProfile: "Perfil",
    menuLfg: "LFG",
    lblRelic: "Nombre de Reliquia",
    phRelic: "Ej: Lith A1...",
    lblItem: "Buscar Item (Ej: Xaku)",
    phItem: "Ej: Xaku, Protea...",
    lblRef: "Refinamiento",
    lblMiss: "Faltan",
    btnCopy: "Copiar Mensaje",
    btnPrice: "💲 Precio",
    msgCopied: "¡COPIADO!",
    noStock: "Sin datos",
    countMsg: "items",
    defaultRelic: "RELIQUIA",
    errLoad: "Error de conexión.",
    loading: "Cargando...",
    loadingSub: "Buscando datos...",
    errFetch: "Error de red.",
    common: "Común",
    uncommon: "Poco Común",
    rare: "Raro",
    setInfo: "Set Completo",
    lblBlueprint: "Plano",
    notFound: "No encontrado en Reliquias.",
    active: "ACTIVA",
    vaulted: "VAULTED",
    aya: "AYA (Varzia)",
    lblRivenW: "Arma del Riven",
    phRivenW: "Ej: Bramma, Nikana...",
    lblRivenS: "Estadísticas (Opcional)",
    headerTitle: "VOIDSTONKS",
    headerSub: "Optimización de Farm y Reclutamiento",
    tooltipContent: "Arrastra piezas al panel lateral para seguirlas. Consulta los requisitos en los círculos y pulsa '+1' para añadirlas a tu inventario.",
    tooltipTracker: "Arrastra piezas aquí para trackearlas, o haz click en cualquier pieza para revelar y seleccionar qué reliquias la dropean. Los círculos indican el progreso de tu Set.",
    lblContent: "Contenido:",
    footerData: "Datos provistos por:",
    contactLabel: "¿Tienes ideas para mejorar la app?",
    contactLink: "w/Parcialsobriedad",
    rivenSearch: " BUSCAR PRECIO",
    refs: {
      rad: "Radiante",
      intact: "Intact",
      flawless: "Perfecta",
      exceptional: "Excepcional",
    },
    rarityAbbr: { common: "C", uncommon: "PC", rare: "R" },
    trackerTitle: "Progreso del Set",
    markDone: "Ya lo tengo",
    markUndo: "Desmarcar",
    lblUser: "Nombre de Usuario (PC)",
    btnCheck: "Check",
    lblDailyFocus: "Foco Diario",
    lblStanding: "Reputación Restante",
    lblTraces: "Max Vestigios",
    disclaimer:
      "VoidStonks no está afiliado, respaldado ni patrocinado por Digital Extremes Ltd.Warframe™ es una marca registrada de Digital Extremes Ltd.",
    lblRivenPos: "+ Estadísticas",
    lblRivenNeg: "- Negativa (Opcional)",
    lblModPreview: "VISTA PREVIA DEL MOD",
    lblWeaponGuide: "GUÍA DEL ARMA",
    lblMrCalc: "Si la API falla, calcula por MR:",
    lblLfgActivity: "Actividad",
    lblLfgPlayers: "Jugadores Necesarios",
    tooltips: {
      tabBounties: "Ver contratos rápidos activos (Zariman, Cavia, 1999).",
      netra:
        "Requiere: Rango 5 con Cavia. Misión de alta dificultad. 5 intentos semanales.",
      temporal:
        "Requiere: Historia principal , completar 1999. Serie de 3 misiones consecutivas en Höllvania sin pausas. Alta dificultad.",
      tabRelic: "Buscar contenidos y precios de Reliquias.",
      tabSet: "Ver precios de Sets completos y partes buscar.",
      tabRiven: "Precios y estadísticas de Mods Riven.",
      tabProfile: "Verificar maestría y cap de usuario.",
      tabLfg: "Generar mensajes de reclutamiento.",
      refinement:
        "Gasta Vestigios para aumentar la chance de recompensas Raras (Doradas).",
      omnia:
        "Requiere: Acceso a misiones de Cascada del Vacío o Conjunción. Permiten abrir CUALQUIER tipo de reliquia (Lith, Meso, Neo, Axi) al mismo tiempo (excepto Requiem).",
      steelPath:
        "Requiere: Completar todos los nodos del Mapa Estelar. Los enemigos tienen +100% de nivel, vida y armadura, pero obtienes +100% de probabilidad de recursos y Esencia de Acero.",
      vs: "Void Strike (Madurai). Esencial para romper escudos rápido.",
      dps: "Damage Dealer. Rompe las partes del Eidolon.",
      lure: "Encargado de mantener vivos los Señuelos.",
      volt: "Escudos Eléctricos para daño crítico.",
      harrow: "Protección contra picos de energía.",
      wisp: "Buffs de velocidad y vida.",
      profit:
        "Requiere: Rango 5 (Viejo Amigo) con Solaris United. Jefe 'araña' en Valles del Orbe. Meta principal: Farm de Créditos.",
      eda: "Requiere: Rango 5 con Cavia (Sanctum Anatomica). La misión más difícil del juego. Restricciones de equipo aleatorias a cambio de recompensas Élite.",
      archon:
        "Requiere: Aventura 'La Nueva Guerra'. Caza semanal de jefes. Recompensa: Fragmentos de Arconte (Mejoras permanentes de stats).",
      sortie:
        "Requiere: Aventura 'La Guerra Interna'. 3 misiones diarias con modificadores. Recompensa: Rivens, Endo, Piña Ayatan.",
      arbi: "Requiere: Completar TODOS los nodos del Mapa Solar. Misiones infinitas sin revivir. Meta: Endo y Mods Galvanizados.",
      radshare: "Todos usan Reliquia RADIANTE (100 vestigios).",
      intshare: "Todos usan Reliquia INTACTA (0 vestigios).",
      rotation: "Capturas de Hidrolista por ciclo nocturno.",
      meta: "Estrategia más eficiente/óptima.",
      casual: "Juego tranquilo sin requisitos estrictos.",
      circuit: "Requiere: Aventura 'La Paradoja Duviri'. Modo rotatorio de 5 fases. Farm de Adaptadores Incarnon. Versión Normal o Camino de Acero.",
      eso: "Onslaught Élite. Eficiencia decreciente, zona 8+. Farm de afinidad, Khora y arcanas (Energize). Rol clásico: Saryn limpiadora.",
      so: "Versión normal del Onslaught. Más accesible, sin penalización de eficiencia tan dura.",
      isovault: "Requiere: Rango con Necralisco (Entrati). Bóvedas T1/T2/T3 en la Deriva Cambion. Farm de Necramech, Arcanas y Réquiem.",
      kuva: "Supervivencia/Flood/Siphon. Farm de Kuva para rerollear Rivens. Flood da más Kuva pero es más difícil.",
      saryn: "Limpiadora del mapa (daño en área constante).",
      mirage: "Nuker de Mirage (Sala de Espejos + Prestidigitación Explosiva).",
      support: "Buffs/energía para el escuadrón (Trinity, Wisp, etc.).",
      jadeConstellation: "Constelación de Jade Shadows. Requiere: completar las misiones Railjack de Jade Shadows. Farm de la constelación.",
      follie: "Caza de Follie en el Relé Vesper (Venus).",
    },
    lfgOpts: {
      radshare: "Radshare",
      radshareInfo: "ℹ️ ¿Qué es Radshare?",
      eidolon: "Caza de Eidolon",
      profit: "Robaganancias",
      eda: "Archimedia Profunda",
      netra: "Netra-Celdas",
      archon: "Cacería de Arconte",
      sortie: "Incursión",
      arbi: "Arbitramento",
      temporal: "Archimedia Temporal",
      circuit: "Circuito",
      eso: "ESO",
      so: "Sanctuary Onslaught",
      isovault: "Bóveda de Aislamiento",
      kuva: "Kuva",
      sirius: "Sirius",
      orion: "Orion",
      follie: "Caza de Follie",
    },
    lfgRoles: {
      dps: "DPS",
      lure: "Señuelos",
      volt: "Volt",
      wisp: "Wisp",
      harrow: "Harrow",
      meta: "Meta",
      casual: "Casual",
      elite: "Élite",
      run3x3: "3x3",
      run5x3: "5x3",
      run6x3: "6x3",
      saryn: "Saryn",
      mirage: "Mirage",
      support: "Soporte",
      normal: "Normal",
      steelpath: "Camino de Acero",
      kuvaSurvival: "Supervivencia",
    },
    purgeConfirmRelics: "¿Borrar todas las Reliquias guardadas?",
    purgeConfirmParts: "¿Borrar todo el Inventario Prime?",
    btnConfirm: "CONFIRMAR",
    btnCancel: "CANCELAR",
    lblOwned: "obtenidos",
    btnShowUpdates: "Ver Novedades",
    updateModalTitle: "HISTORIAL DE ACTUALIZACIONES",
    updateModalGotIt: "Entendido",
    lblRivenMedian: "Precio base estimado (Mediana)",
    lblRivenLow: "Precio más bajo:",
    lblRivenHigh: "Precio más alto:",
    recipe: "Receta",
    stats: "Estadísticas",
    recipeNotAvailable: "Receta no disponible",
    requirements: "Requisitos",
    dropLocations: "Ubicaciones de Drop",
    lichSources: {
      unknown: "Fuente Desconocida",
      kuva: "Lich de Kuva (Vencer)",
      tenet: "Hermanas de Parvos (Vencer)",
      coda: "Liches Infestados (1999)"
    },
    rivenIndex: {
      trend: "TENDENCIA",
      potential: "POTENCIAL",
      medianUnrolled: "MEDIANA (SIN ROLL)",
      medianRerolled: "MEDIANA (ROLLEADO)",
      maxRecorded: "MÁX. REGISTRADO",
      wfmAverage: "MEDIA WFM",
      ords: "ords",
      variantsLabel: "Variantes",
      bestPositives: "MEJORES POSITIVOS",
      worstPositives: "PEORES POSITIVOS",
      bestNegatives: "MEJORES NEGATIVOS (INOFENSIVOS)",
      worstNegatives: "PEORES NEGATIVOS (CRÍTICOS)"
    },
    arbitrage: {
      title: "Arbitraje (Flips)",
      loading: "Buscando oportunidades…",
      error: "Error al cargar.",
      updated: "Actualizado",
      scanned: "activos",
      inventory: "inventario",
      shown: "mostrados",
      refresh: "Refrescar",
      verified: "Verificado en vivo",
      presetHint: "¿Cuánto beneficio buscas?",
      presetAll: "Todos",
      presetSmall: "Pequeños",
      presetGood: "Buenos",
      presetBig: "Pelotazos",
      advanced: "Ajustes finos",
      minSpread: "💰 Ganancia por flip",
      minPct: "📈 Rentabilidad",
      minPrice: "🏷️ Precio del ítem",
      sortBy: "Ordenar",
      sortSpread: "Ganancia",
      sortPct: "Rentab.",
      sortPrice: "Precio",
      empty: "Sin oportunidades con estos filtros.",
      disclaimer: "Flips del mercado: compra a la venta más barata y revende a la compra más cara. Verifica en vivo (↻) antes de actuar; los precios cambian al instante."
    }
  },
  en: {
    condSpeedrun: "Complete in less than 6 min",
    lblCondition: "Condition:",
    lblEndsIn: "Ends in:",
    btnViewDrops: "VIEW REWARDS",
    ayaTags: {
      best: "AYA: ARTIFACT (BEST)",
      fast: "AYA: CAPTURE (FAST)",
      runnable: "AYA: RESCUE (RUNNABLE)",
      generic: "AYA: TIER 5 (CHECK TENTS)",
    },
    inventory: {
      title: "Inventory",
      empty: "Inventory empty. Use live scanner or add prime parts manually.",
      searchPlaceholder: "Filter (e.g. G1)...",
      primeSearchPlaceholder: "Search Set or Part...",
      sort: {
        recent: "Recent",
        valIntact: "Value (Intact)",
        valRad: "Value (Radiant)",
        ducats: "Ducats",
      },
      primeSort: {
        alpha: "Alphabetical (A-Z)",
        sets_desc: "Completed Sets (Highest to Lowest)",
        sets_asc: "Sets to Complete (Closest to finish)",
        plat_desc: "Total Platinum Value",
        relic_potential: "PL Potential (By Relics)",
      },
      tooltips: {
        dropsFor: "Drops for",
        contentsOf: "Relic Contents",
        avgPlat: "Avg Plat",
        avgDucats: "Avg Ducats",
        vaulted: "VAULTED",
        active: "ACTIVE"
      },
      actions: {
        clear: "Clear All",
        deleteConfirm: "Are you sure you want to delete all?",
      },
      lblTotalValue: "ESTIMATED TOTAL VALUE",
      confirmDeleteSet: "Delete entire set?",
      lblMarketSet: "MARKET SET",
    },
    scanner: {
      starting: "STARTING...",
      active: "SCANNER ACTIVE",
      toastActive: "Scanner Active (Auto-Close 12s)",
      relicDetected: "Relic Detected",
      track: "TRACK",
      trackingToast: "Tracking {relic}",
    },
    scannerHUD: {
      title: "VOIDSCANNER",
      statusIdle: "IDLE",
      statusInventory: "INVENTORY",
      statusRelics: "RELICS",
      statusReward: "REWARD",
      btnDebug: "DBG",
      btnRecalibrate: "⊹ RECALIBRATE",
      btnEditCells: "✎ EDIT CELLS",
      btnReset: "↺",
      btnCopyLog: "COPY LOG",
      btnDone: "✓ DONE",
      btnScan: "⌖ SCAN PAGE",
      btnSave: "↓ SAVE",
      editTitle: "GRID EDITOR",
      editGuide: "Drag cells to move entire grid · ↑↓←→ (SHIFT=×5)",
      noCalibration: "No calibration found. Calibrate first.",
      noScanner: "Scanner must be active to edit.",
      scrollWait: "WAIT...",
      scrollNext: "SCAN NEXT PAGE",
      scrollDone: "DONE",
      lblDetected: "DETECTED ITEMS",
      lblEmpty: "PRESS SCAN PAGE TO START",
      btnOpenLog: "IMAGE LOGS",
      finished: "FINISHED!",
      saved: "Saved",
      autoScanOn: "⟳ AUTO SCAN ON",
      autoScanOff: "AUTO SCAN OFF",
      autoScanDesc: "↓ Scroll gently. It scans automatically when stable. Make sure full rows are visible.",
      autoScanDetected: "MOVEMENT DETECTED",
      autoScanDetectedDesc: "Waiting for screen to stabilize...",
      autoScanScanning: "SCANNING PAGE...",
      autoScanScanningDesc: "Please do NOT move the screen or inventory.",
      autoScanDone: "SCAN COMPLETED",
      autoScanDoneDesc: "{count} unique items in total.<br>You can keep scrolling to read more.",
      btnScanNext: "↓ SCAN NEXT",
      lblNewItemsFound: "↓ {count} NEW ITEM(S) FOUND",
      lblNoNewItems: "✓ No new items on this page",
      lblTotalUnique: "{total} total unique items found.",
      btnFinishedSave: "✓ FINISHED — SAVE INVENTORY",
      btnScrollManualScan: "Scroll down, then press SCAN PAGE again.",
      toastScanComplete: "Scan complete! {count} unique Prime items found.",
    },
    calib: {
      title: "ZONE CALIBRATION",
      step1: "Draw a rectangle around the ENTIRE inventory grid area (from the first visible item to the last). Doesn't need to be pixel-perfect.",
      btnNext: "CALIBRATE",
      btnSkip: "Skip Calibration"
    },
    ocr: {
      cameraTitle: "Relic Scanner",
      btnCapture: "Capture",
      btnUpload: "Upload File",
      btnSave: "SAVE TO INVENTORY",
      guide: "Aim at relic list",
      analyzing: "Analyzing image...",
      results: "Detected Results",
      noText: "No clear text detected. Try closer.",
      success: "Saved successfully.",
    },
    lfgPresets: {
      title: "Saved Presets",
      btnSave: "SAVE PRESET",
      placeholder: "Name (e.g., Eidolon 5x3)",
      empty: "No saved presets.",
      deleteConfirm: "Delete this preset?",
    },
    tradePresets: {
      title: "Trade Messages",
      btnSave: "Save",
      placeholderName: "Name (e.g. WTS Energize)",
      placeholderText: "WTS [Arcane Energize] 100p",
      empty: "No saved trade messages.",
      emptyMsg: "Write a message first.",
      deleteConfirm: "Delete this message?",
      copied: "Message copied!",
    },
    sync: {
      title: "Cloud Sync",
      btnSend: "📤 SEND",
      btnReceive: "📥 RECEIVE",
      lblCode: "Your Code:",
      lblInput: "Enter code from other device:",
      btnActionSend: "Send Clipboard",
      waiting: "Waiting for connection...",
      success: "Received successfully!",
      sending: "Sending...",
      sent: "Sent!",
      error: "Error. Try again.",
      limits: "⚠️ Limit: 1000 syncs/day (Global). Codes expire in 60s.",
      helpTooltip:
        "Use this to transfer text (LFG, Market) from Mobile to PC/Console instantly.",
      placeholder: "Ex: 1234",
    },
    modes: {
      capture: "Capture",
      extermination: "Exterminate",
      exterminate: "Exterminate",
      rescue: "Rescue",
      sabotage: "Sabotage",
      "void cascade": "Void Cascade",
      "void flood": "Void Flood",
      "void armageddon": "Void Armageddon",
      disruption: "Disruption",
      survival: "Survival",
      defense: "Defense",
      mobile_defense: "Mobile Defense",
      spy: "Spy",
    },
    msgNoBountiesTitle: "No optimal missions active.",
    msgNoBountiesDesc:
      "No T4/T5 Exterminates or Angel hunts available in this cycle.",
    menuBounties: "Farms",
    lblFastFarms: "Active Fast Farms",
    manualAdd: "Add relic to Inventory",
    addGuide:
      "ℹTwo ways to adD relics: Manually press the add relic to inventory when you select a relic  or Scanner (Camera). Images are processed 100% locally on your device.",
    lblProfit: "Profitability (Avg)",
    lblProfitSolo: "Profitability (Solo)",
    lblProfitSquad: "Profitability ({n} Players)",
    lblRecommended: "⚡ Recommended Fissures:",
    lblFissures: "Active Fissures",
    lblInventory: "Inventory",
    menuRelic: "Relic",
    menuSet: "Set",
    menuRiven: "Riven",
    menuProfile: "Profile",
    menuLfg: "LFG",
    lblRelic: "Relic Name",
    phRelic: "e.g. Lith A1...",
    lblItem: "Search Item (e.g. Xaku)",
    phItem: "e.g. Xaku, Protea...",
    lblRef: "Refinement",
    lblMiss: "Need",
    btnCopy: "Copy Message",
    btnPrice: "💲 Price",
    msgCopied: "COPIED!",
    noStock: "No Data",
    countMsg: "items",
    defaultRelic: "RELIC",
    errLoad: "Connection Error.",
    loading: "Loading...",
    loadingSub: "Fetching data...",
    errFetch: "Network Error.",
    common: "Common",
    uncommon: "Uncommon",
    rare: "Rare",
    setInfo: "Full Set",
    lblBlueprint: "Blueprint",
    notFound: "Not found.",
    active: "ACTIVE",
    vaulted: "VAULTED",
    aya: "AYA (Varzia)",
    lblRivenW: "Riven Weapon",
    phRivenW: "e.g. Bramma...",
    lblRivenS: "Stats (Optional)",
    headerTitle: "VOIDSTONKS",
    headerSub: "Farm & Recruit Tool",
    lblProfit: "Profitability (Avg)",
    tooltipContent: "Drag parts to the side panel to track them. Check build requirements via the circles and click '+1' to add them to your inventory.",
    tooltipTracker: "Drag parts here to track them, or click on a piece to reveal and select the relics that drop it. Circles show your Set progress.",
    lblContent: "Contents:",
    footerData: "Data by:",
    contactLabel: "Ideas? PM me ingame or through wf forums",
    contactLink: "w/Parcialsobriedad",
    rivenSearch: " CHECK PRICE",
    refs: {
      rad: "Radiant",
      intact: "Intact",
      flawless: "Flawless",
      exceptional: "Exceptional",
    },
    rarityAbbr: { common: "C", uncommon: "UC", rare: "R" },
    trackerTitle: "Set Progress",
    markDone: "Got it",
    markUndo: "Unmark",
    lblUser: "Username (PC)",
    btnCheck: "Check",
    lblDailyFocus: "Daily Focus",
    lblStanding: "Daily Standing",
    lblTraces: "Max Traces",
    disclaimer:
      "VoidStonks is not affiliated, endorsed, or sponsored by Digital Extremes Ltd.Warframe™ is a registered trademark of Digital Extremes Ltd.",
    lblRelicFor: "Relics for: ",
    lblRivenPos: "+ Positive Stat",
    lblRivenNeg: "- Negative (Optional)",
    lblModPreview: "MOD CARD LIVE PREVIEW",
    lblWeaponGuide: "WEAPON ATTRIBUTES GUIDE",
    lblMrCalc: "Calc by MR:",
    lblLfgActivity: "Activity",
    lblLfgPlayers: "Players Needed",
    menuBounties: "Farms",
    lblFastFarms: "Active Fast Farms",
    fastFarmGuide:
      "Only shows T4/T5 bounties with fast objectives (Exterminate, Angel, <6min).",
    tooltips: {
      tabBounties: "Check active fast bounties (Zariman, Cavia, 1999).",
      temporal:
        "Requires: Complete 1999 quest , progressing main story. 3 consecutive missions in Höllvania with no breaks. High difficulty.",
      tabRelic: "Check Relic contents and prices.",
      tabSet: "Check Full Sets and parts prices.",
      tabRiven: "Riven Mods prices and stats.",
      tabProfile: "Check User Mastery and Caps.",
      tabLfg: "Generate recruiting messages.",
      refinement: "Spend Traces to boost Rare (Gold) drop chance.",
      omnia:
        "Requires: Access to Void Cascade or Conjunction Survival missions. They allow you to open ANY relic type (Lith, Meso, Neo, Axi) at the same time (except Requiem).",
      steelPath:
        "Requires: Clearing every node on the Star Chart. Enemies have +100% level, health, and armor, but you get +100% resource drop chance and Steel Essence.",
      vs: "Void Strike (Madurai). Breaks shields instantly.",
      dps: "Damage Dealer. Breaks limbs.",
      lure: "Lure Handler (Keeps lures alive).",
      volt: "Electric Shields for crit damage.",
      harrow: "Protection from energy spikes.",
      wisp: "Fire rate and health buffs.",
      profit:
        "Requires: Rank 5 (Old Mate) with Solaris United. 'Spider' boss in Orb Vallis. Main Goal: Massive Credit farm.",
      eda: "Requires: Rank 5 with Cavia (Sanctum). Hardest content in the game. Random loadout restrictions for Elite rewards.",
      archon:
        "Requires: 'The New War' quest. Weekly boss hunt. Reward: Archon Shards (Permanent stat boosts).",
      sortie:
        "Requires: 'The War Within' quest. Daily 3-mission chain. Reward: Rivens, Endo, Sculptures.",
      arbi: "Requires: Clearing ALL Star Chart nodes. Endless permadeath missions. Goal: Endo and Galvanized Mods.",
      radshare: "Everyone equips RADIANT relic.",
      intshare: "Everyone equips INTACT relic.",
      rotation: "Hydrolyst captures per night cycle.",
      meta: "Most efficient strategy.",
      casual: "Relaxed gameplay.",
      circuit: "Requires: 'The Duviri Paradox' quest. Rotating 5-stage mode. Farm Incarnon Adapters. Normal or Steel Path.",
      eso: "Elite Sanctuary Onslaught. Decaying efficiency, zone 8+. Farm affinity, Khora and arcanes (Energize). Classic role: Saryn nuker.",
      so: "Normal Onslaught. More accessible, no harsh efficiency penalty.",
      isovault: "Requires: Rank with Necraloid/Entrati. T1/T2/T3 vaults in Cambion Drift. Farm Necramech, Arcanes and Requiem.",
      kuva: "Survival/Flood/Siphon. Farm Kuva to reroll Rivens. Flood gives more Kuva but is harder.",
      saryn: "Map nuker (constant AoE damage).",
      mirage: "Mirage nuker (Hall of Mirrors + Explosive Legerdemain).",
      support: "Buffs/energy for the squad (Trinity, Wisp, etc.).",
      jadeConstellation: "Jade Shadows constellation. Requires: completed Jade Shadows Railjack missions. Constellation farm.",
      follie: "Follie hunt at the Vesper Relay (Venus).",
    },
    lfgOpts: {
      radshare: "Radshare",
      radshareInfo: "ℹ️ What is Radshare?",
      eidolon: "Eidolon Hunt",
      profit: "Profit Taker",
      eda: "Deep Archimedea",
      archon: "Archon Hunt",
      netra: "Netracells",
      sortie: "Sortie",
      arbi: "Arbitration",
      netra: "Netracells",
      temporal: "Temporal Archimedea",
      circuit: "Circuit",
      eso: "ESO",
      so: "Sanctuary Onslaught",
      isovault: "Isolation Vault",
      kuva: "Kuva",
      sirius: "Sirius",
      orion: "Orion",
      follie: "Follie Hunt",
    },
    lfgRoles: {
      dps: "DPS",
      lure: "Lure",
      volt: "Volt",
      wisp: "Wisp",
      harrow: "Harrow",
      meta: "Meta",
      casual: "Casual",
      elite: "Elite",
      run3x3: "3x3",
      run5x3: "5x3",
      run6x3: "6x3",
      saryn: "Saryn",
      mirage: "Mirage",
      support: "Support",
      normal: "Normal",
      steelpath: "Steel Path",
      kuvaSurvival: "Survival",
    },
    purgeConfirmRelics: "Delete all saved Relics?",
    purgeConfirmParts: "Delete all Prime Inventory?",
    btnConfirm: "CONFIRM",
    btnCancel: "CANCEL",
    lblOwned: "owned",
    btnShowUpdates: "Patch Notes",
    updateModalTitle: "FEATURE HISTORY",
    updateModalGotIt: "Got it",
    lblRivenMedian: "Estimated base price (Median)",
    lblRivenLow: "Lowest Price:",
    lblRivenHigh: "Highest Price:",
    rewardScanner: {
      autoSyncLabel: "AUTO-SYNC",
      autoSyncTooltip: "YES: Sync EVERYTHING with SEEN (OCR Priority). NO: Only add +1 to the part you manually choose.",
      autoCopyLabel: "AUTO-COPY",
      autoCopyTooltip: "YES: Automatically copies results to clipboard after each scan in Warframe chat format.",
      rewardSelectedConfirmation: "{item} SELECTED +1",
      addBtn: "✓ ADD TO INVENTORY",
      lblSeen: "Seen",
      lblInv: "OWNED",
      tagBestPl: "BEST PLAT!",
      tagBestDuc: "BEST DUCAT!",
      tagCompletes: "COMPLETES SET!",
      mobileHint: "Tap 'ADD' to register in inventory",
    },
    history: {
      title: "RECENT DETECTIONS",
      empty: "No recent reward scans found.<br><span style='font-size:0.75rem; color:#aaa; opacity:0.8;'>Try playing a relic opening mission with the Live Scanner active!</span>",
      btnView: "VIEW CAPTURE",
      btnChoose: "CHOOSE",
      btnAdded: "ADDED",
      btnClearTooltip: "Clear history",
      toastCleared: "History cleared",
      btnLabel: "HISTORY"
    },
    recipe: "Recipe",
    stats: "Stats",
    recipeNotAvailable: "Recipe not available",
    requirements: "Requirements",
    dropLocations: "Drop Locations",
    lichSources: {
      unknown: "Unknown Source",
      kuva: "Kuva Lich (Vanquish)",
      tenet: "Sisters of Parvos (Vanquish)",
      coda: "Infested Liches (1999)"
    },
    rivenIndex: {
      trend: "TREND",
      potential: "POTENTIAL",
      medianUnrolled: "MEDIAN (UNROLLED)",
      medianRerolled: "MEDIAN (REROLLED)",
      maxRecorded: "MAX. RECORDED",
      wfmAverage: "WFM AVERAGE",
      ords: "ords",
      variantsLabel: "Variants",
      bestPositives: "BEST POSITIVES",
      worstPositives: "WORST POSITIVES",
      bestNegatives: "BEST NEGATIVES (HARMLESS)",
      worstNegatives: "WORST NEGATIVES (CRITICAL)"
    },
    arbitrage: {
      title: "Arbitrage (Flips)",
      loading: "Scanning opportunities…",
      error: "Failed to load.",
      updated: "Updated",
      scanned: "active",
      inventory: "inventory",
      shown: "shown",
      refresh: "Refresh",
      verified: "Live-verified",
      presetHint: "How much profit are you after?",
      presetAll: "All",
      presetSmall: "Small",
      presetGood: "Good",
      presetBig: "Jackpots",
      advanced: "Fine-tune",
      minSpread: "💰 Profit per flip",
      minPct: "📈 Margin",
      minPrice: "🏷️ Item price",
      sortBy: "Sort",
      sortSpread: "Profit",
      sortPct: "Margin",
      sortPrice: "Price",
      empty: "No opportunities with these filters.",
      disclaimer: "Market flips: buy at the lowest sell and resell to the highest buy. Verify live (↻) before acting; prices change instantly."
    },
    rivenHud: {
      compareTitle: "ROLL COMPARISON",
      current: "CURRENT",
      new: "NEW",
      score: "Score",
      est: "Est",
      verdictBetter: "IS BETTER",
      editCurrent: "EDIT CURRENT",
      editNew: "EDIT NEW",
      capture: "CAPTURE",
      gradeActual: "GRADING (CURRENT)",
      gradeNuevo: "GRADING (NEW)",
      sideCurrent: "CURRENT (L)",
      sideNew: "NEW (R)",
      captured: "CAPTURED"
    }
  },
};
export const AYA_STRATEGY_CONFIG = {
  minLevel: 40,
  maxLevel: 60,
  excludeSP: true,
  requiredReward: "Aya",
  priorities: [
    {
      id: "best",
      keywords: ["artifact", "hidden", "artefacto"],
      tagKey: "best",
    },
    {
      id: "fast",
      keywords: ["capture", "assassinate", "captura", "asesinato"],
      tagKey: "fast",
    },
    { id: "runnable", keywords: ["rescue", "rescate"], tagKey: "runnable" },
  ],
};

export const NODE_MAP = {
  SolNode718: "Cambire",
  SolNode719: "Persto",
  SolNode721: "Munio",
  SolNode715: "Effervo",
  SolNode716: "Anatomia",
  SolNode717: "Nex",
  // Zariman
  SolNode230: "Everview Arc",
  SolNode231: "Halako Perimeter",
  SolNode232: "Tuvul Commons",
  SolNode233: "Oro Works",
  SolNode235: "The Greenway",
  // Höllvania (1999)
  SolNode850: "Köbinn West",
  SolNode851: "Mischta Ramparts",
  SolNode852: "Old Konderuk",
  SolNode853: "Mausoleum East",
  SolNode854: "Rhu Manor",
  SolNode855: "Lower Vehrvod",
  SolNode856: "Victory Plaza",
  SolNode857: "Vehrvod District",
  SolNode858: "Solstice Square",
};

export const NODE_TO_TYPE = {
  SolNode230: "Void Flood",
  SolNode231: "Exterminate",
  SolNode232: "Void Cascade",
  SolNode233: "Void Armageddon",
  SolNode235: "Mobile Defense",
  SolNode715: "Assassination",
  SolNode716: "Assassination",
  SolNode717: "Exterminate",
  SolNode718: "Alchemy",
  SolNode719: "Survival",
  SolNode721: "Mirror Defense",
  SolNode850: "Alchemy",
  SolNode851: "Survival",
  SolNode852: "Survival",
  SolNode853: "Exterminate",
  SolNode854: "Exterminate",
  SolNode855: "Assassination",
  SolNode856: "Assassination",
  SolNode857: "Assassination",
  SolNode858: "Defense",
};
export const VANIA_NAMES = {
  Alchemy: "Legacyte Harvest",
  Survival: "Hell-Scrub",
  Exterminate: "Exterminate",
  Assassination: "Assassination",
  Defense: "Stage Defense",
  "Mobile Defense": "Mobile Defense",
};
export const CHALLENGE_MAP = {
  EntratiLabDefeatDoppelgangerChallenge: "Defeat grimoire mini boss",
  ZarimanExterminateNoPowersChallenge: "Cant use abilities",
  ZarimanAssassinateKillAngelsHardChallenge: "Kill 3 Angels",
  ZarimanKillCorpusEasyChallenge: "Kill 100 Corpus",
  EntratiLabKillVialedEnemyChallenge: "Kill enemies doused with vitriol",
  DestroyHazards: "Destroy Hazards",
  HighKill: "High Kill Count",
  SafeCracker: "Safe Cracker",
  VaniaExplodingInfested: "Exploding Infested when killed",
  DestroySpeakers: "Destroy Speakers",
  DestroyBackpacks: "Destroy Backpacks",
  DestroyVehicles: "Destroy Vehicles",
  LichVaniaHighKill: "Lich: High Kill Count",
  VaniaHighKillEasy: "Kill enemies from above (10)",
  VaniaDestroyPropsNormal: "Destroy 30 crates/stationary items",
  DestroyProps: "Destroy Props",
  VaniaInfestedCrossfire: "techrot emerges from below",
  ZarimanMobDefProtectShieldsChallenge:
    "Complete mission with objective not losing shields",
  ZarimanKillAsOperatorEasyChallenge: "Kill as Operator",
  ZarimanKillAsOperatorNormalChallenge: "Kill as Operator",
  ZarimanKillAsOperatorHardChallenge: "Kill as Operator",
  ZarimanKillAsOperatorVeryHardChallenge: "Kill as Operator",
  VaniaDestroyBackpacksVeryHard: "Destroy Backpacks",
  VaniaDestroyBackpacksHard: "Destroy Backpacks",
  ZarimanCorruptionCollectLargeOrbsEasyChallenge: "Collect Orbs",
  ZarimanUseVoidRiftsHardChallenge: "Use Lohk surges",
  ZarimanFloodCompleteWavesHardChallenge: "Complete rounds",
  ZarimanDefeatVoidAngelChallenge: "Defeat Void Angel",
  ZarimanFindMelicaCacheChallenge: "Find Melica's Cache",
  ZarimanFloodCompleteWavesVeryHardChallenge: "Complete rounds",
  VaniaSafeCracker: "Crack Safe",
  VaniaAbilityKillVeryHard: " Kill using abilities",
  VaniaAbilityKillHard: " Kill using abilities",
  VaniaAbilityKillEasy: " Kill using abilities",
  EntratiLabLootCratesChallenge: "Loot Crates",
  EntratiLabKillVoidRigEasyChallenge: "Kill Necramech",
  EntratiLabRangedMechWeakpointChallenge: "Mech Weakpoints",
  EntratiLabKillFlyingMurmurChallenge: "Kill Flying Murmur",
  EntratiLabKillMurmurVeryHardChallenge: "Kill Murmur",
  EntratiLabKillVoidRigHardChallenge: "Kill Necramech/S",
  EntratiLabKillVoidRigEasyChallenge: "Kill Necramech/s",
  EntratiLabLootCratesChallenge: "Destroy Crates",
  DestroyDemolystLimbs: "Destroy Demolyst Limbs",
  RangedMechWeakpoint: "Ranged Mech Weakpoint",
  LootCrates: "Loot Crates",
  KillFlyingMurmur: "Kill Flying Murmur",
  ActivateLohkSurge: "Activate Lohk Surge",
  KillMurmur: "Kill Murmur",
  ZarimanKillGrineerEasyChallenge: "Kill Grineer",
  ZarimanCorruptionCollectLargeOrbsHardChallenge: "Collect Orbs",
  ZarimanExterminateFastCompleteChallenge:
    "Finish in < 6 min(fast for exterminate)",
  ZarimanUseVoidRiftsEasyChallenge: "Use Lohk surges",
  ZarimanKillGrineerHardChallenge: "Kill Grineer",
  EntratiLabRangedMechWeakpointEasyChallenge: "Necramech Weakpoints",
  EntratiLabKillMurmurChallenge: "Kill Murmur",
};
export const ALLY_MAP = {
  QuincyAllyAgent: "Quincy",
  AmirAllyAgent: "Amir",
  EleanorAllyAgent: "Eleanor",
  AoiAllyAgent: "Aoi",
  LettieAllyAgent: "Lettie",
  ArthurAllyAgent: "Arthur",
};
export const DUAL_PATH_FACTIONS = new Set([
  "The Holdfasts",
  "Cavia",
  "The Hex",
]);
export const ZARIMAN_DATA = {
  counts: {
    normal: [1, 1, 2, 3, 4, 5],
    sp: [2, 2, 3, 5, 6, 8],
  },
  value: 2500,
};
export const BOUNTY_NAMES = {
  Ostrons: {
    "5-15": "Spy Catcher",
    "10-30": "Search and Rescue",
    "20-40": "Cull the Enemy",
    "30-50": "Capture Leader",
    "40-60": "Sabotage Lines",
    "100-100": "Sabotage Bounty",
    "50-70": "Rise and Fall",
  },
  Entrati: {
    "5-15": "Salvage",
    "15-25": "Core Samples",
    "25-30": "Anomaly Retrieval",
    "30-40": "Cleanse the Land",
    "40-60": "For Science!",
    "100-100": "Brute Force",
  },
  "Solaris United": {
    "5-15": "Scorched Earth",
    "10-30": "Bury Them",
    "20-40": "Seems Legit",
    "30-50": "Hunter-Killer",
    "40-60": "Courier Ambush",
    "100-100": "Software Subterfuge",
    "50-70": "Master's Voice",
  },
};
export const OPTIMAL_FILTERS = [
  {
    factions: ["The Holdfasts"],
    tiers: [4, 5, 6],
    types: ["Exterminate"],
    challenges: [
      "ZarimanDefeatVoidAngelChallenge",
      "ZarimanExterminateFastCompleteChallenge",
    ],
  },
  {
    types: ["Exterminate", "Capture"],
    factions: ["Ostrons", "Solaris United", "Entrati"],
  },
];
