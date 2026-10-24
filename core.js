// Pinned core: models, storage, repository and services.
// No DOM code lives here, so the popup, the board and the background worker can all import it.

export const Priority = Object.freeze({ HIGH: 'high', MEDIUM: 'medium', LOW: 'low' });
const PRIORITY_WEIGHT = { high: 3, medium: 2, low: 1 };
const HOUR = 36e5;
const DAY = 864e5;

export class ValidationError extends Error {}

/* ---------- Events ---------- */

export class EventBus {
  #handlers = new Map();
  on(event, fn) {
    if (!this.#handlers.has(event)) this.#handlers.set(event, new Set());
    this.#handlers.get(event).add(fn);
    return () => this.#handlers.get(event)?.delete(fn);
  }
  emit(event, data) {
    this.#handlers.get(event)?.forEach((fn) => fn(data));
  }
}

/* ---------- Models ---------- */

export class BaseEntity {
  constructor({ id, createdAt, updatedAt } = {}) {
    this.id = id ?? crypto.randomUUID();
    this.createdAt = createdAt ?? new Date().toISOString();
    this.updatedAt = updatedAt ?? this.createdAt;
  }
  touch() {
    this.updatedAt = new Date().toISOString();
    return this;
  }
  toJSON() {
    return { ...this };
  }
}

export class Subtask extends BaseEntity {
  constructor(d = {}) {
    super(d);
    this.title = d.title ?? '';
    this.done = Boolean(d.done);
    this.priority = PRIORITY_WEIGHT[d.priority] ? d.priority : Priority.MEDIUM;
  }
  toggle() {
    this.done = !this.done;
    return this.touch();
  }
}

// Abstract: use Exam or Assignment.
export class Assessment extends BaseEntity {
  constructor(d = {}) {
    super(d);
    if (new.target === Assessment) throw new Error('Assessment is abstract. Use Exam or Assignment.');
    this.kind = new.target.kind;
    this.course = d.course ?? '';
    this.colour = d.colour ?? '';
    this.title = d.title ?? '';
    this.due = d.due ?? ''; // local time, "YYYY-MM-DDTHH:mm"
    this.where = d.where ?? '';
    this.weighting = Number(d.weighting) || 0;
    this.notes = d.notes ?? '';
    this.subtasks = (d.subtasks ?? []).map((s) => (s instanceof Subtask ? s : new Subtask(s)));
    this.photos = d.photos ?? [];
  }

  get dueDate() { return new Date(this.due); }
  get hasValidDate() { return !Number.isNaN(this.dueDate.getTime()); }
  get whereLabel() { return 'Where'; }
  get pastLabel() { return 'finished'; }
  reminderOffsets() { return []; }

  msLeft(now = new Date()) { return this.dueDate - now; }
  isPast(now = new Date()) { return this.msLeft(now) < 0; }

  daysLeft(now = new Date()) {
    const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const d = this.dueDate;
    const b = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return Math.round((b - a) / DAY);
  }

  urgency(now = new Date()) {
    if (this.isPast(now)) return 'past';
    const d = this.daysLeft(now);
    return d <= 2 ? 'hot' : d <= 7 ? 'soon' : 'calm';
  }

  countdownLabel(now = new Date()) {
    if (this.isPast(now)) return this.pastLabel;
    const d = this.daysLeft(now);
    if (d === 0) return 'today';
    if (d === 1) return 'tomorrow';
    if (d < 14) return `in ${d} days`;
    return `in ${Math.round(d / 7)} weeks`;
  }

