# Notas de parche

## Conexión con Warframe Market (nuevo)

Ya puedes conectar tu cuenta de warframe.market desde la app.

**Mis órdenes** — pestaña nueva con tus órdenes activas.

- La sesión se abre con email y contraseña: warframe.market no permite todavía conectar
  aplicaciones externas de otra forma. Tus datos pasan por el servidor de VoidStonks para
  reenviarlos; no se guardan ni se registran, y el código es público para que puedas
  comprobarlo. La sesión caduca a las 3 horas y al salir se cierra también en
  warframe.market.
- Si la sesión no permite editar, la pestaña pasa a solo lectura en vez de fallar: se ven
  tus órdenes públicas y se avisa de la limitación.
- Filtros por tipo con contador. El que se queda a 0 se oculta, y la lista vuelve a
  "todas" en lugar de quedarse en blanco.

**Precios en vivo** — mientras la app está abierta, escucha las órdenes que se van
publicando en el mercado.

- En el inventario, las piezas que pasan por el mercado se marcan con el precio recién
  visto. Acompaña al precio de siempre, no lo sustituye: el precio base es una mediana y
  esto es una orden concreta, así que se distinguen.
- Avisa cuando alguien publica tu mismo ítem por debajo de tu precio, y cuando aparece una
  venta muy por debajo de lo normal.
- En Vosfor, un botón consulta el precio en vivo del arcano que estés mirando.
- No hace falta conectar la cuenta: el mercado se escucha igual sin sesión. Conectarla
  añade el aviso de competencia, que necesita saber cuáles son tus órdenes.
- Se apoya en una conexión ya abierta y filtra en tu propio navegador: no añade carga a la
  API de warframe.market.

**Sets** — teniendo un set completo, un acceso directo lleva a venderlo en la pestaña de
órdenes. Si ya lo tienes publicado se indica, en vez de invitar a publicarlo otra vez.

## Fisuras

- Rediseño de la lista para igualarla al resto de la app.
- Los tiers sin fisuras se atenúan: antes la columna parecía llena aunque no hubiera nada
  que farmear.
- Contador con aviso: los últimos 5 minutos se resaltan para descartar de un vistazo una
  fisura a la que ya no llegas.
- El separador Normal / Steel Path solo aparece cuando hay de los dos.

**Corregido**

- "Expired" salía siempre en inglés, aunque la app estuviera en español.
- Las filas se desplazaban y se agrandaban al pasar el ratón, moviendo las de al lado y
  desbordando el borde del panel.

## Farms

**Corregido**

- Los contadores se quedaban clavados en "ROTATING..." al cambiar la rotación y no
  volvían solos: había que recargar la página. Además, mientras tanto la pestaña se
  repetía la consulta en bucle. Ahora reintenta de forma espaciada hasta que llega la
  rotación nueva.

## VoidScanner

- Panel reescrito: mismos botones y misma disposición, pero los estilos salen de la hoja
  en vez de ir incrustados uno a uno.

**Corregido**

- El botón AUTO se quedaba con el color de "encendido" pegado al pasar el ratón por
  encima, aunque estuviera apagado.
- Las pantallas de "cargando" no mostraban ningún indicador de actividad: el icono
  giratorio nunca se llegó a definir y quedaba invisible (afectaba también a Farms).

## Pestañas

- Cuando no caben todas, las que sobran pasan al menú "Más" automáticamente según el
  ancho de la ventana. Antes había una lista fija y la barra se salía de la tarjeta.
- La pestaña en la que estás nunca se esconde en ese menú.
- El menú "Más" solo aparece si de verdad hay algo detrás.

**Corregido**

- "Mis órdenes" no cambiaba de idioma.
- Al abrir "Más", la barra entera se movía ligeramente.

## Vosfor

- Las cuatro calculadoras van plegadas, con un subtítulo que dice qué resuelve cada una.
  Antes la pestaña abría con varias pantallas de controles seguidos.

**Corregido**

- Plegadas seguían asomando trozos de su contenido bajo el título.

## Escáner de inventario

**Corregido**

- Se colaban reliquias inexistentes en el inventario: un resto de texto con "RE" bastaba
  para anotar un "Requiem I" que no existía.
- Códigos como "O5" se leían "05" y la celda se quedaba sin identificar.
- La primera fila, si el juego la dejaba cortada a media altura, se descartaba entera.

## Rendimiento y mantenimiento

- Despliegues: al publicar una versión nueva, quien tuviera la app abierta seguía
  ejecutando el código anterior durante horas, y los síntomas parecían fallos nuevos.
  Ahora la página se refresca sola con cada despliegue.
- Los ficheros pesados (imágenes, datos del escáner) dejan de volver a descargarse en
  cada visita.
- Todos los contadores de la app miden contra la hora del servidor. Con el reloj del
  sistema adelantado unos minutos, una misión con casi una hora por delante podía
  aparecer como caducada.
- Limpieza de código: estilos incrustados movidos a las hojas correspondientes, botones
  registrados en un índice común (que avisa si un botón se queda sin función detrás) y
  numeración de versiones automática en cada publicación, que antes se llevaba a mano y
  se olvidaba.
