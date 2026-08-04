#!/usr/bin/env bash
# Comprueba si el sistema puede compilar y arrancar VoidStonks Desktop (Tauri 2).
# No instala nada: solo informa de qué falta y con qué comando ponerlo.
set -u

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$1"; MISSING=1; }
note() { printf '    \033[2m%s\033[0m\n' "$1"; }

MISSING=0
echo "== Requisitos de VoidStonks Desktop =="
echo

# --- Node / npm (para el CLI de Tauri) ---
if command -v npm >/dev/null 2>&1; then ok "npm $(npm --version)"; else
  bad "npm no encontrado"; note "instálalo con nvm o 'sudo dnf install nodejs'"
fi

# --- Rust ---
if command -v cargo >/dev/null 2>&1; then ok "Rust $(cargo --version | awk '{print $2}')"; else
  bad "Rust/cargo no encontrado"
  note "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
fi

# --- Librerías del sistema (WebKitGTK + soup) ---
DEV_MISSING=()
for lib in "webkit2gtk-4.1" "libsoup-3.0"; do
  if pkg-config --exists "$lib" 2>/dev/null; then
    ok "$lib $(pkg-config --modversion "$lib")"
  else
    bad "$lib no encontrado"
    DEV_MISSING+=("$lib")
  fi
done

echo
if [ "$MISSING" -eq 0 ]; then
  echo "Todo listo. Arranca con:  npm install && npm run tauri dev"
else
  echo "Faltan cosas. En Fedora, las librerías del sistema se instalan con:"
  echo
  echo "  sudo dnf install webkit2gtk4.1-devel libsoup3-devel \\"
  echo "                   gtk3-devel librsvg2-devel \\"
  echo "                   openssl-devel curl wget file"
  echo
  echo "(y Rust con el comando de rustup de arriba, si faltaba)."
  echo "Después:  cd desktop && npm install && npm run tauri dev"
fi
exit "$MISSING"
