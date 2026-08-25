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

  <h4 class="update-section">Rutas de farmeo</h4>
  <p class="update-lead">
    Te dice qué reliquia abrir para terminar los sets que llevas a medias. Cruza las piezas
    que te faltan con lo que ya tienes y con las fisuras abiertas, y te da la reliquia, la
    misión y las runs que suele costar. La otra pestaña, «Por reliquia», empieza por lo que
    tienes: de tus reliquias, cuál te acerca a más sets abriéndola una sola vez.
  </p>
  <p class="update-lead">
    Necesita tu inventario. Escanéalo con el escáner en vivo o mete las reliquias a mano;
    sin eso el panel sale vacío.
  </p>
  <ul class="update-list">
    <li>Filtros por era, platino por hora y ganancia. La era que elijas cambia la reliquia
    que se recomienda.</li>
    <li>Te dice si compensa refinar: cuánto platino de más y a cuántos vestigios sale.</li>
    <li>Cuenta tu excedente. Cuatro planos son cuatro sets.</li>
    <li>Entran todos los sets, los empezados y los que no.</li>
    <li>Pulsa una reliquia y ves su contenido sin salir de la pestaña.</li>
    <li>Está también en Reliquia y en Set, no solo en Inventario.</li>
  </ul>

  <h4 class="update-section">Escáner</h4>
  <ul class="update-list">
    <li>Ya no confunde la pantalla de reliquias con la de recompensas, así que fallan
    menos escaneos.</li>
  </ul>

  <h4 class="update-section">Interfaz</h4>
  <ul class="update-list">
    <li>Los sets que llevas a medias se ven en la pestaña Set.</li>
    <li>Vuelven los tooltips en móvil. Escáner e inventario, traducidos.</li>
  </ul>
</div>
<div class="update-block" id="v272">
  <div class="update-header">
    <span class="update-version">v2.7.2</span>
    <span class="update-date">2026-08-07</span>
  </div>

  <h4 class="update-section">Cada arma con sus propios stats</h4>
  <p class="update-lead">
    Antes casi todas compartían la misma lista de stats buenos y todas veían Crítico y
    Multidisparo arriba. Ahora cada arma se gradúa con sus datos de mercado.
  </p>
  <ul class="update-list">
    <li>El 98% de las armas usa ya sus propios datos; antes era el 10%. En el Bo, Critical
    Chance baja a medio y suben Alcance y Velocidad de Ataque. En la Kuva Bramma, Toxina
    sube arriba del todo.</li>
    <li>Dentro de los mejores stats se marcan con TOP los uno o dos que deciden el precio.</li>
    <li>Obex y Prisma Obex comparten ficha. Se acabaron las recomendaciones contradictorias
    entre variantes del mismo riven.</li>
    <li>Los combos elementales se miden con ventas: Viral se paga 1,4× más que otros pares y
    se premia, Gas cae a 0,76× y pierde el bonus que tenía.</li>
    <li>El aviso de sobreprecio marcaba el 87% de las armas. Ahora marca el 42%, y las que no
    tienen ventas suficientes lo dicen en vez de inventarse un veredicto.</li>
    <li>Carrusel de movimientos del mercado en el índice y en cada arma: subidas y bajadas
    fuertes de los últimos 21 días, con fechas. Se actualiza a diario.</li>
    <li>«Mediana del juego» pasa a llamarse «Precio de venta real» y «Precio Premium» a
    «Precio pedido en WFM». Parecían la misma cifra y se llevan un orden de magnitud.</li>
  </ul>
  <p class="update-foot">
    <em>Sobre 1434 subastas reales, la app ordena los rolls como los ordena el mercado en el
    85% de las armas. El error medio se queda en el 47%: dos rivens idénticos se listan a
    precios distintos y eso no hay ajuste que lo arregle.</em>
  </p>
</div>
<div class="update-block" id="v271">
  <div class="update-header">
    <span class="update-version">v2.7.1</span>
    <span class="update-date">2026-08-04</span>
  </div>

  <h4 class="update-section">Tasación de rivens rehecha</h4>
  <p class="update-lead">
    Los precios salían altos, y cuanto más popular era el arma peor. Ahora se calculan sobre
    lo que los rivens se venden.
  </p>
  <ul class="update-list">
    <li>Las armas populares ya no salen infladas. Era donde más se desviaba el precio.</li>
    <li>Cuenta cuánto rolaron tus stats, no solo cuáles son. Un crítico rolado al mínimo deja
    de puntuar como un godroll.</li>
    <li>Las negativas se juzgan por arma. −Multidisparo destroza un rifle que vive de él y a
    un melee apenas le afecta. El retroceso y el daño por facción dejan de ser inofensivos
    por decreto.</li>
    <li>Los elementales y la perforación no pueden salir como maldición. Si el escáner lee un
    menos ahí, lo corrige.</li>
    <li>Un arma con una sola venta cara se tasaba entera por ella, y en armas de poco volumen
    el godroll y el roll basura salían al mismo precio. Arreglado.</li>
  </ul>

  <p class="update-foot">
    <em>La tasación es una guía. Dos rivens idénticos se listan a precios distintos porque
    cada vendedor pone lo que quiere: usa el rango, no el número suelto.</em>
  </p>