  openSteps() { return this.subtasks.filter((s) => !s.done); }
  progress() {
    return { done: this.subtasks.filter((s) => s.done).length, total: this.subtasks.length };
  }
}

export class Exam extends Assessment {
  static kind = 'Exam';
  constructor(d = {}) {
    super(d);
    this.durationMins = Number(d.durationMins) || 0;
  }
  reminderOffsets() {
    return [
      { key: 'week', ms: 7 * DAY, phrase: 'is a week away' },
      { key: 'day', ms: DAY, phrase: 'is tomorrow' },
      { key: 'hours', ms: 2 * HOUR, phrase: 'starts in 2 hours' },
    ];
  }
}

export class Assignment extends Assessment {
  static kind = 'Assignment';
  get whereLabel() { return 'Hand in via'; }
  get pastLabel() { return 'past due'; }
  reminderOffsets() {
    return [
      { key: 'three', ms: 3 * DAY, phrase: 'is due in 3 days' },
      { key: 'day', ms: DAY, phrase: 'is due tomorrow' },
      { key: 'hours', ms: 3 * HOUR, phrase: 'is due in 3 hours' },
    ];
  }
}

export class AssessmentFactory {
  static create(d) {
    return d.kind === 'Assignment' ? new Assignment(d) : new Exam(d);
  }
}

/* ---------- Storage ---------- */

export class StorageAdapter {
  async get() { throw new Error('Not implemented'); }
  async set() { throw new Error('Not implemented'); }
}

export class ChromeLocalAdapter extends StorageAdapter {
  async get(key, fallback) {
    const result = await chrome.storage.local.get(key);
    return result[key] ?? fallback;
  }
  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  }
}

