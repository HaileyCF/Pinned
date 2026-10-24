import { SoonestStrategy, WeightedStrategy, ValidationError } from './core.js';
import { tracker, initAuth, setItems, initNotify } from './web.js';
import { el, COLOURS, NoteRenderer, Toast, resizeImage, toLocalInput } from './ui.js';

const service = tracker.service;
const $ = (id) => document.getElementById(id);
const toast = new Toast($('toast'));

const STRATEGIES = {
  soonest: { label: 'Soonest first', make: () => new SoonestStrategy() },
  worth: { label: 'Worth the most, with the most left to do', make: () => new WeightedStrategy() },
};
const state = { kind: null, course: null, sort: 'soonest' };

/* ---------- Month calendar ---------- */

class MiniCalendar {
  constructor(host, onPick) {
    this.host = host;
    this.onPick = onPick;
    this.cursor = new Date();
    this.cursor.setDate(1);
  }
  shift(n) { this.cursor.setMonth(this.cursor.getMonth() + n); }

  render(items, now) {
    const y = this.cursor.getFullYear();
    const m = this.cursor.getMonth();
    const lead = (new Date(y, m, 1).getDay() + 6) % 7; // weeks start on Monday
    const days = new Date(y, m + 1, 0).getDate();
    const byDay = new Map();
    for (const i of items) {
      const d = i.dueDate;
      if (d.getFullYear() === y && d.getMonth() === m) {
        if (!byDay.has(d.getDate())) byDay.set(d.getDate(), []);
        byDay.get(d.getDate()).push(i);
      }
    }
    const cells = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((c) => el('span', { class: 'dow', text: c, 'aria-hidden': 'true' }));
    for (let i = 0; i < lead; i++) cells.push(el('span'));
    for (let day = 1; day <= days; day++) {
      const isToday = now.getFullYear() === y && now.getMonth() === m && now.getDate() === day;
      const hit = byDay.get(day);
      if (hit) {
        hit.sort((a, b) => a.dueDate - b.dueDate);
        cells.push(el('button', {
          type: 'button', class: `u-${hit[0].urgency(now)}${isToday ? ' today' : ''}`, text: String(day),
          'aria-label': `${day} ${this.cursor.toLocaleString('en-AU', { month: 'long' })}: ${hit.map((h) => h.title).join(', ')}`,
          onclick: () => this.onPick(hit[0].id),
        }));
      } else {
        cells.push(el('span', { class: isToday ? 'today' : '', text: String(day) }));
      }
    }
    this.host.replaceChildren(
      el('div', { class: 'cal-head' },
        el('h2', { text: this.cursor.toLocaleString('en-AU', { month: 'long', year: 'numeric' }) }),
        el('div', {},
          el('button', { type: 'button', 'aria-label': 'Previous month', text: '<', onclick: () => { this.shift(-1); refresh(); } }),
          ' ',
          el('button', { type: 'button', 'aria-label': 'Next month', text: '>', onclick: () => { this.shift(1); refresh(); } }))),
      el('div', { class: 'cal-grid' }, cells),
    );
  }
}

/* ---------- Editor dialog ---------- */

class Editor {
  constructor() {
    this.dlg = $('editor');
    this.form = $('form');
    this.item = null;
    this.steps = [];
    this.photos = [];

    $('swatches').replaceChildren(...['auto', ...COLOURS].map((c) =>
      el('label', { title: c === 'auto' ? 'Pick one for me' : c },
        el('input', { type: 'radio', name: 'colour', value: c }),
        el('span', { style: c === 'auto' ? '--s:var(--paper)' : `--s:var(--${c})`, text: c === 'auto' ? 'A' : '' }))));

    this.form.addEventListener('submit', (e) => this.save(e));
    this.form.elements.kind.forEach((r) => r.addEventListener('change', () => this.syncKind()));
    $('cancel').addEventListener('click', () => this.dlg.close());
    $('addStep').addEventListener('click', () => { this.steps.push({ title: '', done: false, priority: 'medium' }); this.drawSteps(true); });
    $('addPhotos').addEventListener('click', () => $('photoInput').click());
    $('photoInput').addEventListener('change', async (e) => {
      for (const f of e.target.files) {
        try { this.photos.push(await resizeImage(f)); } catch (err) { $('err').textContent = err.message; }
      }
      e.target.value = '';
      this.drawPhotos();
    });
  }

