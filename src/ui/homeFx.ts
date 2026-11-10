// Home page backdrop: twinkling stars and embers drifting up, drawn at 1/3 size so every dot is a crisp pixel.
const PX = 3;
const EMBER = ["#fff1b8", "#ffd27a", "#efb456", "#e07a32", "#a33a1e", "#5a1e14"]; // hot to cool
const STAR = ["#3a3f52", "#6b7290", "#c9cfe6"];

type Ember = { x: number; y: number; vy: number; sway: number; ph: number; life: number; age: number };

/** Runs until the canvas leaves the page. With reduced motion it draws one still frame. */
export function startHomeFx(cv: HTMLCanvasElement, keepClear: HTMLElement): void {
  const g = cv.getContext("2d")!;
  let W = 0, H = 0;
  let clear = { l: 0, t: 0, r: 0, b: 0 }; // the text column, in backdrop pixels: nothing is drawn over it
  const inClear = (x: number, y: number) => x >= clear.l && x < clear.r && y >= clear.t && y < clear.b;
  let stars: { x: number; y: number; ph: number; sp: number }[] = [];
  const embers: Ember[] = [];
  const size = () => {
    W = Math.ceil(innerWidth / PX);
    H = Math.ceil(innerHeight / PX);
    cv.width = W;
    cv.height = H;
    stars = Array.from({ length: Math.round((W * H) / 900) }, () => ({ x: (Math.random() * W) | 0, y: (Math.random() * H * 0.8) | 0, ph: Math.random() * 6.3, sp: 0.4 + Math.random() * 1.2 }));
  };
  const spawn = (anyHeight = false): Ember => ({
    x: Math.random() * W,
    y: anyHeight ? H * (0.5 + Math.random() * 0.5) : H + 2,
    vy: 4 + Math.random() * 7,
    sway: 2 + Math.random() * 5,
    ph: Math.random() * 6.3,
    life: 5 + Math.random() * 6,
    age: anyHeight ? Math.random() * 4 : 0,
  });
  size();
  addEventListener("resize", size);
  for (let i = 0; i < 40; i++) embers.push(spawn(true));

  const draw = (s: number) => {
    g.clearRect(0, 0, W, H);
    const r = keepClear.getBoundingClientRect(); // read each frame: the list fills in and the page scrolls
    clear = { l: (r.left - 16) / PX, t: (r.top - 8) / PX, r: (r.right + 16) / PX, b: (r.bottom + 8) / PX };
    // a far-off fire's glow along the bottom: ordered dither thinning out upwards
    g.fillStyle = "#3a2016";
    for (let r = 0; r < 12; r++)
      for (let x = (r & 1) * 2; x < W; x += 2 + (r >> 1)) if (((x >> 1) + r) % 4 < 4 - (r >> 2)) g.fillRect(x, H - 1 - r, 1, 1);
    for (const st of stars) {
      const k = (Math.sin(st.ph + s * st.sp) + 1) / 2; // 0..1
      if (inClear(st.x, st.y)) continue;
      g.fillStyle = STAR[k > 0.92 ? 2 : k > 0.45 ? 1 : 0];
      g.fillRect(st.x, st.y, 1, 1);
    }
    for (const e of embers) {
      const f = e.age / e.life; // 0 hot .. 1 gone
      g.fillStyle = EMBER[Math.min(EMBER.length - 1, (f * EMBER.length) | 0)];
      const x = Math.round(e.x + Math.sin(e.ph + e.age * 1.7) * e.sway), y = Math.round(e.y);
      if (inClear(x, y)) continue;
      g.fillRect(x, y, 1, 1);
      if (f < 0.3) g.fillRect(x, y + 1, 1, 1); // young embers have a short tail
      if (f < 0.12) g.fillRect(x + 1, y, 1, 1);
    }
  };

  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return draw(0);
  let last = performance.now();
  const tick = (now: number) => {
    if (!cv.isConnected) return removeEventListener("resize", size);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    for (let i = embers.length; i--; ) {
      const e = embers[i];
      e.age += dt;
      e.y -= e.vy * dt;
      if (e.age >= e.life || e.y < -2) embers[i] = spawn();
    }
    draw(now / 1000);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
