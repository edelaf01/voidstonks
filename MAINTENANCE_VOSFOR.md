# 🛠️ Guía de Mantenimiento: Sistema Vosfor & Arcanos (VoidStonks)

Este documento detalla la arquitectura, el flujo de datos y los pasos exactos para actualizar, mantener o añadir nuevas colecciones de Vosfor y arcanos cuando Warframe reciba nuevas actualizaciones.

---

## 🏗️ 1. Arquitectura del Módulo Vosfor

El módulo Vosfor se compone de 4 capas desacopladas:

1. **Datos Base (`deploy/assets/json/arcanes_vosfor.json`)**:
   - Contiene la lista oficial de colecciones de Loid (`packs`), costes en Vosfor/Créditos, pesos de probabilidad por rareza (`rolls`), y la lista de todos los arcanos conocidos (`arcanes`) con su rareza y rendimiento al disolver.
2. **Servicio y Métricas (`deploy/js/services/vosfor.service.js`)**:
   - Calcula el **EV (Valor Esperado)** de Platinum por pack, la **Liquidez de Mercado** (ventas reales/día en 48h), el **Veredicto** (Vender R0, Vender R5, Disolver), y la simulación de inversión.
3. **Interfaz de Usuario (`deploy/js/ui.components/ui_vosfor.js`)**:
   - Renderiza el **Simulador de Arcano Objetivo**, **Calculadora de Vosfor**, **Rankings TOP**, **Resultados de Búsqueda**, y las **Tablas de Colecciones**.
4. **Traducciones e i18n (`deploy/js/config.js`)**:
   - Todos los textos consumen dinámicamente de `TEXTS[state.currentLang].vosfor`. Nunca hardcodear strings en los componentes UI.

---

## 📝 2. Cómo añadir una Nueva Colección de Loid (Ej. Nueva Actualización)

Cuando DE agregue un nuevo sindicato o colección de packs en Loid:

### Paso A: Registrar la Colección en `deploy/assets/json/arcanes_vosfor.json` (o vía script)
Re-ejecuta `scripts-actu/generar_arcanos_vosfor.py` o añade el nuevo pack dentro del array `"packs"`:

```json
{
  "id": "nueva_coleccion_slug",
  "es": "Colección de Nombre",
  "en": "Name Collection",
  "cost": {
    "vosfor": 200,
    "credits": 50000
  },
  "rolls": [
    {
      "COMMON": 0.50,
      "UNCOMMON": 0.30,
      "RARE": 0.15,
      "LEGENDARY": 0.05
    }
  ],
  "items": [
    "arcano_ejemplo_1",
    "arcano_ejemplo_2"
  ]
}
```

### Paso B: Registrar el Sindicato en `ui_vosfor.js`
Añade los metadatos del sindicato en el objeto `PACK_SYNDICATES` dentro de `deploy/js/ui.components/ui_vosfor.js`:

```javascript
nueva_coleccion_slug: {
    id: "nuevo_sindicato",
    es: "Nombre del Sindicato (Ubicación)",
    en: "Syndicate Name (Location)",
    icon: "nombre_icono_local",
    wikiIcon: "NombrePaginaWikiSyndicate"
}
```

---

## 🔮 3. Cómo añadir Nuevos Arcanos Sueltos (Eventos o fuera de Loid)

Si se añaden arcanos que no se compran en Loid pero se pueden disolver en Vosfor o vender en warframe.market:

1. Añadir la clave del arcano en `"arcanes"` de `deploy/assets/json/arcanes_vosfor.json`:
   ```json
   "nuevo_arcano_slug": {
     "es": "Nombre en Español",
     "en": "English Name",
     "rarity": "LEGENDARY",
     "vosfor": 92
   }
   ```
2. Si forma parte de un evento o sindicato especial, añadir su slug al grupo correspondiente en `ui_vosfor.js` (`CATHEDRALE_ARCANES`, `JADE_CONSTELLATIONS_ARCANES` o el mapeo por defecto).

---

## 🖼️ 4. Cadena de Redundancia de Imágenes (Cero 404s)

Todas las imágenes de arcanos e iconos de Vosfor utilizan una cadena de respaldo triple:

1. **Servidor Oficial de la Wiki de Warframe**: `https://wiki.warframe.com/w/Special:FilePath/{Nombre}.png`
2. **CDN Oficial del Proyecto WFCD (GitHub)**: `https://raw.githubusercontent.com/WFCD/warframe-items/master/data/img/{slug}.png`
3. **Respaldo Local WebP**: `deploy/assets/relic_contents/{slug}.webp`

Para descargar o refrescar las imágenes locales de respaldo en WebP, ejecuta:
```bash
python3 scripts-actu/guardar_vosfor_all.py
```

---

## ⚡ 5. Rendimiento y Actualizaciones del DOM (`In-Place Updates`)

- **Modificación de Copias en el Simulador**: La función `updateTargetSimDOM()` actualiza directamente las etiquetas `#target-val-vosfor`, `#target-val-pulls`, `#target-val-credits` sin destruir el DOM.
- **Entrada de Vosfor del Usuario**: La función `updateCalculatorWidgetDOM()` modifica únicamente el contenedor `#vosfor-calc-results-box`. 
- **Regla de Oro**: Nunca llames a `renderVosforTab()` en eventos `oninput` de campos de texto activos para evitar parpadeos y pérdida de foco.
