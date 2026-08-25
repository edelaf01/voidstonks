# VoidStonks Desktop (Tauri)

Empaqueta la app web (`../deploy`) como aplicación de escritorio nativa:

- **Linux**: AppImage (arranca sin instalar), `.deb`, `.rpm`
- **Windows**: instalador `.exe` (NSIS) y `.msi`

**Nada de `../deploy` se modifica.** El escritorio usa la misma carpeta que la web, tal
cual, con sus rutas relativas. Por eso no hay paso de build: Tauri mete el HTML/CSS/JS
directamente en la ventana.

## Cómo se generan los instaladores

Tauri compila cada plataforma en su propio sistema operativo: desde Linux **no** se puede
generar el `.exe`, y desde Windows no se generan los formatos Linux. Por eso la vía normal
es GitHub Actions, que levanta los dos a la vez.

### Opción A — GitHub Actions (recomendada, saca Windows + Linux)

El workflow `.github/workflows/desktop-build.yml` compila las cinco variantes en paralelo
(un runner Linux + uno Windows) y las deja descargables como artefactos.

```bash
# Dispara la compilación empujando un tag:
git tag desktop-v2.7.0
git push origin desktop-v2.7.0
```

También se puede lanzar a mano en **Actions → Build Desktop → Run workflow**. Al terminar,
los instaladores están en la pestaña del run (Artifacts).

### Opción B — compilar en local (solo tu plataforma)

En tu Fedora sale AppImage/`.deb`/`.rpm`; el `.exe` solo si ejecutas esto en Windows.

```bash
cd desktop
./check-requirements.sh     # dice qué falta y cómo instalarlo
npm install                 # baja el CLI de Tauri
npm run tauri dev           # abre la ventana con la app dentro (para probar)

# Fedora 44+ necesita estas dos para el AppImage; el porqué, más abajo
export APPIMAGE_EXTRACT_AND_RUN=1 NO_STRIP=1
npm run tauri build         # genera los instaladores en src-tauri/target/release/bundle/
```

**Un build fallido te deja sin el anterior.** `tauri build` vacía
`src-tauri/target/release/bundle/appimage/` antes de empaquetar, así que si falla no queda
nada: ni el nuevo ni el que ya tenías. Copia fuera de `target/` el AppImage que te sirva.

## Requisitos (Fedora)

El script `check-requirements.sh` los comprueba. En resumen:

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Librerías del sistema
sudo dnf install webkit2gtk4.1-devel libsoup3-devel \
                 gtk3-devel librsvg2-devel \
                 openssl-devel curl wget file
```

### Fedora atómica (Bazzite, Silverblue, Kinoite)

El `sudo dnf install` de arriba **no funciona en el host**: el sistema base es de solo
lectura. Compila dentro de un contenedor, que además ahorra el reboot que obligaría a dar
`rpm-ostree install`:

```bash
distrobox create --name voidstonks-build \
  --image registry.fedoraproject.org/fedora-toolbox:latest -Y

distrobox enter voidstonks-build -- bash -lc '
  sudo dnf install -y webkit2gtk4.1-devel libsoup3-devel gtk3-devel librsvg2-devel \
                      openssl-devel curl wget file patchelf xdg-utils \
                      rust cargo gcc gcc-c++ make'
```

`xdg-utils` es el que se olvida: sin él el empaquetado muere con `xdg-open binary not
found`, porque el bundler copia ese binario dentro del AppDir.

Después, cada compilación:

```bash
distrobox enter voidstonks-build -- bash -lc '
  cd ~/Escritorio/voidstonks/desktop
  export APPIMAGE_EXTRACT_AND_RUN=1 NO_STRIP=1
  npm run tauri build -- --bundles appimage'
