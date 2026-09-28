# R5-01 follow-pause verification evidence

Fix verification for `docs/acceptance/integration-verdict-5.md` R5-01 (P1): during playback the
chip row stole the user's wheel scroll back within ≤106ms at the default 12 FPS.

**Result: PASS on all cases.** `pauseMillis` (user scroll → first app scroll-back, the verdict's
primary criterion, target 1900–2400ms):

| case | pauseMillis | note |
|---|---|---|
| wheel-12-dark-zh | 2010.8ms | the R5-01 defect scenario (default 12 FPS) |
| wheel-12-light-en | 2005.8ms | second theme/language combo |
| wheel-120-dark-zh | 2048.1ms | high-FPS stress (old window logic re-armed every 8ms) |
| wheel-2-dark-zh | 2015.4ms | 2 FPS regression (already passing pre-fix) |
| follow-12-dark-zh | — | no user scroll; follow survives a full 48-frame loop, chip offscreen ≤200ms |

Method mirrors `docs/acceptance/evidence/integration-r5/verify-scroll.mjs` (same fixture
`03-tiled-4x.png`, 48 frames, real `isTrusted` wheel via Playwright, rAF-sampled scrollLeft),
run headless Chrome 1024×768 against the local production build instead of the deployed site.
`report.json` holds per-sample scrollLeft/frame/inside and the full wheel/scroll event timeline.
`*-paused.png` (~+200ms after wheel) shows the row parked at the user position with the playhead
out of view; `*-resumed.png` (~+2.5s) shows follow restored.

Reproduce: `BASE_URL=http://localhost:4174/ node apps/web/evidence/r5-01-follow-verify.mjs`
(serve `apps/web/dist` via `vite preview` first).
