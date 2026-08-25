# VoidStonks

Las reglas del repo están en CLAUDE.md y ARCHITECTURE.md; valen igual para Gemini CLI.

@./CLAUDE.md

@./ARCHITECTURE.md

## Recordatorio de las tres que más duelen

- `deploy/` es fuente **y** lo publicado: un error va directo a producción.
- `npm test` (~745 tests, ~65 s) y `npm run lint` (0 errores) antes de dar nada por terminado.
- Los commits los hace el usuario. Nada de `git add` / `commit` / `push`.