```

Se limita a `appimage` a propósito: en un sistema atómico el `.rpm` obligaría a layering
con reboot, mientras que el AppImage es un fichero suelto que arranca con doble clic. Se
genera **dentro** del contenedor pero se ejecuta **en el host** sin instalar nada, porque
lleva su propio WebKitGTK dentro.

## Las dos variables del AppImage (Fedora 44+)

Sin ellas `tauri build` termina en `failed to run linuxdeploy`, y ese mensaje no dice cuál
de las dos causas —independientes entre sí— ha sido:

- `APPIMAGE_EXTRACT_AND_RUN=1` — `linuxdeploy` se distribuye como AppImage tipo 2 y pide
  **libfuse2**, que Fedora 44 ya no trae (solo `fusermount3`):
  `dlopen(): error loading libfuse.so.2`. La variable lo auto-extrae en vez de montarlo.
- `NO_STRIP=1` — el `strip` que `linuxdeploy` lleva empaquetado es viejo y no reconoce la
  sección `.relr.dyn` de las librerías de Fedora 44:
  ``strip: libzstd.so.1: unknown type [0x13] section `.relr.dyn` ``.

Hoy en CI no hacen falta, porque `ubuntu-22.04` es lo bastante antiguo como para no tropezar
con ninguna de las dos; el workflow las exporta igual para cuando jubilen ese runner.

## Por qué `csp` está a `null`

Con la CSP puesta la app **se pinta entera pero no responde a ninguna pulsación**, y no da
ningún error visible. La causa: Tauri inyecta un `nonce` en `script-src` para sus propios
scripts de arranque, y la spec de CSP manda **ignorar `'unsafe-inline'` en cuanto hay un
nonce**. Como `index.html` resuelve ~118 handlers con `onclick="foo()"` inline (ver
`CLAUDE.md`), se quedan todos muertos de golpe. En la web no ocurre porque ahí no hay CSP.

Poner `'unsafe-inline'` en la CSP no lo arregla: ya estaba puesto, y es precisamente lo que
el nonce anula. El arreglo de verdad sería migrar esos handlers a `addEventListener`, que es
un cambio grande en `index.html` y en los módulos que publican en `globalThis`.

Lo que se pierde: la CSP era defensa en profundidad frente a datos de warframe.market y del
OCR. La primera línea sigue en pie —`escapeHTML` en todo lo que va a `innerHTML`, verificado
por `tests/xss-escaping.test.mjs`—, pero conviene no perder de vista que aquí hay una red de
seguridad menos.

Efecto secundario: sin CSP vuelve a cargar `chart.js` desde `cdn.jsdelivr.net`
(`index.html`), que la CSP bloqueaba por tener jsdelivr solo en `connect-src` y no en
`script-src`.

## Aviso conocido: `GStreamer element appsink not found`

Sale por stderr al arrancar el AppImage. El AppDir lleva las librerías *core* de GStreamer
(`libgstreamer-1.0.so.0`, `libgstapp-1.0.so.0`…) pero **ningún plugin**: el contenedor de
compilación no tiene `gstreamer1-plugins-*`, así que `linuxdeploy-plugin-gstreamer` no
encontró nada que copiar y solo llegó a ejecutarse el hook de GTK. Los elementos de verdad
—`appsink` vive en `/usr/lib64/gstreamer-1.0/libgstapp.so`— se quedan fuera.

Afecta a lo que WebKit reproduzca vía GStreamer, y el candidato es el `MediaStream` del
scanner. **Sin verificar**: si el scanner falla al previsualizar la captura, prueba a
instalar los plugins en el contenedor y recompilar.

```bash
distrobox enter voidstonks-build -- \
  sudo dnf install -y gstreamer1-plugins-base gstreamer1-plugins-good
```

## Qué hace esta versión (fase 2)

Solo **envuelve la web en una ventana**. El backend Rust (`src-tauri/src/lib.rs`) no hace
nada más todavía: es a propósito, para validar que la app carga y funciona en el WebView
antes de invertir en lo siguiente.

## Pendiente

- **Fase 3 — login nativo.** El puente que describe
  `../deploy/js/utils/native_bridge.contract.md`: el login contra warframe.market irá
  directo desde el proceso Rust (sin CORS ni HttpOnly, como un script), de modo que la
  contraseña del usuario **nunca pase por el worker**. El front ya está preparado
  (`../deploy/js/utils/platform.js` detecta `globalThis.__vsNative`).

## Punto a verificar al arrancar

El **scanner** usa `getDisplayMedia` (compartir pantalla). En el WebView de Linux
(WebKitGTK) esto necesita el portal de escritorio:

- **Wayland**: requiere `xdg-desktop-portal` + el backend de tu escritorio (p. ej.
  `xdg-desktop-portal-gnome` o `-kde`). Si al pulsar "compartir pantalla" no pasa nada,
  suele ser que falta el portal.
- **X11**: suele funcionar sin más.

Todo lo demás (mercados, inventario local, WebSocket de precios) usa APIs estándar que el
WebView soporta sin configuración extra.
