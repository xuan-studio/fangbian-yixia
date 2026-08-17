# 「方便一下」AI 本地部署教程

这份文档是给能够读文件、运行终端和检查浏览器的 AI 助手使用的。目标是让任何人在一台新电脑上，把项目安全地运行起来并得到可验证的结果。

## 1. AI 的任务边界

执行前先向用户说明你会：

1. 检查运行环境与 Git 状态。
2. 安装锁文件指定的依赖。
3. 运行 lint、构建和测试。
4. 启动本地服务并报告网址。

默认不修改业务数据、不创建账号、不上传个人信息，也不公开部署。若用户要求修改或公网部署，再单独确认影响范围。

## 2. 环境要求

- Git。
- Node.js `22.13+ LTS` 或 Node.js 24。
- npm（随 Node.js 安装）。
- Chrome 或 Chromium，用于浏览器端到端测试。

检查命令：

```bash
git --version
node --version
npm --version
```

如果 Node.js 版本低于 22.13，先让用户升级 Node.js，再继续。不要擅自安装系统级软件。

## 3. 获取代码

macOS、Linux 或 Windows PowerShell 均可执行：

```bash
git clone https://github.com/xuan-studio/fangbian-yixia.git
cd fangbian-yixia
git status --short
```

如果目录已经存在，先确认它是本项目，再执行 `git status --short`。不要使用 `git reset --hard`、`git clean` 或删除用户文件。

## 4. 安装与验收

优先使用锁文件进行可重复安装：

```bash
npm ci
npm run lint
npm test
```

成功标准：

- lint 无错误。
- 生产构建完成。
- 3 项数据/离线契约测试通过。
- 3 项真实浏览器流程测试通过。

构建出现“大于 500 kB”的 chunk 提示属于性能优化提醒，不是当前启动阻塞项。

## 5. 启动本地产品

```bash
npm run dev
```

终端出现服务地址后，打开 `http://localhost:3000/`。不要假设端口一定可用；如果 3000 已被占用，先判断现有服务是否属于本项目，再选择新端口或征求用户许可停止旧进程。

本地必须能够看到：

- 941 个公开厕所点和 12 个优质场所点。
- 青色公开点、珊瑚色 24 小时点和金色榜单点。
- “憋不住了”四级降级入口。
- “我要共建”和“验证中心”。
- 手机宽度下地图和紧急入口进入首屏。
- 在线底图不可用时可以切换到离线概念地图。

路演页面位于 `http://localhost:3000/slides/`。

### 可选启用高德 3D 地图

只有用户明确提供高德“Web 端（JS API）”Key 与 `securityJsCode` 时才配置：

```bash
cp .env.example .env.local
```

将 Key 写入 `AMAP_JS_KEY`，将安全密钥写入 `AMAP_SECURITY_JS_CODE`。不要在聊天回复、日志、截图或 Git 提交中回显真实值。高德 Key 未配置、网络失败或接口拒绝时，应继续验证 MapLibre 和离线概念图回退，而不是让产品白屏。

## 6. 生产模式本地预览

需要更接近线上环境时：

```bash
npm run build
npm run start
```

构建产物位于 `dist/`，不要手工编辑构建产物。

## 7. 常见问题

### 地图底图失败

这不应阻塞产品。高德失败时先确认回退到“在线底图”；通用在线底图也失败时确认顶部出现“离线概念图”，然后继续检查筛选、详情和紧急推荐。如果本地 JSON 也未加载，再查看浏览器网络错误和终端输出。

### 浏览器测试找不到 Chrome

在安装 Chrome/Chromium 后设置 `PLAYWRIGHT_CHROME_PATH` 指向浏览器可执行文件，再运行 `npm run test:e2e`。不要下载来源不明的浏览器二进制文件。

### 依赖安装失败

先报告 Node/npm 版本和首个真实错误。不要删除锁文件，也不要用随机升级依赖来掩盖问题。

### 页面数据数量不一致

先检查 `public/data/` 与 Git 状态。不要为了让测试通过而伪造记录或修改期望数量。

## 8. 修改项目时的强制规则

- 先完整阅读根目录 `AGENTS.md`。
- 缺失字段使用 `null`；未知不等于 `false`。
- Mock 内容必须明确标注，不能参与正式可信度计算。
- 楼内位置和新厕所必须先进入候选池，经过多人验证后上线。
- 商业推广不得干预紧急推荐排序。
- 健康模块只做娱乐观察和红旗分流，不做医疗诊断。
- 保留 OpenStreetMap 署名与 ODbL 数据说明。
- 修改后至少运行 `npm run lint` 和 `npm test`。

## 9. 三条可复制 AI 指令

### 只在本地运行

```text
请完整阅读 AGENTS.md 和 AI-DEPLOY.md，检查环境与 Git 状态，执行 npm ci、npm run lint、npm test，然后启动本地开发服务。不要修改业务数据。完成后报告访问网址、测试结果和任何已知限制。
```

### 修改后运行

```text
请先阅读 AGENTS.md、AI-DEPLOY.md 和相关源码，只修改我指定的功能。保留数据来源、null 语义、Mock 标识和健康安全边界。完成后运行 npm run lint 与 npm test，并在浏览器中复查桌面和手机布局。
```

### 部署自己的公开副本

```text
请先按 AI-DEPLOY.md 在本地完成全部验收，再检查当前托管平台的官方文档。不要提交或打印任何 Token。先告诉我将创建的公开网址、访问范围、需要的账号权限和回滚方式，得到确认后再发布。发布后用未登录浏览器验证首页与 /slides/。
```
