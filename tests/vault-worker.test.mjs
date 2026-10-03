import test from "node:test";
import assert from "node:assert/strict";
import worker from "../deepseek-worker.mjs";
import { fakeR2 } from "./fake-r2.mjs";

function setup(initial = {}, pageSize = 200) {
  const bucket = fakeR2(initial, pageSize);
  const env = {
    ALLOWED_ORIGIN: "https://jarvis.example",
    JARVIS_TOKEN: "test-only-vault-token-at-least-32-characters",
    VAULT: bucket, VAULT_PREFIX: "Vault/"
  };
  const call = async (endpoint, method = "GET", data) => {
    const response = await worker.fetch(new Request("https://worker.example" + endpoint, {
      method, headers: {
        Origin: env.ALLOWED_ORIGIN, Authorization: "Bearer " + env.JARVIS_TOKEN,
        ...(data ? { "Content-Type": "application/json" } : {})
      },
      body: data ? JSON.stringify(data) : undefined
    }), env);
    return { status: response.status, body: await response.json() };
  };
  const create = (path, content, extra = {}) => call("/vault/note", "POST", {
    path, content, autoTag: true, autoLink: true, ...extra
  });
  const read = path => call("/vault/note?path=" + encodeURIComponent(path));
  return { bucket, env, call, create, read };
}

test("lists all pages, isolates prefix, and excludes config/binary files", async () => {
  const vault = setup({
    "Vault/Inbox/Note.md": "Hi", "Vault/Work/Circuit.md": "Circuit",
    "Vault/.obsidian/settings.md": "Secret", "Vault/photo.jpg": "Binary",
    "Other/Personal.md": "Other vault"
  }, 2);
  const result = await vault.call("/vault/notes");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.notes.map(note => note.path), ["Inbox/Note.md", "Work/Circuit.md"]);
  assert.equal((await vault.read("Inbox/Note.md")).body.content, "Hi");
});

test("notes work without an AI key; unconfigured binding/prefix fails explicitly", async t => {
  const vault = setup();
  assert.equal((await vault.create("Inbox/Note.md", "Test")).status, 201);
  vault.env.VAULT_PREFIX = "../";
  t.mock.method(console, "error", () => {});
  assert.equal((await vault.call("/vault/notes")).status, 503);
  delete vault.env.VAULT;
  assert.equal((await vault.call("/vault/notes")).status, 503);
});

test("rejects traversal, hidden paths, non-Markdown and link-special paths", async t => {
  const vault = setup();
  t.mock.method(console, "error", () => {});
  for (const path of ["../Secret.md", "/Secret.md", "Inbox/../Secret.md", ".obsidian/file.md",
    "Inbox/.hidden.md", "Inbox\\Note.md", "Inbox/Bad[link].md", "Inbox/a#heading.md",
    "Inbox/a|alias.md", "Inbox/a.txt", "Inbox//Note.md", "Inbox/ Note.md"]) {
    assert.equal((await vault.create(path, "No")).status, 400, path);
  }
  assert.equal(vault.bucket.puts.length, 0);
  assert.equal((await vault.create("Personal/Café.md", "Unicode title")).status, 201);
});

