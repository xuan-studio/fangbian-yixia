import { spawnSync } from "node:child_process";
import { access, mkdir, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const root = resolve(import.meta.dirname, "..");
const deckPath = resolve(root, "public/slides/index.html");
const framesDir = resolve(root, ".preview-frames");
const outputPath = resolve(root, "public/slides/preview.gif");
const chromeCandidates = [
  process.env.PLAYWRIGHT_CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

async function findChrome() {
  for (const candidate of chromeCandidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next known browser path.
    }
  }
  throw new Error("没有找到 Chrome/Chromium；可设置 PLAYWRIGHT_CHROME_PATH 后重试。");
}

await rm(framesDir, { recursive: true, force: true });
await mkdir(framesDir, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: await findChrome() });
const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });
const slides = [1, 5, 6, 7, 9, 12];

try {
  for (const [index, slide] of slides.entries()) {
    const url = new URL(pathToFileURL(deckPath));
    url.searchParams.set("slide", String(slide));
    url.searchParams.set("capture", "1");
    await page.goto(url.href, { waitUntil: "load" });
    await page.waitForTimeout(450);
    await page.screenshot({ path: resolve(framesDir, `frame-${String(index + 1).padStart(2, "0")}.png`) });
  }
} finally {
  await browser.close();
}

const render = spawnSync("ffmpeg", [
  "-y",
  "-framerate", "0.8",
  "-start_number", "1",
  "-i", resolve(framesDir, "frame-%02d.png"),
  "-vf", "scale=960:540:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer",
  "-loop", "0",
  outputPath,
], { encoding: "utf8" });

if (render.status !== 0) {
  throw new Error(`ffmpeg 生成预览失败：\n${render.stderr}`);
}

const output = await stat(outputPath);
if (output.size > 10 * 1024 * 1024) {
  throw new Error(`动画预览过大：${(output.size / 1024 / 1024).toFixed(1)} MB`);
}

await rm(framesDir, { recursive: true, force: true });
console.log(`README 动画预览已生成：${(output.size / 1024 / 1024).toFixed(1)} MB`);
