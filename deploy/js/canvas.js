export function initCanvas() {
  const canvas = document.getElementById("void-traces-canvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const TARGET_FPS = 15;
  const SPEED_MULTI = 2;
  const PARTICLE_COUNT = 15;
  const CELL_SIZE = 12;
  const MIN_SEGMENT = 15;
  const TURN_PROBABILITY = 0.05;
  const BASE_MAX_LENGTH = 180;
  const GOLD_COLOR = "212, 175, 55";

  let width,
    height,
    cols,
    rows,
    grid = [],
    particles = [];
  const frameDelay = 1000 / TARGET_FPS;
  let then = Date.now();
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
    draw() {
      if (this.path.length < 2) return;
      const sx = (x) => x * CELL_SIZE + CELL_SIZE / 2;
      const sy = (y) => y * CELL_SIZE + CELL_SIZE / 2;
      ctx.lineWidth = 2;
      ctx.lineCap = "square";
      ctx.lineJoin = "bevel";
      const opacity = this.state === "retracting" ? 0.3 : 0.8;
      ctx.strokeStyle = `rgba(${GOLD_COLOR}, ${opacity * this.alpha})`;
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.moveTo(sx(this.path[0].x), sy(this.path[0].y));
      for (let i = 1; i < this.path.length; i++)
        ctx.lineTo(sx(this.path[i].x), sy(this.path[i].y));
      ctx.stroke();

      ctx.fillStyle = `rgba(${GOLD_COLOR}, ${opacity * this.alpha})`;
      for (let tIndex of this.turns) {
        if (tIndex > 0 && tIndex < this.path.length) {
          const pt = this.path[tIndex];
          ctx.beginPath();
          ctx.arc(sx(pt.x), sy(pt.y), 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (this.state === "drawing") {
        const head = this.path[this.path.length - 1];
        const hx = sx(head.x);
        const hy = sy(head.y);
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.moveTo(hx, hy - 4);
        ctx.lineTo(hx + 4, hy);
        ctx.lineTo(hx, hy + 4);
        ctx.lineTo(hx - 4, hy);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = `rgba(${GOLD_COLOR}, 1)`;
        ctx.beginPath();
        ctx.arc(hx, hy, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      if (this.path.length > 0) {
        const tail = this.path[0];
        ctx.fillStyle = `rgba(${GOLD_COLOR}, ${opacity * this.alpha})`;
        ctx.beginPath();
        ctx.arc(sx(tail.x), sy(tail.y), 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function initSystem() {
    const dpr = window.devicePixelRatio || 1;
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

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

  function animate() {
    requestAnimationFrame(animate);
    const now = Date.now();
    const elapsed = now - then;
    if (elapsed > frameDelay) {
      then = now - (elapsed % frameDelay);

      if (Math.random() < 0.05) {
        spawnBus();
      }

      ctx.clearRect(0, 0, width, height);
      for (let i = 0; i < SPEED_MULTI; i++) {
        particles.forEach((p) => p.update());
      }
      particles.forEach((p) => p.draw());
    }
  }
  animate();
}