</div>
<div class="update-block old" id="v27">
  <div class="update-header">
    <span class="update-version">v2.7</span>
    <span class="update-date">2026-08-03</span>
  </div>

  <h4 class="update-section">Mis órdenes</h4>
  <p class="update-lead">
    Pestaña nueva para llevar tus ventas de warframe.market desde la app.
  </p>
  <ul class="update-list">
    <li>Ves tus órdenes con el precio del mercado al lado, y editas precio, cantidad y rango
    ahí mismo. También puedes marcar vendido, ocultar o borrar.</li>
    <li>Publicas sets del inventario con un precio sugerido. El botón «Vender» está en el
    inventario y en el tracker de sets, y lo que ya está publicado lleva la etiqueta
    «En venta».</li>
    <li>Los precios se actualizan solos y te avisa si alguien te rebaja.</li>
    <li>En mods y arcanos se ven por separado el precio de rango 0 y el de rango máximo.</li>
  </ul>

  <h4 class="update-section">Arreglos</h4>
  <ul class="update-list">
    <li>Con inventarios grandes los ítems no cargaban.</li>
    <li>Iconos rotos en mods y otros ítems sin imagen propia.</li>
  </ul>
</div>
<div class="update-block old" id="v2661">
  <div class="update-header">
    <span class="update-version">v2.6.6.1</span>
    <span class="update-date">2026-08-01</span>
  </div>
  <ul class="update-list">
    <li><strong>Parche pequeño.</strong> Arreglos sueltos, sin funciones nuevas.</li>
    <li><strong>Botones que no hacían nada.</strong> «Cancelar» en el aviso de borrar
    inventario y «RESET DEFAULTS» en los ajustes del escáner.</li>
    <li><strong>Menos memoria en el móvil.</strong> Al cerrar el escáner se libera todo lo que
    estaba usando; antes había que recargar la página.</li>
  </ul>
</div>
<div class="update-block old" id="v266">
  <div class="update-header">
    <span class="update-version">v2.6.6</span>
    <span class="update-date">2026-07-29</span>
  </div>

  <h4 class="update-section">Escáner móvil renovado</h4>
  <p class="update-lead">
    Apunta a la pantalla y dispara. Ya no hay que alinear la caja ni decirle cuántas
    recompensas hay. Escanea en menos de un segundo, lee bien los nombres largos y de dos
    líneas, y vibra al detectarlos. La pantalla del móvil no se apaga mientras lo tienes
    abierto, así que puedes dejarlo apoyado apuntando al monitor.
  </p>
  <ul class="update-list">
    <li>Las cuatro recompensas se ven a la vez, en vertical y en horizontal, con el icono de
    cada pieza.</li>
    <li>Añadir una ya no cierra la lista, así que puedes registrar varias seguidas.</li>
    <li>Si algo falla te dice qué corregir: acercarte, el reflejo o el ángulo del móvil.</li>
    <li>El inventario usa la cantidad que muestra el juego en vez de sumar de uno en uno, y
    hay un botón para cuadrar las cuatro recompensas de golpe.</li>
  </ul>
</div>
<div class="update-block old" id="v265">
  <div class="update-header">
    <span class="update-version">v2.6.5</span>
    <span class="update-date">2026-07-25</span>
  </div>
  <ul class="update-list">
    <li><strong>Fisuras para tus sets.</strong> En Inventario, un bloque te dice qué fisura
    activa te conviene para cerrar tus sets y te avisa si sale más a cuenta comprar la
    pieza que farmearla.</li>
    <li><strong>Cantidades del inventario.</strong> Las que llevaban varios «1» (119, 111...)
    salían a medias.</li>
    <li><strong>Escáner.</strong> Menos recompensas fantasma, y el de rivens ya no se queda
    colgado ni pierde la última lectura buena.</li>
  </ul>