  syncKind() {
    const exam = this.form.elements.kind.value === 'Exam';
    $('whereLabel').textContent = exam ? 'Where' : 'Hand in via';
    $('whereInput').placeholder = exam ? 'Room, building or link' : 'Moodle, Canvas, email';
    $('durationField').hidden = !exam;
  }

  drawSteps(focusLast = false) {
    $('stepRows').replaceChildren(...this.steps.map((s, i) => el('div', { class: 'steprow' },
      el('input', { value: s.title, placeholder: 'e.g. Do the 2023 past paper', 'aria-label': `Step ${i + 1}`, oninput: (e) => { s.title = e.target.value; } }),
      el('select', { 'aria-label': `Priority for step ${i + 1}`, onchange: (e) => { s.priority = e.target.value; } },
        ['high', 'medium', 'low'].map((p) => el('option', { value: p, text: p, selected: p === s.priority }))),
      el('button', { type: 'button', 'aria-label': `Remove step ${i + 1}`, text: 'x', onclick: () => { this.steps.splice(i, 1); this.drawSteps(); } }))));
    if (focusLast) $('stepRows').querySelector('.steprow:last-child input')?.focus();
  }

  drawPhotos() {
    $('thumbs').replaceChildren(...this.photos.map((src, i) => el('div', { class: 'thumb' },
      el('img', { src, alt: `Photo ${i + 1}` }),
      el('button', { type: 'button', 'aria-label': `Remove photo ${i + 1}`, text: 'x', onclick: () => { this.photos.splice(i, 1); this.drawPhotos(); } }))));
  }

  async open(item = null) {
    this.item = item;
    const f = this.form.elements;
    this.form.reset();
    $('editorTitle').textContent = item ? 'Edit note' : 'New note';
    $('err').textContent = '';
    $('warn').textContent = '';
    const all = await service.list();
    $('courseList').replaceChildren(...[...new Set(all.map((i) => i.course))].map((c) => el('option', { value: c })));

    if (item) {
      f.kind.value = item.kind;
      f.course.value = item.course;
      f.title.value = item.title;
      f.due.value = item.due;
      f.where.value = item.where;
      f.weighting.value = item.weighting || '';
      f.durationMins.value = item.durationMins || '';
      f.notes.value = item.notes;
      f.colour.value = item.colour || 'auto';
    } else {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      f.due.value = toLocalInput(d);
      f.colour.value = 'auto';
    }
    this.steps = item ? item.subtasks.map((s) => ({ ...s })) : [];
    this.photos = item ? [...item.photos] : [];
    this.syncKind();
    this.drawSteps();
    this.drawPhotos();
    this.dlg.showModal();
    f.course.focus();
  }

  async save(e) {
    e.preventDefault();
    const f = this.form.elements;
    const data = {
      kind: f.kind.value,
      course: f.course.value.trim(),
      title: f.title.value.trim(),
      due: f.due.value,
      where: f.where.value.trim(),
      weighting: f.weighting.value,
      durationMins: f.durationMins.value,
      notes: f.notes.value.trim(),
      colour: f.colour.value === 'auto' ? '' : f.colour.value,
      subtasks: this.steps.filter((s) => s.title.trim()).map((s) => ({ ...s, title: s.title.trim() })),
      photos: this.photos,
    };
    try {
      const clash = await service.findClash(data, this.item?.id);
      if (this.item) await service.update(this.item.id, data); else await service.add(data);
      this.dlg.close();
      await refresh();
      toast.show(clash ? `Saved. Heads up: it overlaps with \u201c${clash.title}\u201d.` : 'Saved.');
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      $('err').textContent = err.message;
    }
  }
}

