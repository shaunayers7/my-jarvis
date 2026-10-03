import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function app(fetchImpl = async () => Response.json({ reply: "Test answer." })) {
  const nodes = new Map();
  const storage = new Map();
  const element = () => ({
    value: "", textContent: "", disabled: false, offsetTop: 0, dataset: {},
    children: [], listeners: new Map(),
    classList: { add() {}, remove() {}, contains() { return false; } },
    setAttribute() {}, scrollTo() {}, showModal() {}, close() {},
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    addEventListener(name, listener) { this.listeners.set(name, listener); },
    querySelector() { return element(); }
  });
  const document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, element());
      return nodes.get(id);
    },
    createElement: element
  };
  const context = vm.createContext({
    document, window: { matchMedia: () => ({ matches: true }) },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    fetch: fetchImpl, console: { error() {} },
    URL, Date, Intl, crypto, TypeError, SyntaxError, AbortController, TextEncoder, setTimeout, clearTimeout, setInterval, clearInterval
  });
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  return {
    nodes, storage, run,
    connect() {
      document.getElementById("ai-url").value = "https://worker.example/";
      document.getElementById("ai-token").value = "test-only-token-at-least-32-characters";
      nodes.get("ai-form").listeners.get("submit")({ preventDefault() {} });
    }
  };
}

test("AI starts disconnected and never calls a provider during greeting", async () => {
  let calls = 0;
  const ui = app(async () => { calls++; return Response.json({ reply: "Hello" }); });
  assert.equal(calls, 0);
  await assert.rejects(ui.run('route("What filament should I order?")'), /not connected/);
  assert.equal(calls, 0);
});

test("connection settings save only URL, reject unsafe URLs, and clear token on disconnect", () => {
  const ui = app();
  ui.connect();
  assert.equal(ui.storage.get("jarvis.aiURL"), "https://worker.example/");
  assert.equal(ui.storage.size, 1);
  ui.nodes.get("ai-url").value = "http://worker.example/";
  ui.nodes.get("ai-form").listeners.get("submit")({ preventDefault() {} });
  assert.match(ui.nodes.get("ai-error").textContent, /HTTPS/);
  assert.equal(ui.storage.get("jarvis.aiURL"), "https://worker.example/");
  ui.nodes.get("ai-disconnect").listeners.get("click")();
  assert.equal(ui.run("aiToken"), "");
  assert.equal(ui.nodes.get("ai-token").value, "");
});

test("saves remember commands to Markdown before print/today keyword matching, never localStorage or AI", async () => {
  const requests = [];
  const ui = app(async (url, options) => {
    const data = options.body ? JSON.parse(options.body) : null;
    requests.push({ url: String(url), data });
    return Response.json(data ? { path: data.path, etag: "test-etag" } : { notes: [] });
  });
  ui.connect();
  await ui.run('route("remember buy PLA today")');
  assert.match(requests[0].data.path, /^Inbox\/buy PLA today-/);
  assert.match(requests[0].data.content, /buy PLA today/);
  assert.equal(ui.storage.has("jarvis.inbox"), false);
  await ui.run('route("remember")');
  assert.equal(requests.length, 1);
  await ui.run('route("today")');
  await ui.run('route("inbox")');
  await ui.run('route("show me my prints")');
  assert.equal(ui.run("picker.phase"), "pick");
  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => request.url.includes("/vault/")));
});

test("disconnected capture fails rather than creating a local notes database", async () => {
  const ui = app();
  await assert.rejects(ui.run('route("remember grey PLA")'), /not saved locally/);
  assert.equal(ui.storage.has("jarvis.inbox"), false);
});

test("lost capture response retains the same path for a safe retry", async () => {
  const paths = [];
  const ui = app(async (url, options) => {
    paths.push(JSON.parse(options.body).path);
    if (paths.length === 1) throw new TypeError("Connection lost after write");
    return Response.json({ error: "Already exists" }, { status: 409 });
  });
  ui.connect();
  await assert.rejects(ui.run('route("remember grey PLA")'), /could not be confirmed/);
  await assert.rejects(ui.run('route("remember grey PLA")'), /Already exists/);
  assert.equal(paths[0], paths[1]);
  assert.equal(ui.storage.has("jarvis.inbox"), false);
});

