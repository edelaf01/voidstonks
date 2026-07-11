# VoidStonks AutoCopy (extensión de navegador)

Permite que el AUTO-COPY del scanner escriba el portapapeles **aunque Warframe tenga el
foco**. Sin la extensión, el navegador bloquea `navigator.clipboard` en pestañas sin foco
y la app solo puede encolar el texto y copiarlo cuando vuelves a la pestaña.

## Instalación (Chrome / Edge / Brave)

1. Abre `chrome://extensions`
2. Activa **Modo desarrollador** (arriba a la derecha)
3. **Cargar descomprimida** → selecciona esta carpeta (`extension/`)

Nada más. La app la detecta sola: con la extensión instalada, al escanear una recompensa
con AUTO-COPY activado el texto llega al portapapeles al instante y puedes pegarlo en el
chat del juego sin alt-tab.

## Cómo funciona

- `content.js` — puente: recibe el `postMessage` de la página y lo reenvía al service worker.
- `background.js` — crea un documento offscreen (razón `CLIPBOARD`).
- `offscreen.js` — escribe el portapapeles con `execCommand("copy")`, que no requiere foco.

Solo tiene permisos `offscreen` + `clipboardWrite` y solo corre en los dominios de
VoidStonks (github.io / localhost).
