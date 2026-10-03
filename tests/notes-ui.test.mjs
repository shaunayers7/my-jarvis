import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../notes.html", import.meta.url), "utf8");
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function notesApp(fetchImpl) {
  const nodes = new Map();
  const storage = new Map([["jarvis.aiURL", "https://worker.example/"]]);
  const windowEvents = new Map();
  const element = () => ({
    value: "", textContent: "", hidden: false, disabled: false, checked: true, readOnly: false,
    children: [], listeners: new Map(),
    classList: { toggle() {} },
    replaceChildren(...children) { this.children = children; },
    appendChild(child) { this.children.push(child); },
    addEventListener(name, listener) { this.listeners.set(name, listener); }
  });
  const document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, element());
      return nodes.get(id);
    },
    createElement: element,
    querySelectorAll() { return [...nodes.values()]; }
  };
  document.getElementById("editor-section").hidden = true;
  const context = vm.createContext({
    document,
    window: { confirm: () => false, addEventListener: (name, listener) => windowEvents.set(name, listener) },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    fetch: fetchImpl,
    console: { error() {} },
    URL, crypto, TypeError, SyntaxError, AbortController, setTimeout, clearTimeout
  });
  vm.runInContext(source, context);
  const run = code => vm.runInContext(code, context);
  const connect = async () => {
    document.getElementById("token").value = "test-only-vault-token-at-least-32-characters";
    await nodes.get("connection").listeners.get("submit")({ preventDefault() {} });
  };
  return { nodes, storage, run, connect, windowEvents };
}

function existing(content = "---\ntags: [mine]\n---\n# Filament\nGrey PLA") {
  return { path: "Inbox/Filament.md", content, etag: "v1", updated: "2026-10-03", folder: "Business" };
}

test("opens Markdown as plain text, preserves Unicode, and stores no note copies or tokens", async () => {
  const ui = notesApp(async url => String(url).includes("/vault/notes")
    ? Response.json({ notes: [{ path: "Inbox/Filament.md" }] })
    : Response.json(existing("<script>alert('no')</script>\nCafé")));
  await ui.connect();
  await ui.run('perform(() => openNote("Inbox/Filament.md"))');
  assert.equal(ui.nodes.get("content").value, "<script>alert('no')</script>\nCafé");
  assert.equal(ui.nodes.get("note-path").readOnly, true);
  assert.equal(ui.storage.size, 1);
  assert.equal(ui.storage.has("jarvis.inbox"), false);
});

test("save uses existing etag and tagging/linking choices; confirmed save survives list refresh failure", async () => {
  const requests = [];
  const ui = notesApp(async (url, options) => {
    requests.push({ url: String(url), options });
    if (options.method === "PUT") return Response.json({ ...existing("Updated PLA"), etag: "v2" });
    return Response.json({ error: "Listing unavailable" }, { status: 502 });
  });
  ui.run("workerURL = 'https://worker.example/'; token = 'test-token';");
  ui.run("showNote(" + JSON.stringify(existing()) + ")");
  ui.nodes.get("content").value = "Updated PLA";
  ui.nodes.get("auto-link").checked = false;
  await ui.nodes.get("editor").listeners.get("submit")({ preventDefault() {} });
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.etag, "v1");
  assert.equal(body.autoTag, true);
  assert.equal(body.autoLink, false);
  assert.equal(ui.nodes.get("content").value, "Updated PLA");
  assert.equal(ui.run("current.etag"), "v2");
  assert.match(ui.nodes.get("status").textContent, /Saved Inbox\/Filament.md, but/);
  assert.equal(ui.run("dirty()"), false);
});

test("conflicting edit preserves the draft and current version for explicit resolution", async () => {
  const ui = notesApp(async () => Response.json({ error: "Note changed during sync." }, { status: 409 }));
  ui.run("workerURL = 'https://worker.example/'; token = 'test-token';");
  ui.run("showNote(" + JSON.stringify(existing()) + ")");
  ui.nodes.get("content").value = "My unsaved draft";
  await ui.nodes.get("editor").listeners.get("submit")({ preventDefault() {} });
  assert.match(ui.nodes.get("status").textContent, /changed during sync/);
  assert.equal(ui.nodes.get("content").value, "My unsaved draft");
  assert.equal(ui.run("current.etag"), "v1");
  assert.equal(ui.run("dirty()"), true);
  assert.equal(ui.nodes.get("content").readOnly, false);
});

test("new notes use unique Markdown Inbox paths; unsaved drafts block navigation and moves", () => {
  const ui = notesApp(async () => { throw new Error("Must not write"); });
  ui.run("token = 'test-token'; controls();");
  ui.nodes.get("new-note").listeners.get("click")();
  assert.match(ui.nodes.get("note-path").value, /^Inbox\/Note-.*\.md$/);
  ui.nodes.get("content").value = "My new note";
  const path = ui.nodes.get("note-path").value;
  ui.nodes.get("new-note").listeners.get("click")();
  assert.equal(ui.nodes.get("note-path").value, path);
  let prevented = false;
  ui.windowEvents.get("beforeunload")({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  let backPrevented = false;
  ui.nodes.get("back").listeners.get("click")({ preventDefault() { backPrevented = true; } });
  assert.equal(backPrevented, true);
  ui.run("showNote(" + JSON.stringify(existing()) + ")");
  ui.nodes.get("content").value = "Unsaved edit";
  ui.nodes.get("organize").listeners.get("click")();
  assert.match(ui.nodes.get("status").textContent, /Save your draft before moving/);
});

test("move partial failure reports its destination; redirects cannot be edited", async () => {
  const ui = notesApp(async () => Response.json({
    error: "Copy created; source changed.", destination: "Business/Filament.md"
  }, { status: 409 }));
  ui.run("workerURL = 'https://worker.example/'; token = 'test-token';");
  ui.run("showNote(" + JSON.stringify(existing()) + ")");
  await ui.nodes.get("organize").listeners.get("click")();
  assert.match(ui.nodes.get("status").textContent, /Destination to check: Business\/Filament.md/);
  ui.run("showNote(" + JSON.stringify({ ...existing(), redirect: "Business/Filament.md" }) + "); controls();");
  assert.equal(ui.nodes.get("content").readOnly, true);
  assert.equal(ui.nodes.get("organize").disabled, true);
});

test("disconnect clears note content, token and list; no silent offline save exists", async () => {
  const ui = notesApp(async () => Response.json({ notes: [] }));
  await ui.connect();
  ui.run("showNote(" + JSON.stringify(existing()) + ")");
  ui.nodes.get("disconnect").listeners.get("click")();
  assert.equal(ui.run("token"), "");
  assert.equal(ui.run("current"), null);
  assert.equal(ui.nodes.get("content").value, "");
  assert.equal(ui.nodes.get("editor-section").hidden, true);
  await assert.rejects(ui.run('api("/vault/note", "POST", {path:"Inbox/Note.md", content:"Fact"})'), /Connect your Worker/);
  assert.equal(ui.storage.size, 1);
});