/* ---------- Layout ---------- */

// Shortest-column-first masonry. CSS multi-column was dropped because it splits rotated notes across columns.
function masonry(host, notes) {
  const n = Math.max(1, Math.min(3, notes.length, Math.floor((host.clientWidth || 900) / 270)));
  const cols = Array.from({ length: n }, () => el('div', { class: 'col' }));
  host.replaceChildren(...cols);
  const heights = new Array(n).fill(0);
  for (const note of notes) {
    const k = heights.indexOf(Math.min(...heights));
    cols[k].append(note);
    heights[k] += note.offsetHeight + 40;
  }
}

/* ---------- Page ---------- */

const editor = new Editor();
const calendar = new MiniCalendar($('cal'), (id) => {
  const node = document.querySelector(`.note[data-id="${id}"]`);
  if (!node) return;
  node.scrollIntoView({ behavior: 'smooth', block: 'center' });
  node.classList.remove('flash');
  void node.offsetWidth; // restart the wobble if it was already running
  node.classList.add('flash');
});

const handlers = {
  toggle: async (itemId, stepId, li) => {
    li.classList.toggle('done'); // responds to the tap; the board redraws once storage settles
    await service.toggleStep(itemId, stepId);
  },
  edit: (item) => editor.open(item),
  remove: async (id) => {
    const removed = await service.remove(id);
    await refresh();
    if (removed) {
      toast.show(`Took down \u201c${removed.title}\u201d.`, 'Undo', async () => { await service.restore(removed); refresh(); });
    }
  },
  photo: (src) => { $('lightImg').src = src; $('lightbox').showModal(); },
};

function pill(label, pressed, onclick) {
  return el('button', { type: 'button', class: 'pill', 'aria-pressed': String(pressed), text: label, onclick });
}

function renderFilters(upcoming) {
  const count = (fn) => upcoming.filter(fn).length;
  const courses = [...new Set(upcoming.map((i) => i.course))].sort();
  const set = (patch) => () => { Object.assign(state, patch); refresh(); };
  const none = state.kind === null && state.course === null;

  const sort = el('label', { class: 'sort' }, 'Order:',
    el('select', { onchange: (e) => { state.sort = e.target.value; refresh(); } },
      Object.entries(STRATEGIES).map(([k, s]) => el('option', { value: k, text: s.label, selected: k === state.sort }))));

  $('filters').replaceChildren(
    pill(`Everything (${upcoming.length})`, none, set({ kind: null, course: null })),
    pill(`Exams (${count((i) => i.kind === 'Exam')})`, state.kind === 'Exam', set({ kind: 'Exam', course: null })),
    pill(`Assignments (${count((i) => i.kind === 'Assignment')})`, state.kind === 'Assignment', set({ kind: 'Assignment', course: null })),
    ...courses.map((c) => pill(`${c} (${count((i) => i.course === c)})`, state.course === c, set({ course: c, kind: null }))),
    sort,
  );
}

function renderLede(upcoming, now) {
  const week = upcoming.filter((i) => i.daysLeft(now) <= 7);
  const next = upcoming[0];
  $('lede').textContent = !next
    ? 'Nothing pinned yet. Stick your first note up.'
    : week.length === 0
      ? `Nothing in the next 7 days. Next up is ${next.title} for ${next.course}, ${next.countdownLabel(now)}.`
      : `${week.length} due in the next 7 days. First is ${next.title} for ${next.course}, ${next.countdownLabel(now)}.`;
}