test("creates Markdown with automatic tags/links without changing user frontmatter", async () => {
  const vault = setup({
    "Vault/Business/Grey filament.md": "# Grey filament\nPLA",
    "Vault/Work/Wiring.md": "# Wiring"
  });
  const original = "---\ntags: [existing]\ncustom: keep-me\n---\n# Grey filament\nI prefer grey PLA.\n\n[[Work/Wiring]]";
  const saved = await vault.create("Inbox/Grey filament preference.md", original);
  assert.equal(saved.status, 201);
  assert.ok(saved.body.content.startsWith(original));
  assert.match(saved.body.content, /#jarvis\/business/);
  assert.match(saved.body.content, /\[\[Business\/Grey filament\]\]/);
  assert.deepEqual(saved.body.tags, ["business"]);
  assert.equal(saved.body.folder, "Business");
  const object = vault.bucket.objects.get("Vault/Inbox/Grey filament preference.md");
  assert.ok(Number(object.customMetadata.mtime) > 1000000000);
  assert.equal(object.customMetadata.mtime, object.customMetadata.ctime);
  assert.equal(object.httpMetadata.contentType, "text/markdown; charset=utf-8");
});

test("create never overwrites an existing note, even an empty one", async t => {
  const vault = setup({ "Vault/Inbox/Empty.md": "" });
  t.mock.method(console, "error", () => {});
  const result = await vault.create("Inbox/Empty.md", "Replacement");
  assert.equal(result.status, 409);
  assert.equal(vault.bucket.objects.get("Vault/Inbox/Empty.md").content, "");
});

test("update checks atomic etag at write, preserves timestamps and replaces generated block once", async t => {
  const vault = setup();
  const first = await vault.create("Inbox/Preference.md", "Grey PLA");
  const etag = first.body.etag;
  const ctime = vault.bucket.objects.get("Vault/Inbox/Preference.md").customMetadata.ctime;
  const edit = await vault.call("/vault/note", "PUT", {
    path: first.body.path, etag, content: first.body.content.replace("Grey PLA", "Black PETG"),
    autoTag: true, autoLink: true
  });
  assert.equal(edit.status, 200);
  assert.equal((edit.body.content.match(/jarvis:related:start/g) || []).length, 1);
  assert.equal(vault.bucket.objects.get("Vault/Inbox/Preference.md").customMetadata.ctime, ctime);
  t.mock.method(console, "error", () => {});
  assert.equal((await vault.call("/vault/note", "PUT", {
    path: first.body.path, etag, content: "Stale edit", autoTag: true, autoLink: true
  })).status, 409);
  vault.bucket.beforePut = async key => {
    vault.bucket.beforePut = null;
    vault.bucket.seed(key, "New external sync edit");
  };
  const raced = await vault.call("/vault/note", "PUT", {
    path: edit.body.path, etag: edit.body.etag, content: "My draft", autoTag: false, autoLink: false
  });
  assert.equal(raced.status, 409);
  assert.equal(vault.bucket.objects.get("Vault/Inbox/Preference.md").content, "New external sync edit");
});

test("tagging and linking can be disabled and malformed generated blocks fail safely", async t => {
  const vault = setup({ "Vault/Business/Filament.md": "PLA" });
  const plain = "PLA\n\n[[Manual]]";
  const result = await vault.create("Inbox/Plain.md", plain, { autoTag: false, autoLink: false });
  assert.equal(result.body.content, plain);
  t.mock.method(console, "error", () => {});
  assert.equal((await vault.create("Inbox/Broken.md", "PLA\n<!-- jarvis:related:start -->")).status, 422);
  assert.equal(vault.bucket.objects.has("Vault/Inbox/Broken.md"), false);
});

test("content byte limit and missing notes are explicit errors", async t => {
  const vault = setup({ "Vault/Inbox/Big.md": "x".repeat(65537) });
  t.mock.method(console, "error", () => {});
  assert.equal((await vault.read("Inbox/Missing.md")).status, 404);
  assert.equal((await vault.read("Inbox/Big.md")).status, 413);
  assert.equal((await vault.create("Inbox/BigUnicode.md", "é".repeat(32769))).status, 413);
  assert.equal((await vault.create("Inbox/Null.md", "\u0000")).status, 400);
  assert.equal((await vault.create("Inbox/Limit.md", "x".repeat(65536), { autoTag: false, autoLink: false })).status, 201);
});

test("organizes an Inbox note by area and leaves a readable redirect without deleting", async () => {
  const vault = setup();
  const source = await vault.create("Inbox/Filament.md", "# Filament\nBuy PLA");
  const moved = await vault.call("/vault/organize", "POST", { path: source.body.path, etag: source.body.etag });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.path, "Business/Filament.md");
  assert.equal(moved.body.redirectLeft, true);
  assert.equal(vault.bucket.objects.get("Vault/Business/Filament.md").content, source.body.content);
  const redirect = await vault.read("Inbox/Filament.md");
  assert.equal(redirect.body.redirect, "Business/Filament.md");
  assert.match(redirect.body.content, /\[\[Business\/Filament\]\]/);
  // Simulate the plugin reuploading the redirect without the custom metadata.
  vault.bucket.seed("Vault/Inbox/Filament.md", redirect.body.content);
  assert.equal((await vault.read("Inbox/Filament.md")).body.redirect, "Business/Filament.md");
});

test("unclear folders ask for a choice; explicit folder works; collisions never overwrite", async t => {
  const vault = setup({ "Vault/Personal/Mixed.md": "Keep existing" });
  const source = await vault.create("Inbox/Mixed.md", "Build an app for filament.");
  t.mock.method(console, "error", () => {});
  const data = { path: source.body.path, etag: source.body.etag };
  assert.equal((await vault.call("/vault/organize", "POST", data)).status, 422);
  assert.equal((await vault.call("/vault/organize", "POST", { ...data, folder: "Personal" })).status, 409);
  assert.equal(vault.bucket.objects.get("Vault/Personal/Mixed.md").content, "Keep existing");
  const moved = await vault.call("/vault/organize", "POST", { ...data, folder: "Builds" });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.path, "Builds/Mixed.md");
});

test("move races preserve new source content and explicitly report the created copy", async t => {
  const vault = setup();
  const source = await vault.create("Inbox/Filament.md", "PLA");
  vault.bucket.beforePut = async key => {
    if (key === "Vault/Inbox/Filament.md") {
      vault.bucket.beforePut = null;
      vault.bucket.seed(key, "Latest Obsidian sync edit");
    }
  };
  t.mock.method(console, "error", () => {});
  const result = await vault.call("/vault/organize", "POST", { path: source.body.path, etag: source.body.etag });
  assert.equal(result.status, 409);
  assert.equal(result.body.destination, "Business/Filament.md");
  assert.equal(vault.bucket.objects.get("Vault/Inbox/Filament.md").content, "Latest Obsidian sync edit");
  assert.equal(vault.bucket.objects.get("Vault/Business/Filament.md").content, source.body.content);
});

