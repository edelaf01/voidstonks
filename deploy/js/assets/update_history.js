// Historial de versiones que pinta el modal de novedades. Es contenido (HTML por idioma), no
// configuración, y ocupaba 1041 de las 3154 líneas de config.js.
//
// Se reexporta desde config.js, que es de donde se importa.

export const UPDATE_HISTORY_DATA = {
  es: `
<nav class="update-index" aria-label="Versiones">
  <span class="update-index-label">Versiones</span>
  <a href="#v280" class="update-index-link is-current">v2.8</a>
  <a href="#v272" class="update-index-link">v2.7.2</a>
  <a href="#v271" class="update-index-link">v2.7.1</a>
  <a href="#v27" class="update-index-link">v2.7</a>
  <a href="#v2661" class="update-index-link">v2.6.6.1</a>
  <a href="#v266" class="update-index-link">v2.6.6</a>
  <a href="#v265" class="update-index-link">v2.6.5</a>
  <a href="#v264" class="update-index-link">v2.6.4</a>
</nav>
<div class="update-block" id="v280">
  <div class="update-header">
    <span class="update-version">v2.8 (Actual)</span>
    <span class="update-date">2026-08-19</span>
  </div>

  <h4 class="update-section">Escáner</h4>
  <ul class="update-list">
    <li>Menos escaneos fallidos: ya no confunde la pantalla de reliquias con la de recompensas.</li>
  </ul>

  <h4 class="update-section">Rutas de farmeo (nuevo)</h4>
  <p class="update-lead">
    <strong>Qué reliquia abrir ahora mismo para cerrar un set que tienes a medias.</strong>
    Cruza las piezas que te faltan con las fisuras abiertas y con las reliquias que ya tienes:
    por cada pieza te dice cuál abrir, a qué misión ir y cuántas runs suele costar. La otra
    cara, «Por reliquia», va al revés: de las que tienes, cuál te acerca a más sets de una
    sola apertura.
  </p>
  <p class="update-lead">
    Necesita saber qué tienes. Escanea tu inventario con el escáner en vivo o añade las
    reliquias a mano: sin eso no hay nada que cruzar y el panel sale vacío.
  </p>
  <ul class="update-list">
    <li>Ahora también en Reliquia y Set, no solo en el inventario.</li>
    <li>Pulsa una reliquia y ves su contenido sin cambiar de pestaña.</li>
    <li>Vista por reliquia: cuáles de las tuyas te acercan a más sets, con sus propios
    filtros y órdenes.</li>
    <li>Te dice si refinar renta: cuánto platino de más y a cuántos vestigios sale.</li>
    <li>Filtros por era, platino por hora y ganancia. La era elegida decide además qué
    reliquia se te recomienda.</li>
    <li>Cuenta tu excedente: 4 planos = 4 sets.</li>
    <li>Entran todos los sets, empezados o no.</li>
  </ul>

  <h4 class="update-section">Interfaz</h4>
  <ul class="update-list">
    <li>Tus sets a medias, a la vista en la pestaña Set.</li>
    <li>Tooltips de vuelta en móvil; escáner e inventario traducidos.</li>
  </ul>
</div>
<div class="update-block" id="v272">
  <div class="update-header">
    <span class="update-version">v2.7.2</span>
    <span class="update-date">2026-08-07</span>
  </div>

  <p class="update-lead">
    <strong>Los stats se valoran arma por arma.</strong> Antes casi todas compartían la misma lista de
    stats buenos; ahora cada una usa sus propios datos de mercado.
  </p>
  <ul class="update-list">
    <li><strong>El 98% de las armas ya se gradúa con sus propios datos</strong> (antes el 10%). En Bo,
    Critical Chance baja a medio y suben Alcance y Velocidad de Ataque; en Kuva Bramma, Toxina sube a
    lo más alto. Antes todas veían Crítico y Multidisparo.</li>
    <li><strong>Se marcan los 1-2 stats decisivos</strong> dentro de los mejores, con etiqueta TOP.</li>
    <li><strong>Las variantes comparten ficha.</strong> Obex y Prisma Obex son el mismo riven, así que
    ya no muestran recomendaciones distintas ni contradictorias.</li>
    <li><strong>Combos elementales medidos.</strong> Viral se paga (1.4× frente a otros pares) y se
    premia; Gas se paga menos (0.76×) y ya no cobra bonus. Corrosivo cobraba lo mismo que Viral sin
    merecerlo.</li>
    <li><strong>El aviso de sobreprecio ya distingue.</strong> Marcaba el 87% de las armas; ahora el
    42%, y las que no tienen ventas suficientes lo dicen en vez de inventar un veredicto.</li>
    <li><strong>Carrusel de movimientos del mercado</strong> en el índice y en la ficha del arma:
    subidas y bajadas bruscas de los últimos 21 días, con el tramo de fechas y si coinciden con la
    publicación semanal de Digital Extremes. Se actualiza a diario.</li>
    <li><strong>Textos y filtros reescritos.</strong> "Mediana del Juego" pasa a "Precio de venta
    real" y "Precio Premium" a "Lo que piden en WFM": eran el mismo tipo de dato en apariencia y se
    diferencian en un orden de magnitud.</li>
  </ul>
  <p class="update-note">
    Precisión: sobre 1434 subastas reales, la app ordena los rolls como el mercado en el
    <strong>85%</strong> de las armas. El error medio sigue en el <strong>47%</strong>: dos rivens
    idénticos se listan a precios distintos, y eso no lo arregla ningún ajuste.
  </p>
</div>
<div class="update-block" id="v271">
  <div class="update-header">
    <span class="update-version">v2.7.1</span>
    <span class="update-date">2026-08-04</span>
  </div>

  <p class="update-lead">
    <strong>Tasación de rivens rehecha.</strong> Los precios salían altos, y cuanto más popular era el
    arma, peor. Ahora siguen lo que los rivens se <em>venden</em>, no lo que piden los vendedores.
  </p>
  <ul class="update-list">
    <li><strong>Las armas populares ya no salen infladas.</strong> Era donde más se desviaba el precio.</li>
    <li><strong>Ahora cuenta cuánto rolaron tus stats</strong>, no solo cuáles son: un crítico rolado
    al mínimo ya no puntúa como un godroll.</li>
    <li><strong>Las negativas se juzgan por arma.</strong> −Multishot destroza un rifle que vive de él,
    pero apenas afecta a un melee. El retroceso y el daño por facción dejan de ser inofensivos por
    decreto.</li>
    <li><strong>Negativas imposibles.</strong> Los elementales y la perforación no pueden salir como
    maldición: si el escáner lee un menos ahí, lo corrige.</li>
    <li><strong>Arreglado:</strong> un arma con una sola venta cara se tasaba entera por ella, y en
    algunas armas de poco volumen el godroll y el roll basura salían al mismo precio.</li>
  </ul>

  <p class="update-foot">
    <em>La tasación es una guía: dos rivens idénticos se listan a precios distintos porque cada
    vendedor pone lo que quiere. Usa el rango, no el número único.</em>
  </p>
</div>
<div class="update-block old" id="v27">
  <div class="update-header">
    <span class="update-version">v2.7</span>
    <span class="update-date">2026-08-03</span>
  </div>

  <p class="update-lead">
    Nueva pestaña <strong>Mis órdenes</strong>: gestiona tus ventas de warframe.market
    desde la app.
  </p>

  <h4 class="update-section">Qué puedes hacer</h4>
  <ul class="update-list">
    <li><strong>Ver tus órdenes</strong> con el precio del mercado al lado.</li>
    <li><strong>Editar precio, cantidad y rango</strong>, marcar vendido, ocultar o borrar.</li>
    <li><strong>Publicar sets del inventario</strong> con un precio sugerido.</li>
    <li><strong>Precios en vivo</strong>, actualizados solos.</li>
    <li><strong>Avisos</strong> si alguien te rebaja.</li>
  </ul>

  <h4 class="update-section">En pantalla</h4>
  <ul class="update-list">
    <li><strong>Botón «Vender»</strong> en el inventario y en el tracker de sets, con etiqueta «En venta» en los ya publicados.</li>
    <li><strong>Mods y arcanos por rango</strong>: el precio de rango 0 y el de rango máximo se muestran por separado.</li>
  </ul>

  <h4 class="update-section">Arreglos</h4>
  <ul class="update-list">
    <li><strong>Los ítems no cargaban</strong> con inventarios grandes.</li>
    <li><strong>Iconos rotos</strong> en mods y otros ítems sin imagen propia.</li>
  </ul>

  <p class="update-foot">
    <em>Algunas cuentas solo podrán leer sus órdenes, no editarlas. La app lo indica
    cuando pasa. Tu contraseña no se guarda.</em>
  </p>
</div>
<div class="update-block old" id="v2661">
  <div class="update-header">
    <span class="update-version">v2.6.6.1</span>
    <span class="update-date">2026-08-01</span>
  </div>
  <ul class="update-list">
    <li><strong>Parche pequeño: limpieza interna y arreglos sueltos.</strong> Sin funciones nuevas.</li>
    <li><strong>Botones que no respondían.</strong> "Cancelar" en el aviso de borrar inventario no cerraba la ventana, y "RESET DEFAULTS" en los ajustes del escáner no hacía nada. Ambos arreglados.</li>
    <li><strong>Menos memoria en el móvil.</strong> Al cerrar el escáner ya se libera todo lo que usaba; antes había que recargar la página. Además, el escáner solo carga el segundo motor de lectura cuando de verdad hace falta.</li>
    <li><strong>Textos corregidos.</strong> Algunas etiquetas repetidas mostraban la versión equivocada (por ejemplo "Destroy Crates" en vez de "Loot Crates").</li>
    <li><strong>Avisos más seguros.</strong> Los nombres que vienen del mercado o del escáner ya no pueden colarse como código en los mensajes emergentes.</li>
  </ul>
</div>
<div class="update-block old" id="v266">
  <div class="update-header">
    <span class="update-version">v2.6.6</span>
    <span class="update-date">2026-07-29</span>
  </div>
  <ul class="update-list">
    <li><strong>Escáner móvil renovado.</strong> Apunta a la pantalla y dispara: ya no hay que alinear la caja ni indicar cuántas recompensas hay. Escanea 3 veces más rápido (menos de 1 segundo), lee bien los nombres largos y de dos líneas, y avisa con vibración al detectarlas. La pantalla del móvil no se apaga mientras lo tienes abierto, así que puedes dejarlo apoyado apuntando al monitor.</li>
    <li><strong>Resultados más claros.</strong> Se ven las cuatro recompensas a la vez en vertical y en horizontal, con el icono de cada pieza. Añadir una ya no cierra la lista, así que puedes registrar varias seguidas. Si algo falla, te dice qué corregir: acercarte, evitar el reflejo o sujetar el móvil más recto.</li>
    <li><strong>Inventario corregido.</strong> El escáner ahora usa la cantidad que muestra el juego en lugar de sumar de uno en uno, así que se acabaron los desajustes. Nuevo botón para cuadrar las cuatro recompensas de golpe.</li>
  </ul>
</div>
<div class="update-block old" id="v265">
  <div class="update-header">
    <span class="update-version">v2.6.5</span>
    <span class="update-date">2026-07-25</span>
  </div>
  <ul class="update-list">
    <li><strong>Nuevo: Fisuras para tus sets.</strong> En Inventario, un bloque te dice qué fisura activa te conviene para completar tus sets, y te avisa si sale más a cuenta comprar la pieza que farmearla.</li>
    <li><strong>Cantidades del inventario corregidas:</strong> las que llevaban varios "1" (119, 111...) salían a medias.</li>
    <li><strong>Menos recompensas fantasma</strong> durante el escaneo.</li>
    <li><strong>El escáner de rivens ya no se queda colgado</strong> ni pierde la última lectura buena.</li>
  </ul>
</div>
<div class="update-block old" id="v264">
  <div class="update-header">
    <span class="update-version">v2.6.4</span>
    <span class="update-date">2026-07-19</span>
  </div>
  <ul class="update-list">
    <li><strong>Escáner de recompensas mejorado:</strong> los nombres largos salían cortados o no se detectaban.</li>
    <li><strong>Recompensas fantasma corregidas</strong> en Camino de Acero y en la pantalla de fin de misión.</li>
    <li><strong>Los planos ya no se pierden</strong> al escanear.</li>
    <li><strong>Lectura correcta con cualquier tinte de misión,</strong> y cada contador va a su tarjeta.</li>
    <li><strong>Filtro de Camino de Acero en alarmas:</strong> puedes elegir si las alarmas de fisuras se activan solo en Camino de Acero, en misiones normales o en ambas.</li>
    <li><strong>Alarmas de arbitración:</strong> avisos cuando la arbitración activa cumpla el tier o tipo de misión que elijas.</li>
    <li><strong>Próxima arbitración S:</strong> cuenta atrás en vivo para la siguiente rotación tier S.</li>
    <li><strong>Escáner de reliquias reparado:</strong> la pestaña RELIQUIAS no escaneaba nada; ahora lee la página entera, Requiem incluidas.</li>
    <li><strong>Cantidades bien leídas en la última columna</strong> del inventario.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.6.3</span>
    <span class="update-date">2026-07-18</span>
  </div>
  <ul class="update-list">
    <li><strong>Calculadora de Ducados:</strong> Añadida una herramienta de Ducados en el inventario para ver rápidamente el valor de tus piezas Prime.</li>
    <li><strong>Guía de Usuario:</strong> Añadida una guía de usuario que se irá expandiendo en el futuro.</li>
    <li><strong>Correcciones:</strong> Solucionado un problema por el que las Fisuras y Arbitraciones no se actualizaban o desaparecían de la lista.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.6.2</span>
    <span class="update-date">2026-07-18</span>
  </div>
  <ul class="update-list">
    <li><strong>Escáner de recompensas más preciso:</strong> las tarjetas ahora aparecen bien alineadas debajo de su recompensa y ya no se intercambian entre recompensas con nombres parecidos.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.6.1</span>
    <span class="update-date">2026-07-15</span>
  </div>
  <ul class="update-list">
    <li><strong>Corrección de fisuras:</strong> Las fisuras recomendadas y arbitraciones ahora se muestran siempre correctamente.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.6.0</span>
    <span class="update-date">2026-07-11</span>
  </div>
  <ul class="update-list">
    <li><strong>Ficha de armas mejorada:</strong> las armas con disparo alternativo ahora muestran cada modo por separado (Normal, Alt-Fire...) con sus propios stats. Además una etiqueta te dice si el arma escala Condition Overload de forma multiplicativa o plana.</li>
    <li><strong>Nueva arma: Haalvu.</strong></li>
    <li><strong>Disposiciones de riven al día:</strong> actualizadas al último reajuste del juego.</li>
    <li><strong>Escáner más fiable:</strong> detecta recompensas que antes se saltaba (sobre todo con fondos claros) y reconoce mejor las piezas del inventario, sin confundir el icono de fundición con un número.</li>
    <li><strong>Copiar recompensas:</strong> al escanear una recompensa puedes pegarla en el chat al instante.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.5.0</span>
    <span class="update-date">2026-07-04</span>
  </div>
  <ul class="update-list">
    <li><strong>Calculadora de Vosfor:</strong> Compara al instante si te conviene vender un arcano en Warframe Market o disolverlo en Vosfor. Te muestra qué paquete de Loid te da más Platinum medio y se vende más rápido, y simula cuánto Vosfor necesitas para conseguir las copias de tu arcano objetivo.</li>
    <li><strong>Simulador de Runs (Set Tracker):</strong> Muestra los runs promedio necesarios para conseguir 1 copia de cualquier pieza según la refinación de la reliquia y el número de jugadores (1 a 4), junto a su rango de caso mejor y peor (95% de confianza).</li>
    <li><strong>Corrección de errores (Reliquias):</strong> Solucionado el fallo al buscar reliquias escribiendo directamente el nombre de la recompensa deseada (ej: "kronen", "rhino") o por era ("Lith", "Meso", "Neo", "Axi").</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.4.0</span>
    <span class="update-date">2026-07-02</span>
  </div>
  <ul class="update-list">
    <li><strong>Tasación de Rivens rediseñada</strong>
      <ul>
        <li>Todo visible sin hacer scroll, en móvil y escritorio: precio estimado y nota (S/A/B/C/F) al frente, y el resto como fichas compactas.</li>
        <li>La tabla de grados por stat (valor, rango ideal y nota) ahora aparece junto a la carta del riven.</li>
        <li>Adiós a la jerga: cada dato explica qué significa al pasar el ratón o tocarlo ("Demanda", "Precio típico", "Stats buscados"...), en español e inglés.</li>
      </ul>
    </li>
    <li><strong>Tasación más precisa</strong>
      <ul>
        <li>Nuevo indicador "En venta ahora": si hay rivens con tu mismo combo listados en el mercado, la tasación se ajusta a esos precios reales.</li>
        <li>El escáner en vivo ahora usa el historial de precios del arma (antes tasaba sin él y podía desviarse en armas volátiles).</li>
        <li>El rango de precio ya no usa el techo godroll del arma para cualquier roll: un combo poco buscado muestra un techo realista.</li>
        <li>El modelo distingue mejor un precio troll de una subida real de mercado (Incarnons, buffs), y se reentrena solo cada semana con datos frescos.</li>
      </ul>
    </li>
    <li><strong>Escáner de Rivens:</strong> panel más compacto (cabe en pantalla en móvil), captura plegada por defecto y comparativa con el precio de cada roll destacado.</li>
    <li><strong>Aviso sobre los precios:</strong> la tasación es un <strong>indicador orientativo</strong>, no un precio garantizado. En rolls muy altos y godrolls el margen de error crece (hay pocas ventas de referencia), así que úsala como punto de partida y contrasta con los listados en vivo antes de cerrar un trato.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.3.0</span>
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
    <li><strong>⚠️ Aviso:</strong> las tasaciones son solo una guía orientativa y pueden variar mucho según el mercado. El escáner de rivens está en <strong>versión de pruebas (beta)</strong>.</li>
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
<nav class="update-index" aria-label="Versions">
  <span class="update-index-label">Versions</span>
  <a href="#v280" class="update-index-link is-current">v2.8</a>
  <a href="#v272" class="update-index-link">v2.7.2</a>
  <a href="#v271" class="update-index-link">v2.7.1</a>
  <a href="#v27" class="update-index-link">v2.7</a>
  <a href="#v2661" class="update-index-link">v2.6.6.1</a>
  <a href="#v266" class="update-index-link">v2.6.6</a>
  <a href="#v265" class="update-index-link">v2.6.5</a>
  <a href="#v264" class="update-index-link">v2.6.4</a>
</nav>
<div class="update-block" id="v280">
  <div class="update-header">
    <span class="update-version">v2.8 (Current)</span>
    <span class="update-date">2026-08-19</span>
  </div>

  <h4 class="update-section">Scanner</h4>
  <ul class="update-list">
    <li>Fewer failed scans: it no longer mistakes the relic screen for the reward one.</li>
  </ul>

  <h4 class="update-section">Farm routes (new)</h4>
  <p class="update-lead">
    <strong>Which relic to crack right now to finish a set you have half-built.</strong>
    It cross-references the parts you are missing with the open fissures and with the relics
    you already own: for each part it tells you which one to crack, which mission to run and
    how many runs it usually takes. The other side, "By relic", works backwards: of the ones
    you own, which gets you closer to more sets in a single crack.
  </p>
  <p class="update-lead">
    It needs to know what you own. Scan your inventory with the live scanner or add the relics
    by hand: without that there is nothing to cross-reference and the panel comes up empty.
  </p>
  <ul class="update-list">
    <li>Click a relic and see its contents without switching tabs.</li>
    <li>By-relic view: which of yours get you closer to more sets, with its own filters
    and sort orders.</li>
    <li>It tells you whether refining pays: how much extra platinum, and at how many traces.</li>
    <li>Filters by era, platinum per hour and gain. The chosen era also decides which relic
    gets recommended.</li>
  </ul>

  <h4 class="update-section">Interface</h4>
  <ul class="update-list">
    <li>Tooltips work on mobile again; scanner and inventory translated.</li>
  </ul>
</div>
<div class="update-block" id="v272">
  <div class="update-header">
    <span class="update-version">v2.7.2</span>
    <span class="update-date">2026-08-07</span>
  </div>

  <p class="update-lead">
    <strong>Stats are now valued weapon by weapon.</strong> Almost every weapon used to share the same
    list of good stats; each one now uses its own market data.
  </p>
  <ul class="update-list">
    <li><strong>98% of weapons are now graded from their own data</strong> (previously 10%). On Bo,
    Critical Chance drops to mid while Range and Attack Speed rise; on Kuva Bramma, Toxin reaches the
    top tier. Before, every weapon showed Critical and Multishot.</li>
    <li><strong>The 1-2 decisive stats are highlighted</strong> among the best ones, tagged TOP.</li>
    <li><strong>Variants share one guide.</strong> Obex and Prisma Obex are the same riven, so they no
    longer show different or contradictory recommendations.</li>
    <li><strong>Elemental combos measured.</strong> Viral does get paid for (1.4x versus other pairs)
    and is rewarded; Gas sells for less (0.76x) and no longer earns a bonus. Corrosive was paid the
    same as Viral without deserving it.</li>
    <li><strong>The overpriced warning now discriminates.</strong> It flagged 87% of weapons; now 42%,
    and those without enough sales say so instead of inventing a verdict.</li>
    <li><strong>Market movement carousel</strong> on the index and on each weapon page: sharp rises and
    drops over the last 21 days, with the date range and whether they line up with the Digital
    Extremes weekly release. Updated daily.</li>
    <li><strong>Labels and filters rewritten.</strong> "Game Median" becomes "Real sale price" and
    "Premium Price" becomes "Asking price on WFM": they looked like the same kind of figure and differ
    by an order of magnitude.</li>
  </ul>
  <p class="update-note">
    Accuracy: across 1434 real auctions, the app ranks rolls like the market does on
    <strong>85%</strong> of weapons. Average error stays at <strong>47%</strong>: two identical rivens
    get listed at different prices, and no amount of tuning fixes that.
  </p>
</div>
<div class="update-block" id="v271">
  <div class="update-header">
    <span class="update-version">v2.7.1</span>
    <span class="update-date">2026-08-04</span>
  </div>

  <p class="update-lead">
    <strong>Riven appraisal rebuilt.</strong> Prices were too high, and the more popular the weapon,
    the worse it got. Now they follow what rivens actually <em>sell</em> for, not what sellers ask.
  </p>
  <ul class="update-list">
    <li><strong>Popular weapons are no longer overpriced.</strong> That's where the price drifted most.</li>
    <li><strong>How high your stats rolled now counts</strong>, not just which ones: a crit roll at the
    lowest values no longer scores like a godroll.</li>
    <li><strong>Negatives are judged per weapon.</strong> −Multishot wrecks a rifle that lives on it but
    barely touches a melee. Recoil and faction damage are no longer harmless by decree.</li>
    <li><strong>Impossible negatives.</strong> Elemental damage and Punch Through can't roll as a curse:
    if the scanner reads a minus there, it corrects it.</li>
    <li><strong>Fixed:</strong> a weapon with a single expensive sale was priced off that one trade, and
    on some low-volume weapons the godroll and the trash roll came out at the same price.</li>
  </ul>

  <p class="update-foot">
    <em>Appraisals are a guide: two identical rivens get listed at different prices because each seller
    picks their own. Use the range, not the single number.</em>
  </p>
</div>
<div class="update-block old" id="v27">
  <div class="update-header">
    <span class="update-version">v2.7</span>
    <span class="update-date">2026-08-03</span>
  </div>

  <p class="update-lead">
    New <strong>My orders</strong> tab: manage your warframe.market sales from the app.
  </p>

  <h4 class="update-section">What you can do</h4>
  <ul class="update-list">
    <li><strong>See your orders</strong> with the market price next to them.</li>
    <li><strong>Edit price, quantity and rank</strong>, mark as sold, hide or delete.</li>
    <li><strong>List sets from your inventory</strong> with a suggested price.</li>
    <li><strong>Live prices</strong>, updated on their own.</li>
    <li><strong>Alerts</strong> when someone undercuts you.</li>
  </ul>

  <h4 class="update-section">On screen</h4>
  <ul class="update-list">
    <li><strong>"Sell" button</strong> in the inventory and the set tracker, with a "Listed" tag on the ones already up.</li>
    <li><strong>Mods and arcanes by rank</strong>: rank 0 and max rank prices are shown separately.</li>
  </ul>

  <h4 class="update-section">Fixes</h4>
  <ul class="update-list">
    <li><strong>Items failed to load</strong> with large inventories.</li>
    <li><strong>Broken icons</strong> on mods and other items without their own image.</li>
  </ul>

  <p class="update-foot">
    <em>Some accounts can only read their orders, not edit them. The app tells you when
    that happens. Your password is never stored.</em>
  </p>
</div>
<div class="update-block old" id="v2661">
  <div class="update-header">
    <span class="update-version">v2.6.6.1</span>
    <span class="update-date">2026-08-01</span>
  </div>
  <ul class="update-list">
    <li><strong>Small patch: internal cleanup and loose fixes.</strong> No new features.</li>
    <li><strong>Buttons that did nothing.</strong> "Cancel" on the clear-inventory prompt didn't close the dialog, and "RESET DEFAULTS" in the scanner settings had no effect. Both fixed.</li>
    <li><strong>Lower memory on mobile.</strong> Closing the scanner now frees everything it was using; before, only a page reload did. The scanner also loads its second reading engine only when it's actually needed.</li>
    <li><strong>Text fixes.</strong> A few duplicated labels showed the wrong wording (for example "Destroy Crates" instead of "Loot Crates").</li>
    <li><strong>Safer notifications.</strong> Names coming from the market or the scanner can no longer leak into pop-up messages as code.</li>
  </ul>
</div>
<div class="update-block old" id="v266">
  <div class="update-header">
    <span class="update-version">v2.6.6</span>
    <span class="update-date">2026-07-29</span>
  </div>
  <ul class="update-list">
    <li><strong>Mobile scanner revamped.</strong> Point at the screen and shoot: no lining up a box, no telling it how many rewards there are. Scans 3× faster (under a second), reads long and two-line names properly, and buzzes when it detects them. Your phone screen stays on while it's open, so you can prop it up facing the monitor.</li>
    <li><strong>Clearer results.</strong> All four rewards visible at once in portrait and landscape, each with its item icon. Adding one no longer closes the list, so you can register several in a row. If something fails, it tells you what to fix: get closer, avoid glare, or hold the phone straighter.</li>
    <li><strong>Inventory fixed.</strong> The scanner now uses the count the game shows instead of adding one at a time, so no more drift. New button to square all four rewards at once.</li>
  </ul>
</div>
<div class="update-block old" id="v265">
  <div class="update-header">
    <span class="update-version">v2.6.5</span>
    <span class="update-date">2026-07-25</span>
  </div>
  <ul class="update-list">
    <li><strong>New: Fissures for your sets.</strong> In Inventory, a block shows which active fissure helps complete your sets, and flags when buying the part beats farming it.</li>
    <li><strong>Inventory quantities fixed:</strong> the ones with several "1"s (119, 111...) came through half-read.</li>
    <li><strong>Fewer ghost rewards</strong> while scanning.</li>
    <li><strong>The Riven scanner no longer freezes</strong> or loses its last good reading.</li>
  </ul>
</div>
<div class="update-block old" id="v264">
  <div class="update-header">
    <span class="update-version">v2.6.4</span>
    <span class="update-date">2026-07-19</span>
  </div>
  <ul class="update-list">
    <li><strong>Reward scanner improved:</strong> long names used to arrive cut off or undetected.</li>
    <li><strong>Ghost rewards fixed:</strong> fake rewards under Steel Path red tint no longer appear or replace real rewards. End-of-mission screen text (bonuses, player names) can no longer be mistaken for a Warframe name and change the detected reward either.</li>
    <li><strong>Undetected blueprints fixed:</strong> blueprints previously discarded by error are now reliably detected.</li>
    <li><strong>Correct reading under any mission tint,</strong> with each counter landing on its own card.</li>
    <li><strong>Steel Path filter for fissure alarms:</strong> options added to trigger alarms for Steel Path fissures, normal fissures, or both.</li>
    <li><strong>Arbitration alarms:</strong> new panel block to alert you when active Arbitrations meet a chosen community tier or mission type.</li>
    <li><strong>Next S-tier Arbitration:</strong> live countdown added for upcoming S-tier rotations, with notifications if none occur within 12 hours.</li>
    <li><strong>Relic scanner fixed:</strong> the RELICS inventory tab scanned nothing; it now reads all 18 cells per page, Requiem relics included, and tolerates typical OCR misreads in relic names.</li>
    <li><strong>Correct quantities in the last column</strong> of the inventory.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.6.3</span>
    <span class="update-date">2026-07-18</span>
  </div>
  <ul class="update-list">
    <li><strong>Inventory Ducat Calculator:</strong> Added a Ducats tool overlay for the inventory to calculate the value of your Prime parts.</li>
    <li><strong>User Guide:</strong> Added a new user guide that will be expanded in the future.</li>
    <li><strong>Bug Fixes:</strong> Fixed an issue where Fissures and Arbitrations were failing to update or disappearing from the list.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.6.2</span>
    <span class="update-date">2026-07-18</span>
  </div>
  <ul class="update-list">
    <li><strong>More accurate reward scanner:</strong> cards now line up correctly under their reward and no longer get swapped between rewards with similar names.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.6.1</span>
    <span class="update-date">2026-07-15</span>
  </div>
  <ul class="update-list">
    <li><strong>Fissures fix:</strong> Recommended fissures and arbitrations now always display correctly.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.6.0</span>
    <span class="update-date">2026-07-11</span>
  </div>
  <ul class="update-list">
    <li><strong>Better weapon panel:</strong> weapons with an alternate fire now show each mode separately (Normal, Alt-Fire...) with its own stats. There's also a tag telling you whether the weapon scales Condition Overload multiplicatively or flat.</li>
    <li><strong>New weapon: Haalvu.</strong></li>
    <li><strong>Riven dispositions updated:</strong> synced to the game's latest disposition pass.</li>
    <li><strong>More reliable scanner:</strong> picks up rewards it used to miss (especially on bright backgrounds) and recognizes inventory parts better, no longer mistaking the foundry icon for a number.</li>
    <li><strong>Copy rewards:</strong> paste a scanned reward straight into chat.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.5.0</span>
    <span class="update-date">2026-07-04</span>
  </div>
  <ul class="update-list">
    <li><strong>Vosfor Calculator:</strong> Instantly compares whether to sell your arcanes on Warframe Market or dissolve them into Vosfor. Shows which Loid pack yields the highest expected Platinum and fastest sales, and simulates how much Vosfor you need to farm your target arcane.</li>
    <li><strong>Runs Simulator (Set Tracker):</strong> Displays average expected runs to get 1 copy of any part based on relic refinement and squad size (1 to 4 players), along with best and worst case ranges (95% confidence).</li>
    <li><strong>Bugfixes (Relics):</strong> Fixed search issues when searching relics directly by item reward name (e.g. "kronen", "rhino") or era ("Lith", "Meso", "Neo", "Axi").</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.4.0</span>
    <span class="update-date">2026-07-02</span>
  </div>
  <ul class="update-list">
    <li><strong>Riven appraisal redesigned</strong>
      <ul>
        <li>Everything visible without scrolling, on mobile and desktop: estimated price and grade (S/A/B/C/F) up front, everything else as compact chips.</li>
        <li>The per-stat grade table (value, ideal range and grade) now sits next to the riven card.</li>
        <li>No more jargon: every value explains itself on hover or tap ("Demand", "Typical price", "Wanted stats"...</li>
      </ul>
    </li>
    <li><strong>More accurate appraisals</strong>
      <ul>
        <li>New "On sale now" indicator: if rivens with your exact combo are listed on the market, the appraisal adjusts to those real prices.</li>
        <li>The live scanner now uses the weapon's price history (it previously appraised without it and could drift on volatile weapons).</li>
        <li>The price range no longer uses the weapon's godroll ceiling for every roll: an unwanted combo now shows a realistic ceiling.</li>
        <li>The model better separates troll listings from genuine market shifts (Incarnons, buffs), and retrains itself weekly on fresh data.</li>
      </ul>
    </li>
    <li><strong>Riven scanner:</strong> more compact panel (fits on screen on mobile), capture collapsed by default, and the comparison view highlights each roll's price.</li>
    <li><strong>A note on prices:</strong> the appraisal is a <strong>guideline, not a guaranteed price</strong>. On very high rolls and godrolls the margin of error grows (there are few reference sales), so treat it as a starting point and check live listings before closing a trade.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.3.0</span>
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
    <li><strong>⚠️ Note:</strong> appraisals are a rough guide only and can vary a lot with the market. The riven scanner is in <strong>beta (testing)</strong>.</li>
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
    <span class="update-version">v1.2.4</span>
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
