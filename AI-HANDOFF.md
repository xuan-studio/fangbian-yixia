# 「方便一下」AI 接手与部署教程

这份文件用于把项目交给下一位 AI。请先完整阅读，再执行任何修改、提交或部署操作。

## 1. 项目位置

推荐下一位 AI 直接使用非隐藏目录：

```text
/Users/xuan/Documents/fangbian-yixia
```

Codex 当前工作区镜像位于：

```text
/Users/xuan/.codex/.chatgpt-projects/g-p-6a7ff74d1f8481918d933077e64d0e69/fangbian-yixia
```

两个目录已经同步。为了避免双向修改造成版本分叉，新的 AI 应只选择 `/Users/xuan/Documents/fangbian-yixia` 继续工作。

## 2. 项目是什么

「方便一下」是上海厕所 3D 情报地图，包含：

- 941 个 OpenStreetMap 上海公共厕所点。
- 12 个小红书榜单或专题场所点。
- MapLibre + deck.gl 亮色 3D 地图。
- 行政区、开放状态、蹲坐、无障碍、第三卫生间和来源筛选。
- “憋不住了”四级降级找厕。
- 平台证据、Mock 评论和用户评论的来源分层。
- 楼内位置投稿与 3 人共识验证。
- 厕所共建中心：六维评分、事实更新、临时状态、新厕所投稿、验证和版本记录。
- 娱乐型排泄观察与红旗健康提示。
- 商场体验 SaaS、标注推广、城市服务和匿名研究等商业路径。

完整产品说明见：

```text
docs/project-introduction.md
```

## 3. 接手前的强制检查

在项目目录中执行：

```bash
cd /Users/xuan/Documents/fangbian-yixia
git status --short
git log -3 --oneline
node --version
npm --version
```

要求：

- Node.js 推荐 `22.13+ LTS` 或 Node.js 24；不要临赛前切换到非 LTS 的 Node 23，虽然当前构建通过，但部分开发工具会显示兼容警告。
- 当前基线提交应至少包含 `0fa0693 Build P0 community contribution loop`。
- 不要运行 `git reset --hard`、`git clean` 或删除式同步。
- 保留所有未提交文件，尤其是 `docs/project-introduction.md`、`docs/qa/` 和 `slides/`。
- 不要把未知字段补成虚构信息；缺失事实继续使用 `null` 和“待核实”。

## 4. 最快本地运行

依赖目录已经随项目复制；如果依赖不可用，再执行安装。

```bash
cd /Users/xuan/Documents/fangbian-yixia
npm install
npm run dev
```

浏览器打开：

```text
http://localhost:3000/
```

如果 3000 端口已经有页面，先确认它是不是本项目，不要直接结束未知进程。

### 本地运行必须看到

- 顶部显示 941 个公开厕所点。
- 左侧显示 12 个优质榜单场所。
- 界面默认深色，地图本身保持亮色。
- 地图能看到青色公开点、珊瑚色 24 小时点和金色榜单点。
- 顶部存在“我要共建”和“验证中心”。
- 地图加载失败时仍能切换到离线上海概念图。

## 5. 质量验收

部署前依次执行：

```bash
npm run lint
npm test
```

当前已知基线：

- `npm run lint`：通过。
- `npm test`：6/6 通过（3 项契约测试 + 3 项真实浏览器 E2E）。
- `npm test` 内部会先执行完整生产构建，并覆盖移动端和断网刷新。
- 构建可能提示 JavaScript chunk 大于 500 kB；这是优化提醒，不是当前演示阻塞项。

还需要人工检查以下流程：

1. 点击一个公开厕所，确认详情和来源可信度正常。
2. 点击一个金色榜单点，确认平台证据、Mock 和现场评论分层。
3. 打开“我要共建”，提交一次六维评分。
4. 提交一条楼层或设施事实，确认它进入验证中心而不是直接改写正式数据。
5. 打开“验证中心”，检查确认、反对和演示票状态。
6. 点击“憋不住了”，确认 L1–L4 四级方案都出现。
7. 输入一次普通健康记录和一次“便血”红旗记录，确认安全提示不同。
8. 断网或阻止在线瓦片后，确认离线地图、筛选、详情和紧急推荐仍可用。

## 6. 黑客松推荐部署方式

