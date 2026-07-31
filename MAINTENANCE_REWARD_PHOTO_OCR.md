# Escáner de recompensas por foto (`deploy/js/utils/reward_photo_ocr.js`)

Lee la pantalla **VOID FISSURE/REWARDS** de una foto de cámara o de una captura directa.

Objetivo de diseño: **el jugador apunta a la pantalla y dispara**. Sin alinear guías, sin
calibrar, con la luz que haya. Nada puede darse por fijo — ni luminosidad, ni contraste, ni
el tipo de pantalla (curva, OLED, TN), ni la resolución, ni el tamaño de la imagen.

## Estado medido

Sobre 5 imágenes reales (`~/Imágenes/Capturas de pantalla/nofunciona/`): fotos de cámara a
monitor y capturas 1440p con tinte rojo de Steel Path, nombres a dos líneas y badges variados.

| | resultado |
|---|---|
| aciertos | **20/20** |
| falsos positivos | **0** |
| tiempo medio | **~0,65 s** por imagen (vía PaddleOCR) |

Punto de partida antes de este módulo: **1/4** en una foto real y **48 s** en una captura 1440p.
Con la vía de Tesseract (respaldo): 20/20 en ~2,5-3,7 s.

Verificación end-to-end: `node scripts/verify-reward-scan.mjs` (necesita navegador y el
servidor HTTPS local). Lógica pura: `node --test tests/reward-photo-ocr.test.mjs`.

## Por qué un algoritmo propio

Un OCR genérico trata la imagen como texto plano y aquí falla por tres motivos medidos:

- La pantalla ocupa solo parte del encuadre (pared, bisel, escritorio): la mayoría de la
  imagen es ruido que además fabrica falsos positivos.
- Ningún preprocesado único gana. Grayscale rescataba recompensas que el filtrado de OpenCV
  perdía y viceversa (3/4 cada uno, **4/4 al unirlos**).
- Los nombres llegan con caracteres rotos y palabras pegadas (`BazabrimeBarel`), pero su
  **posición es muy estable**: las cards están equiespaciadas en una fila.

La estructura del dominio es la que resuelve el problema: `<Nombre> Prime <Pieza>`, en 1-4
columnas equiespaciadas, con el badge encima.

## Dos motores

**Vía rápida — PaddleOCR (`V6_TINY_MODEL`)**. Red neuronal de detección + reconocimiento:
localiza el texto por sí misma, así que **no necesita scout, ni recortes candidatos, ni
varios preprocesados**. Una sola pasada sobre la imagen entera. Además lee los nombres sin
partir palabras, donde Tesseract entregaba `BazabrimeBarel`.

Elección del modelo (medido sobre 3 imágenes):

| modelo | descarga | por imagen | aciertos |
|---|---|---|---|
| **V6_TINY** | **4,8 MB** | **652 ms** | 11/12 |
| V6_SMALL | 10,0 MB | 2010 ms | 7/12 |
| V5_EN_MOBILE_INT8 | 11,9 MB | 1400 ms | 11/12 |
| V5_EN_MOBILE (el que había) | 12,3 MB | ~1500 ms | 11/12 |

V6_TINY gana en las tres dimensiones. Es **más ligero que Tesseract** (4,8 MB frente a 7,5 MB
de wasm + 4 MB de idioma) y unas 5× más rápido que el pipeline completo.

Los modelos se descargan de un CDN la primera vez y quedan cacheados. Se precalientan al
abrir la cámara, mientras el usuario encuadra.

**Vía de respaldo — Tesseract**. Si Paddle no carga (sin red la primera vez, CDN caído) o no
saca al menos 2 recompensas, se sigue con el pipeline de 4 fases de abajo, que no depende de
nada externo. Verificado: con Paddle roto, 4/4.

## Fases (vía Tesseract)

1. **SCOUT** — OCR barato buscando la palabra `PRIME`. Su fila (Y) marca dónde están los
   nombres, sin asumir nada del monitor.
2. **ROI** — se recorta esa banda. El texto pasa a ocupar mucha más resolución con el mismo
   coste de OCR.
3. **UNIÓN** — preprocesados complementarios en paralelo; se unen sus resultados.
4. **COLUMNAS** — filtro por coordenadas: se busca el paso que explique más ítems y se
   descarta lo que no cae en la rejilla. Los falsos positivos (requiems espurios, duplicados
   desplazados) caen entre columnas y mueren aquí.

