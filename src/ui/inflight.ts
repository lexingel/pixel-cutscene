// Paid generations in flight, keyed by their action ("Generate dragon breathe"). A second run of the same action is
// refused even after the panel that started it re-rendered, so nothing is paid for twice. While anything runs, a
// status pill shows what and for how long (1-3 min is normal for PixelLab).
const live = new Map<string, number>(); // action -> start time (ms)
let pill: HTMLElement | null = null;
let timer: ReturnType<typeof setInterval> | undefined;

export const isRunning = (action: string) => live.has(action);
export const clock = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function show(): void {
  if (typeof document === "undefined") return;
  if (!live.size) {
    pill?.remove();
    pill = null;
    clearInterval(timer);
    timer = undefined;
    return;
  }
  if (!pill) {
    pill = Object.assign(document.createElement("div"), { className: "inflight" });
    pill.setAttribute("role", "status");
    document.body.append(pill);
  }
  pill.textContent = [...live].map(([a, t0]) => `${a}: working… ${clock(Date.now() - t0)}`).join(" · ");
  timer ??= setInterval(show, 1000);
}

/** Runs `run` unless `action` is already running (then false). True when it ran; its errors pass through. */
export async function track(action: string, run: () => Promise<void>): Promise<boolean> {
  if (live.has(action)) return false;
  live.set(action, Date.now());
  show();
  try {
    await run();
    return true;
  } finally {
    live.delete(action);
    show();
  }
}
