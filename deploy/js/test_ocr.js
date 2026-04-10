import fs from 'fs';
import { parseTextForRewards } from './scanner_ocr.js';
import { state } from './state.js';

// mock state 
state.itemsDatabase = {
    "Voruna Prime Blueprint": [{ ducats: 100 }],
    "Forma Blueprint": [{ ducats: 15 }],
    "Fang Prime Blueprint": [{ ducats: 45 }]
};

const ocrData = {
    words: [
        { text: "Voruna", bbox: { x0: 100, x1: 150, y0: 100, y1: 120 } },
        { text: "Prime", bbox: { x0: 160, x1: 200, y0: 100, y1: 120 } },
        { text: "Blueprint", bbox: { x0: 210, x1: 280, y0: 100, y1: 120 } },
        { text: "2", bbox: { x0: 290, x1: 300, y0: 100, y1: 120 } },
        { text: "X", bbox: { x0: 310, x1: 320, y0: 100, y1: 120 } },
        { text: "Forma", bbox: { x0: 500, x1: 560, y0: 100, y1: 120 } },
        { text: "Blueprint", bbox: { x0: 570, x1: 650, y0: 100, y1: 120 } },
        { text: "Fang", bbox: { x0: 1000, x1: 1050, y0: 100, y1: 120 } },
        { text: "Prime", bbox: { x0: 1060, x1: 1100, y0: 100, y1: 120 } },
        { text: "Blueprint", bbox: { x0: 1110, x1: 1180, y0: 100, y1: 120 } },
        { text: "Fang", bbox: { x0: 1500, x1: 1550, y0: 100, y1: 120 } },
        { text: "Prime", bbox: { x0: 1560, x1: 1600, y0: 100, y1: 120 } },
        { text: "Blueprint", bbox: { x0: 1610, x1: 1680, y0: 100, y1: 120 } }
    ],
    imageW: 1920
};

const res = parseTextForRewards(ocrData);
console.log(res);
