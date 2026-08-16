import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import process from "node:process";
import test, { after, before } from "node:test";
import { chromium } from "playwright-core";

const root = new URL("../", import.meta.url);
const port = 4173;
const baseUrl = `http://127.0.0.1:${port}/`;
const chromeCandidates = [
  process.env.PLAYWRIGHT_CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].filter(Boolean);

let server;
let browser;
let serverOutput = "";

async function findChrome() {
  for (const candidate of chromeCandidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next explicit local browser path.
    }
  }
  throw new Error("没有找到本机 Chrome。可设置 PLAYWRIGHT_CHROME_PATH 后重试。 ");
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`本地验收服务提前退出：\n${serverOutput}`);
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // The production server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`等待本地验收服务超时：\n${serverOutput}`);
}

before(async () => {
  server = spawn("npm", ["run", "start", "--", "--port", String(port)], {
    cwd: root,
    env: { ...process.env, WRANGLER_LOG_PATH: ".wrangler/e2e.log" },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
  server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });
  await waitForServer();
  browser = await chromium.launch({ headless: true, executablePath: await findChrome() });
});

after(async () => {
  await browser?.close();
  if (server?.pid && server.exitCode === null) {
    if (process.platform === "win32") server.kill("SIGTERM");
    else process.kill(-server.pid, "SIGTERM");
  }
});

test("golden map, emergency and community flows remain usable", async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector(".map-count strong")?.textContent?.trim() === "953");

  assert.equal(await page.locator(".data-stat-row").filter({ hasText: "公开厕所" }).locator("strong").innerText(), "941");
  assert.equal(await page.locator(".data-stat-row").filter({ hasText: "优质榜单" }).locator("strong").innerText(), "12");

  await page.getByRole("combobox", { name: "区域" }).selectOption({ label: "黄浦区" });
  await page.waitForFunction(() => document.querySelector(".map-count strong")?.textContent?.trim() === "129");
  await page.getByRole("combobox", { name: "开放状态" }).selectOption("24h");
  await page.waitForFunction(() => document.querySelector(".map-count strong")?.textContent?.trim() === "8");
  assert.equal(await page.getByRole("heading", { name: "黄浦区公共厕所" }).innerText(), "黄浦区公共厕所");
  await page.getByRole("button", { name: "重置", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".map-count strong")?.textContent?.trim() === "953");

  await page.getByRole("button", { name: /7 汇金百货/ }).click();
  assert.equal(await page.getByText("1 条平台证据 · 1 条 Mock", { exact: true }).innerText(), "1 条平台证据 · 1 条 Mock");
  await page.getByPlaceholder("补充气味、清洁或排队情况").fill("E2E：5F 东南侧指引清楚");
  await page.getByRole("button", { name: "提交点评" }).click();
  assert.equal(await page.getByText("E2E：5F 东南侧指引清楚", { exact: true }).innerText(), "E2E：5F 东南侧指引清楚");

  await page.getByRole("button", { name: /憋不住了/ }).click();
  assert.equal(await page.locator(".fallback-step").count(), 4);
  assert.match(await page.locator(".emergency-panel").innerText(), /L1[\s\S]*L2[\s\S]*L3[\s\S]*L4/);
  await page.locator(".emergency-panel").getByRole("button", { name: "关闭" }).click();

  await page.getByRole("button", { name: "我要共建", exact: true }).click();
  await page.getByPlaceholder("补充一句体验说明，可选填").fill("E2E 六维评分");
  await page.getByRole("button", { name: "提交评分", exact: true }).click();
  assert.equal(await page.getByText("1 条会话评分已存在", { exact: true }).innerText(), "1 条会话评分已存在");

  await page.getByRole("button", { name: "补充信息", exact: true }).click();
  await page.getByRole("textbox", { name: "用自然语言补充事实" }).fill("B2 东南侧，有蹲厕和无障碍，维修关闭");
  assert.equal(await page.getByText("floor: B2", { exact: true }).innerText(), "floor: B2");
  assert.equal(await page.getByText("operationalStatus: 可能暂停开放", { exact: true }).innerText(), "operationalStatus: 可能暂停开放");

  await page.getByRole("button", { name: "新增厕所", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "发现说明" }).inputValue(), "", "新增厕所说明不应继承上一种投稿内容");
  await page.getByRole("textbox", { name: "厕所/建筑名称" }).fill("E2E 人民广场测试厕所");
  await page.getByRole("textbox", { name: "行政区" }).fill("黄浦区");
  await page.getByRole("textbox", { name: "地址或入口" }).fill("人民广场 1 号口附近");
  await page.getByRole("textbox", { name: "楼层" }).fill("B1");
  await page.getByRole("textbox", { name: "楼内方位" }).fill("近服务台");
  await page.getByRole("textbox", { name: "发现说明" }).fill("入口清楚，现场待验证");
  await page.getByRole("button", { name: "提交到验证中心", exact: true }).click();
  assert.equal(await page.locator(".map-count strong").innerText(), "953");

  await page.getByRole("button", { name: /验证中心 2/ }).last().click();
  const newToiletTask = page.getByRole("heading", { name: "E2E 人民广场测试厕所" }).locator("..");
  assert.match(await newToiletTask.innerText(), /0\/3 确认/);
  for (let step = 0; step < 3; step += 1) {
    await newToiletTask.getByRole("button", { name: "模拟下一位" }).click();
  }
  assert.match(await newToiletTask.innerText(), /演示上线/);
  await page.waitForFunction(() => document.querySelector(".map-count strong")?.textContent?.trim() === "954");

  await page.getByRole("dialog", { name: "厕所共建中心" }).getByRole("button", { name: "关闭" }).click();
  await page.getByRole("button", { name: "排泄记录", exact: true }).click();
  const healthDialog = page.getByRole("dialog", { name: "以屎为镜，可以知……今天。" });
  await healthDialog.getByRole("checkbox", { name: "发现便血或黑便" }).check();
  await healthDialog.getByRole("button", { name: "生成观察卡" }).click();
  assert.match(await healthDialog.locator(".health-result").innerText(), /红旗信号[\s\S]*联系医生[\s\S]*急诊/);

  await page.close();
});

