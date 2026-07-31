import fs from 'fs';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = __filename.split('/').slice(0, -1).join('/');

/**
 * EE.log Parser for Warframe
 * Extracts kubrow colors, patterns, and other inventory data
 */

class EELogParser {
  constructor() {
    // Kubrow breeds mapped from Warframe data
    this.kubrowBreeds = {
      'Huras': 'huras',
      'Sunika': 'sunika',
      'Raksa': 'raksa',
      'Sahasa': 'sahasa',
      'Chesa': 'chesa',
      'Adarza': 'adarza',
      'Smeeta': 'smeeta',
      'Vasili': 'vasili',
      'Khora': 'khora', // Khora Deluxe
    };

    // Rarity levels from the color system
    this.rarityLevels = ['Mundane', 'Mid', 'Vibrant'];

    // Kubrow color rarity mapping (from spreadsheet)
    this.colorRarityMap = this.buildColorRarityMap();

    this.kubrows = [];
    this.colorReferences = [];
    this.patternReferences = [];
  }

  /**
   * Build color to rarity mapping from known Warframe color paths
   * Format: KubrowPetColor{Breed}{Rarity}
   */
  buildColorRarityMap() {
    const map = {};

    for (const breed of Object.keys(this.kubrowBreeds)) {
      map[breed] = {};
      for (const rarity of this.rarityLevels) {
        const colorPath = `KubrowPetColor${breed}${rarity}`;
        map[breed][rarity] = colorPath;
      }
    }

    return map;
  }

  /**
   * Parse EE.log line by line
   * @param {string} logPath - Path to EE.log file
   * @returns {Promise<Object>} Parsed data
   */
  async parseLogFile(logPath) {
    return new Promise((resolve, reject) => {
      const fileStream = fs.createReadStream(logPath);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      rl.on('line', (line) => {
        this.parseLine(line);
      });

      rl.on('close', () => {
        const result = this.compileResults();
        resolve(result);
      });

      rl.on('error', reject);
    });
  }

  /**
   * Parse individual log line
   * @param {string} line - Log line
   */
  parseLine(line) {
    // Match Kubrow color references
    if (line.includes('KubrowPetColor')) {
      this.parseColorReference(line);
    }

    // Match Kubrow pattern references
    if (line.includes('KubrowPetPattern')) {
      this.parsePatternReference(line);
    }

    // Match Kubrow pet avatars (entities being loaded)
    if (line.includes('KubrowPetAvatar') || line.includes('KubrowShipAvatar')) {
      this.parseKubrowEntity(line);
    }

    // Match inventory sync events
    if (line.includes('OnInventoryResults')) {
      this.parseInventorySync(line);
    }
  }

  /**
   * Extract color reference from log line
   * Pattern: /Lotus/Types/Game/KubrowPet/Colors/KubrowPetColor{Breed}{Rarity}
   */
  parseColorReference(line) {
    const colorMatch = line.match(/KubrowPetColor([A-Za-z]+(?:Deluxe)?)(Mundane|Mid|Vibrant)?/);
    if (colorMatch) {
      const breed = colorMatch[1];
      const rarity = colorMatch[2] || 'Unknown';

      this.colorReferences.push({
        breed,
        rarity,
        timestamp: this.extractTimestamp(line),
        rawPath: line.match(/\/Lotus[^\s]*/)?.[0] || ''
      });
    }
  }

  /**
   * Extract pattern reference from log line
   * Pattern: /Lotus/Types/Game/KubrowPet/Patterns/KubrowPetPattern{Letter}
   */
  parsePatternReference(line) {
    const patternMatch = line.match(/KubrowPetPattern([A-Za-z]+)/);
    if (patternMatch) {
      const patternLetter = patternMatch[1];

      this.patternReferences.push({
        patternLetter,
        timestamp: this.extractTimestamp(line),
        rawPath: line.match(/\/Lotus[^\s]*/)?.[0] || ''
      });
    }
  }

  /**
   * Extract Kubrow pet entity information
   */
  parseKubrowEntity(line) {
    const entityMatch = line.match(/(KubrowPetAvatar|KubrowShipAvatar)(\d+)/);
    const playerMatch = line.match(/setting owner player to ([A-Za-z0-9_]+)/);

    if (entityMatch) {
      const entityType = entityMatch[1];
      const entityId = entityMatch[2];
      const playerName = playerMatch ? playerMatch[1] : 'Unknown';

      this.kubrows.push({
        entityId,
        entityType,
        playerName,
        timestamp: this.extractTimestamp(line),
        rawLine: line
      });
    }
  }

  /**
   * Extract inventory sync event
   */
  parseInventorySync(line) {
    const sizeMatch = line.match(/body size=(\d+)/);
    if (sizeMatch) {
      console.log(`[INFO] Inventory sync detected: ${sizeMatch[1]} bytes`);
    }
  }

  /**
   * Extract timestamp from log line (first token)
   */
  extractTimestamp(line) {
    const match = line.match(/^([\d.]+)/);
    return match ? parseFloat(match[1]) : null;
  }

  /**
   * Compile and deduplicate results
   */
  compileResults() {
    // Deduplicate color references
    const uniqueColors = {};
    for (const ref of this.colorReferences) {
      const key = `${ref.breed}_${ref.rarity}`;
      if (!uniqueColors[key]) {
        uniqueColors[key] = ref;
      }
    }

    // Deduplicate pattern references
    const uniquePatterns = new Set(
      this.patternReferences.map(p => p.patternLetter)
    );

    // Deduplicate kubrow entities
    const uniqueKubrows = {};
    for (const kubrow of this.kubrows) {
      if (!uniqueKubrows[kubrow.entityId]) {
        uniqueKubrows[kubrow.entityId] = kubrow;
      }
    }

    return {
      colors: Object.values(uniqueColors),
      patterns: Array.from(uniquePatterns),
      kubrows: Object.values(uniqueKubrows),
      summary: {
        totalColorReferences: this.colorReferences.length,
        uniqueColors: Object.keys(uniqueColors).length,
        totalPatternReferences: this.patternReferences.length,
        uniquePatterns: uniquePatterns.size,
        totalKubrows: this.kubrows.length,
        uniqueKubrows: Object.keys(uniqueKubrows).length
      }
    };
  }

  /**
   * Export results to JSON
   */
  exportJSON(data, outputPath) {
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    console.log(`[OK] Exported to ${outputPath}`);
  }
}

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const logPath = process.argv[2] || '/var/home/ppsoy/Escritorio/voidstonks/.claude/eelog/EE.log';
  const outputPath = process.argv[3] || '/tmp/ee-log-parsed.json';

  const parser = new EELogParser();

  console.log(`[*] Parsing ${logPath}...`);
  parser.parseLogFile(logPath).then(result => {
    console.log(`[OK] Parsed successfully`);
    console.log(`    Colors found: ${result.summary.uniqueColors}`);
    console.log(`    Patterns found: ${result.summary.uniquePatterns}`);
    console.log(`    Kubrows found: ${result.summary.uniqueKubrows}`);

    parser.exportJSON(result, outputPath);
  }).catch(err => {
    console.error(`[ERROR] ${err.message}`);
    process.exit(1);
  });
}

export default EELogParser;
