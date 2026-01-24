# VoidStonks Copilot Instructions

## Architecture Overview

VoidStonks is a Warframe companion web app built with vanilla JavaScript ES6 modules. The production build lives in `deploy/`, with modular components in `deploy/js/`. No build tools; static file deployment.

- **main.js**: Entry point importing all modules and initializing the app.
- **state.js**: Global state object with debounced localStorage persistence (1s delay).
- **ui.js**: DOM manipulation, tab switching, rendering functions (2800+ lines).
- **api.js**: Warframe Market API interactions via proxy worker (`WORKER_URL`), with memory caching and rate limiting (max 5 concurrent requests).
- **scanner.js / live_scanner.js / mobile_scanner.js**: OCR relic scanning using Tesseract.js from camera/image uploads.
- **config.js**: Constants like `WORKER_URL`, app version, update history.

## Key Patterns

- **State Management**: Modify `state` object directly, call `saveAppState()` for persistence. Access via `import { state } from "./state.js"`.
- **API Calls**: Use `addToQueue()` for rate-limited requests. Cache results in `MEMORY_CACHE` Map.
- **UI Updates**: Functions like `showToast(message)` for notifications, `switchTab(mode)` for navigation.
- **OCR Processing**: Canvas preprocessing before Tesseract recognition. Detect static frames to avoid redundant scans.
- **Language Support**: Bilingual (ES/EN) via `TEXTS` object in config, switched via `state.currentLang`.

## Workflows

- **Development**: Edit files in `deploy/js/`, test in browser. No hot reload or build step.
- **Deployment**: Update `deploy/` manually. Version in `config.js`, update history in `UPDATE_HISTORY_CONTENT`.
- **Data Fetching**: Relics, prices, rivens fetched on-demand. Inventory stored locally in `state.inventory`.
- **Scanning**: Open scanner overlay, capture/process frames, confirm additions to inventory.

## Conventions

- Imports: Relative paths, e.g., `import { func } from "./module.js"`.
- Error Handling: `showToast()` for user feedback, console logs for debugging.
- Naming: CamelCase functions, UPPER_CASE constants.
- No tests or linters visible; manual QA.

Reference: [README.md](README.md) for features, [deploy/index.html](deploy/index.html) for structure.</content>
<parameter name="filePath">/var/home/ajunkie/Documentos/GitHub/voidstonks/.github/copilot-instructions.md