比赛默认使用本地部署，不依赖公网发布：

```bash
cd /Users/xuan/Documents/fangbian-yixia
npm run dev
```

提前保持依赖安装完成，现场只启动服务并打开 `http://localhost:3000/`。这是风险最低的 1 小时黑客松方案。

如需更接近生产环境的本地预览：

```bash
npm run build
npm run start
```

## 7. 公网部署边界

用户此前明确要求不要发布到 ChatGPT Sites。除非用户重新明确指定平台、账号和公开范围，否则下一位 AI 不得自行公网发布。

当前工程已经包含：

- `@cloudflare/vite-plugin`
- `worker/index.ts`
- `vite.config.ts` 中的 Cloudflare Worker 本地配置
- Vinext 的生产构建流程

因此若用户明确要求公网部署，优先评估 Cloudflare Workers，而不是改造成另一套框架。但当前仓库没有冻结的 `wrangler.jsonc` 和 `deploy` 脚本，不能直接假设生产账号、Worker 名称、域名或资源绑定。

下一位 AI 在获得公网部署授权后，应按这个顺序处理：

1. 确认 Cloudflare 账号、Worker 名称、公开域名和环境。
2. 查看当前版本 Cloudflare Vite 插件与 Vinext 的官方部署说明。
3. 新建最小 `wrangler.jsonc`，不要写入 token 或其他秘密。
4. 根据 `worker/index.ts` 检查 `ASSETS` 和图片能力；当前 `.openai/hosting.json` 的 D1、R2 均为 `null`，项目数据来自本地 JSON。
5. 先执行 `npm run lint`、`npm test` 和部署 dry-run。
6. 只有用户确认后才执行实际发布。
7. 发布后验证首页、在线地图、离线降级、共建中心和移动端布局。
8. 把部署 URL、提交号、环境和回滚方法写回本文档或 README。

## 8. 关键文件导航

| 文件 | 作用 |
| --- | --- |
| `app/Dashboard.tsx` | 主界面、地图交互、紧急推荐、评论、健康和共建中心 |
| `app/globals.css` | 深色界面、亮色地图、响应式和弹窗样式 |
| `app/types.ts` | 厕所、评论、共识、评分和审计的数据类型 |
| `public/data/public-toilets.json` | 941 个公开厕所点 |
| `public/data/premium-toilets.json` | 12 个榜单场所点 |
| `public/data/premium-comment-seeds.json` | 平台证据与明确标注的 Mock 评论 |
| `public/data/building-location-candidates.json` | 楼内位置共识候选 |
| `public/data/toilet-record.schema.json` | 统一厕所记录 Schema |
| `docs/project-introduction.md` | 产品、商业模式和当前状态的完整介绍 |
| `docs/60-minute-replay.md` | 办公小浣熊 60 分钟复演脚本 |
| `docs/office-raccoon-prompts.md` | 比赛现场编号提示词 |
| `docs/qa/qa-report.md` | 已完成的真实流程与视觉验收记录 |
| `slides/` | 路演材料；当前可能尚未纳入 Git，禁止清理 |

## 9. 数据与安全规则

- OpenStreetMap 数据需要保留 ODbL 和贡献者署名。
- 小红书信息只能使用用户提供、页面可见或已保存的内容；不要虚构原帖、评论、评分或楼层。
- Mock 内容必须继续明确标注，不得参与正式评分、设施确认或可信度计算。
- 新投稿必须先进入候选池，不能直接进入紧急推荐。
- 紧急推荐不得因商业推广改变距离和可用性排序。
- 健康模块只做娱乐观察和红旗分流，不做医疗诊断。
- 不提交账号 token、Cookie、`.env`、个人定位或健康隐私数据。

## 10. 给下一位 AI 的最短任务指令

可以直接把下面这段发给下一位 AI：

> 打开 `/Users/xuan/Documents/fangbian-yixia/AI-HANDOFF.md` 并完整阅读。先检查 Git 状态，保留所有未提交文件，不要 reset 或 clean。运行 `npm run lint` 和 `npm test`，再按教程启动本地项目。默认只做本地部署，不发布 ChatGPT Sites；任何公网发布必须先确认平台、账号、域名和用户授权。完成后报告运行 URL、测试结果、当前提交号和未提交文件，不要擅自改写数据来源或医疗安全规则。