En **ráfaga** (disparo con cámara) se capturan varios fotogramas, se ordenan por nitidez y se
analiza el mejor primero, consolidando por consenso.

## Constantes y su medición

| constante | valor | por qué |
|---|---|---|
| `MAX_SIDE` | 1800 | Antes se escalaba ×2 a ciegas: una captura 1440p acababa en 5120×2880 y tardaba **48 s**. Con un objetivo fijo, una foto pequeña se amplía y una grande se reduce; el coste queda acotado. |
| `SCOUT_SIDE` | 1500 | A 1200 px una captura se queda sin ancla; a 1500 todas la encuentran; a 1800 solo añade 200-400 ms sin ganar anclas. Bajo 1100 px `PRIME` no se lee casi nunca. |
| `ROI_MARGINS` | 3 pares | Ningún margen único sirve: con 0.20/0.08 una foto perdía el nombre de dos líneas; con 0.32/0.14 lo recuperaba pero otra captura pasaba de 4/4 a 3/4. Se prueban de ajustado a amplio y **gana el que más lee**. |
| `BLUR_THRESHOLD` | 9.5 | `frameSharpness` de las 5 imágenes: 8.24 / 9.59 / 10.84 / 11.39 / 12.52. La única que mejora claramente con realce (`nofunca`, de 2 a 4 recompensas) es la de 8.24. |
| pitch en `filterByColumns` | 0.07 – 0.35 | 4 cards ocupan ~0.125 de separación; 2 cards muy separadas llegan a ~0.19. |
| tolerancia de columna | 0.22 × paso | Absorbe la inclinación de una foto a pulso y el jitter del OCR sin fundir columnas contiguas. |

### ROI clavada

El recorte se deriva de la **altura real de la letra** que midió el scout, expresado en
"alturas de línea" (~9 arriba, ~3 abajo). Así se adapta solo a cualquier pantalla, distancia y
resolución, cosa que un margen fijo en fracción de imagen no puede hacer. En X se ciñe al
rango donde el scout vio texto: los bordes de la foto solo aportan ruido.

### Preprocesados

- `gray` — barato, resuelve el caso normal.
- `cvsoft` — rescata texto de bajo contraste sobre fondo tintado.
- `graycontrast` — imprescindible con tinte rojo saturado de Steel Path: al pasar a gris el
  texto blanco y el fondo quedan a luminancia parecida y **se funden** (0 anclas a 1400, 1800
  y 2200 px). Con contraste aparecen 3 anclas y los 4 nombres.
- `unsharp` — realce de bordes para fotos de lejos o con autofoco corto (de 2 a 4
  recompensas en una foto así). **No se aplica siempre**: en una foto ya nítida realza el
  muaré de fotografiar una pantalla y bajaba de 4 a 3.

## Cosas que se probaron y NO funcionaron

No volver a intentarlas sin datos nuevos.

