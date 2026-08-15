# 方便一下

上海公共厕所 3D 情报地图的黑客松黄金参考版。公开厕所地图、筛选、详情、四级紧急降级和娱乐型健康观察可完整运行；当前另有 12 个来自小红书榜单/专题线索并完成场所 POI 匹配的金色榜单点。

交付模式：仅本地运行，不发布到 ChatGPT Sites。

## 运行

```bash
npm install
npm run dev
```

验收：

```bash
npm run lint
npm test
```

## 已实现

- 941 个 OpenStreetMap 上海公共厕所点，本地 JSON 缓存，ODbL 署名。
- deck.gl 3D 数据柱、上海离线概念轮廓、在线底图失败自动降级。
- 区域、开放信息、蹲厕、坐厕、无障碍、第三卫生间与来源筛选。
- 厕所详情、来源可信度、会话点评与拥挤数据真实空状态。
- “憋不住了”四级降级找厕。
- 纯娱乐排泄观察，便血、黑便、持续腹痛等红旗信号直接提示就医。
- 商场体验 SaaS、明确标注推广位、自愿匿名研究合作三类商业路径。
- 小浣熊 JSON 导入器；合法数据导入后，优质榜单与金色 3D 柱自动出现。
- 评论区楼内定位：提交楼层、方位和行走说明，进入候选池；3 位独立用户确认后才能上线。
- P0 共建中心：六维厕所打分、自然语言事实补充、状态报告、新厕所入库、验证任务和版本历史。
- 体验评分、数据可信度、信息新鲜度分开显示，避免一条评论直接改变事实可信度。

## 数据约定

- 统一接口：`app/types.ts`。
- JSON Schema：`public/data/toilet-record.schema.json`。
- 公开数据：`public/data/public-toilets.json`。
- 优质榜单：`public/data/premium-toilets.json`，当前包含 12 个 `pending_verification` 场所点。
- 评论种子：`public/data/premium-comment-seeds.json`，为每个场所保存一条平台证据观点、一组证据标签和一条明确标注的 Mock 评论。
- 楼内位置候选：`public/data/building-location-candidates.json`，真实确认与演示确认分开计数；含演示票的结果只能标记“演示上线”。
- 匹配审计：`public/data/premium-matches.json`，保留场所点与最近公开厕所的距离，并明确不自动合并。
- 重新生成：`npm run build:premium`。
- 导入空模板：`public/data/premium-import-template.json`。
- 缺失事实必须使用 `null`；界面显示“待核实”，不能把未知当成“无”。

公开数据来自 OpenStreetMap 社区记录，不能替代现场确认。系统不提供实时排队、精确路线或医疗诊断。

## 黑客松复演

- [项目完整介绍与当前状态](docs/project-introduction.md)
- [办公小浣熊编号提示词](docs/office-raccoon-prompts.md)
- [60 分钟复演脚本](docs/60-minute-replay.md)
- [Starter 交付检查单](docs/starter-checklist.md)

比赛前把整个目录压缩为 Starter；现场只用办公小浣熊按编号提示词推进，不临时改变数据接口或视觉方向。