</div>
<div class="update-block old" id="v264">
  <div class="update-header">
    <span class="update-version">v2.6.4</span>
    <span class="update-date">2026-07-19</span>
  </div>
  <ul class="update-list">
    <li><strong>Escáner de recompensas.</strong> Los nombres largos salían cortados y en
    Camino de Acero y en la pantalla de fin de misión aparecían recompensas fantasma. Los
    planos ya no se pierden y el tinte de la misión da igual.</li>
    <li><strong>Escáner de reliquias.</strong> La pestaña RELIQUIAS no escaneaba nada. Ahora
    lee la página entera, Requiem incluidas.</li>
    <li><strong>Alarmas.</strong> Puedes elegir si las de fisuras saltan en Camino de Acero,
    en normales o en las dos. Y hay alarmas de arbitración por tier y tipo de misión, con
    cuenta atrás para la próxima tier S.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.6.3</span>
    <span class="update-date">2026-07-18</span>
  </div>
  <ul class="update-list">
    <li><strong>Calculadora de Ducados.</strong> En el inventario, para ver de un vistazo lo
    que valen tus piezas Prime.</li>
    <li><strong>Guía de usuario.</strong> Nueva, y se irá ampliando.</li>
    <li><strong>Arreglado.</strong> Las fisuras y arbitraciones dejaban de actualizarse o
    desaparecían de la lista.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.6.2</span>
    <span class="update-date">2026-07-18</span>
  </div>
  <ul class="update-list">
    <li><strong>Escáner de recompensas.</strong> Las tarjetas salen debajo de su recompensa y
    ya no se intercambian entre nombres parecidos.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.6.1</span>
    <span class="update-date">2026-07-15</span>
  </div>
  <ul class="update-list">
    <li><strong>Fisuras.</strong> Las recomendadas y las arbitraciones se muestran siempre.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.6.0</span>
    <span class="update-date">2026-07-11</span>
  </div>
  <ul class="update-list">
    <li><strong>Ficha de armas.</strong> Las que tienen disparo alternativo muestran cada modo
    por separado con sus stats, y una etiqueta te dice si escalan Condition Overload de forma
    multiplicativa o plana.</li>
    <li><strong>Nueva arma: Haalvu.</strong> Y las disposiciones de riven al día con el último
    reajuste del juego.</li>
    <li><strong>Escáner.</strong> Coge recompensas que antes se saltaba, sobre todo con fondos
    claros, y ya no confunde el icono de fundición con un número.</li>
    <li><strong>Copiar recompensas.</strong> Escaneas una y la pegas en el chat al momento.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.5.0</span>
    <span class="update-date">2026-07-04</span>
  </div>
  <ul class="update-list">
    <li><strong>Calculadora de Vosfor.</strong> Compara al momento si te renta vender un arcano
    en Warframe Market o disolverlo. Te dice qué paquete de Loid da más platino de media y se
    vende más rápido, y cuánto Vosfor necesitas para juntar las copias del arcano que
    buscas.</li>
    <li><strong>Simulador de runs.</strong> En el tracker de sets: cuántas runs cuesta de media
    sacar una copia de cada pieza según la refinación de la reliquia y los jugadores del
    escuadrón, con su mejor y peor caso.</li>
    <li><strong>Reliquias.</strong> Buscar por el nombre de la recompensa («kronen», «rhino») o
    por era volvía sin resultados.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.4.0</span>
    <span class="update-date">2026-07-02</span>
  </div>

  <h4 class="update-section">Tasación de rivens rediseñada</h4>
  <p class="update-lead">
    Cabe entera en pantalla, en móvil y en escritorio: el precio estimado y la nota (S/A/B/C/F)
    al frente y el resto en fichas compactas. La tabla de grados por stat va junto a la carta
    del riven, y cada dato explica qué significa al pasar el ratón o tocarlo.
  </p>
  <ul class="update-list">
    <li>Indicador «En venta ahora»: si hay rivens con tu mismo combo listados en el mercado,
    la tasación se ajusta a esos precios.</li>
    <li>El escáner en vivo usa el historial de precios del arma. Sin él se desviaba en las
    armas volátiles.</li>
    <li>El rango de precio dejó de usar el techo godroll para cualquier roll: un combo poco
    buscado muestra un techo realista.</li>
    <li>El modelo separa mejor un precio troll de una subida de verdad (Incarnons, buffs), y
    se reentrena solo cada semana.</li>
    <li>Escáner de rivens: panel más compacto para que quepa en el móvil, captura plegada por
    defecto y comparativa con el precio de cada roll.</li>
  </ul>

  <p class="update-foot">
    <em>En rolls muy altos y en godrolls el margen de error crece porque hay pocas ventas de
    referencia. Contrasta con los listados en vivo antes de cerrar un trato.</em>
  </p>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.3.0</span>
    <span class="update-date">2026-06-21</span>
  </div>

  <h4 class="update-section">Escáner de rivens en vivo</h4>
  <p class="update-lead">
    Escanea rivens desde la pantalla del juego y te da la tasación al instante: precio
    estimado, rango y nota. En la pantalla de reroll lee las dos cartas a la vez y las pone
    lado a lado, el roll nuevo contra el anterior.
  </p>
  <ul class="update-list">
    <li>Cada stat lleva su etiqueta según el meta del arma: TOP, GOOD, MID o WEAK, y BRICK o
    NEG OK en las negativas.</li>
    <li>Kitguns tasables: Catchmoon, Gaze, Rattleguts, Tombfinger, Sporelacer y
    Vermisplicer.</li>
    <li>Primes nuevas con sus ducados: Afentis Prime, Athodai Prime, War Prime, Pride y
    Wrath.</li>
    <li>Las fisuras se refrescan solas cada dos o tres minutos y ya no se quedan vacías
    cuando el servidor tarda.</li>
    <li>Las armas impopulares o fuera del meta salían sobrevaloradas.</li>
  </ul>

  <p class="update-foot">
    <em>El escáner de rivens está en beta.</em>
  </p>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.2.1</span>
    <span class="update-date">2026-06-09</span>
  </div>
  <ul class="update-list">
    <li><strong>Arreglos.</strong> El escáner no sincronizaba bien un recuento de 0, y los
    precios del inventario se quedaban colgados al recargar.</li>
    <li><strong>Rivens.</strong> Se ven mejor los stats recomendados, y las variantes heredan
    los datos de mercado del arma base.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.2.0</span>
    <span class="update-date">2026-05-31</span>
  </div>
  <ul class="update-list">
    <li><strong>Escáner.</strong> Detecta mejor las piezas Prime del inventario y sus
    cantidades.</li>
    <li><strong>Historial de aperturas</strong> de reliquias.</li>
    <li><strong>Tasación de rivens</strong> más ajustada.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.1.0</span>
    <span class="update-date">2026-05-22</span>
  </div>

  <h4 class="update-section">Rivens de arriba abajo</h4>
  <p class="update-lead">
    La sección de rivens y el tasador, rehechos. La interfaz va más suelta y los campos
    opcionales (+stat 3 y la negativa) aparecen y desaparecen sin recargar la página.
  </p>
  <ul class="update-list">
    <li>Ves las dos cifras por separado: lo que se pagó en ventas cerradas dentro del juego
    (DE Real) y lo que se pide en warframe.market (WFM Web).</li>
    <li>Con esos datos el tasador saca el precio medio de un riven sin rolar y marca solo los
    mejores y peores stats del arma.</li>
    <li>Escáner de recompensas en PC casi instantáneo, con muchos menos falsos positivos y
    muchas menos lecturas perdidas.</li>
    <li>Pestaña de Sets rediseñada.</li>
  </ul>

  <p class="update-foot">
    <em>El precio es una estimación: puedes vender por más o por menos según la oferta y la
    demanda.</em>
  </p>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.0.0</span>
    <span class="update-date">2026-04-17</span>
  </div>
  <ul class="update-list">
    <li><strong>Escáner de inventario.</strong> Más acierto en las cantidades.</li>
    <li><strong>Escáner de recompensas.</strong> Vuelve la detección estable de antes.</li>
    <li><strong>Interfaz.</strong> El modal de resultados se cierra solo al elegir
    recompensa.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.8.5</span>
    <span class="update-date">2026-03-27</span>
  </div>
  <ul class="update-list">
    <li><strong>Escáner.</strong> Lee mejor las reliquias en vivo y las recompensas.</li>
    <li><strong>Inventario.</strong> Lavado de cara de la pestaña.</li>
    <li><strong>Traducciones nuevas</strong> y arreglos sueltos.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.8.0</span>
    <span class="update-date">2026-03-25</span>
  </div>

  <h4 class="update-section">Escaneo del inventario Prime</h4>
  <p class="update-lead">
    Ya puedes escanear tu inventario Prime con el botón de LiveScan. Comparte la pantalla de
    Warframe, la app detecta que estás en el inventario y te deja escanear a mano o
    automático mientras haces scroll. Sigue las instrucciones que salen debajo.
  </p>
  <p class="update-lead">
    Antes te pedirá una calibración: ponte en el inventario, pestaña de partes Prime y
    ordenado alfabéticamente si puedes, y marca el primer ítem de la izquierda y el último de
    la derecha. Cerca del borde de la pantalla queda un error pequeño que quiero quitar más
    adelante para que no haga falta calibrar.
  </p>
  <ul class="update-list">
    <li>Importar y exportar el inventario, y gestión bastante más fluida.</li>
    <li>Reliquias y sets más intuitivos: arrastra piezas de una reliquia al tracker de sets y
    ves ahí mismo cuántas llevas.</li>
    <li>En el tracker, al pulsar una pieza salen las reliquias de donde cae.</li>
  </ul>

  <p class="update-foot">
    <em>El escaneo es experimental y habrá casos en los que el reconocimiento de letras falle.
    Si os pasa, avisadme por <strong>w/Parcialsobriedad</strong> en los foros de Warframe con
    la captura que dio error (modo debug) y lo tengo en cuenta para los ajustes. Gracias por
    usar la app. ¡Disfrutad de <strong>Shadowgrafter</strong>!</em>
  </p>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.7.1</span>
    <span class="update-date">2026-02-18</span>
  </div>
  <ul class="update-list">
    <li><strong>Idiomas.</strong> Había textos que salían siempre en español; ahora respetan
    el idioma que tengas elegido.</li>
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

  <h4 class="update-section">Farm routes</h4>
  <p class="update-lead">
    It tells you which relic to crack to finish the sets you have half-built. It takes the
    parts you are missing, what you already own and the open fissures, and gives you the
    relic, the mission and the runs it usually takes. The other tab, "By relic", starts from
    what you own: which of your relics gets you closer to more sets in a single crack.
  </p>
  <p class="update-lead">
    It needs your inventory. Scan it with the live scanner or add the relics by hand, or the
    panel comes up empty.
  </p>
  <ul class="update-list">
    <li>Filters by era, platinum per hour and gain. The era you pick changes which relic gets
    recommended.</li>
    <li>It tells you whether refining pays off: how much extra platinum, and at how many
    traces.</li>
    <li>It counts your surplus. Four blueprints are four sets.</li>
    <li>Every set is in there, started or not.</li>
    <li>Click a relic and see its contents without leaving the tab.</li>
    <li>It's in Relic and Set too, not just Inventory.</li>
  </ul>

  <h4 class="update-section">Scanner</h4>
  <ul class="update-list">
    <li>It no longer mistakes the relic screen for the reward one, so fewer scans fail.</li>
  </ul>

  <h4 class="update-section">Interface</h4>
  <ul class="update-list">
    <li>The sets you have half-built show up in the Set tab.</li>
    <li>Tooltips work on mobile again. Scanner and inventory translated.</li>
  </ul>
