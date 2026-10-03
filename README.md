# my-jarvis
a second brain personal assistant

## App shell

Jarvis is an installable Progressive Web App written in vanilla HTML, CSS and JavaScript. There's no build step and no dependencies.

- **Dark theme, mobile-first:** the layout starts with a single column. It switches to two columns at 600px. From 1024px up, the sidebar stays open next to the content.
- **Sidebar:** on mobile it slides in from the hamburger button. You can close it with the scrim, the Esc key, or by picking a page.
- **Home dashboard:** a greeting, an "Ask Jarvis" box (not yet connected to an assistant), a clock, a count of open tasks, and quick notes.
- **Views:** Home, Tasks, Notes, Calendar (placeholder) and Settings. Navigation uses hash routing (`#/tasks`).
- **Offline:** `sw.js` caches the app shell. Tasks, notes and your name are saved in `localStorage`.

### Run locally

Service workers need `http://localhost` or HTTPS, so serve the folder rather than opening the file directly:

```sh
python3 -m http.server 8080
# then open http://localhost:8080
```

### Structure

```
index.html            App shell markup
css/styles.css        Dark, mobile-first styles
js/app.js             Sidebar, routing, dashboard, SW registration
sw.js                 Service worker (offline app shell cache)
manifest.webmanifest  PWA manifest
icons/                App icons (SVG + PNG)
```

When you change shell files, bump `CACHE` in `sw.js` so clients get the new version.
