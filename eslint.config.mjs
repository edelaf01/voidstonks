// Config de ESLint (flat). No hay tooling instalado por defecto: para usarlo,
//   npm i -D eslint globals && npm run lint
// Tuneada para ESTE proyecto (navegador, sin bundler, muchos globals de UI y del juego)
// para que reporte bugs reales sin ahogar en falsos no-undef.

import globals from "globals";

export default [
    {
        // Vendored / generados: no se lintan (son enormes y no son fuente propia).
        ignores: [
            "deploy/js/tesseract*.js",
            "deploy/js/**/*.min.js",
            "deploy/js/**/*.wasm.js",
            "deploy/js/**/opencv*.js",
            "dist/**",
            "node_modules/**",
            "antiguo/**",
        ],
    },
    {
        files: ["deploy/js/**/*.js", "extension/**/*.js", "worker-code.js", "scripts-actu/**/*.mjs"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                ...globals.browser,
                ...globals.worker,
                ...globals.serviceworker,
                // Globals del ecosistema de la app expuestos en window/globalThis.
                chrome: "readonly",
                cv: "readonly",
                Tesseract: "readonly",
                Chart: "readonly",
                state: "writable",
                // Expuesto en globalThis por ui_components.js: los scripts planos del
                // scanner (no-módulos) no pueden importarlo.
                showToast: "readonly",
                ScannerService: "writable",
                RivenScannerHUD: "writable",
                LiveCalibration: "writable",
            },
        },
        rules: {
            // Enfoque en bugs, no en estilo (el proyecto no tiene formateo automático).
            "no-undef": "error",
            "no-unused-vars": ["warn", { args: "none", ignoreRestSiblings: true }],
            "no-dupe-keys": "error",
            "no-dupe-args": "error",
            "no-unreachable": "error",
            "no-constant-condition": ["error", { checkLoops: false }],
            "no-cond-assign": "error",
            "no-self-assign": "error",
            "no-fallthrough": "error",
            "use-isnan": "error",
            "valid-typeof": "error",
            // El proyecto usa console.* para debug del scanner a propósito.
            "no-console": "off",
            "no-dupe-class-members": "error",
            // Las tres están hoy en 0 infracciones: entran como error para que siga siendo 0.
            // "smart" deja pasar `== null`, que en este repo es idiomático.
            "no-var": "error",
            "eqeqeq": ["error", "smart"],
        },
    },

    // El contrato de capas de ARCHITECTURE.md, también en el editor: tests/architecture.test.mjs
    // lo comprueba en `npm test`, pero un subrayado rojo al escribir el import ahorra el viaje.
    {
        files: ["deploy/js/utils/**/*.js"],
        rules: {
            "no-restricted-imports": ["error", { patterns: [
                { group: ["**/ui.components/*", "**/services/*", "**/repositories/*", "**/api.js", "**/ui.js"],
                  message: "utils/ solo importa de config.js, state.js y otros utils/. Ver ARCHITECTURE.md §A." },
            ] }],
        },
    },
    {
        files: ["deploy/js/repositories/**/*.js"],
        rules: {
            "no-restricted-imports": ["error", { patterns: [
                { group: ["**/ui.components/*", "**/services/*", "**/ui.js"],
                  message: "repositories/ hace I/O crudo: no conoce services/ ni la UI. Ver ARCHITECTURE.md §A." },
            ] }],
        },
    },
    {
        files: ["deploy/js/services/**/*.js"],
        rules: {
            "no-restricted-imports": ["error", { patterns: [
                { group: ["**/ui.components/*", "**/ui.js"],
                  message: "Un service devuelve datos; el DOM y los toasts los pone el componente. Ver ARCHITECTURE.md §A." },
            ] }],
        },
    },
    {
        files: ["deploy/js/ui.components/**/*.js"],
        rules: {
            "no-restricted-imports": ["error", { patterns: [
                { group: ["**/repositories/*"],
                  message: "El componente habla con un service, no con el repositorio. Ver ARCHITECTURE.md §A." },
                // ui.js ejecuta código al importarse: el import inverso deja el módulo a medio
                // evaluar y sus `let` explotan con "Cannot access 'X' before initialization".
                { group: ["**/ui.js"],
                  message: "Desde un componente se usa globalThis.switchTab(...), nunca import de ui.js." },
            ] }],
        },
    },

    // Deuda congelada: los tres ficheros que siguen cruzando capas (DEUDA.md §2 y
    // tests/_baseline/architecture-debt.json, que impide que la lista crezca). Se apaga aquí
    // para mantener el lint en 0 errores; al arreglar uno, se quita de las dos listas.
    {
        files: [
            "deploy/js/services/scanner/scanner.service.js",
            "deploy/js/ui.components/rivens/ui_arbitrage.js",
            "deploy/js/utils/vision/kubrow_color_extractor.js",
        ],
        rules: { "no-restricted-imports": "off" },
    },

    // Los tests son Node, no navegador: sin esto `no-undef` marcaría process/Buffer/__dirname.
    {
        files: ["tests/**/*.mjs", "scripts/**/*.mjs"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: { ...globals.node },
        },
        rules: {
            "no-undef": "error",
            "no-unused-vars": ["warn", { args: "none", ignoreRestSiblings: true }],
            "no-var": "error",
        },
    },
];
