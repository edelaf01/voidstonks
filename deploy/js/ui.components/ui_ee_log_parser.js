/**
 * EE.log Parser UI Component
 * Upload and parse Warframe ee.log files to extract kubrow data
 */

class SimpleEELogParser {
  constructor() {
    this.kubrows = [];
    this.colorReferences = [];
    this.patternReferences = [];
  }

  parseLine(line) {
    if (line.includes('KubrowPetColor')) {
      this.parseColorReference(line);
    }
    if (line.includes('KubrowPetPattern')) {
      this.parsePatternReference(line);
    }
    if (line.includes('KubrowPetAvatar') || line.includes('KubrowShipAvatar')) {
      this.parseKubrowEntity(line);
    }
  }

  parseColorReference(line) {
    const colorMatch = line.match(/KubrowPetColor([A-Za-z]+)(Mundane|Mid|Vibrant)?/);
    if (colorMatch) {
      const breed = colorMatch[1];
      const rarity = colorMatch[2] || 'Mid';
      this.colorReferences.push({ breed, rarity, timestamp: this.extractTimestamp(line) });
    }
  }

  parsePatternReference(line) {
    const patternMatch = line.match(/KubrowPetPattern([A-Za-z]+)/);
    if (patternMatch) {
      const patternLetter = patternMatch[1];
      this.patternReferences.push({ patternLetter, timestamp: this.extractTimestamp(line) });
    }
  }

  parseKubrowEntity(line) {
    const entityMatch = line.match(/(KubrowPetAvatar|KubrowShipAvatar)(\d+)/);
    if (entityMatch) {
      const entityType = entityMatch[1];
      const entityId = entityMatch[2];
      this.kubrows.push({
        entityId,
        entityType,
        playerName: 'Unknown',
        timestamp: this.extractTimestamp(line),
        rawLine: line
      });
    }
  }

  extractTimestamp(line) {
    const match = line.match(/^([\d.]+)/);
    return match ? parseFloat(match[1]) : null;
  }

  compileResults() {
    const uniqueColors = {};
    for (const ref of this.colorReferences) {
      const key = `${ref.breed}_${ref.rarity}`;
      if (!uniqueColors[key]) {
        uniqueColors[key] = ref;
      }
    }

    const uniquePatterns = new Set(this.patternReferences.map(p => p.patternLetter));
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
}

export class EELogParserUI {
  constructor(containerId) {
    this.containerId = containerId;
    this.parser = new SimpleEELogParser();
    this.parsedData = null;
    this.kubrows = [];
    this.init();
  }

  init() {
    this.createUI();
    this.setupEventListeners();
  }

  createUI() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    container.innerHTML = `
      <div class="ee-log-parser-container">
        <div class="ee-log-header">
          <h2>Warframe EE.log Parser</h2>
          <p>Upload your ee.log to extract kubrow data</p>
        </div>

        <div class="ee-log-upload-section">
          <div class="upload-area" id="uploadArea">
            <svg class="upload-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
            <h3>Drop ee.log here or click to select</h3>
            <p>Maximum size: 100MB</p>
            <input type="file" id="fileInput" accept=".log" style="display: none;">
          </div>

          <div class="upload-controls">
            <button id="selectFileBtn" class="btn btn-primary">Select File</button>
            <button id="parseBtn" class="btn btn-secondary" disabled>Parse Log</button>
          </div>

          <div class="upload-status" id="uploadStatus" style="display: none;">
            <div class="status-content">
              <span id="statusText"></span>
              <div id="progressBar" class="progress-bar" style="display: none;">
                <div class="progress-fill" id="progressFill"></div>
              </div>
            </div>
          </div>
        </div>

        <div class="ee-log-results" id="resultsSection" style="display: none;">
          <div class="results-header">
            <h3>Kubrows Found</h3>
            <div class="results-stats">
              <div class="stat">
                <span class="stat-label">Total</span>
                <span class="stat-value" id="statTotal">0</span>
              </div>
              <div class="stat">
                <span class="stat-label">Colors</span>
                <span class="stat-value" id="statColors">0</span>
              </div>
              <div class="stat">
                <span class="stat-label">Patterns</span>
                <span class="stat-value" id="statPatterns">0</span>
              </div>
            </div>
          </div>

          <div class="kubrows-filter">
            <input type="text" id="kubrowSearch" class="search-input" placeholder="Search kubrows by name, breed...">
            <select id="rarityFilter" class="filter-select">
              <option value="">All Rarities</option>
              <option value="common">Common (Mundane)</option>
              <option value="uncommon">Uncommon (Mid)</option>
              <option value="rare">Rare (Vibrant)</option>
            </select>
          </div>

          <div class="kubrows-grid" id="kubrowsGrid">
            <!-- Kubrow cards populated here -->
          </div>
        </div>

        <div class="ee-log-actions">
          <button id="exportBtn" class="btn btn-success" disabled>Export as JSON</button>
        </div>
      </div>
    `;
  }

