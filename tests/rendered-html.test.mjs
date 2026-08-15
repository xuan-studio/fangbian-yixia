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
  const [publicData, premiumData] = await Promise.all([
    readFile(new URL("public/data/public-toilets.json", root), "utf8").then(JSON.parse),
    readFile(new URL("public/data/premium-toilets.json", root), "utf8").then(JSON.parse),
  ]);
  assert.ok(publicData.records.length >= 900);
  assert.equal(premiumData.status, "pending_source");
  assert.deepEqual(premiumData.records, []);
  for (const record of publicData.records) {
    assert.equal(record.sourceType, "public_open_data");
    assert.ok(record.coordinates.longitude >= 120.8 && record.coordinates.longitude <= 122.15);
    assert.ok(record.coordinates.latitude >= 30.65 && record.coordinates.latitude <= 31.9);
    assert.equal(typeof record.name, "string");
  }
});

test("offline and import contracts are packaged", async () => {
  const [serviceWorker, schema, template, dashboard] = await Promise.all([
    readFile(new URL("public/sw.js", root), "utf8"),
    readFile(new URL("public/data/toilet-record.schema.json", root), "utf8"),
    readFile(new URL("public/data/premium-import-template.json", root), "utf8"),
    readFile(new URL("app/Dashboard.tsx", root), "utf8"),
  ]);
  assert.match(serviceWorker, /public-toilets\.json/);
  assert.match(serviceWorker, /shanghai-boundary\.geojson/);
  assert.match(schema, /"title": "ToiletRecord"/);
  assert.match(template, /"records": \[\]/);
  assert.match(dashboard, /憋不住了/);
  assert.match(dashboard, /未知 ≠ 没有/);
  await assert.rejects(access(new URL("app/_sites-preview", root)));
});