</div>
<div class="update-block" id="v272">
  <div class="update-header">
    <span class="update-version">v2.7.2</span>
    <span class="update-date">2026-08-07</span>
  </div>

  <h4 class="update-section">Every weapon with its own stats</h4>
  <p class="update-lead">
    Almost every weapon used to share the same list of good stats, and they all showed
    Critical and Multishot at the top. Each one is now graded from its own market data.
  </p>
  <ul class="update-list">
    <li>98% of weapons now use their own data; it was 10% before. On the Bo, Critical Chance
    drops to mid while Range and Attack Speed climb. On the Kuva Bramma, Toxin goes all the
    way up.</li>
    <li>Among the best stats, the one or two that decide the price are tagged TOP.</li>
    <li>Obex and Prisma Obex share one guide, so variants of the same riven stop giving
    contradictory recommendations.</li>
    <li>Elemental combos are measured against sales: Viral gets paid 1.4× more than other
    pairs and is rewarded, Gas drops to 0.76× and loses the bonus it had.</li>
    <li>The overpriced warning used to flag 87% of weapons. It now flags 42%, and the ones
    without enough sales say so instead of inventing a verdict.</li>
    <li>Market movement carousel on the index and on each weapon: sharp rises and drops over
    the last 21 days, with dates. Updated daily.</li>
    <li>"Game Median" is now "Real sale price" and "Premium Price" is now "Asking price on
    WFM". They looked like the same kind of figure and they differ by an order of
    magnitude.</li>
  </ul>
  <p class="update-foot">
    <em>Across 1434 real auctions, the app ranks rolls the way the market ranks them on 85% of
    weapons. Average error stays at 47%: two identical rivens get listed at different prices,
    and no amount of tuning fixes that.</em>
  </p>