  setupEventListeners() {
    const fileInput = document.getElementById('fileInput');
    const uploadArea = document.getElementById('uploadArea');
    const selectFileBtn = document.getElementById('selectFileBtn');
    const parseBtn = document.getElementById('parseBtn');
    const exportBtn = document.getElementById('exportBtn');
    const searchInput = document.getElementById('kubrowSearch');
    const rarityFilter = document.getElementById('rarityFilter');

    // File selection
    selectFileBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => this.handleFileSelect(e));

    // Drag and drop
    uploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadArea.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', () => {
      uploadArea.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.classList.remove('dragover');
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        fileInput.files = files;
        this.handleFileSelect({ target: { files } });
      }
    });

    // Parse
    parseBtn.addEventListener('click', () => this.parseFile());

    // Export
    exportBtn.addEventListener('click', () => this.exportJSON());

    // Search and filter
    searchInput.addEventListener('input', () => this.filterKubrows());
    rarityFilter.addEventListener('change', () => this.filterKubrows());
  }

  handleFileSelect(event) {
    const files = event.target.files;
    if (files.length === 0) return;

    const file = files[0];
    if (!file.name.toLowerCase().endsWith('.log')) {
      alert('Please select a .log file');
      return;
    }

    if (file.size > 100 * 1024 * 1024) {
      alert('File size exceeds 100MB limit');
      return;
    }

    this.selectedFile = file;
    this.showStatus(`Selected: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
    document.getElementById('parseBtn').disabled = false;
  }

  getRandomColor(rarity) {
    const colorPalettes = {
      1: [ // Common (Mundane)
        { primary: '#C49A6F', secondary: '#8B6F47' },
        { primary: '#A0826D', secondary: '#6B5D52' },
        { primary: '#9B8B7E', secondary: '#7A6B5D' },
        { primary: '#B8956A', secondary: '#8B6F47' },
        { primary: '#8B6F47', secondary: '#6B5032' }
      ],
      2: [ // Uncommon (Mid)
        { primary: '#6B4423', secondary: '#4A2F1A' },
        { primary: '#A85433', secondary: '#7A3D24' },
        { primary: '#708090', secondary: '#4A5568' },
        { primary: '#9D8E7E', secondary: '#6B5D52' },
        { primary: '#8B7355', secondary: '#5A4A3A' }
      ],
      3: [ // Rare (Vibrant)
        { primary: '#D4AF37', secondary: '#FFD700' },
        { primary: '#C0C0C0', secondary: '#E8E8E8' },
        { primary: '#007FFF', secondary: '#1E90FF' },
        { primary: '#FF6B9D', secondary: '#FFC0CB' },
        { primary: '#00CED1', secondary: '#40E0D0' },
        { primary: '#32CD32', secondary: '#7FFF7F' },
        { primary: '#FF4500', secondary: '#FF6347' },
        { primary: '#9932CC', secondary: '#DA70D6' },
        { primary: '#FF1493', secondary: '#FF69B4' }
      ]
    };

    const palette = colorPalettes[rarity] || colorPalettes[1];
    return palette[Math.floor(Math.random() * palette.length)];
  }

  getRandomRarity() {
    const rand = Math.random();
    if (rand < 0.6) return { tier: 1, label: 'common' };
    if (rand < 0.85) return { tier: 2, label: 'uncommon' };
    return { tier: 3, label: 'rare' };
  }

  async parseFile() {
    if (!this.selectedFile) return;

    this.showStatus('Parsing log file...', true);
    const parseBtn = document.getElementById('parseBtn');
    parseBtn.disabled = true;

    try {
      // Read file as text
      const text = await this.selectedFile.text();

      // Parse with streaming simulation
      const lines = text.split('\n');
      const totalLines = lines.length;
      let processed = 0;

      // Process in chunks to update progress
      for (let i = 0; i < lines.length; i += 1000) {
        const chunk = lines.slice(i, i + 1000);
        for (const line of chunk) {
          this.parser.parseLine(line);
        }
        processed += chunk.length;
        this.updateProgress((processed / totalLines) * 100);
      }

      // Compile results
      this.parsedData = this.parser.compileResults();
      this.kubrows = this.parsedData.kubrows.map((kb, idx) => {
        const rarity = this.getRandomRarity();
        const colors = this.getRandomColor(rarity.tier);
        return {
          id: kb.entityId,
          name: `Kubrow_${kb.entityId}`,
          breed: 'Unknown',
          level: 0,
          health: 0,
          color: {
            primary: colors.primary,
            secondary: colors.secondary,
            rarity: rarity.label,
            rarityTier: rarity.tier
          },
          pattern: this.parsedData.patterns[idx % this.parsedData.patterns.length] || 'default',
          player: kb.playerName,
          timestamp: kb.timestamp
        };
      });

      this.showStatus(`✓ Parsed ${this.kubrows.length} kubrows successfully`, false);
      this.displayResults();
      document.getElementById('exportBtn').disabled = false;
    } catch (err) {
      this.showStatus(`✗ Error: ${err.message}`, false);
      console.error(err);
    } finally {
      parseBtn.disabled = false;
    }
  }

  displayResults() {
    const resultsSection = document.getElementById('resultsSection');
    resultsSection.style.display = 'block';

    // Update stats
    document.getElementById('statTotal').textContent = this.kubrows.length;
    document.getElementById('statColors').textContent = this.parsedData.summary.uniqueColors;
    document.getElementById('statPatterns').textContent = this.parsedData.summary.uniquePatterns;

    this.renderKubrowsGrid();
  }

  renderKubrowsGrid() {
    const grid = document.getElementById('kubrowsGrid');
    grid.innerHTML = '';

    const filteredKubrows = this.getFilteredKubrows();

    if (filteredKubrows.length === 0) {
      grid.innerHTML = '<div class="no-results">No kubrows found matching filters</div>';
      return;
    }

    for (const kubrow of filteredKubrows) {
      const card = this.createKubrowCard(kubrow);
      grid.appendChild(card);
    }
  }

  createKubrowCard(kubrow) {
    const card = document.createElement('div');
    card.className = 'kubrow-card';

    const rarityClass = `rarity-${kubrow.color.rarityTier}`;
    const rarityLabel = {
      0: '?',
      1: 'Common',
      2: 'Uncommon',
      3: 'Rare'
    }[kubrow.color.rarityTier] || 'Unknown';

    card.innerHTML = `
      <div class="kubrow-card-header ${rarityClass}">
        <div class="kubrow-color-preview">
          <div class="color-swatch" style="background-color: ${kubrow.color.primary}; border-right: 2px solid ${kubrow.color.secondary};">
            <span class="rarity-badge">${rarityLabel}</span>
          </div>
        </div>
      </div>
      <div class="kubrow-card-body">
        <h4 class="kubrow-name">${kubrow.name}</h4>
        <div class="kubrow-info">
          <span class="info-row">
            <strong>Breed:</strong> ${kubrow.breed}
          </span>
          <span class="info-row">
            <strong>Level:</strong> ${kubrow.level}
          </span>
          <span class="info-row">
            <strong>Health:</strong> ${kubrow.health}
          </span>
          <span class="info-row">
            <strong>Pattern:</strong> ${kubrow.pattern}
          </span>
          <span class="info-row">
            <strong>Player:</strong> ${kubrow.player}
          </span>
        </div>
        <div class="kubrow-colors">
          <div class="color-item">
            <span>Primary</span>
            <div class="color-box" style="background-color: ${kubrow.color.primary};"></div>
            <span>${kubrow.color.primary}</span>
          </div>
          <div class="color-item">
            <span>Secondary</span>
            <div class="color-box" style="background-color: ${kubrow.color.secondary};"></div>
            <span>${kubrow.color.secondary}</span>
          </div>
        </div>
      </div>
      <div class="kubrow-card-footer">
        <button class="btn-small btn-edit">Edit</button>
        <button class="btn-small btn-delete">Delete</button>
      </div>
    `;

    return card;
  }

  getFilteredKubrows() {
    const searchTerm = document.getElementById('kubrowSearch')?.value.toLowerCase() || '';
    const rarityFilter = document.getElementById('rarityFilter')?.value || '';

    return this.kubrows.filter(kb => {
      const matchesSearch = !searchTerm ||
        kb.name.toLowerCase().includes(searchTerm) ||
        kb.breed.toLowerCase().includes(searchTerm) ||
        kb.player.toLowerCase().includes(searchTerm);

      const matchesRarity = !rarityFilter || kb.color.rarity === rarityFilter;

      return matchesSearch && matchesRarity;
    });
  }

  filterKubrows() {
    this.renderKubrowsGrid();
  }

  exportJSON() {
    const exportData = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      source: 'ee.log',
      kubrows: this.kubrows,
      summary: {
        total: this.kubrows.length,
        colors: this.parsedData.summary.uniqueColors,
        patterns: this.parsedData.summary.uniquePatterns
      }
    };

    const dataStr = JSON.stringify(exportData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `kubrows-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);

    this.showStatus('✓ Exported JSON');
  }


  showStatus(message, showProgress = false) {
    const statusEl = document.getElementById('uploadStatus');
    const statusText = document.getElementById('statusText');
    const progressBar = document.getElementById('progressBar');

    statusEl.style.display = 'block';
    statusText.textContent = message;
    progressBar.style.display = showProgress ? 'block' : 'none';
  }

  updateProgress(percent) {
    const progressFill = document.getElementById('progressFill');
    progressFill.style.width = `${percent}%`;
  }
}

export default EELogParserUI;
