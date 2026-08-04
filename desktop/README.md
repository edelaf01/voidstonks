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
npm run tauri build         # genera los instaladores en src-tauri/target/release/bundle/
```

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
