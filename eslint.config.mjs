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
                ScannerService: "writable",
                RivenScannerHUD: "writable",
                OpenCVEngine: "writable",
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
        },
    },
];
