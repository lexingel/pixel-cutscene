// gifenc ships no types; just what exporter.ts uses.
declare module "gifenc" {
  type Palette = number[][];
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number): Palette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette): Uint8Array;
  export function GIFEncoder(): {
    writeFrame(index: Uint8Array, w: number, h: number, opts: { palette: Palette; delay?: number; repeat?: number }): void;
    finish(): void;
    bytes(): Uint8Array;
  };
}