export class MemoryAdapter extends StorageAdapter {
  #data = new Map();
  async get(key, fallback) { return this.#data.has(key) ? structuredClone(this.#data.get(key)) : fallback; }
  async set(key, value) { this.#data.set(key, structuredClone(value)); }
}

export class AssessmentRepository {
  static KEY = 'assessments';
  constructor(adapter) { this.adapter = adapter; }

  async getAll() {
    const raw = await this.adapter.get(AssessmentRepository.KEY, []);
    return raw.map((r) => AssessmentFactory.create(r));
  }
  async getById(id) { return (await this.getAll()).find((i) => i.id === id) ?? null; }
  async replaceAll(list) {
    await this.adapter.set(AssessmentRepository.KEY, JSON.parse(JSON.stringify(list)));
  }
  async save(item) {
    const list = await this.getAll();
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = item; else list.push(item);
    await this.replaceAll(list);
  }
  async remove(id) {
    const list = await this.getAll();
    await this.replaceAll(list.filter((i) => i.id !== id));
  }
}

/* ---------- Prioritising (strategy pattern) ---------- */

export class PriorityStrategy {
  score() { throw new Error('Not implemented'); }
}
export class SoonestStrategy extends PriorityStrategy {
  score(item, now) { return -item.msLeft(now); }
}
export class WeightedStrategy extends PriorityStrategy {
  // Bigger weighting and more unfinished steps push a note up. Closer dates push harder.
  score(item, now) {
    const days = Math.max(item.daysLeft(now), 0);
    return ((item.weighting || 10) * (1 + item.openSteps().length)) / (days + 1);
  }
}

export class PriorityService {
  constructor(strategy = new SoonestStrategy()) { this.strategy = strategy; }
  setStrategy(strategy) { this.strategy = strategy; }
  rank(items, now = new Date()) {
    return [...items].sort((a, b) => this.strategy.score(b, now) - this.strategy.score(a, now));
  }
  topSteps(items, limit = 6, now = new Date()) {
    const rows = [];
    for (const item of items) {
      if (item.isPast(now)) continue;
      const days = Math.max(item.daysLeft(now), 0);
      for (const step of item.openSteps()) {
        rows.push({ item, step, score: (PRIORITY_WEIGHT[step.priority] * 4) / (days + 1) });
      }
    }
    return rows.sort((a, b) => b.score - a.score).slice(0, limit);
  }
}

/* ---------- Main service ---------- */

export class AssessmentService {
  constructor(repo, bus = new EventBus()) {
    this.repo = repo;
    this.bus = bus;
  }

  list() { return this.repo.getAll(); }

  validate(d) {
    if (!String(d.course ?? '').trim()) throw new ValidationError('Add the course name.');
    if (!String(d.title ?? '').trim()) throw new ValidationError('Give the note a title.');
    if (!d.due || Number.isNaN(new Date(d.due).getTime())) throw new ValidationError('Pick a due date and time.');
    const w = Number(d.weighting || 0);
    if (w < 0 || w > 100) throw new ValidationError('Worth must be between 0 and 100 percent.');
  }

  async add(d) {
    this.validate(d);
    const item = AssessmentFactory.create(d);
    await this.repo.save(item);
    this.bus.emit('added', item);
    return item;
  }

  async update(id, d) {
    this.validate(d);
    const old = await this.repo.getById(id);
    if (!old) throw new ValidationError('That note no longer exists.');
    const next = AssessmentFactory.create({ ...old.toJSON(), ...d, id, createdAt: old.createdAt, updatedAt: new Date().toISOString() });
    await this.repo.save(next);
    this.bus.emit('updated', next);
    return next;
  }

  async remove(id) {
    const item = await this.repo.getById(id);
    if (item) {
      await this.repo.remove(id);
      this.bus.emit('removed', item);
    }
    return item;
  }

  async restore(item) {
    await this.repo.save(item);
    this.bus.emit('added', item);
  }

  async toggleStep(itemId, stepId) {
    const item = await this.repo.getById(itemId);
    const step = item?.subtasks.find((s) => s.id === stepId);
    if (!step) return;
    step.toggle();
    item.touch();
    await this.repo.save(item);
    this.bus.emit('updated', item);
  }

  // Returns another exam that overlaps this one, if any. Exams with no length count as 2 hours.
  async findClash(d, ignoreId) {
    if (d.kind !== 'Exam' || !d.due) return null;
    const start = new Date(d.due).getTime();
    const end = start + (Number(d.durationMins) || 120) * 60000;
    const all = await this.list();
    return all.find((o) => o.id !== ignoreId && o.kind === 'Exam' && o.hasValidDate
      && o.dueDate.getTime() < end && start < o.dueDate.getTime() + (o.durationMins || 120) * 60000) ?? null;
  }

  async exportData() {
    return JSON.stringify({ app: 'pinned', version: 1, items: await this.list() }, null, 2);
  }

  async importData(text) {
    let data;
    try { data = JSON.parse(text); } catch { throw new ValidationError('That file could not be read.'); }
    if (!Array.isArray(data?.items)) throw new ValidationError('That file is not a Pinned backup.');
    const byId = new Map((await this.list()).map((i) => [i.id, i]));
    for (const raw of data.items) {
      const item = AssessmentFactory.create(raw);
      byId.set(item.id, item);
    }
    await this.repo.replaceAll([...byId.values()]);
    return data.items.length;
  }
}

/* ---------- Background helpers (need the chrome.* APIs) ---------- */

export class ReminderService {
  static PREFIX = 'rem|';

  async sync(items, now = new Date()) {
    const existing = await chrome.alarms.getAll();
    await Promise.all(existing.filter((a) => a.name.startsWith(ReminderService.PREFIX)).map((a) => chrome.alarms.clear(a.name)));
    for (const item of items) {
      if (!item.hasValidDate) continue;
      for (const off of item.reminderOffsets()) {
        const when = item.dueDate.getTime() - off.ms;
        if (when > now.getTime()) await chrome.alarms.create(`${ReminderService.PREFIX}${item.id}|${off.key}`, { when });
      }
    }
  }
}

export class BadgeManager {
  static COLOURS = { hot: '#D7263D', soon: '#E58A00', calm: '#1F7A6B' };

  async update(items, now = new Date()) {
    const next = items
      .filter((i) => i.hasValidDate && !i.isPast(now))
      .sort((a, b) => a.dueDate - b.dueDate)[0];
    if (!next) {
      await chrome.action.setBadgeText({ text: '' });
      return;
    }
    const d = next.daysLeft(now);
    await chrome.action.setBadgeText({ text: d === 0 ? 'now' : `${d}d` });
    await chrome.action.setBadgeBackgroundColor({ color: BadgeManager.COLOURS[next.urgency(now)] });
  }
}

/* ---------- Wiring ---------- */

export class Tracker {
  constructor(adapter) {
    this.bus = new EventBus();
    this.repo = new AssessmentRepository(adapter);
    this.service = new AssessmentService(this.repo, this.bus);
    this.priority = new PriorityService();
  }
  static create(adapter = new ChromeLocalAdapter()) {
    return new Tracker(adapter);
  }
}
