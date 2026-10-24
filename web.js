// Web glue: Supabase storage for your original Pinned code, login screen, tab badge and reminders.
// `db`, `configured` and `SITE_URL` come from config.js.
import { Tracker, MemoryAdapter, AssessmentFactory } from './core.js';

const $ = (id) => document.getElementById(id);

/* ---------- Storage: same methods core.js expects, but saved in Supabase ---------- */
class SupabaseRepository {
  constructor(client) { this.db = client; }
  async getAll() {
    const { data, error } = await this.db.from('assessments').select('data');
    if (error) throw error;
    return data.map((r) => AssessmentFactory.create(r.data));
  }
  async getById(id) {
    const { data, error } = await this.db.from('assessments').select('data').eq('id', id).maybeSingle();
    if (error) throw error;
    return data ? AssessmentFactory.create(data.data) : null;
  }
  row(item) { return { id: item.id, data: JSON.parse(JSON.stringify(item)), updated_at: new Date().toISOString() }; }
  async save(item) {
    const { error } = await this.db.from('assessments').upsert(this.row(item), { defaultToNull: false });
    if (error) throw error;
  }
  async remove(id) {
    const { error } = await this.db.from('assessments').delete().eq('id', id);
    if (error) throw error;
  }
  async replaceAll(list) { // only used by "Load a backup": adds or updates, never deletes
    if (!list.length) return;
    const { error } = await this.db.from('assessments').upsert(list.map((i) => this.row(i)), { defaultToNull: false });
    if (error) throw error;
  }
}

export const tracker = new Tracker(new MemoryAdapter());
tracker.repo = new SupabaseRepository(db);
tracker.service.repo = tracker.repo;

/* ---------- Login screen ---------- */
const say = (id, text, kind = '') => { $(id).textContent = text; $(id).className = `msg ${kind}`; };
const friendly = (e) => {
  const m = (e && e.message) || 'Something went wrong.';
  if (/invalid login/i.test(m)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(m)) return 'Confirm your email first. Check your inbox for the link.';
  if (/rate limit|too many/i.test(m)) return 'Too many emails sent. Wait a while and try again.';
  if (/failed to fetch|network/i.test(m)) return 'Could not reach the server. Check your connection.';
  return m;
};
const MODES = {
  login:  { title: 'Log in',         btn: 'Log in',          pw: true,  auto: 'current-password' },
  signup: { title: 'Create account', btn: 'Sign up',         pw: true,  auto: 'new-password' },
  forgot: { title: 'Reset password', btn: 'Send reset link', pw: false, auto: 'current-password' },
};
let mode = 'login';
function setMode(m) {
  mode = m;
  const c = MODES[m];
  $('authTitle').textContent = c.title;
  $('authBtn').textContent = c.btn;
  $('pwField').hidden = !c.pw;
  $('password').required = c.pw;
  $('password').autocomplete = c.auto;
  $('toSignup').hidden = m === 'signup';
  $('toLogin').hidden = m === 'login';
  $('toForgot').hidden = m === 'forgot';
  say('authMsg', '');
}

export function initAuth(onUser) {
  if (!configured) { $('boot').hidden = true; $('setup').hidden = false; return; }
  setMode('login');
  $('toSignup').onclick = () => setMode('signup');
  $('toLogin').onclick = () => setMode('login');
  $('toForgot').onclick = () => setMode('forgot');
  $('logout').onclick = () => db.auth.signOut();

  $('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = $('email').value.trim();
    const password = $('password').value;
    if (!email) return say('authMsg', 'Enter your email address.', 'err');
    if (mode !== 'forgot' && password.length < 8) return say('authMsg', 'Use a password of at least 8 characters.', 'err');
    const label = $('authBtn').textContent;
    $('authBtn').disabled = true;
    $('authBtn').textContent = 'Working…';
    say('authMsg', '');
    try {
      if (mode === 'login') {
        const { error } = await db.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'signup') {
        const { data, error } = await db.auth.signUp({ email, password, options: { emailRedirectTo: SITE_URL } });
        if (error) throw error;
        if (data.user && data.user.identities && data.user.identities.length === 0) say('authMsg', 'That email already has an account. Log in instead.', 'err');
        else if (!data.session) say('authMsg', 'Almost there. Check your email and click the confirmation link, then log in.', 'ok');
      } else {
        const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: `${SITE_URL}reset.html` });
        if (error) throw error;
        say('authMsg', 'If that email has an account, a reset link is on its way.', 'ok');
      }
    } catch (err) {
      say('authMsg', friendly(err), 'err');
    } finally {
      $('authBtn').disabled = false;
      $('authBtn').textContent = label;
    }
  });

  let lastId = null;
  db.auth.onAuthStateChange((event, session) => {
    setTimeout(() => {
      const user = session ? session.user : null;
      $('boot').hidden = true;
      $('auth').hidden = !!user;
      $('gate').hidden = !!user;
      $('appRoot').hidden = !user;
      if ((user ? user.id : null) === lastId) return;
      lastId = user ? user.id : null;
      if (user) $('who').textContent = user.email;
      else $('password').value = '';
      onUser(user);
    }, 0);
  });
}

/* ---------- Extension features, web version: tab badge + reminders while the site is open ---------- */
let items = [];
const readFired = () => { try { return new Set(JSON.parse(localStorage.getItem('pinned-fired') || '[]')); } catch { return new Set(); } };

function check() {
  const now = new Date();
  const next = items.filter((i) => i.hasValidDate && !i.isPast(now)).sort((a, b) => a.dueDate - b.dueDate)[0];
  if (items.length || document.title === 'Pinned') {
    const d = next ? next.daysLeft(now) : null;
    document.title = next ? `(${d === 0 ? 'now' : `${d}d`}) Pinned` : 'Pinned';
  }
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const seen = readFired();
  let changed = false;
  for (const item of items) {
    if (!item.hasValidDate || item.isPast(now)) continue;
    for (const off of item.reminderOffsets()) {
      const at = item.dueDate.getTime() - off.ms;
      const key = `${item.id}|${off.key}`;
      if (now.getTime() >= at && now.getTime() - at < 36e5 && !seen.has(key)) {
        const open = item.openSteps().length;
        new Notification(`${item.course}: ${item.title}`, {
          body: `${item.kind} ${off.phrase}.${open ? ` ${open} step${open === 1 ? '' : 's'} still to tick off.` : ''}`,
          icon: 'icon128.png',
        });
        seen.add(key);
        changed = true;
      }
    }
  }
  if (changed) { try { localStorage.setItem('pinned-fired', JSON.stringify([...seen].slice(-300))); } catch {} }
}

export function setItems(list) { items = list; check(); }
setInterval(check, 60000);

export function initNotify() {
  const b = $('notify');
  if (!('Notification' in window)) { b.hidden = true; return; }
  const sync = () => {
    b.hidden = Notification.permission === 'granted';
    b.textContent = Notification.permission === 'denied' ? 'Reminders blocked in browser' : 'Turn on reminders';
    b.disabled = Notification.permission === 'denied';
  };
  b.onclick = async () => { await Notification.requestPermission(); sync(); check(); };
  sync();
}
