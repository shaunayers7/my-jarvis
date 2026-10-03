(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  /* ---------- Storage ---------- */
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(`jarvis:${key}`);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(`jarvis:${key}`, JSON.stringify(value));
      } catch {
        /* storage unavailable (private mode / quota) */
      }
    },
  };

  const state = {
    name: String(store.get('name', '') || ''),
    tasks: [].concat(store.get('tasks', [])).filter((t) => t && typeof t.text === 'string'),
    notes: [].concat(store.get('notes', [])).filter((n) => n && typeof n.text === 'string'),
  };

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /* ---------- Sidebar ---------- */
  const sidebar = $('#sidebar');
  const scrim = $('#scrim');
  const menuBtn = $('#menu-toggle');
  const desktopMQ = window.matchMedia('(min-width: 1024px)');

  function setSidebar(open) {
    sidebar.classList.toggle('open', open);
    scrim.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
    menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    document.body.classList.toggle('no-scroll', open && !desktopMQ.matches);
    if (open && !desktopMQ.matches) sidebar.querySelector('a').focus();
  }

  menuBtn.addEventListener('click', () => setSidebar(!sidebar.classList.contains('open')));
  scrim.addEventListener('click', () => setSidebar(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sidebar.classList.contains('open')) {
      setSidebar(false);
      menuBtn.focus();
    }
  });
  desktopMQ.addEventListener('change', () => setSidebar(false));

  /* ---------- Router ---------- */
  const titles = { home: 'Home', tasks: 'Tasks', notes: 'Notes', calendar: 'Calendar', settings: 'Settings' };

  function route() {
    const name = location.hash.replace(/^#\/?/, '') || 'home';
    const view = Object.prototype.hasOwnProperty.call(titles, name) ? name : 'home';
    $$('.view').forEach((el) => { el.hidden = el.dataset.view !== view; });
    $$('.sidebar__nav a').forEach((a) => {
      if (a.dataset.route === view) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    $('#page-title').textContent = titles[view];
    document.title = `${titles[view]} · Jarvis`;
    if (sidebar.classList.contains('open')) setSidebar(false);
  }
  window.addEventListener('hashchange', route);

  /* ---------- Rendering ---------- */
  function deleteButton(label, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'icon-btn';
    btn.setAttribute('aria-label', label);
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>';
    btn.addEventListener('click', onClick);
    return btn;
  }

  function renderTasks() {
    const list = $('#task-list');
    list.replaceChildren(...state.tasks.map((task) => {
      const li = document.createElement('li');
      li.classList.toggle('done', task.done);
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = task.done;
      cb.setAttribute('aria-label', `Mark "${task.text}" done`);
      cb.addEventListener('change', () => {
        task.done = cb.checked;
        saveTasks();
      });
      const span = document.createElement('span');
      span.textContent = task.text;
      li.append(cb, span, deleteButton(`Delete "${task.text}"`, () => {
        state.tasks = state.tasks.filter((t) => t.id !== task.id);
        saveTasks();
      }));
      return li;
    }));
    $('#task-count').textContent = state.tasks.filter((t) => !t.done).length;
  }

  function noteItem(note) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.textContent = note.text;
    li.append(span, deleteButton('Delete note', () => {
      state.notes = state.notes.filter((n) => n.id !== note.id);
      saveNotes();
    }));
    return li;
  }

  function renderNotes() {
    $('#note-list').replaceChildren(...state.notes.slice(0, 3).map(noteItem));
    $('#all-notes').replaceChildren(...state.notes.map(noteItem));
  }

  function saveTasks() { store.set('tasks', state.tasks); renderTasks(); }
  function saveNotes() { store.set('notes', state.notes); renderNotes(); }

  /* ---------- Dashboard ---------- */
  function updateClock() {
    const now = new Date();
    $('#clock').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    $('#today-date').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
    const h = now.getHours();
    const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
    $('#greeting-text').textContent = state.name ? `${part}, ${state.name}` : part;
  }

  function onSubmit(formSel, inputSel, handler) {
    $(formSel).addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $(inputSel);
      const value = input.value.trim();
      if (!value) return;
      handler(value);
      input.value = '';
    });
  }

  onSubmit('#task-form', '#task-input', (text) => {
    state.tasks.unshift({ id: uid(), text, done: false });
    saveTasks();
  });

  onSubmit('#note-form', '#note-input', (text) => {
    state.notes.unshift({ id: uid(), text, created: Date.now() });
    saveNotes();
  });

  onSubmit('#ask-form', '#ask-input', (text) => {
    $('#ask-reply').textContent = `You asked: “${text}”. The assistant isn't connected yet.`;
  });

  $('#name-input').value = state.name;
  onSubmit('#name-form', '#name-input', (text) => {
    state.name = text;
    store.set('name', text);
    $('#name-input').value = text;
    updateClock();
  });

  /* ---------- Network status ---------- */
  function updateNetStatus() {
    const dot = $('#net-status');
    const online = navigator.onLine;
    dot.classList.toggle('offline', !online);
    dot.title = online ? 'Online' : 'Offline';
    dot.setAttribute('aria-label', dot.title);
  }
  window.addEventListener('online', updateNetStatus);
  window.addEventListener('offline', updateNetStatus);

  /* ---------- Init ---------- */
  route();
  renderTasks();
  renderNotes();
  updateClock();
  updateNetStatus();
  setInterval(updateClock, 15000);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW registration failed:', err));
    });
  }
})();
