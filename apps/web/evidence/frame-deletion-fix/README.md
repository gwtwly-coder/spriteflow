# Frame-deletion fix evidence (confirm-delete was a silent no-op on the timeline)

Fix verification for the P0 regression: after confirming deletion the toast appeared and the
status-bar summary dropped, but the timeline chips and canvas rects kept the deleted frame —
`removeSelected` marked frames `included: false` (soft exclude) instead of removing them from
drafts, so everything reading `drafts` (chips, canvas, filters) never changed while the
summary read `included.length`.

Fix: `removeSelected` now filters the selected drafts out (same hard-delete pattern merge and
split already used; the interface contract explicitly allows either semantics, the product
owner ruled for removal). Undo/redo covers it via the existing temporal stack.

| artifact | what it shows |
|---|---|
| `delete-confirm-dialog.png` | the confirmation step of the owner's path (chip 1 → 删除帧) |
| `after-delete-5-chips.png` | after confirming: 5 chips, canvas shows 5 rects, status bar 5 帧 / 全部帧 5, toast 已删除帧。, 删除帧 disabled again |
| `report.json` | chips 6→5, summary 6 帧→5 帧, deleteDisabled=true after, undo restores 6, redo deletes to 5 — all PASS |

Component tests: `tests/frame-deletion.test.tsx` walks the full chain (chip click → 删除帧 →
dialog → 删除 → toast) and asserts the chips count drops by one, the summary agrees, the
deleted id is gone from `drafts` (truly removed, not `included: false`), and undo/redo restore
and re-delete. The old suite stopped at the disabled-button assertion, which is how this regressed.

Reproduce: rebuild `apps/web` (dist), `vite preview --port 4175`, then
`BASE_URL=http://localhost:4175/ node apps/web/evidence/frame-deletion-fix-verify.mjs`.
