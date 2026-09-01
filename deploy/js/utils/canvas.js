export function initCanvas() {
  const canvas = document.getElementById("void-traces-canvas");
  if (!canvas) return;

  // Sin imageSmoothing: solo afecta a drawImage y aquí solo se pintan líneas y arcos.
  // `desynchronized` deja al navegador saltarse la sincronía con el resto de la página, que es
  // exactamente lo que quieres de un fondo decorativo: nunca debe hacer esperar a la UI.
  const ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
  const TARGET_FPS = 15;
  const SPEED_MULTI = 2;
  const PARTICLE_COUNT = 15;
  const CELL_SIZE = 12;
  const MIN_SEGMENT = 15;
  const TURN_PROBABILITY = 0.05;
  const BASE_MAX_LENGTH = 180;
  const HALO_WIDTH = 5;
  const CORE_WIDTH = 1.6;
  const VIA_R = 2.6;

  const resolveThemeColorRGB = () => {
    const colorStr = getComputedStyle(document.body).getPropertyValue("--active-theme-color").trim();
    if (!colorStr) return "212, 175, 55";

    if (colorStr.startsWith("#")) {
      const hex = colorStr.slice(1);
      if (hex.length === 6) {
        const r = parseInt(hex.slice(0, 2), 16);
        const g = parseInt(hex.slice(2, 4), 16);
        const b = parseInt(hex.slice(4, 6), 16);
        return `${r}, ${g}, ${b}`;
      }
    }
    
    if (colorStr.startsWith("var(")) {
      const varName = colorStr.match(/var\(([^)]+)\)/)?.[1]?.trim();
      if (varName) {
        const resolved = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
        if (resolved.startsWith("#")) {
          const hex = resolved.slice(1);
          const r = parseInt(hex.slice(0, 2), 16);
          const g = parseInt(hex.slice(2, 4), 16);
          const b = parseInt(hex.slice(4, 6), 16);
          return `${r}, ${g}, ${b}`;
        }
      }
    }

    return "212, 175, 55"; // Fallback to Orokin Gold
  };

  // getComputedStyle fuerza un recálculo de estilo del documento ENTERO, y el color solo
  // cambia cuando cambia la clase de tema del <body>. Sin esta caché era un recálculo por
  // frame (15/s) provocado por un adorno del fondo.
  let colorCache = null;
  let colorCacheKey = null;
  const getThemeColorRGB = () => {
    const key = document.body?.className ?? "";
    if (key !== colorCacheKey || !colorCache) {
      colorCacheKey = key;
      colorCache = resolveThemeColorRGB();
    }
    return colorCache;
  };

  let width,
    height,
    cols,
    rows,
    grid = [],
    particles = [];
  const frameDelay = 1000 / TARGET_FPS;
  const directions = [
    { dx: 0, dy: -1 }, // 0: N
    { dx: 1, dy: -1 }, // 1: NE
    { dx: 1, dy: 0 },  // 2: E
    { dx: 1, dy: 1 },  // 3: SE
    { dx: 0, dy: 1 },  // 4: S
    { dx: -1, dy: 1 }, // 5: SW
    { dx: -1, dy: 0 }, // 6: W
    { dx: -1, dy: -1 },// 7: NW
  ];

  function isGridOccupied(x, y) {
    if (x < 0 || x >= cols || y < 0 || y >= rows) return true;
    return grid[x][y] !== null;
  }

  function isPathClear(x, y, dx, dy) {
    const tx = x + dx;
    const ty = y + dy;
    if (isGridOccupied(tx, ty)) return false;

    // Strict diagonal clearance: prevents "X" crossings and squeezing
    if (dx !== 0 && dy !== 0) {
      if (isGridOccupied(x + dx, y) || isGridOccupied(x, y + dy)) {
        return false;
      }
    }
    return true;
  }

  function spawnBus() {
    const waiting = particles.filter((p) => p.state === "waiting_to_spawn");
    if (waiting.length < 2) return;

    const side = Math.floor(Math.random() * 4);
    let basex, basey, tdir;
    // Buffer from edges to leave room for the bus width
    if (side === 0) {
      basex = 1;
      basey = Math.floor(Math.random() * (rows - 10)) + 5;
      tdir = 2; // Move East
    } else if (side === 1) {
      basex = cols - 2;
      basey = Math.floor(Math.random() * (rows - 10)) + 5;
      tdir = 6; // Move West
    } else if (side === 2) {
      basex = Math.floor(Math.random() * (cols - 10)) + 5;
      basey = 1;
      tdir = 4; // Move South
    } else {
      basex = Math.floor(Math.random() * (cols - 10)) + 5;
      basey = rows - 2;
      tdir = 0; // Move North
    }

    const busSize = Math.floor(Math.random() * 3) + 2; // 2 to 4 traces per bus
    for (let i = 0; i < busSize; i++) {
      if (waiting.length === 0) break;
      const p = waiting.pop();

      // Setup adjacent parallel spawning points
      let ox = basex;
      let oy = basey;
      if (tdir === 2 || tdir === 6) oy += i * 2; // Offset Y for E/W
      else ox += i * 2; // Offset X for N/S

      if (isGridOccupied(ox, oy)) {
        // If spot occupied, throw it back to pool
        p.state = "waiting_to_spawn";
      } else {
        p.gx = ox;
        p.gy = oy;
        p.dirIdx = tdir;
        p.baseDir = tdir; // Lock base direction to prevent U-turns
        p.pushPath(ox, oy);
        p.state = "drawing";
      }
    }
  }

  class Particle {
    constructor() {
      // Fase propia: sin ella todas las cabezas laten a la vez y el fondo parpadea entero.
      this.fase = Math.random() * Math.PI * 2;
      this.reset(true);
    }
    reset(isInitial = false) {
      if (this.path && this.path.length > 0) this.clearGrid();
      this.path = [];
      this.stepsStraight = 0;
      this.alpha = 0;
      this.turns = [];
      this.myMaxLength = BASE_MAX_LENGTH * (0.6 + Math.random());
      this.state = "waiting_to_spawn";
      this.baseDir = 0;
    }
    pushPath(x, y) {
      this.gx = x;
      this.gy = y;
      this.path.push({ x, y });
      grid[x][y] = { id: this };
    }
    clearGrid() {
      for (let p of this.path) {
        if (
          p.x >= 0 &&
          p.x < cols &&
          p.y >= 0 &&
          p.y < rows &&
          grid[p.x][p.y] &&
          grid[p.x][p.y].id === this
        ) {
          grid[p.x][p.y] = null;
        }
      }
    }
    updateMove() {
      const currentDir = directions[this.dirIdx];
      const nextX = this.gx + currentDir.dx;
      const nextY = this.gy + currentDir.dy;

      const canGoStraight = isPathClear(this.gx, this.gy, currentDir.dx, currentDir.dy);

      if (
        canGoStraight &&
        (this.stepsStraight < MIN_SEGMENT || Math.random() > TURN_PROBABILITY)
      ) {
        this.pushPath(nextX, nextY);
        this.stepsStraight++;
        return true;
      }

      if (!canGoStraight && this.stepsStraight < MIN_SEGMENT) {
        return false;
      }

      const turnOffsets = [1, -1];
      if (Math.random() < 0.5) turnOffsets.reverse();

      for (let offset of turnOffsets) {
        const newDirIdx = (this.dirIdx + offset + 8) % 8;

        let diff = Math.abs(newDirIdx - this.baseDir);
        if (diff > 4) diff = 8 - diff;
        if (diff > 2) continue;

        const d = directions[newDirIdx];
        if (isPathClear(this.gx, this.gy, d.dx, d.dy)) {
          this.dirIdx = newDirIdx;
          this.pushPath(this.gx + d.dx, this.gy + d.dy);
          this.stepsStraight = 0;
          this.turns.push(this.path.length - 1);
          return true;
        }
      }
      return false;
    }
    update() {
      if (this.state === "waiting_to_spawn") return;

      if (this.state === "drawing") {
        if (this.alpha < 1) this.alpha += 0.05;
        const moved = this.updateMove();
        if (!moved || this.path.length > this.myMaxLength) {
          this.state = "retracting";
        }
      }
      if (this.state === "retracting") {
        if (this.path.length > 0) {
          const tail = this.path.shift();
          if (tail && grid[tail.x][tail.y] && grid[tail.x][tail.y].id === this)
            grid[tail.x][tail.y] = null;
          if (this.turns.length > 0 && this.turns[0] === 0) this.turns.shift();
          this.turns = this.turns.map((t) => t - 1);

          if (this.path.length > 0) {
            const tail2 = this.path.shift();
            if (
              tail2 &&
              grid[tail2.x][tail2.y] &&
              grid[tail2.x][tail2.y].id === this
            )
              grid[tail2.x][tail2.y] = null;
            if (this.turns.length > 0 && this.turns[0] === 0)
              this.turns.shift();
            this.turns = this.turns.map((t) => t - 1);
          }
        } else {
          this.reset(false);
        }
      }
    }
    draw(activeColor, tick) {
      if (this.path.length < 2) return;
      const sx = (x) => x * CELL_SIZE + CELL_SIZE / 2;
      const sy = (y) => y * CELL_SIZE + CELL_SIZE / 2;

      const n = this.path.length;
      const cola = this.path[0];
      const cabeza = this.path[n - 1];
      const base = (this.state === "retracting" ? 0.5 : 1) * this.alpha;
      if (base <= 0) return;

      // El desvanecido de la cola lo pone un degradado cola->cabeza, no un `stroke` por tramo:
      // el camino se recorre una vez y el reparto de brillo lo hace la GPU. Trocearlo en bandas
      // de alfa distinto costaba N veces más y dejaba costura en cada empalme.
      const trazo = ctx.createLinearGradient(sx(cola.x), sy(cola.y), sx(cabeza.x), sy(cabeza.y));
      trazo.addColorStop(0, `rgba(${activeColor}, 0)`);
      trazo.addColorStop(0.3, `rgba(${activeColor}, 0.45)`);
      trazo.addColorStop(1, `rgba(${activeColor}, 1)`);
      ctx.strokeStyle = trazo;

      ctx.beginPath();
      ctx.moveTo(sx(cola.x), sy(cola.y));
      for (let i = 1; i < n; i++) ctx.lineTo(sx(this.path[i].x), sy(this.path[i].y));

      // Neón barato: el MISMO camino se traza dos veces, ancho y tenue (halo) y fino y brillante
      // (núcleo). `shadowBlur` daría el mismo efecto pero es un desenfoque gaussiano de todo el
      // canvas por partícula, que es justo lo que no puede pagar un fondo decorativo.
      ctx.globalAlpha = 0.1 * base;
      ctx.lineWidth = HALO_WIDTH;
      ctx.stroke();
      ctx.globalAlpha = 0.85 * base;
      ctx.lineWidth = CORE_WIDTH;
      ctx.stroke();

      // Todas las vías en un solo camino y con el degradado como estilo: cada anillo coge solo
      // el brillo que le toca por su posición, en una llamada de dibujo en vez de una por vía.
      if (this.turns.length) {
        ctx.beginPath();
        for (const tIndex of this.turns) {
          if (tIndex <= 0 || tIndex >= n) continue;
          const pt = this.path[tIndex];
          // moveTo al borde del círculo: sin él, `arc` enlaza con una recta desde la vía anterior.
          ctx.moveTo(sx(pt.x) + VIA_R, sy(pt.y));
          ctx.arc(sx(pt.x), sy(pt.y), VIA_R, 0, Math.PI * 2);
        }
        ctx.globalAlpha = 0.9 * base;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      if (this.state === "drawing") {
        const hx = sx(cabeza.x);
        const hy = sy(cabeza.y);
        ctx.globalAlpha = (0.7 + 0.3 * Math.sin(tick * 0.35 + this.fase)) * this.alpha;
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.moveTo(hx, hy - 3.5);
        ctx.lineTo(hx + 3.5, hy);
        ctx.lineTo(hx, hy + 3.5);
        ctx.lineTo(hx - 3.5, hy);
        ctx.closePath();
        ctx.fill();
      }

      ctx.globalAlpha = 1;
    }
  }

  function initSystem() {
    // Acotado a 1,5: el backing store crece con el CUADRADO del dpr, así que en un 4K a dpr 2
    // son ~15 M de píxeles que hay que limpiar y repintar enteros cada frame. Para unas líneas
    // de 2px translúcidas de fondo, la diferencia entre 1,5 y 2 no se ve; la factura de GPU sí.
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Asignar canvas.width REINICIA todo el estado del contexto, así que el estilo persistente
    // se vuelve a poner aquí y no una sola vez al arrancar.
    // "lighter" suma en vez de tapar, y eso el CSS no lo puede dar: `mix-blend-mode` mezcla la
    // capa entera contra la página, nunca los trazos entre sí. Aquí es lo que hace que los
    // halos de dos trazos paralelos del mismo bus se enciendan al rozarse.
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    cols = Math.ceil(width / CELL_SIZE);
    rows = Math.ceil(height / CELL_SIZE);
    grid = new Array(cols).fill(null).map(() => new Array(rows).fill(null));
    particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(new Particle());
  }

  let resizeTimeout;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(initSystem, 200);
  });
  initSystem();

  let tick = 0;
  function frame() {
    if (Math.random() < 0.05) spawnBus();
    const activeColor = getThemeColorRGB();

    ctx.clearRect(0, 0, width, height);
    for (let i = 0; i < SPEED_MULTI; i++) particles.forEach((p) => p.update());
    particles.forEach((p) => p.draw(activeColor, tick));
    tick++;

    schedule();
  }

  // setTimeout marca el ritmo y rAF solo decide el instante de pintado. Antes el rAF corría a
  // la frecuencia del monitor y descartaba 9 de cada 10 frames por un contador: en un panel de
  // 144 Hz eran ~145 despertares por segundo para pintar 15, y con eso ni la CPU ni la GPU
  // llegan a entrar en reposo. Además, con la pestaña de fondo el navegador frena el
  // setTimeout y no dispara el rAF, así que se detiene solo sin vigilar nada.
  let pending;
  function schedule() {
    clearTimeout(pending);
    pending = setTimeout(() => requestAnimationFrame(frame), frameDelay);
  }

  // Quien pide menos movimiento se queda con el fondo quieto: se pinta un frame y se para.
  const quieto = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  if (quieto?.matches) {
    // Un fondo quieto, no un fondo vacío: spawnBus solo se llamaba desde frame(), así que sin
    // estos pasos las 15 partículas se quedaban en "waiting_to_spawn" y el canvas salía en
    // blanco para quien pide menos movimiento.
    for (let i = 0; i < 120; i++) {
      if (i % 8 === 0) spawnBus();
      particles.forEach((p) => p.update());
    }
    const activeColor = getThemeColorRGB();
    particles.forEach((p) => p.draw(activeColor, 0));
  } else {
    // El primer frame se pinta ya y él mismo encadena el siguiente: arrancar por el temporizador
    // dejaba el fondo en blanco los primeros 66 ms de cada carga.
    frame();
  }
}
