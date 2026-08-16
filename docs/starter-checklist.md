# Starter 交付检查单

比赛前把本目录作为唯一 Starter，不要再准备多个分叉版本。

- [x] `npm install` 已完成，依赖锁文件与当前环境一致。
- [x] `npm test` 通过：3 项单元/契约测试 + 3 项真实浏览器 E2E。
- [x] `public/data/public-toilets.json` 包含 941 条记录，坐标位于上海范围。
- [x] `public/data/premium-toilets.json` 包含 12 个待核实榜单场所点，且没有虚构评分。
- [x] `public/data/premium-import-template.json` 不含样例厕所。
- [x] `app/types.ts` 与 JSON Schema 均已冻结；后续只按现有接口补数据。
- [x] 首页首次访问后，断网刷新仍能恢复 953 条本地数据并进入离线概念地图。
- [x] 办公小浣熊提示词 00–07 可随时复制。
- [ ] 3 分钟口播已计时两次。
- [x] 现场只保留一个启动命令 `npm run dev`、一个演示地址 `http://localhost:3000/` 和一个备份压缩包 `方便一下-Starter-2026-08-16.zip`。

不要预先伪造小红书榜单。真实数据到达后，只替换 `records`，不改地图和交互逻辑。

## 2026-08-16 自动验收记录

- `npm run lint`：通过。
- `npm test`：6/6 通过；包含生产构建。
- 真实浏览器流程覆盖：黄金演示路径、移动端六入口、断网缓存恢复。
- 运行依赖安全审计：0 个已知漏洞。
- 开发工具链审计：17 个告警（2 low / 15 high），来自 Vite、Cloudflare、vinext 等开发依赖；临赛前不自动升级，避免引入构建回归。