</div>
<div class="update-block" id="v271">
  <div class="update-header">
    <span class="update-version">v2.7.1</span>
    <span class="update-date">2026-08-04</span>
  </div>

  <h4 class="update-section">Riven appraisal rebuilt</h4>
  <p class="update-lead">
    Prices came out too high, and the more popular the weapon the worse it got. They are now
    worked out from what rivens actually sell for.
  </p>
  <ul class="update-list">
    <li>Popular weapons no longer come out inflated. That's where the price drifted most.</li>
    <li>How high your stats rolled counts, not just which ones they are. A crit roll at the
    bottom of its range stops scoring like a godroll.</li>
    <li>Negatives are judged per weapon. −Multishot wrecks a rifle that lives on it and
    barely touches a melee. Recoil and faction damage stop being harmless by decree.</li>
    <li>Elemental damage and Punch Through can't roll as a curse. If the scanner reads a minus
    there, it corrects it.</li>
    <li>A weapon with a single expensive sale was priced off that one trade, and on low-volume
    weapons the godroll and the trash roll came out at the same price. Fixed.</li>
  </ul>

  <p class="update-foot">
    <em>The appraisal is a guide. Two identical rivens get listed at different prices because
    each seller picks their own: use the range, not the single number.</em>
  </p>
</div>
<div class="update-block old" id="v27">
  <div class="update-header">
    <span class="update-version">v2.7</span>
    <span class="update-date">2026-08-03</span>
  </div>

  <h4 class="update-section">My orders</h4>
  <p class="update-lead">
    A new tab to run your warframe.market sales from the app.
  </p>
  <ul class="update-list">
    <li>You see your orders with the market price next to them, and edit price, quantity and
    rank right there. You can also mark as sold, hide or delete.</li>
    <li>You can list sets from your inventory with a suggested price. The "Sell" button is in
    the inventory and in the set tracker, and anything already up carries a "Listed" tag.</li>
    <li>Prices update on their own and it warns you when someone undercuts you.</li>
    <li>On mods and arcanes you see rank 0 and max rank prices separately.</li>
  </ul>

  <h4 class="update-section">Fixes</h4>
  <ul class="update-list">
    <li>Items failed to load with large inventories.</li>
    <li>Broken icons on mods and other items without their own image.</li>
  </ul>
</div>
<div class="update-block old" id="v2661">
  <div class="update-header">
    <span class="update-version">v2.6.6.1</span>
    <span class="update-date">2026-08-01</span>
  </div>
  <ul class="update-list">
    <li><strong>Small patch.</strong> Loose fixes, no new features.</li>
    <li><strong>Buttons that did nothing.</strong> "Cancel" on the clear-inventory prompt and
    "RESET DEFAULTS" in the scanner settings.</li>
    <li><strong>Lower memory on mobile.</strong> Closing the scanner now frees everything it
    was using; before that took a page reload.</li>
  </ul>
