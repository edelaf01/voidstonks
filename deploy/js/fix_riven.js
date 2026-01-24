const fs = require('fs');
const path = '/home/ajunkie/Documentos/GitHub/voidstonks/deploy/js/ui.js';
let content = fs.readFileSync(path, 'utf8');

// Ocultar "Stat 1 / 2 / 3"
content = content.replace(/\+ STAT 1/g, '');
content = content.replace(/\+ STAT 2/g, '');
content = content.replace(/\+ STAT 3/g, '');

// Corregir cálculo de ducados promedio (simulación de bugfix)
// En updateRelicTotal o calculateSquadEV
// Asegurarse de que refinement 'Rad' se mapee correctamente a Radiant si no lo está
// En calculateSquadEV:
// const safeKey = keyMap[refinement] || refinement;
// Si refinement llega como 'Rad', keyMap['Rad'] es 'Radiant'.
// Si llega como 'rad' (minúscula), podría fallar si keyMap no tiene 'rad'.
content = content.replace(/Rad: "Radiant",/g, 'Rad: "Radiant", rad: "Radiant",');

fs.writeFileSync(path, content);
