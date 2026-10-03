# My Jarvis — Second Brain Assistant | Copilot Instructions

Read this whole file before every task.

## What we're building
A personal "Jarvis" — a SECOND BRAIN + assistant that remembers everything
about my life and helps me run it. It should:
- Remember (my Obsidian vault IS the memory)
- Organize my day and schedule
- Bring things UP to me instead of making me search
- Talk to me and talk back (voice)
- Show me things visually (cards/bubbles I tap and pick)
- Do tasks across ALL areas of my life

## The areas it covers (Electric Boyes is just ONE)
- Work       — I'm an electrician (this is "Electric Boyes")
- Business   — Dynamic Media Print Shop (3D printing; filament inventory)
- Builds     — apps, AI, automation projects
- Personal   — home, hobbies, life, schedules

## Who I am
- Electrician + 3D print shop owner. NOT a professional developer.
- Explain simply. Comment your code.
- I build in the browser (GitHub Codespaces) — my Mac is a mid-2010 and
  can't run modern tools.

## HARD CONSTRAINTS
- PWA: runs in Safari on iPhone, addable to Home Screen.
- Vanilla HTML/CSS/JS. No frameworks/build step unless I ask.
- Mobile-first. Big touch targets.
- Free to host (GitHub Pages / Cloudflare Pages).
- Cheap: no paid services. DeepSeek API only (pennies).
- Output PURE code in code files. Never mix chat text into code.
- Give me complete, working, single-file tools.

## Architecture (the layers)
1. Brain / memory = Obsidian markdown (I own it)
2. Engine         = DeepSeek API
3. Data           = Google Sheets (inventory) + my vault
4. Front door     = this PWA + voice

## The app this repo builds (the Jarvis front end)
- index.html = the Jarvis shell (a home base / dashboard)
- Views:
  - Picker    (cards/bubbles: "show me items" → I tap → they float to a list)
  - Today     (my schedule + reminders)
  - Inventory (Google Sheets)
  - Notes     (quick access to my brain)
- Voice: use the browser Web Speech API where possible
- Data sources (build in order):
  1. localStorage (now)
  2. Google Sheets via published CSV
  3. DeepSeek API
  4. Obsidian vault via export/API later

## Design language
- Dark theme, clean, "Jarvis" feel.
- Cards/bubbles, tap-to-select, selections float into a list.
- Large buttons, readable on a phone. Voice-friendly.

## Behaviors (the soul of it)
- Route by intent: COMMAND → do it; QUESTION → answer from my data;
  IDEA → discuss; UNCLEAR → ask, never guess.
- Organic: when I say "from now on…" it updates its rules.
- Bring things up to me proactively where possible.

## How to help
- One thing at a time. Don't build features I didn't ask for.
- One clean HTML file per tool/view.
- Keep it simple. Vanilla JS. Free libraries only if truly needed.

