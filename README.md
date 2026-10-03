# my-jarvis
a second brain personal assistant

## Connecting DeepSeek

DeepSeek is the **AI engine**, not permanent memory. Your **Obsidian Markdown
vault is the primary memory**, synced by Remotely Save to a private Cloudflare
R2 bucket. Jarvis reads and writes those same files through its Worker.
There is no separate personal-notes database. The Worker and vault sync must
be deployed/configured first; nothing is live just by editing this repository.

The app stays vanilla HTML/CSS/JS with no build step. The one additional
server file, [deepseek-worker.mjs](./deepseek-worker.mjs), runs on Cloudflare
Workers so your DeepSeek API key and R2 credentials never appear in browser code.
Cloudflare has free Worker/R2 allowances, **not an unlimited free service**;
R2 may require billing details and charges above the allowance. Use R2 Standard
storage and monitor usage. DeepSeek API usage is still billed by DeepSeek.
The integration uses `deepseek-flash`, thinking disabled, with a
1,000-token answer limit.

### Setup in your browser

1. Create a DeepSeek API key in [DeepSeek's console](https://platform.deepseek.com/api_keys).
   Keep it private; do not paste it into chat, HTML, or GitHub.
2. In the [Cloudflare dashboard](https://dash.cloudflare.com/), open
   **Workers & Pages**, create a Worker named `my-jarvis-ai`, and open its
   code editor. Replace the starter code with the complete contents of
   [deepseek-worker.mjs](./deepseek-worker.mjs), then deploy it.
3. In the Worker's **Settings → Variables and Secrets**, add:
   - `DEEPSEEK_API_KEY` as a **Secret**: your DeepSeek API key.
   - `JARVIS_TOKEN` as a **Secret**: a different, randomly generated
     32–256-character token, without spaces. A password manager's generator
     works. Keep it private too; it authorizes paid AI calls.
   - `ALLOWED_ORIGIN` as a text variable: the exact origin you use to open
     Jarvis, with **no path or trailing slash**. For GitHub Pages this is
     `https://shaunayers7.github.io`, not the `/my-jarvis/` path. For a
     Codespaces preview, use its full HTTPS origin instead. This setup allows
     one origin at a time; change it when moving from preview to your live app.
   - `VAULT_PREFIX` as a text variable: the exact S3 remote prefix configured
     in Remotely Save. Use an empty string for no prefix, or a prefix ending
     in `/`, such as `MyVault/`. This is **not necessarily your vault name**;
     check the actual R2 object keys. Jarvis only accesses that prefix.
   Add an **R2 bucket binding**, variable name `VAULT`, selecting your private
   vault bucket (see below). Apply/deploy settings if Cloudflare prompts you.
4. Open Jarvis through HTTPS, tap **AI**, and enter the Worker's HTTPS URL
   (such as `https://my-jarvis-ai.YOUR-SUBDOMAIN.workers.dev`) and your
   **JARVIS_TOKEN**, not the DeepSeek API key. Tap **Enable AI**.
5. Once vault sync is configured, try `remember I prefer grey PLA`, then
   ask `What filament do I prefer?`. A successful answer reports
   **DeepSeek connected** and the number of vault sources scanned.

The connection token is kept only in tab memory and must be entered again
after a refresh. **Disconnect** clears it and the recent AI conversation.
Only the Worker URL is saved in browser storage. Do not connect to a Worker
you do not own/trust: it receives your token and memory.

## Obsidian sync and Markdown notes

### Connect your iPhone vault to private R2

1. **Back up your vault first.** Keep a separate backup, not just a synced copy.
   Do not run iCloud sync and Remotely Save against the same active vault folder.
   If your vault currently lives in iCloud, back it up and set up a device-local
   Obsidian vault before making Remotely Save its sync method.
2. In Cloudflare R2, create a **private Standard bucket**, for example
   `my-jarvis-vault`. Leave public access / `r2.dev` disabled.
3. Create an R2 S3 credential scoped to **Object Read & Write for this bucket only**.
   Enter the endpoint, bucket, access key and secret **privately in Obsidian**.
   Do not paste them into Jarvis, source files, GitHub or chat.
4. In Obsidian on iPhone, install and enable the **Remotely Save** community
   plugin. Choose S3-compatible storage, your R2 endpoint and bucket.
   Use region `auto` (or `us-east-1`, which R2 aliases to `auto`).
   Enable the plugin's **Bypass CORS** option if required on mobile.
   Check connectivity, then sync.
5. **Do not enable Remotely Save's password/encryption** for this integration:
   the Worker must be able to read real `.md` files. The bucket is private,
   but this is not end-to-end encryption. Exclude secrets and private notes
   you do not want processed by Cloudflare/DeepSeek, preferably using a
   dedicated sync vault/prefix. Do not sync plugin credentials/configuration.
6. Enable the plugin's scheduled automatic sync. On iPhone this works while
   **Obsidian is running/active**, not as an always-on background service.
   Jarvis sees only the latest version already uploaded to R2.
7. Bind the same bucket to the Worker as `VAULT`, and match `VAULT_PREFIX`
   exactly. Verify in R2 that a known note has a readable path such as
   `MyVault/Inbox/Test.md` (or `Inbox/Test.md` with no prefix).
   The prefix must be relative, without hidden segments or `..`.

The Worker has no R2 S3 access key: its private R2 binding supplies access.
The plugin's S3 credential is separate from the Worker's `JARVIS_TOKEN`.
Notes operations work even without a DeepSeek API key.

### Using Notes

- Open [notes.html](./notes.html) through the **Notes** link or dashboard card.
  Connect with your Worker URL and connection token. Because tokens stay only
  in page memory, you enter the token again when switching between Home and Notes.
- Filter the vault by path/title, tap a note, and read or edit its raw Markdown.
  Content is displayed as text, never injected as HTML.
- **New Inbox note** creates a unique proposed path. Change its title/path,
  write Markdown, then save. Existing note paths are read-only; new notes can
  also be created directly in another visible vault folder.
- Automatic area tags use simple keywords and are written as `#jarvis/work`,
  `#jarvis/business`, `#jarvis/builds` or `#jarvis/personal`.
  Related-note links use matching existing note titles, not AI guesses.
  These are editable suggestions, not semantic understanding of the whole vault.
  Each feature can be switched off before saving.
- Generated tags/links live inside a marked Markdown block. Existing frontmatter
  and user-authored links are preserved. Saving updates that block instead of
  adding repeated copies. Manual links are not duplicated.
- **Move from Inbox** uses the suggested area when there is one clear match;
  otherwise it asks you to pick Work, Business, Builds or Personal. Save your
  draft before moving. The content goes to the destination folder, and a small
  Markdown redirect remains at the old path to preserve existing links.
  Folder names are currently fixed to these four areas and `Inbox`.
- Sync Obsidian **before and after** editing in Jarvis. Avoid editing the
  same note in both apps at once. New R2 writes include the `mtime`/`ctime`
  metadata Remotely Save expects, in seconds.

### Reliability and existing local data

Every edit supplies the version (`etag`) it opened; R2 checks that version
atomically when writing. New notes cannot overwrite existing files. A stale
edit is rejected and the draft stays in the editor for you to copy/merge.
These checks protect Jarvis writes, but cannot prevent a sync client from
overwriting a note later according to its own conflict policy. Keep backups.

R2 has no atomic file rename/conditional delete through its Worker binding.
Moves therefore copy the content without overwriting a destination and then
conditionally replace the Inbox source with a redirect—**never delete it**.
If the source changes during the move, Jarvis leaves it intact, reports the
destination copy, and asks you to compare both. A move is two writes, not a
transaction. Network failures are reported as unconfirmed, not as guaranteed
failures: check the vault list before retrying. No automatic write retries run.

Home's `remember ...`, `note ...`, `remind me ...`, `add ...` and `dump ...`
commands now write Markdown into the vault's `Inbox/`. They do **not** save
personal notes into localStorage if the vault is disconnected.
The old [inbox.html](./inbox.html) is a **legacy task view**: existing local
items are preserved, new capture is disabled, and it links to vault Notes.
No old data is silently migrated or erased. Copy any legacy items you want
in Obsidian into new vault notes; delete the legacy item only after checking
the saved note. Today still shows the legacy appointments and local print queue,
not parsed appointments from the vault. New notes do not schedule notifications.

### What is sent and remembered

- AI questions send your prompt, legacy task Inbox, print queue, sample print
  catalog, local date/time zone and up to six recent AI exchanges to the Worker.
  The Worker reads the current R2 vault and adds selected note excerpts before
  calling DeepSeek. Do not sync/send information you do not want processed.
- There is no embedding database or duplicated notes index. Each AI question
  considers up to 20 title-matched/recent notes, ranks their content with simple
  keyword matching, then sends up to 8 relevant excerpts (6,000 characters per
  excerpt, 24,000 total). Excerpts can come from later in a note, not just its
  opening. Large notes are skipped and reported. Coverage/source counts
  are returned to the app, and Jarvis is instructed to cite note paths.
  This is a bounded lightweight lookup, **not a full-vault or semantic search**.
- AI history stays in this tab and is not saved across reloads. Long-term
  facts must be explicitly saved with `remember ...` or entered in vault Notes.
- Explicit local commands still work without AI: `show me my prints`,
  `what's on today` (legacy task view), and greetings. Picker selection stays
  local. `inbox` reads the vault Inbox; capture commands require the Worker/R2
  connection but do not call DeepSeek.
  More specific questions and idea discussions go to DeepSeek instead of
  being intercepted just because they contain words like "print" or "today".
- AI chat can answer and discuss, not perform background tasks or independently
  edit your data. Explicit capture/Notes controls perform the Markdown writes.
  Saving an appointment does **not** schedule a notification. The print
  catalog is sample data, not inventory; undated appointments are not proof
  that something is due today.
- Failures are shown explicitly and your message is returned to the input
  when it is still empty. There are no automatic retries or hidden paid calls.
  Limits: 4,000 characters per chat message, 500 legacy tasks/queue/catalog
  entries per list, 200 KB request body, and 64 KB per edited Markdown note.
  Vault listing supports up to 1,000 visible `.md` notes or 10 listing pages;
  larger vaults need a smaller dedicated sync prefix. Hidden paths, binary
  files and filenames with special Obsidian link characters are excluded.
  Oversized notes cannot be edited; retrieval excerpt limits are explicitly reported.

For deployment from Codespaces instead, [wrangler.toml](./wrangler.toml)
contains the Worker configuration. Set its `ALLOWED_ORIGIN`, `VAULT_PREFIX`
and R2 bucket name (create that private bucket first), then use
`npx wrangler login`, `npx wrangler deploy`,
`npx wrangler secret put DEEPSEEK_API_KEY`, and
`npx wrangler secret put JARVIS_TOKEN`. Enter secrets only at the private CLI
prompts. Local secret files are excluded by [.gitignore](./.gitignore).

### Check the connection

Run the focused tests in Codespaces:

```sh
node --test tests/deepseek-worker.test.mjs tests/deepseek-ui.test.mjs tests/vault-worker.test.mjs tests/notes-ui.test.mjs
```

Tests use fake R2 data and mocked API responses, never a real key or paid call.
They cover authentication, CORS, versioned Markdown writes, tags/links,
folder moves and sync races, retrieval limits, note drafts and conversation.
For a live check on iPhone:

1. Sync a known Obsidian note, then open it in Jarvis Notes.
2. Create a note in Jarvis; sync Obsidian and verify its content/tags/links.
3. Edit it in Obsidian and sync; reopen it in Jarvis and verify the change.
4. Open it in Jarvis, edit it in Obsidian and sync, then try saving the old
   Jarvis draft: it must report a conflict and keep the draft.
5. Move a test Inbox note; sync and verify both the destination and old redirect.
6. Ask AI a question about a synced fact and check its cited source.
7. Disconnect; verify notes fail visibly while the local Picker still works.

API reference: [DeepSeek API](https://api-docs.deepseek.com/) and
[Cloudflare Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
Sync references: [Remotely Save R2 setup](https://github.com/remotely-save/remotely-save/blob/master/docs/remote_services/s3_cloudflare_r2/README.md),
[R2 Worker API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/) and
[R2 pricing/free allowance](https://developers.cloudflare.com/r2/pricing/).

## Picking prints

- Ask "show me my prints" on the home screen, or open the Picker.
- Suggestions stay centered in one readable column, with space between cards.
- Tap to highlight your picks. Each tap restarts a 3-second pause; unselected
  cards then fade out and your picks glide to the top in their original screen
  order, without crossing. The saved list still remembers your selection order.
- You can also say "done" in the conversation or tap Done in the Picker.
  Typing in the conversation holds the timer so it does not interrupt you.
- Tap a remaining card to choose your first task and save the list.
- Today shows the saved list in one column on phones and adds columns when
  the screen has enough room. Long lists scroll instead of shrinking the text.

## Conversation and motion

- The conversation shows Jarvis's responses only, not copies of your prompts.
- Separate cards appear from top to bottom, with no enclosing box. Each card
  gently rises and fades in over 700ms, starting 180ms after the previous card.
  Cards become tappable once their entrance finishes.
  Long suggestion lists scroll inside the card area instead of overflowing.
- Unpicked cards fade out over 500ms; selected cards stay visible and gently
  glide to the top over 900ms. They never fade out and reappear.
- The card area stays steady while the picks move. Jarvis reserves
  space for each response before typing it, so text does not push the screen
  around on every letter. Long replies reveal multiple characters per tick
  so typing finishes in about four seconds instead of blocking input for minutes.
- The iPhone/iPad Reduce Motion setting disables movement and typing effects.
- Motion follows [Apple's guidance](https://developer.apple.com/design/human-interface-guidelines/motion)
  and [web.dev's animation guidance](https://web.dev/articles/animations-guide).
  No animation libraries or build step are needed.