function renderTodo(upcoming, now) {
  const rows = tracker.priority.topSteps(upcoming, 6, now);
  $('todo').replaceChildren(
    el('h2', { text: 'Tick these off first' }),
    rows.length === 0
      ? el('p', { class: 'hand', text: 'No open steps. Add steps to a note and the most pressing ones land here.' })
      : el('ul', { class: 'steps' }, rows.map(({ item, step }) => el('li', { class: `step${step.done ? ' done' : ''}` },
        el('button', {
          class: 'tick', type: 'button', 'aria-pressed': 'false', 'aria-label': `Tick off: ${step.title}`,
          onclick: (e) => handlers.toggle(item.id, step.id, e.currentTarget.closest('li')),
        }),
        el('span', { class: 'step-text' }, step.title, el('small', { text: `${item.course}, ${item.countdownLabel(now)}` })),
        step.priority === 'high' && el('span', { class: 'bang', text: '!', title: 'High priority' })))),
  );
}

async function refresh() {
  const now = new Date();
  const all = (await service.list()).filter((i) => i.hasValidDate);
  setItems(all);
  const upcoming = all.filter((i) => !i.isPast(now));
  const past = all.filter((i) => i.isPast(now)).sort((a, b) => b.dueDate - a.dueDate);

  // A filter that no longer matches anything (e.g. its last note was taken down) quietly resets.
  if (state.course && !upcoming.some((i) => i.course === state.course)) state.course = null;
  if (state.kind && !upcoming.some((i) => i.kind === state.kind)) state.kind = null;

  tracker.priority.setStrategy(STRATEGIES[state.sort].make());
  const sortedByDate = [...upcoming].sort((a, b) => a.dueDate - b.dueDate);
  const visible = tracker.priority.rank(
    upcoming.filter((i) => (!state.kind || i.kind === state.kind) && (!state.course || i.course === state.course)), now);

  renderLede(sortedByDate, now);
  renderFilters(upcoming);
  renderTodo(upcoming, now);
  calendar.render(upcoming, now);

  const [first, ...rest] = visible;
  $('hero').replaceChildren(first
    ? new NoteRenderer(handlers, { hero: true }).render(first)
    : el('div', { class: 'empty' },
      el('p', { text: upcoming.length ? 'Nothing matches that filter.' : 'The wall is empty. Pin your first exam or assignment.' }),
      el('button', { class: 'block', type: 'button', text: 'Pin a new note', onclick: () => editor.open() })));

  const renderer = new NoteRenderer(handlers);
  masonry($('board'), rest.map((i) => renderer.render(i)));

  $('pastWrap').hidden = past.length === 0;
  $('pastTitle').textContent = `Done and dusted (${past.length})`;
  masonry($('past'), past.map((i) => renderer.render(i)));
}

$('add').addEventListener('click', () => editor.open());
$('lightbox').addEventListener('click', () => $('lightbox').close());

$('export').addEventListener('click', async () => {
  const url = URL.createObjectURL(new Blob([await service.exportData()], { type: 'application/json' }));
  const a = el('a', { href: url, download: `pinned-backup-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$('import').addEventListener('click', () => $('importFile').click());
$('importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const n = await service.importData(await file.text());
    await refresh();
    toast.show(`Loaded ${n} note${n === 1 ? '' : 's'} from the backup.`);
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    toast.show(err.message);
  }
});

$('pastWrap').addEventListener('toggle', () => refresh());
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(refresh, 250); });

// Redraw shortly after any change (replaces the extension's chrome.storage listener).
let timer;
tracker.bus.on('updated', () => { clearTimeout(timer); timer = setTimeout(refresh, 450); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('appRoot').hidden) refresh(); });

// Anything that fails (offline, session expired) shows a message instead of failing silently.
window.addEventListener('unhandledrejection', (e) => {
  e.preventDefault();
  toast.show(`Something went wrong: ${(e.reason && e.reason.message) || 'please try again'}`);
});

$('lede').textContent = 'Loading your notes…';
initNotify();
initAuth((user) => {
  if (user) { $('lede').textContent = 'Loading your notes…'; refresh(); }
  else { $('hero').replaceChildren(); $('board').replaceChildren(); $('past').replaceChildren(); }
});