test("general questions go to DeepSeek with fresh memory and bounded conversation history", async () => {
  const requests = [];
  const ui = app(async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) });
    return Response.json({ reply: "<b>Use your saved grey PLA.</b>" });
  });
  ui.connect();
  ui.storage.set("jarvis.inbox", JSON.stringify([{ text: "Buy grey PLA", bucket: "print" }]));
  await ui.run('route("Jarvis, what should I print today?")');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.context.inbox[0].text, "Buy grey PLA");
  assert.equal(requests[0].options.credentials, "omit");
  assert.equal(requests[0].options.redirect, "error");
  assert.equal(ui.nodes.get("ai-status").textContent, "DeepSeek connected");
  const replyNode = ui.nodes.get("chat").children.at(-1);
  assert.equal(replyNode.children[1].textContent, "<b>Use your saved grey PLA.</b>");
  ui.storage.set("jarvis.printQueue", JSON.stringify([{ name: "Cable clips" }]));
  for (let i = 0; i < 7; i++) await ui.run('route("Help me plan my work")');
  assert.equal(requests.at(-1).body.context.printQueue[0].name, "Cable clips");
  assert.equal(requests.at(-1).body.history.length, 12);
  assert.equal(ui.run("aiHistory.length"), 12);
  assert.equal(ui.storage.has("jarvis.aiHistory"), false);
});

test("requests for printing advice are not mistaken for Picker commands", async () => {
  let calls = 0;
  const ui = app(async () => { calls++; return Response.json({ reply: "Use PLA for a prototype." }); });
  ui.connect();
  await ui.run('route("Show me how to print a bracket")');
  assert.equal(calls, 1);
  assert.equal(ui.run("picker"), null);
});

test("invalid answers and network failures do not enter chat history", async () => {
  for (const implementation of [
    async () => Response.json({ reply: "" }),
    async () => { throw new TypeError("Failed to fetch"); }
  ]) {
    const ui = app(implementation);
    ui.connect();
    await assert.rejects(ui.run('route("Help me plan work")'));
    assert.equal(ui.run("aiHistory.length"), 0);
  }
});

test("request failures restore input, unlock send, and do not append fake history", async () => {
  const ui = app(async () => Response.json({ error: "Incorrect token" }, { status: 401 }));
  ui.connect();
  ui.nodes.get("prompt-input").value = "Help me plan my work";
  await ui.run("send()");
  assert.equal(ui.nodes.get("prompt-input").value, "Help me plan my work");
  assert.equal(ui.nodes.get("send-btn").disabled, false);
  assert.equal(ui.run("aiHistory.length"), 0);
  assert.equal(ui.nodes.get("chat").children.at(-1).children[1].textContent, "Incorrect token");
});

test("corrupt and oversized memory are rejected before network calls", async () => {
  let calls = 0;
  const ui = app(async () => { calls++; return Response.json({ reply: "Wrong" }); });
  ui.connect();
  ui.storage.set("jarvis.inbox", "invalid JSON");
  await assert.rejects(ui.run('route("Help me plan work")'));
  ui.storage.set("jarvis.inbox", JSON.stringify({ text: "Not a list" }));
  await assert.rejects(ui.run('route("Help me plan work")'), /Saved memory is invalid/);
  ui.storage.set("jarvis.inbox", JSON.stringify([{ text: "x".repeat(200001) }]));
  await assert.rejects(ui.run('route("Help me plan work")'), /too large/);
  assert.equal(calls, 0);
});

test("only one request can run, and typed next messages are preserved", async () => {
  let finish;
  let calls = 0;
  const ui = app(() => { calls++; return new Promise(resolve => { finish = resolve; }); });
  ui.connect();
  ui.nodes.get("prompt-input").value = "Help me plan work";
  const first = ui.run("send()");
  ui.nodes.get("prompt-input").value = "My next message";
  await ui.run("send()");
  assert.equal(calls, 1);
  assert.equal(ui.nodes.get("send-btn").disabled, true);
  finish(Response.json({ reply: "Plan one task first." }));
  await first;
  assert.equal(ui.nodes.get("prompt-input").value, "My next message");
  assert.equal(ui.nodes.get("send-btn").disabled, false);
});