</div>
<div class="update-block old" id="v266">
  <div class="update-header">
    <span class="update-version">v2.6.6</span>
    <span class="update-date">2026-07-29</span>
  </div>

  <h4 class="update-section">Mobile scanner revamped</h4>
  <p class="update-lead">
    Point at the screen and shoot. No lining up a box, no telling it how many rewards there
    are. It scans in under a second, reads long and two-line names properly, and buzzes when
    it picks them up. Your phone screen stays on while it's open, so you can prop it up
    facing the monitor.
  </p>
  <ul class="update-list">
    <li>All four rewards are visible at once, in portrait and landscape, each with its item
    icon.</li>
    <li>Adding one no longer closes the list, so you can register several in a row.</li>
    <li>If something fails it tells you what to fix: get closer, the glare, or the angle of
    the phone.</li>
    <li>The inventory uses the count the game shows instead of adding one at a time, and
    there's a button to square all four rewards at once.</li>
  </ul>
</div>
<div class="update-block old" id="v265">
  <div class="update-header">
    <span class="update-version">v2.6.5</span>
    <span class="update-date">2026-07-25</span>
  </div>
  <ul class="update-list">
    <li><strong>Fissures for your sets.</strong> In Inventory, a block tells you which active
    fissure helps you close your sets, and warns you when buying the part beats farming
    it.</li>
    <li><strong>Inventory quantities.</strong> The ones with several "1"s (119, 111...) came
    through half-read.</li>
    <li><strong>Scanner.</strong> Fewer ghost rewards, and the riven scanner no longer freezes
    or loses its last good reading.</li>
  </ul>
