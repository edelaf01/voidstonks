export function initCanvas() {
  const canvas = document.getElementById("void-traces-canvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d", { alpha: true });
  const TARGET_FPS = 15;
  const SPEED_MULTI = 2;
  const PARTICLE_COUNT = 8;
  const CELL_SIZE = 12;
  const MIN_SEGMENT = 10;
  const TURN_PROBABILITY = 0.02;
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
    { dx: 0, dy: -1 },
    { dx: 1, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: 1, dy: 1 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: -1, dy: -1 },
  ];

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
      this.myMaxLength = BASE_MAX_LENGTH * (0.4 + Math.random());
      this.state = "waiting_to_spawn";
      this.waitTimer = isInitial
        ? Math.floor(Math.random() * 300)
        : Math.floor(Math.random() * 60);
    }
    trySpawn() {
      let found = false,
        attempts = 0;
      while (!found && attempts < 50) {
        const side = Math.floor(Math.random() * 4);
        let tx, ty, tdir;
        if (side === 0) {
          tx = 1;
          ty = Math.floor(Math.random() * (rows - 2)) + 1;
          tdir = 2;
        } else if (side === 1) {
          tx = cols - 2;
          ty = Math.floor(Math.random() * (rows - 2)) + 1;
          tdir = 6;
        } else if (side === 2) {
          tx = Math.floor(Math.random() * (cols - 2)) + 1;
          ty = 1;
          tdir = 4;
        } else {
          tx = Math.floor(Math.random() * (cols - 2)) + 1;
          ty = rows - 2;
          tdir = 0;
        }
        if (!this.isOccupied(tx, ty)) {
          this.gx = tx;
          this.gy = ty;
          this.dirIdx = tdir;
          found = true;
        }
        attempts++;
      }
      if (found) {
        this.pushPath(this.gx, this.gy);
        this.state = "drawing";
      } else {
        this.waitTimer = 10;
        this.state = "waiting_to_spawn";
      }
    }
    isOccupied(x, y) {
      if (x < 0 || x >= cols || y < 0 || y >= rows) return true;
      return grid[x][y] !== null;
    }
    pushPath(x, y) {
      this.gx = x;
      this.gy = y;
      this.path.push({ x, y });
      grid[x][y] = { id: this };
    }
    clearGrid() {
      for (let p of this.path)
        if (
          p.x >= 0 &&
          p.x < cols &&
          p.y >= 0 &&
          p.y < rows &&
          grid[p.x][p.y] &&
          grid[p.x][p.y].id === this
        )
          grid[p.x][p.y] = null;
    }
    updateMove() {
      const currentDir = directions[this.dirIdx];
      const nextX = this.gx + currentDir.dx;
      const nextY = this.gy + currentDir.dy;
      if (
        !this.isOccupied(nextX, nextY) &&
        (this.stepsStraight < MIN_SEGMENT || Math.random() > TURN_PROBABILITY)
      ) {
        this.pushPath(nextX, nextY);
        this.stepsStraight++;
        return true;
      }
      const turnOffsets = [1, -1, 2, -2];
      if (Math.random() < 0.5) turnOffsets.reverse();
      for (let offset of turnOffsets) {
        const newDirIdx = (this.dirIdx + offset + 8) % 8;
        const d = directions[newDirIdx];
        const tx = this.gx + d.dx;
        const ty = this.gy + d.dy;
        if (!this.isOccupied(tx, ty)) {
          this.dirIdx = newDirIdx;
          this.pushPath(tx, ty);
          this.stepsStraight = 0;
          this.turns.push(this.path.length - 1);
          return true;
        }
      }
      return false;
    }
    update() {
      if (this.state === "waiting_to_spawn") {
        this.waitTimer--;
        if (this.waitTimer <= 0) this.trySpawn();
        return;
      }
      if (this.state === "drawing") {
        if (this.alpha < 1) this.alpha += 0.1;
        const moved = this.updateMove();
        if (!moved || this.path.length > this.myMaxLength)
          this.state = "retracting";
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
        } else this.reset(false);
      }
    }
    draw() {
      if (this.path.length < 2) return;
      const sx = (x) => x * CELL_SIZE + CELL_SIZE / 2;
      const sy = (y) => y * CELL_SIZE + CELL_SIZE / 2;
      ctx.lineWidth = 2;
      ctx.lineCap = "square";
      ctx.lineJoin = "round";
      const opacity = this.state === "retracting" ? 0.5 : 1.0;
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
          ctx.arc(sx(pt.x), sy(pt.y), 2, 0, Math.PI * 2);
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
        ctx.arc(sx(tail.x), sy(tail.y), 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function initSystem() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
    cols = Math.ceil(width / CELL_SIZE);
    rows = Math.ceil(height / CELL_SIZE);
    grid = new Array(cols).fill(null).map(() => new Array(rows).fill(null));
    particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(new Particle());
  }

  window.addEventListener("resize", initSystem);
  initSystem();
  function animate() {
    requestAnimationFrame(animate);
    const now = Date.now();
    const elapsed = now - then;
    if (elapsed > frameDelay) {
      then = now - (elapsed % frameDelay);
      ctx.clearRect(0, 0, width, height);
      for (let i = 0; i < SPEED_MULTI; i++)
        particles.forEach((p) => p.update());
      particles.forEach((p) => p.draw());
    }
  }
  animate();
}
