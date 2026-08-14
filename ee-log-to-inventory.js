#!/usr/bin/env node

/**
 * EE.log to Inventory Integration
 * Parses Warframe ee.log and injects kubrow data into voidstonks app
 *
 * Usage:
 *   node ee-log-to-inventory.js [ee.log path] [output path]
 */

import fs from 'fs';
import path from 'path';
import EELogParser from './ee-log-parser.js';
import EELogTranslator from './ee-log-translator.js';

async function main() {
  const logPath = process.argv[2] || '.claude/eelog/EE.log';
  // Fuera de deploy/: ese directorio se copia entero a Cloudflare y este JSON es la salida de
  // este script, no un dato que pida el navegador.
  const outputPath = process.argv[3] || 'data/kubrows-from-eelog.json';

  console.log('[*] EE.log → Inventory Pipeline');
  console.log(`    Log: ${logPath}`);
  console.log(`    Output: ${outputPath}`);
  console.log('');

  // Step 1: Parse EE.log
  console.log('[1/3] Parsing EE.log...');
  const parser = new EELogParser();

  let eeLogData;
  try {
    eeLogData = await parser.parseLogFile(logPath);
    console.log(`      ✓ Found ${eeLogData.summary.uniqueKubrows} kubrows`);
    console.log(`      ✓ Found ${eeLogData.summary.uniqueColors} colors`);
    console.log(`      ✓ Found ${eeLogData.summary.uniquePatterns} patterns`);
  } catch (err) {
    console.error(`      ✗ Error parsing log: ${err.message}`);
    process.exit(1);
  }

  // Step 2: Translate to app format
  console.log('');
  console.log('[2/3] Translating to app format...');
  const translator = new EELogTranslator();
  const appData = translator.translateInventory(eeLogData);
  console.log(`      ✓ Translated ${appData.kubrows.length} kubrows`);
  console.log(`      ✓ Discovered ${appData.discoveredColors.length} color variants`);

  // Step 3: Export
  console.log('');
  console.log('[3/3] Exporting...');

  const output = {
    version: '1.0',
    timestamp: new Date().toISOString(),
    source: 'ee.log',
    data: appData,
    instructions: {
      colors: 'Import "discoveredColors" into kubrow color database',
      kubrows: 'Use kubrows array with formatForApp() to populate inventory',
      integration: 'Feed into scanner.service.js::processInventoryGrid() for OCR-less inventory sync'
    }
  };

  try {
    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`      ✓ Saved to ${outputPath}`);
  } catch (err) {
    console.error(`      ✗ Error exporting: ${err.message}`);
    process.exit(1);
  }

  console.log('');
  console.log('[✓] Pipeline complete');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Review discovered colors in the output file');
  console.log('  2. If colors are missing, ensure Warframe loaded the kubrows before logging');
  console.log('  3. Import into voidstonks inventory system');
}

main().catch(err => {
  console.error(`[ERROR] ${err.message}`);
  process.exit(1);
});
