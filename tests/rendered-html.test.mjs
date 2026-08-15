import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the hackathon dashboard without starter metadata", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /上海厕所情报地图/);
  assert.match(html, /方便一下/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|Building your site/i);
});

test("public and premium datasets preserve truthful status", async () => {
  const [publicData, premiumData, matchData, indoorData] = await Promise.all([
    readFile(new URL("public/data/public-toilets.json", root), "utf8").then(JSON.parse),
    readFile(new URL("public/data/premium-toilets.json", root), "utf8").then(JSON.parse),
    readFile(new URL("public/data/premium-matches.json", root), "utf8").then(JSON.parse),
    readFile(new URL("public/data/building-location-candidates.json", root), "utf8").then(JSON.parse),
  ]);
  assert.ok(publicData.records.length >= 900);
  assert.equal(premiumData.status, "ready");
  assert.equal(premiumData.records.length, 12);
  assert.equal(matchData.records.length, premiumData.records.length);
  assert.ok(premiumData.records.every((record) => record.sourceType === "premium_xhs"));
  assert.ok(premiumData.records.every((record) => record.dataStatus === "pending_verification"));
  assert.ok(premiumData.records.every((record) => record.rating === null && record.reviewCount === null));
  assert.ok(premiumData.records.every((record) => record.comments.length === 2));
  assert.ok(premiumData.records.every((record) => record.comments.some((comment) => comment.source === "xhs_note" || comment.source === "xhs_aggregate")));
  assert.ok(premiumData.records.every((record) => record.comments.some((comment) => comment.source === "mock" && comment.sourceLabel === "Mock 演示")));
  assert.ok(matchData.records.every((record) => record.mergeDecision === "keep_separate"));
  assert.equal(indoorData.status, "ready");
  assert.ok(indoorData.records.length >= 1);
  assert.ok(indoorData.records.every((record) => record.requiredVerifications === 3));
  assert.ok(indoorData.records.every((record) => record.status === "collecting"));
  for (const record of publicData.records) {
    assert.equal(record.sourceType, "public_open_data");
    assert.ok(record.coordinates.longitude >= 120.8 && record.coordinates.longitude <= 122.15);
    assert.ok(record.coordinates.latitude >= 30.65 && record.coordinates.latitude <= 31.9);
    assert.equal(typeof record.name, "string");
  }
});

test("offline and import contracts are packaged", async () => {
  const [serviceWorker, schema, template, dashboard, styles, candidates, types] = await Promise.all([
    readFile(new URL("public/sw.js", root), "utf8"),
    readFile(new URL("public/data/toilet-record.schema.json", root), "utf8"),
    readFile(new URL("public/data/premium-import-template.json", root), "utf8"),
    readFile(new URL("app/Dashboard.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("public/data/xhs-candidates.json", root), "utf8").then(JSON.parse),
    readFile(new URL("app/types.ts", root), "utf8"),
  ]);
  assert.match(serviceWorker, /public-toilets\.json/);
  assert.match(serviceWorker, /premium-comment-seeds\.json/);
  assert.match(serviceWorker, /building-location-candidates\.json/);
  assert.match(serviceWorker, /shanghai-boundary\.geojson/);
  assert.match(schema, /"title": "ToiletRecord"/);
  assert.match(template, /"records": \[\]/);
  assert.match(dashboard, /憋不住了/);
  assert.match(dashboard, /未知 ≠ 没有/);
  assert.match(dashboard, /3 人确认后上线/);
  assert.match(dashboard, /模拟下一位用户确认/);
  assert.match(dashboard, /厕所共建中心/);
  assert.match(dashboard, /社区六维评分/);
  assert.match(dashboard, /新厕所已进入验证中心/);
  assert.match(dashboard, /!record\.tags\.includes\("演示上线"\)/);
  assert.match(types, /export type CommunityClaim/);
  assert.match(types, /export type CommunityRating/);
  assert.match(types, /export type AuditEvent/);
  assert.match(dashboard, /interleaved: false/);
  assert.match(dashboard, /"light_all" : "dark_all"/);
  assert.match(dashboard, /MAP_VISUAL_THEME: VisualTheme = "light"/);
  assert.match(dashboard, /useState<VisualTheme>\("dark"\)/);
  assert.match(dashboard, /theme=\{MAP_VISUAL_THEME\}/);
  assert.match(dashboard, /theme-\$\{visualTheme\}/);
  assert.doesNotMatch(dashboard, /dark-matter-gl-style\/style\.json/);
  assert.doesNotMatch(dashboard, /map\.on\("error", failOnline\)/);
  assert.doesNotMatch(dashboard, /transitions:\s*\{\s*getElevation/);
  assert.match(styles, /\.map-frame \.map-canvas\s*\{[^}]*height:\s*100%/s);
  assert.equal(candidates.status, "pending_verification");
  assert.ok(candidates.sourcePosts.length >= 10);
  assert.ok(candidates.venueCandidates.every((candidate) => candidate.coordinates === null));
  await assert.rejects(access(new URL("app/_sites-preview", root)));
});