test("mobile layout exposes every primary action without horizontal discovery", async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector(".map-count strong")?.textContent?.trim() === "953");

  for (const label of ["切换为亮色模式", "在线底图", "我要共建", /验证中心 1/, "导入榜单 JSON", "3 分钟演示"]) {
    assert.equal(await page.getByRole("button", { name: label, exact: typeof label === "string" }).isVisible(), true, `${String(label)} 应在手机顶部直接可见`);
  }
  const viewportMetrics = await page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(viewportMetrics.scrollWidth <= viewportMetrics.width + 1, `手机页面出现横向溢出：${JSON.stringify(viewportMetrics)}`);
  await page.close();
});

test("a warmed visit reloads with local data when the network is offline", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector(".map-count strong")?.textContent?.trim() === "953");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector(".map-count strong")?.textContent?.trim() === "953");

  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector(".map-count strong")?.textContent?.trim() === "953");
  // Chromium's protocol-level offline switch blocks requests but keeps
  // navigator.onLine=true, so dispatch the same event emitted by a real OS
  // network transition before asserting the visible fallback state.
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await page.getByRole("button", { name: "离线概念图", exact: true }).waitFor({ state: "visible", timeout: 12_000 });
  assert.equal(await page.locator(".data-stat-row").filter({ hasText: "公开厕所" }).locator("strong").innerText(), "941");
  assert.equal(await page.locator(".data-stat-row").filter({ hasText: "优质榜单" }).locator("strong").innerText(), "12");

  await context.setOffline(false);
  await context.close();
});
