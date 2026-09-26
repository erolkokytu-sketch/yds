import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const dist = new URL("../dist/", import.meta.url);

async function json(path) {
  return JSON.parse(await readFile(new URL(path, dist), "utf8"));
}

async function pngSize(path) {
  const bytes = await readFile(new URL(path, dist));
  assert.equal(bytes.subarray(1, 4).toString(), "PNG");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

test("manifest is valid and installable", async () => {
  const manifest = await json("manifest.webmanifest");
  assert.equal(manifest.name, "YDS Çalışma");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./#/");
  assert.equal(manifest.scope, "./");
  assert.deepEqual(await pngSize("icons/icon-192.png"), [192, 192]);
  assert.deepEqual(await pngSize("icons/icon-512.png"), [512, 512]);
  assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"));
});

test("production PWA assets and offline shell are generated", async () => {
  const worker = await readFile(new URL("sw.js", dist), "utf8");
  assert.match(worker, /yds-shell-0\.1\.0-/);
  assert.match(worker, /\/YDS\/index\.html/);
  assert.match(worker, /\/YDS\/manifest\.webmanifest/);
  assert.match(worker, /\/YDS\/assets\/index-/);
  assert.match(worker, /caches\.open/);
  assert.match(worker, /ignoreVary: true/);
  assert.doesNotMatch(worker, /indexedDB|deleteDatabase/);
  await stat(new URL("index.html", dist));
});

test("production base path is applied and runtime has no external dependency", async () => {
  const index = await readFile(new URL("index.html", dist), "utf8");
  assert.match(index, /\/YDS\/assets\/index-/);
  assert.match(index, /\.\/manifest\.webmanifest/);
  assert.doesNotMatch(index, /https?:\/\//);
});

test("service worker uses versioned updates without clearing application data", async () => {
  const worker = await readFile(new URL("sw.js", dist), "utf8");
  assert.match(worker, /activate/);
  assert.match(worker, /caches\.delete/);
  assert.match(worker, /clients\.claim/);
  assert.doesNotMatch(worker, /localStorage|indexedDB/);
});

test("application source has no runtime external network client", async () => {
  const files = ["../src/App.tsx", "../src/main.tsx", "../src/pwa.ts", "../index.html"];
  const source = (await Promise.all(files.map((path) => readFile(new URL(path, import.meta.url), "utf8")))).join("\n");
  assert.doesNotMatch(source, /<script[^>]+src=["']https?:/i);
  assert.doesNotMatch(source, /\b(fetch\s*\(|XMLHttpRequest|WebSocket\s*\(|sendBeacon\s*\()/);
  assert.match(source, /accept="\.ydspack,\.json,application\/json,application\/octet-stream"/);
});