</div>
<div class="update-block old" id="v264">
  <div class="update-header">
    <span class="update-version">v2.6.4</span>
    <span class="update-date">2026-07-19</span>
  </div>
  <ul class="update-list">
    <li><strong>Reward scanner.</strong> Long names arrived cut off, and ghost rewards showed
    up on Steel Path and on the end-of-mission screen. Blueprints no longer get dropped and
    the mission tint doesn't matter any more.</li>
    <li><strong>Relic scanner.</strong> The RELICS tab scanned nothing. It now reads the whole
    page, Requiem relics included.</li>
    <li><strong>Alarms.</strong> You can choose whether fissure alarms fire on Steel Path, on
    normal missions or both. And there are arbitration alarms by tier and mission type, with
    a countdown to the next S tier.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.6.3</span>
    <span class="update-date">2026-07-18</span>
  </div>
  <ul class="update-list">
    <li><strong>Ducat calculator.</strong> In the inventory, to see at a glance what your Prime
    parts are worth.</li>
    <li><strong>User guide.</strong> New, and it will keep growing.</li>
    <li><strong>Fixed.</strong> Fissures and arbitrations stopped updating or vanished from
    the list.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.6.2</span>
    <span class="update-date">2026-07-18</span>
  </div>
  <ul class="update-list">
    <li><strong>Reward scanner.</strong> Cards land under their own reward and no longer get
    swapped between similar names.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.6.1</span>
    <span class="update-date">2026-07-15</span>
  </div>
  <ul class="update-list">
    <li><strong>Fissures.</strong> Recommended fissures and arbitrations always show up
    now.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.6.0</span>
    <span class="update-date">2026-07-11</span>
  </div>
  <ul class="update-list">
    <li><strong>Weapon panel.</strong> Weapons with an alternate fire show each mode separately
    with its own stats, and a tag tells you whether they scale Condition Overload
    multiplicatively or flat.</li>
    <li><strong>New weapon: Haalvu.</strong> Plus riven dispositions synced to the game's
    latest pass.</li>
    <li><strong>Scanner.</strong> It picks up rewards it used to miss, especially on bright
    backgrounds, and no longer mistakes the foundry icon for a number.</li>
    <li><strong>Copy rewards.</strong> Scan one and paste it straight into chat.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.5.0</span>
    <span class="update-date">2026-07-04</span>
  </div>
  <ul class="update-list">
    <li><strong>Vosfor calculator.</strong> Works out on the spot whether to sell an arcane on
    Warframe Market or dissolve it. It tells you which Loid pack gives the most average
    platinum and sells fastest, and how much Vosfor you need for the copies of the arcane
    you're after.</li>
    <li><strong>Runs simulator.</strong> In the set tracker: how many runs it takes on average
    to get one copy of any part, based on relic refinement and squad size, with best and worst
    case.</li>
    <li><strong>Relics.</strong> Searching by reward name ("kronen", "rhino") or by era came
    back empty.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.4.0</span>
    <span class="update-date">2026-07-02</span>
  </div>

  <h4 class="update-section">Riven appraisal redesigned</h4>
  <p class="update-lead">
    It fits on one screen, on mobile and desktop: estimated price and grade (S/A/B/C/F) up
    front, everything else as compact chips. The per-stat grade table sits next to the riven
    card, and every value explains itself on hover or tap.
  </p>
  <ul class="update-list">
    <li>"On sale now" indicator: if rivens with your exact combo are listed on the market, the
    appraisal adjusts to those prices.</li>
    <li>The live scanner uses the weapon's price history. Without it, it drifted on volatile
    weapons.</li>
    <li>The price range stopped using the godroll ceiling for every roll: an unwanted combo
    shows a realistic ceiling.</li>
    <li>The model separates troll listings from genuine market shifts (Incarnons, buffs)
    better, and retrains itself weekly.</li>
    <li>Riven scanner: more compact panel so it fits on mobile, capture collapsed by default,
    and a comparison showing each roll's price.</li>
  </ul>

  <p class="update-foot">
    <em>On very high rolls and godrolls the margin of error grows, because there are few
    reference sales. Check live listings before closing a trade.</em>
  </p>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.3.0</span>
    <span class="update-date">2026-06-21</span>
  </div>

  <h4 class="update-section">Live riven scanner</h4>
  <p class="update-lead">
    Scan rivens straight off the game screen and get the appraisal instantly: estimated price,
    range and grade. On the reroll screen it reads both cards at once and puts them side by
    side, new roll against the previous one.
  </p>
  <ul class="update-list">
    <li>Each stat carries its own tag based on the weapon's meta: TOP, GOOD, MID or WEAK, and
    BRICK or NEG OK on negatives.</li>
    <li>Kitguns can be appraised: Catchmoon, Gaze, Rattleguts, Tombfinger, Sporelacer and
    Vermisplicer.</li>
    <li>New Primes with their ducat values: Afentis Prime, Athodai Prime, War Prime, Pride and
    Wrath.</li>
    <li>Fissures refresh on their own every two or three minutes and no longer go blank when
    the server is slow.</li>
    <li>Unpopular and off-meta weapons came out overvalued.</li>
  </ul>

  <p class="update-foot">
    <em>The riven scanner is in beta.</em>
  </p>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.2.1</span>
    <span class="update-date">2026-06-09</span>
  </div>
  <ul class="update-list">
    <li><strong>Fixes.</strong> The scanner didn't sync an owned count of 0 properly, and
    inventory prices hung on reload.</li>
    <li><strong>Rivens.</strong> The recommended stats stand out better, and variants inherit
    the market data of the base weapon.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.2.0</span>
    <span class="update-date">2026-05-31</span>
  </div>
  <ul class="update-list">
    <li><strong>Scanner.</strong> It picks up Prime parts in the inventory and their quantities
    better.</li>
    <li><strong>Detection history</strong> for relic runs.</li>
    <li><strong>Riven pricing</strong> closer to the mark.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.1.0</span>
    <span class="update-date">2026-05-22</span>
  </div>

  <h4 class="update-section">Rivens from top to bottom</h4>
  <p class="update-lead">
    The riven section and the appraisal widget, rebuilt. The interface moves better and the
    optional fields (+stat 3 and the negative) appear and disappear without reloading.
  </p>
  <ul class="update-list">
    <li>You get both figures separately: what was paid in completed in-game trades (DE Real)
    and what people ask on warframe.market (WFM Web).</li>
    <li>From that data the appraiser works out the average price of an unrolled riven and tags
    the weapon's best and worst stats on its own.</li>
    <li>The PC reward scanner is close to instant, with far fewer false positives and far
    fewer missed reads.</li>
    <li>Sets tab redesigned.</li>
  </ul>

  <p class="update-foot">
    <em>The price is an estimate: you may sell for more or for less depending on supply and
    demand. This isn't abandoned, by the way — I work on it every other day when I can. I've
    had some real-life scares with family health on top of a full-time job. Next I want to
    prioritise mobile, so you console tenno get a reliable overlay on your phone while you
    play.</em>
  </p>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v2.0.0</span>
    <span class="update-date">2026-04-17</span>
  </div>
  <ul class="update-list">
    <li><strong>Inventory scanner.</strong> Better hit rate on quantities.</li>
    <li><strong>Reward scanner.</strong> The old stable detection is back.</li>
    <li><strong>Interface.</strong> The results modal closes on its own once you pick a
    reward.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.9.0</span>
    <span class="update-date">2026-03-27</span>
  </div>
  <ul class="update-list">
    <li><strong>Scanner.</strong> Better reads on live relics and rewards.</li>
    <li><strong>Inventory.</strong> A fresh coat of paint on the tab.</li>
    <li><strong>New translations</strong> and loose fixes.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.8.0</span>
    <span class="update-date">2026-03-25</span>
  </div>

  <h4 class="update-section">Prime inventory scanning</h4>
  <p class="update-lead">
    You can now scan your Prime inventory with the LiveScan button. Share your Warframe
    screen, the app detects that you're in the inventory and lets you scan by hand or
    automatically as you scroll. Follow the instructions below it.
  </p>
  <p class="update-lead">
    It asks for a calibration first: go to the inventory, Prime parts tab, sorted
    alphabetically if you can, and mark the first item on the left and the last one on the
    right. There's still a small error near the edge of the screen that I want to remove later
    so calibration isn't needed at all.
  </p>
  <ul class="update-list">
    <li>Import and export your inventory, and much smoother management overall.</li>
    <li>Relics and sets are more intuitive: drag parts from a relic onto the set tracker and
    see right there how many you have.</li>
    <li>In the tracker, clicking a part shows which relics drop it.</li>
  </ul>

  <p class="update-foot">
    <em>Scanning is experimental and there will be cases where character recognition gets it
    wrong. If it happens, let me know at <strong>w/Parcialsobriedad</strong> on the Warframe
    forums with the screenshot that failed (debug mode) and I'll take it into account. Thanks
    for using the app. Enjoy <strong>Shadowgrafter</strong>!</em>
  </p>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.7.1</span>
    <span class="update-date">2026-02-18</span>
  </div>
  <ul class="update-list">
    <li><strong>Languages.</strong> Some text always came out in Spanish; it now follows the
    language you picked.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.7.0</span>
    <span class="update-date">2026-01-30</span>
  </div>

  <h4 class="update-section">New look</h4>
  <p class="update-lead">
    A fresh interface with item images everywhere (big thanks to the WFCD team) and a layout
    that's easier to read.
  </p>
  <ul class="update-list">
    <li>Relics and sets: clearer buttons, an "Add to inventory" action, ducat values and stats
    like average ducats per relic.</li>
    <li>Click a Prime component and you see how close you are to finishing that set.</li>
    <li>Rivens: variants in a carousel (try "Cernos"), plus price, disposition, crafting
    recipes and a Wiki link.</li>
    <li>New Prime Inventory tab to track your loot and check market data. It understands sets
    that need two of the same part.</li>
  </ul>

  <p class="update-foot">
    <em>This one grew massive. From here on I'll aim for smaller updates, weekly.</em>
  </p>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.4.1</span>
    <span class="update-date">2026-01-20</span>
  </div>
  <ul class="update-list">
    <li><strong>Relic overlay scan.</strong> A backend error was leaving the debug settings on
    screen.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.4.0</span>
    <span class="update-date">2026-01-20</span>
  </div>
  <ul class="update-list">
    <li><strong>New Farms tab.</strong> It replaces Profile, with curated syndicate missions
    from the open worlds: 1999, Zariman and Cavia. Alerts and more tracking are coming
    later.</li>
    <li><strong>Mobile.</strong> Fixed several display and navigation problems. Sorry about the
    last few days.</li>
    <li><strong>From now on</strong> updates get tested on a dev server before they go
    live.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.3.0 and v1.3.1</span>
    <span class="update-date">2026-01-18</span>
  </div>
  <ul class="update-list">
    <li><strong>Mobile AR scanner (beta).</strong> Point your phone camera at the screen,
    relics or inventory, and get prices straight away. It's experimental, so expect the odd
    misread.</li>
    <li><strong>More on the way.</strong> Working on other features you asked for. Thanks for
    the suggestions.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.2.4</span>
    <span class="update-date">2026-01-14</span>
  </div>
  <ul class="update-list">
    <li><strong>Fixed.</strong> Clicking any tab closed the relic inventory panel. Thanks for
    the report.</li>
    <li><strong>Dev diary.</strong> Live OCR using the phone as a console overlay is at about
    70% reliability. I want it past 90% before it ships.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.2.3</span>
    <span class="update-date">2026-01-10</span>
  </div>
  <ul class="update-list">
    <li><strong>Relic scan.</strong> Covers more cases and recognizes more parts.</li>
    <li><strong>Dev note.</strong> A console overlay through the phone should be here
    soonish.</li>
  </ul>
