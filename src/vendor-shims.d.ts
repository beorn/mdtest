// Type shims for transitive dependencies of @termless/core
// These modules have .d.ts files in the termless repo, but TypeScript
// doesn't resolve them when type-checking mdspec because they're outside
// mdspec's include paths. Re-declaring them here avoids TS7016 errors.

declare module "upng-js" {
  export function encode(
    imgs: ArrayBuffer[],
    w: number,
    h: number,
    cnum: number,
    dels?: number[],
    forbidPlte?: boolean,
  ): ArrayBuffer
  export function decode(buf: ArrayBuffer): unknown
  export function toRGBA8(out: unknown): ArrayBuffer[]
}

declare module "gifenc" {
  export function GIFEncoder(opts?: unknown): {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: unknown): void
    finish(): void
    bytes(): Uint8Array
    bytesView(): Uint8Array
    reset(): void
  }
  export function quantize(rgba: Uint8Array, maxColors: number, options?: unknown): number[][]
  export function applyPalette(rgba: Uint8Array, palette: number[][], format?: string): Uint8Array
}