test("move storage failure after copy reports partial success and preserves source", async t => {
  const vault = setup();
  const source = await vault.create("Inbox/Filament.md", "PLA");
  vault.bucket.beforePut = async key => {
    if (key === "Vault/Inbox/Filament.md") throw new Error("R2 write unavailable");
  };
  t.mock.method(console, "error", () => {});
  const result = await vault.call("/vault/organize", "POST", { path: source.body.path, etag: source.body.etag });
  assert.equal(result.status, 503);
  assert.equal(result.body.destination, "Business/Filament.md");
  assert.equal(vault.bucket.objects.get("Vault/Inbox/Filament.md").content, source.body.content);
  assert.ok(vault.bucket.objects.has("Vault/Business/Filament.md"));
});

test("vault bounds and retrieval failures block AI calls rather than silently falling back", async t => {
  const initial = {};
  for (let i = 0; i < 1001; i++) initial["Vault/Personal/Note-" + i + ".md"] = "Note";
  const vault = setup(initial);
  vault.env.DEEPSEEK_API_KEY = "fake-test-key";
  let calls = 0;
  t.mock.method(globalThis, "fetch", () => { calls++; throw new Error("Must not call AI"); });
  t.mock.method(console, "error", () => {});
  assert.equal((await vault.call("/vault/notes")).status, 413);
  const data = {
    message: "Read my vault", history: [],
    context: { localDate: "Now", timeZone: "UTC", inbox: [], printQueue: [], printCatalog: [] }
  };
  assert.equal((await vault.call("/", "POST", data)).status, 413);
  vault.bucket.list = async () => { throw new Error("Storage unavailable"); };
  assert.equal((await vault.call("/", "POST", data)).status, 502);
  assert.equal(calls, 0);
});

test("AI reads fresh R2 content, reports bounded sources, and never trusts browser vault data", async t => {
  const vault = setup({
    "Vault/Personal/Filament preferences.md": "I prefer grey PLA.",
    "Vault/Inbox/Old.md": "<!-- jarvis:moved -->\n# Moved\n\n[[Personal/Filament preferences]]\n",
    "Vault/Inbox/Too large.md": "x".repeat(65537)
  });
  vault.env.DEEPSEEK_API_KEY = "fake-test-key";
  let forwarded;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    forwarded = JSON.parse(options.body);
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: "Grey PLA (Personal/Filament preferences.md)." } }] });
  });
  const data = {
    message: "What filament do I prefer?", history: [],
    context: { localDate: "2026-10-03", timeZone: "UTC", inbox: [], printQueue: [], printCatalog: [], vault: "fake browser fact" }
  };
  const response = await vault.call("/", "POST", data);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.memory.sources, ["Personal/Filament preferences.md"]);
  assert.deepEqual(response.body.memory.skippedLargeNotes, ["Inbox/Too large.md"]);
  assert.match(forwarded.messages[1].content, /I prefer grey PLA/);
  assert.doesNotMatch(forwarded.messages[1].content, /fake browser fact|jarvis:moved/);
  vault.bucket.seed("Vault/Personal/Filament preferences.md", "Now I prefer black PETG.");
  await vault.call("/", "POST", data);
  assert.match(forwarded.messages[1].content, /Now I prefer black PETG/);
});

test("AI retrieval shows its candidate and excerpt limits instead of claiming full-vault knowledge", async t => {
  const initial = {};
  for (let i = 0; i < 25; i++) initial["Vault/Personal/Filament-" + i + ".md"] = "PLA ".repeat(2000);
  const vault = setup(initial);
  vault.env.DEEPSEEK_API_KEY = "fake-test-key";
  let memory;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    memory = JSON.parse(JSON.parse(options.body).messages[1].content.split("\n").slice(1).join("\n")).vault;
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: "Found notes." } }] });
  });
  const response = await vault.call("/", "POST", {
    message: "Filament", history: [],
    context: { localDate: "Now", timeZone: "UTC", inbox: [], printQueue: [], printCatalog: [] }
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.memory.totalNotes, 25);
  assert.equal(response.body.memory.scannedNotes, 20);
  assert.ok(memory.notes.length <= 8);
  assert.ok(memory.notes.reduce((sum, note) => sum + note.content.length, 0) <= 24000);
  assert.ok(memory.notes.every(note => note.truncated));
});

test("retrieval picks a relevant excerpt beyond the first 6,000 characters", async t => {
  const vault = setup({
    "Vault/Business/Filament preference.md": "# Filament\n" + "Unrelated text. ".repeat(800) +
      "\nMy preferred filament colour is teal PETG.\n"
  });
  vault.env.DEEPSEEK_API_KEY = "fake-test-key";
  let memory;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    memory = JSON.parse(JSON.parse(options.body).messages[1].content.split("\n").slice(1).join("\n")).vault;
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: "Teal PETG." } }] });
  });
  await vault.call("/", "POST", {
    message: "What is my preferred filament colour?", history: [],
    context: { localDate: "Now", timeZone: "UTC", inbox: [], printQueue: [], printCatalog: [] }
  });
  assert.match(memory.notes[0].content, /teal PETG/);
  assert.ok(memory.notes[0].startCharacter > 0);
  assert.equal(memory.notes[0].truncated, true);
});
