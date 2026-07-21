# Warframe EE.log Parser

Parser para extraer datos de kubrows desde el archivo `EE.log` de Warframe.

## Dónde encontrar tu EE.log

**Windows:**
```
%LocalAppData%\Warframe\EE.log
C:\Users\[TuNombre]\AppData\Local\Warframe\EE.log
```

**Linux (Proton):**
```
~/.local/share/Steam/steamapps/compatdata/230410/pfx/drive_c/users/steamuser/AppData/Local/Warframe/EE.log
```

## Cómo usar

1. **Abre VoidStonks** en tu navegador
2. **Haz clic en la pestaña "Kubrows"** (📋)
3. **Sube tu `EE.log`**:
   - Arrastra y suelta el archivo
   - O haz clic para seleccionar
4. **El parser**:
   - Extrae todos los kubrows detectados
   - Asigna colores realistas según rareza
   - Muestra el total de entidades encontradas
5. **Filtra y explora**:
   - Busca por nombre o raza
   - Filtra por rareza (Common, Uncommon, Rare)
6. **Exporta** los datos como JSON

## Información extraída

Por cada kubrow:
- **ID**: Identificador único en el log
- **Nombre**: Kubrow_[ID] (editable manualmente)
- **Raza**: Detectada del tipo (Huras, Sunika, etc)
- **Colores**: Paleta primaria/secundaria según rareza
- **Rareza**: Common (60%), Uncommon (25%), Rare (15%)
- **Patrón**: Detectado del asset de textura
- **Jugador**: Propietario (si está disponible)

## Limitaciones actuales

⚠️ **Color**: Los colores reales se extraen del EE.log solo si Warframe cargó los kubrows visualmente antes de cerrar. Si tu log no contiene referencias `KubrowPetColor*`, se asignan colores aleatorios realistas por rareza.

Para obtener colores exactos:
1. Abre tu Orbiter o Arsenal
2. Visualiza tus kubrows (que se cacheen en memoria)
3. Genera un nuevo EE.log
4. Sube ese log

## Qué hace el parser

- Lee el EE.log línea por línea
- Busca patrones de `KubrowPetAvatar`, `KubrowShipAvatar`, `KubrowPetColor*`
- Extrae IDs, tipos de entidad, timestamps
- Deduplica entidades con el mismo ID
- Genera una vista grid con cards interactivas

## Datos técnicos

- **Tamaño máximo**: 100MB
- **Procesamiento**: Chunked (1000 líneas por iteración)
- **Feedback**: Barra de progreso en vivo
- **Exporta**: JSON válido listo para importar

## Próximas mejoras (roadmap)

- [ ] Lectura de colores RGB reales desde logs completos
- [ ] Editor inline para renombrar kubrows
- [ ] Importación directa a inventario
- [ ] Soporte para Khora (catbrows)
- [ ] Sincronización con Warframe.market API
