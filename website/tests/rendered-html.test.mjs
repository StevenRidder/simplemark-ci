import assert from "node:assert/strict";
import test from "node:test";

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

test("server-renders the SimpleMark product site", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>SimpleMark — The beautiful living document for AI work<\/title>/i);
  assert.match(html, /Your agent writes the Markdown/);
  assert.match(html, /A document, not another workspace/);
  assert.match(html, /macOS build — coming soon/);
  assert.match(html, /What is not ready/);
  assert.match(html, /simplemark-demo\.gif/);
  assert.match(html, /simplemark-logo-512\.png/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|Your site is taking shape/);
});

test("keeps the pre-alpha download state honest", async () => {
  const response = await render();
  const html = await response.text();

  assert.match(html, /Pre-alpha for macOS/);
  assert.match(html, /disabled=""/);
  assert.match(html, /signed native download/);
  assert.match(html, /production file watching/);
  assert.match(html, /github\.com\/StevenRidder\/simplemark/);
});
