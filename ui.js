// Shared UI helpers. Everything is built with textContent, never innerHTML, so typed text can't inject markup.

export const COLOURS = ['butter', 'peach', 'sky', 'sage', 'lilac', 'paper'];

export const hash = (s) => {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h;
};

export const colourFor = (item) =>
  COLOURS.includes(item.colour) ? item.colour : COLOURS[hash(item.course.toLowerCase()) % COLOURS.length];

export function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) n.append(kid);
  return n;
}

export function fmtWhen(item) {
  return item.dueDate.toLocaleString('en-AU', {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
}

export const pad = (n) => String(n).padStart(2, '0');
export const toLocalInput = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function resizeImage(file, max = 900) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}

export class Toast {
  constructor(host) { this.host = host; this.timer = null; }
  show(message, actionLabel, onAction) {
    clearTimeout(this.timer);
    this.host.replaceChildren(
      el('span', { text: message }),
      actionLabel && el('button', { type: 'button', text: actionLabel, onclick: () => { onAction(); this.hide(); } }),
    );
    this.host.hidden = false;
    this.timer = setTimeout(() => this.hide(), 6000);
  }
  hide() { this.host.hidden = true; }
}

// handlers: { toggle(itemId, stepId, li), edit(item), remove(id), photo(src) }
export class NoteRenderer {
  constructor(handlers = {}, { compact = false, hero = false } = {}) {
    this.on = handlers;
    this.compact = compact;
    this.hero = hero;
  }

  stepRow(item, s) {
    return el('li', { class: `step${s.done ? ' done' : ''}` },
      el('button', {
        class: 'tick', type: 'button', 'aria-pressed': String(s.done), 'aria-label': `Tick off: ${s.title}`,
        onclick: (e) => this.on.toggle?.(item.id, s.id, e.currentTarget.closest('li')),
      }),
      el('span', { class: 'step-text', text: s.title }),
      s.priority === 'high' && el('span', { class: 'bang', text: '!', title: 'High priority' }),
    );
  }

  render(item) {
    const now = new Date();
    const colour = colourFor(item);
    const tilt = ((hash(item.id) % 50) - 25) / 10;
    const tape = (hash(`${item.id}t`) % 30) - 15;
    const { done, total } = item.progress();
    const steps = this.compact ? item.subtasks.slice(0, 3) : item.subtasks;
    const hidden = item.subtasks.length - steps.length;

    return el('article', {
      class: `note c-${colour} u-${item.urgency(now)}${this.compact ? ' compact' : ''}${this.hero ? ' hero' : ''}`,
      style: `--tilt:${tilt}deg;--tape:${tape}deg`,
      'data-id': item.id,
    },
      el('i', { class: 'tape', 'aria-hidden': 'true' }),
      el('div', { class: 'stamp', text: item.countdownLabel(now) }),
      el('p', { class: 'course' }, el('span', { class: 'kind', text: item.kind }), item.course),
      el('h3', { text: item.title }),
      el('p', { class: 'when', text: fmtWhen(item) }),
      !this.compact && item.where && el('p', { class: 'where', text: `${item.whereLabel}: ${item.where}` }),
      !this.compact && item.weighting > 0 && el('p', { class: 'where', text: `Worth ${item.weighting}% of your grade` }),
      steps.length > 0 && el('ul', { class: 'steps' }, steps.map((s) => this.stepRow(item, s))),
      hidden > 0 && el('p', { class: 'hand more', text: `and ${hidden} more on the board` }),
      total > 0 && el('p', { class: 'tally', style: `--p:${Math.round((done / total) * 100)}%`, text: `${done} of ${total} ticked` }),
      !this.compact && item.notes && el('p', { class: 'scrawl', text: item.notes }),
      !this.compact && item.photos.length > 0 && el('div', { class: 'snaps' },
        item.photos.slice(0, 4).map((src, i) => el('img', {
          class: 'snap', src, alt: `Photo ${i + 1} for ${item.title}`, tabindex: '0',
          style: `--r:${((hash(src.slice(-40) + i) % 90) - 45) / 10}deg`,
          onclick: () => this.on.photo?.(src),
          onkeydown: (e) => { if (e.key === 'Enter') this.on.photo?.(src); },
        }))),
      !this.compact && el('div', { class: 'actions' },
        el('button', { type: 'button', class: 'link', text: 'Edit', onclick: () => this.on.edit?.(item) }),
        el('button', { type: 'button', class: 'link', text: 'Take down', onclick: () => this.on.remove?.(item.id) }),
        el('span', { class: 'added', text: `added ${new Date(item.createdAt).toLocaleDateString('en-AU')}` }),
      ),
    );
  }
}