</div>
<div class="update-block old">
 <div class="update-header">
  <span class="update-version">v1.2.1 and 1.2.2</span>
    <span class="update-date">2026-01-07</span>
  </div>
  <ul class="update-list">
    <li><strong>Export and import your relic inventory.</strong> If you went through the
    hassle of adding it by hand, you can save your progress and load it back later.</li>
    <li><strong>Small fixes.</strong> Optimization, a few translation errors, and the mobile
    UI I had broken.</li>
    <li><strong>Inventory scan</strong> takes several photos at once now. Mobile scan is broken
    at the moment, fix pending.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.2.0</span>
    <span class="update-date">2026-01-05</span>
  </div>
  <ul class="update-list">
    <li><strong>Riven grading.</strong> New modal to work out a riven's quality.</li>
    <li><strong>Relics tab</strong> restyled, along with bits of the rest of the
    interface.</li>
    <li><strong>Fixed</strong> the vaulted / not vaulted logic.</li>
    <li><em>Coming soon: riven grading from a photo.</em></li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.1.5 (Beta)</span>
    <span class="update-date">2026-01-04</span>
  </div>
  <ul class="update-list">
    <li><strong>Live reward scanner (beta).</strong> Reads mission rewards as they come up.
    Expect bugs while it's in testing.</li>
    <li><strong>Vaulted relics.</strong> Relics now say whether they're vaulted.</li>
    <li><strong>Mobile.</strong> Navigation is much better on phones.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.1.0</span>
    <span class="update-date">2025-12-30</span>
  </div>
  <ul class="update-list">
    <li><strong>Inventory scanner.</strong> Point your phone camera at the screen to add
    relics.</li>
    <li><strong>Clipboard sync.</strong> The cloud icon moves LFG text between devices.</li>
    <li><strong>Side panels.</strong> Buttons to show or hide the relic inventory and the
    recommended fissures.</li>
  </ul>
</div>
<div class="update-block old">
  <div class="update-header">
    <span class="update-version">v1.0.0</span>
    <span class="update-date">2025-12-28</span>
  </div>
  <ul class="update-list">
    <li><strong>LFG message generator.</strong> Recruitment messages for chat in one click.</li>
    <li><strong>Market prices.</strong> Live prices for Prime parts and sets from Warframe
    Market.</li>
    <li><strong>Database.</strong> Every relic and Prime item currently in the game.</li>
  </ul>
</div>
`
};
