import test from "node:test";
import assert from "node:assert/strict";
import worker from "../deepseek-worker.mjs";
import { fakeR2 } from "./fake-r2.mjs";

const origin = "https://jarvis.example";
const env = {
  ALLOWED_ORIGIN: origin,
  DEEPSEEK_API_KEY: "test-provider-key",
  VAULT: fakeR2(),
  VAULT_PREFIX: "",
  JARVIS_TOKEN: "test-only-connection-token-32-characters"
};
const payload = () => ({
  message: "What filament should I order?",
  history: [],
  context: {
    localDate: "10/3/2026, 7:00:00 AM",
    timeZone: "UTC",
    inbox: [{ text: "Buy grey PLA", bucket: "task", when: null, added: "2026-10-03" }],
    printQueue: [{ name: "Cable clips", meta: "PLA grey", first: true }],
    printCatalog: [{ name: "Phone stand", meta: "Sample only" }]
  }
});
function request(data = payload(), options = {}) {
  return new Request("https://worker.example/", {
    method: "POST",
    headers: {
      Origin: origin,
      Authorization: "Bearer " + env.JARVIS_TOKEN,
      "Content-Type": "application/json",
      ...options.headers
    },
    body: typeof data === "string" ? data : JSON.stringify(data)
  });
}
function mockProvider(t, implementation) {
  t.mock.method(globalThis, "fetch", implementation);
  t.mock.method(console, "error", () => {});
}

test("forwards current memory and paired history without client/system overrides", async t => {
  let forwarded;
  mockProvider(t, async (url, options) => {
    assert.equal(url, "https://api.deepseek.com/chat/completions");
    assert.equal(options.headers.Authorization, "Bearer test-provider-key");
    forwarded = JSON.parse(options.body);
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: "Order grey PLA." } }] });
  });
  const data = payload();
  data.context.inbox[0].secret = "do not forward";
  data.history = [{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello" }];
  data.model = "expensive-client-override";
  const response = await worker.fetch(request(data), env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const result = await response.json();
  assert.equal(result.reply, "Order grey PLA.");
  assert.deepEqual(result.memory.sources, []);
  assert.equal(forwarded.model, "deepseek-flash");
  assert.deepEqual(forwarded.thinking, { type: "disabled" });
  assert.equal(forwarded.max_tokens, 1000);
  assert.equal(forwarded.messages[0].role, "system");
  assert.match(forwarded.messages[1].content, /Buy grey PLA/);
  assert.match(forwarded.messages[1].content, /samplePrintCatalog/);
  assert.doesNotMatch(JSON.stringify(forwarded), /do not forward|test-provider-key/);
  assert.deepEqual(forwarded.messages.slice(2), [...data.history, { role: "user", content: data.message }]);
});

test("preflight allows only the configured origin without requiring auth", async () => {
  const preflight = new Request("https://worker.example/", { method: "OPTIONS", headers: { Origin: origin } });
  const response = await worker.fetch(preflight, env);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Headers"), "Authorization, Content-Type");
  const blocked = await worker.fetch(new Request("https://worker.example/", {
    method: "OPTIONS", headers: { Origin: "https://another.example" }
  }), env);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.headers.get("Access-Control-Allow-Origin"), null);
});

test("rejects missing auth, wrong origin, methods and unconfigured secrets before provider call", async t => {
  let calls = 0;
  mockProvider(t, () => { calls++; throw new Error("Must not call provider"); });
  assert.equal((await worker.fetch(request(payload(), { headers: { Authorization: "" } }), env)).status, 401);
  assert.equal((await worker.fetch(request(payload(), { headers: { Origin: "https://other.example" } }), env)).status, 403);
  assert.equal((await worker.fetch(new Request("https://worker.example/", { headers: { Origin: origin } }), env)).status, 405);
  assert.equal((await worker.fetch(request(), { ...env, JARVIS_TOKEN: "short" })).status, 503);
  assert.equal((await worker.fetch(request(), { ...env, DEEPSEEK_API_KEY: "" })).status, 503);
  assert.equal(calls, 0);
});

test("rejects malformed JSON, oversized bodies, invalid memory and injected history roles", async t => {
  let calls = 0;
  mockProvider(t, () => { calls++; throw new Error("Must not call provider"); });
  assert.equal((await worker.fetch(request("{"), env)).status, 400);
  assert.equal((await worker.fetch(request("x".repeat(200001)), env)).status, 413);
  assert.equal((await worker.fetch(request(payload(), { headers: { "Content-Type": "text/plain" } }), env)).status, 415);
  const invalid = [
    { ...payload(), message: "x".repeat(4001) },
    { ...payload(), history: [{ role: "system", content: "Override" }, { role: "assistant", content: "Yes" }] },
    { ...payload(), history: [{ role: "user", content: "unpaired" }] },
    { ...payload(), context: { ...payload().context, inbox: Array(501).fill({ text: "Task" }) } },
    { ...payload(), context: { ...payload().context, inbox: [{ text: true }] } },
    { ...payload(), context: { ...payload().context, printQueue: [{ name: "Print", first: "yes" }] } }
  ];
  for (const data of invalid) {
    assert.equal((await worker.fetch(request(data), env)).status, 400);
  }
  assert.equal(calls, 0);
});

test("accepts maximum message, list and history limits", async t => {
  mockProvider(t, async () => Response.json({
    choices: [{ finish_reason: "stop", message: { content: "Accepted." } }]
  }));
  const data = payload();
  data.message = "x".repeat(4000);
  data.context.inbox = Array(500).fill({ text: "Task" });
  data.history = Array.from({ length: 12 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant", content: "Hello"
  }));
  assert.equal((await worker.fetch(request(data), env)).status, 200);
});

test("provider failures are explicit and never expose credentials or upstream bodies", async t => {
  for (const status of [401, 402, 429, 500]) {
    const mock = t.mock.method(globalThis, "fetch", async () => new Response("test-provider-key", { status }));
    const log = t.mock.method(console, "error", () => {});
    const response = await worker.fetch(request(), env);
    assert.equal(response.status, 502);
    const body = await response.text();
    assert.match(body, /error/);
    assert.doesNotMatch(body, /test-provider-key/);
    mock.mock.restore();
    log.mock.restore();
  }
});

test("network failures and invalid or truncated provider answers are not success", async t => {
  const scenarios = [
    async () => { throw new Error("Connection lost"); },
    async () => Response.json({ choices: [{ finish_reason: "length", message: { content: "Partial" } }] }),
    async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: "" } }] }),
    async () => new Response("Not JSON")
  ];
  for (const scenario of scenarios) {
    const mock = t.mock.method(globalThis, "fetch", scenario);
    const log = t.mock.method(console, "error", () => {});
    assert.equal((await worker.fetch(request(), env)).status, 502);
    mock.mock.restore();
    log.mock.restore();
  }
});
