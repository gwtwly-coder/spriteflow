# Ghost-overlap fix evidence (transparent-area backing on the editor canvas)

Fix verification for the post-acceptance regression: the editor canvas used the uploaded
preview bitmap itself as a `createPattern` fill. The preview bitmap is smaller than the
working coordinate system (≤1024px vs. e.g. 1536×1024), so the pattern tiled raw-size
copies while `drawImage` stretched one copy to full size — tiled duplicates leaked through
the source's transparent areas as "ghost elements that are not in the original" (seam at
x=1024 on the 1536×1024 mermaid sheet).

Fix: the backing fill now tiles a one-shot 16×16 two-tone checkerboard canvas (colors mirror
the `--checker-a/b` tokens), drawn only under the image rectangle; `drawImage` unchanged.

| artifact | what it shows |
|---|---|
| `synthetic-1536-canvas.png` | 1536×1024 generated input (red block on the left 256px, rest fully transparent): transparent right half shows a uniform checkerboard, no tiled copy at the x=1024 seam |
| `mermaid-1536-canvas.png` | the product owner's 1536×1024 mermaid sheet: clean canvas, no ghost overlap |
| `report.json` | pixel assertion: red-pixel span across the canvas = 0.143 of canvas width (single band). A tiled copy would place red at x≈66% of the image, pushing the span past 0.7 — the assertion threshold is 0.35 |
| `synthetic-1536-transparent.png` | the generated fixture |

Pixel assertion method: scan the full canvas `ImageData` for red-dominant pixels
(R>180, G<90, B<90) and measure the span of their x coordinates relative to canvas width.

Component test: `tests/canvas-editor-checker.test.tsx` locks the paint contract —
`createPattern` receives the 16×16 checker tile (never the source bitmap) and the backing
`fillRect` covers exactly the same working rect as `drawImage`.

Reproduce: rebuild `apps/web` (dist), `vite preview --port 4175`, then
`BASE_URL=http://localhost:4175/ node apps/web/evidence/ghost-overlap-fix-verify.mjs`.
