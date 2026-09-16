# M1 集成验收执行清单

状态：待 Wave 3 管线、Web 与部署候选完成后执行。执行者不得用本文件的“待执行”状态冒充
验收通过；每轮复制为带日期的报告，填写浏览器、Node、OS、提交 SHA 与 preview URL。

## 自动门禁

- [ ] `pnpm lint` 零错误。
- [ ] `pnpm typecheck` 零错误。
- [ ] `pnpm test:unit` 全绿。
- [ ] `pnpm golden` 20/20，全量报告归档。
- [ ] `pnpm build` 零错误零警告。
- [ ] Playwright 冒烟矩阵全部通过，下载 ZIP 均完成内存解包校验。

## PRD P0 实测

- [ ] F-01：处理期间无素材/像素/帧/导出数据网络上传；静态资源加载后可离线复测。
- [ ] F-02：PNG/WebP 上传、99% alpha 边界、非 M1 格式与损坏输入行为正确。
- [ ] F-03：网格、条带及网格多组件样例符合 ground truth。
- [ ] F-04：散排、断件与噪点样例符合 ground truth。
- [ ] F-05：三类降级显式展示，手动网格可继续完成编辑与导出。
- [ ] F-06～F-08：视口、8K 浏览、增删改合拆排、undo/redo 实测。
- [ ] F-09：trim、统一画布、空帧、padding/extrude 与图集坐标逐像素抽检。
- [ ] F-10：Phaser Hash/Array ZIP 结构、引用、边界与稳定帧名正确。
- [ ] F-11：Godot ZIP 结构正确，并在 Godot 4.4.x 执行脚本生成 SpriteFrames。
- [ ] F-12：尺寸超限、预估内存不足、运行时内存失败均可恢复。
- [ ] F-13/F-18：黄金集数量、IoU、flags、降级、角标筛选与确认行为一致。

## 性能与发布

- [ ] 参考设备记录 4K CCL warmup 5 次、测量 30 次，p95 <500ms。
- [ ] 代表样例连续 10 次记录上传至可导出结果 P50 ≤10s，处理时 UI 心跳正常。
- [ ] 生产构建首屏 JS gzip <300 KiB，Worker 延迟包单列。
- [ ] 1 张 Kenney + 5 张已授权透明 AI 图完成端到端 6/6。
- [ ] Cloudflare Pages preview 上复测上传、检测、审校、三种导出与离线行为。
- [ ] 第三方依赖与真实素材许可证终审，无来源不明文件。

## 结果记录模板

每项记录：`PASS/FAIL | 证据路径或 trace | 实测步骤 | 实际值 | 备注`。发现产品/管线问题时
在 `tests/golden/bugs/SF-BUG-xxx.md` 建档；QA 不直接修改管线代码。全部 P0、20/20 黄金、
E2E、性能、preview 和许可终审完成前，结论只能是 FAIL 或 PENDING，不能给出 M1 PASS。
