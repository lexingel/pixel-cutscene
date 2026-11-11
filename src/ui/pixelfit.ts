// Pixel art in a strip is shown at a whole-number scale of its own pixels (never a fraction), in the height its
// CSS gives it (72px strip, 96px preview, 160px motion preview). Art bigger than the box stays 1x and is cropped.
export const wholeScale = (natural: number, box: number): number => Math.max(1, Math.floor(box / Math.max(1, natural)));

/** Display width for a W-pixel scene in a box: whole-number upscale, or a whole-number reduction (W / n) when it is wider than the box. */
export const sceneWidth = (W: number, box: number): number => (W > box && box > 0 ? W / Math.ceil(W / box) : W * wholeScale(W, box));

document.addEventListener("load", (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains("frame") || !img.naturalWidth) return;
  const s = img.style, nw = img.naturalWidth, nh = img.naturalHeight;
  s.width = s.height = ""; // read the CSS box, not our previous answer
  const cand = img.closest<HTMLElement>(".cand"); // a candidate cell is a square
  const box = cand ? cand.clientWidth - 18 : img.clientHeight || 72;
  const k = wholeScale(cand ? Math.max(nw, nh) : nh, box);
  s.width = `${nw * k}px`; s.height = `${nh * k}px`;
  s.minWidth = "0"; s.maxWidth = "100%"; s.objectFit = "none"; s.objectPosition = "left top";
}, true);
