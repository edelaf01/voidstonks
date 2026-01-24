const fs = require('fs');
const path = '/home/ajunkie/Documentos/GitHub/voidstonks/deploy/js/ui.js';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(/\+ STAT 1/g, '');
content = content.replace(/\+ STAT 2/g, '');
content = content.replace(/\+ STAT 3/g, '');

content = content.replace(/Rad: "Radiant",/g, 'Rad: "Radiant", rad: "Radiant",');

fs.writeFileSync(path, content);
