// flat config tuned to catch bugs, not style

import globals from "globals";

export default [
    {
        ignores: [
            "deploy/js/tesseract*.js",
            "deploy/js/**/*.min.js",
            "deploy/js/**/*.wasm.js",
            "deploy/js/**/opencv*.js",
            "dist/**",
            "node_modules/**",
            "antiguo/**",
            "desktop/electron/node_modules/**",
            "desktop/electron/out/**",
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
                chrome: "readonly",
                cv: "readonly",
                Tesseract: "readonly",
                Chart: "readonly",
                state: "writable",
                showToast: "readonly",
                ScannerService: "writable",
                RivenScannerHUD: "writable",
                LiveCalibration: "writable",
            },
        },
        rules: {
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
            "no-console": "off",
            "no-dupe-class-members": "error",
            "no-var": "error",
            "eqeqeq": ["error", "smart"],
        },
    },

    {
        files: ["deploy/js/utils/**/*.js"],
        rules: {
            "no-restricted-imports": ["error", { patterns: [
                { group: ["**/ui.components/*", "**/services/*", "**/repositories/*", "**/api.js", "**/ui.js"],
                  message: "utils/ solo importa de config.js, state.js y otros utils/." },
            ] }],
        },
    },
    {
        files: ["deploy/js/repositories/**/*.js"],
        rules: {
            "no-restricted-imports": ["error", { patterns: [
                { group: ["**/ui.components/*", "**/services/*", "**/ui.js"],
                  message: "repositories/ hace I/O crudo: no conoce services/ ni la UI." },
            ] }],
        },
    },
    {
        files: ["deploy/js/services/**/*.js"],
        rules: {
            "no-restricted-imports": ["error", { patterns: [
                { group: ["**/ui.components/*", "**/ui.js"],
                  message: "Un service devuelve datos; el DOM y los toasts los pone el componente." },
            ] }],
        },
    },
    {
        files: ["deploy/js/ui.components/**/*.js"],
        rules: {
            "no-restricted-imports": ["error", { patterns: [
                { group: ["**/repositories/*"],
                  message: "El componente habla con un service, no con el repositorio." },
                { group: ["**/ui.js"],
                  message: "Desde un componente se usa globalThis.switchTab(...), nunca import de ui.js." },
            ] }],
        },
    },

    // frozen layer debt, keep in sync with tests/_baseline/architecture-debt.json
    {
        files: [
            "deploy/js/services/scanner/scanner.service.js",
            "deploy/js/ui.components/rivens/ui_arbitrage.js",
            "deploy/js/utils/vision/kubrow_color_extractor.js",
        ],
        rules: { "no-restricted-imports": "off" },
    },

    {
        files: ["tests/**/*.mjs", "scripts/**/*.mjs", "scripts-actu/**/*.mjs"],
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
    {
        files: ["desktop/electron/src/**/*.{js,cjs}"],
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
    {
        files: ["desktop/electron/src/**/*.cjs"],
        languageOptions: { sourceType: "commonjs" },
    },
    {
        files: ["desktop/electron/overlay/**/*.js"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: { ...globals.browser },
        },
        rules: {
            "no-undef": "error",
            "no-unused-vars": ["warn", { args: "none", ignoreRestSiblings: true }],
        },
    },
];
