#!/usr/bin/env bash
# Empaqueta la app en app.zip y compila el lanzador para Linux y Windows.
# Uso: ./build.sh [carpeta]   (por defecto deploy/; CI le pasa el dist/ minificado)
set -euo pipefail
cd "$(dirname "$0")"
src="$(cd "${1:-../../deploy}" && pwd)"

rm -f app.zip
(cd "$src" && zip -qr -9 "$OLDPWD/app.zip" . -x '*.md' '_headers' '_redirects' '.assetsignore' '.wrangler/*')

mkdir -p out
export CGO_ENABLED=0
GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o out/voidstonks-linux-x64 .
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w -H=windowsgui" -o out/VoidStonks.exe .
ls -lh out
