# Chip-click selection evidence (ui-spec v1.3 :319 regression fix)

Fix verification for the post-acceptance regression: clicking a timeline chip only moved the
playhead and left the editor selection untouched, keeping 删除帧/合并帧 disabled.

Fixture: golden `02-grid-3x2` (6 frames), local production build, headless Chrome 1024×768.

| screenshot | action | observed |
|---|---|---|
| `plain-click-delete-enabled.png` | click chip 3 | 删除帧 enabled (disabled=false), 合并帧 still disabled (needs ≥2), status bar shows 已选 1 帧, chip 3 active + playhead |
| `shift-click-range.png` | click chip 3, then Shift+click chip 6 | range 3–6 selected, 合并帧 enabled, 已选 4 帧 |
| `ctrl-click-toggle.png` | then Ctrl+click chip 5 | chip 5 toggled out of the range, 已选 3 帧 |

Reproduce: `BASE_URL=http://localhost:4175/ node` with the probe inline in the commit message —
or simply run the component tests: `pnpm --filter @spriteflow/web test` (`tests/chip-selection.test.tsx`,
4 cases covering plain/shift/ctrl plus plain-after-range collapse).