| intento | resultado medido |
|---|---|
| **Binarizar por color dominante** (`detectAccentColor` + `binarizeNearColor`) | **0/4**. Devolvía el azul del FONDO del juego, no el del texto. Sin binarizar: 4/4. |
| **`findTextROIs`** (contornos morfológicos) para localizar las cards | Fusionaba toda la foto en un blob del 100%×101% (pared, webcam, monitor incluidos). |
| **Detectar el rectángulo del monitor** (Canny + contornos) | El borde curvo no da contorno limpio. Además no se puede asumir nada de la pantalla. |
| **Detector de badges rojos por píxeles** (para modo continuo) | Rapidísimo (5-45 ms) pero no discrimina: con tinte rojo el fondo ahoga la señal y las pantallas de riven puntúan **más** que las de recompensas. |
| **Agrupar por coordenadas ANTES del matcher** | 5/16. Los clusters colapsan en uno y el matcher cruza nombres (`Epitaph Prime Barrel`). Las coordenadas sirven como **filtro final**, no como agrupador previo. |
| **Buscar `PRIME` a baja resolución** (modo continuo) | Bajo 1100 px casi nunca aparece; una captura no lo da ni a 1100. Y cuesta 150-900 ms: demasiado inestable para un bucle. |
| **Recortes candidatos en paralelo** | Peor: 4,0 s → 6,8 s. Con 2 workers, varios recortes × varios preprocesados saturan la cola. El paralelismo que sí rinde es el de los preprocesados dentro de un recorte. |
| **Margen de ROI más ancho** | Los mismos 1800 px se reparten entre más superficie y el texto pierde resolución: una foto pasó de leer 2 a leer **0**. |
| **Detectar nombres de dos líneas** (texto encima del ancla) | Se activaba también en nombres de una línea y empeoraba ambas fotos. |
| **Kernel de sharpen `[-1..9..-1]`** (el que ya había en `opencv_engine`) | Dispara la nitidez numérica (×25) pero destroza el OCR: dejó en **0** una foto que sin él daba 2. Por eso se usa máscara de desenfoque. |
| **Umbralización adaptativa** (consejo estándar para fotos de pantallas) | **Destructiva** aquí, en ambas polaridades: 4→2 y 2→**0**. Es buen consejo para documentos escaneados, pero el texto de Warframe es claro sobre fondo oscuro semitransparente con arte detrás, y binarizar por zonas destruye el antialiasing de las letras. |
| **Desenfoque de mediana** (anti-moiré, kernel 3 y 5) | Destructivo: 4→1, 4→3, 2→1. A este tamaño de letra borra los trazos finos en vez del patrón de interferencia. |
| **Mediana + adaptativa combinadas** | Lo peor de todo: **0 aciertos** en las dos fotos de cámara. |
| **Filtro bilateral** | 4→1. |
| **Binarización de Otsu** | Aislada parecía prometedora: misma precisión que el gris y 20-40 % menos de tiempo de OCR. Pero **en el pipeline real empeora** (19/20 y 12,8 s en la foto difícil), tanto añadida como sustituyendo al gris. Medir una pasada suelta no predice su efecto dentro del pipeline, donde compite por los workers y la ROI es distinta. |

## Optimizaciones que sí funcionaron

- **Atajo del scout**: el scout ya OCRea la imagen entera; si de ahí salen las 4
  recompensas, se acabó. Las capturas directas bajan a **<1 s**.
- **No pedir más paralelismo que workers**: se lanzaban 3 pasadas con 2 workers y la tercera
  se encolaba sumando su tiempo entero.
- **Empezar por el preprocesado que ya funcionó**: el scout descubre cuál separa bien el
  texto en *esa* imagen.
- **Ráfaga ordenada por nitidez**: analizar primero el fotograma más nítido evita gastar el
  tiempo en los movidos. Medido con ráfaga simulada (movido/oscuro/bueno): 16,5 s → 5,2 s.

## Sobre el moiré

Fotografiar una pantalla genera un patrón de interferencia entre la rejilla de píxeles y el
sensor. La receta habitual contra él (desenfoque de mediana + umbral adaptativo) **está
medida aquí y empeora el resultado** — ver la tabla de arriba. Lo único que ayudó fue el
realce por máscara de desenfoque, y solo en fotos lavadas.

Lo que sí funciona contra el moiré en este pipeline es indirecto: **varios preprocesados
complementarios cuya unión se queda con lo que cada uno lee bien**, y la ráfaga, que ordena
por nitidez y descarta los fotogramas peores.

Del lado de la captura, `applyBestCameraConstraints` pide foco y exposición continuos al
abrir la cámara (muchos navegadores móviles lo ignoran). Inclinar levemente el móvil respecto
a la pantalla rompe el patrón, pero es una indicación para el usuario, no algo que la app
pueda forzar.

## OCR nativo (ML Kit / Apple Vision)

No aplicables: voidstonks es una **web** (Cloudflare Pages) que corre en el navegador, y esos
SDK son nativos y exigen una app compilada. La alternativa realista dentro del navegador es
**PaddleOCR** (ver abajo), que ya está integrada en el proyecto.

## Techo actual

El tiempo restante es casi todo **Tesseract** (0,5-1,7 s por pasada; OpenCV son 30-135 ms).
Bajar de aquí pide cambiar de motor: **PaddleOCR** (PP-OCRv5 vía onnxruntime-web) ya está
integrado en el proyecto y es el candidato natural — detecta texto con red neuronal en vez de
análisis de conectividad, que es justo donde Tesseract sufre con foto de pantalla.

## Añadir un caso de fallo

1. Guardar la foto en `~/Imágenes/Capturas de pantalla/nofunciona/`.
2. Añadirla a la lista de `scripts/verify-reward-scan.mjs` con sus recompensas esperadas.
3. Ejecutar el verificador y mirar la traza (`trace`), que indica qué fase falló.

Cada caso real añadido hace el algoritmo más robusto **sin tocar constantes a mano**.
