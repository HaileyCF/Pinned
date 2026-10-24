const $ = (id) => document.getElementById(id);
const h = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  n.append(...kids);
  return n;
};
const say = (id, text, kind = '') => { $(id).textContent = text; $(id).className = `msg ${kind}`; };
const friendly = (e) => {
  const m = (e && e.message) || 'Something went wrong.';
  if (/invalid login/i.test(m)) return 'Wrong email or password.';
  if (/email not confirmed/i.test(m)) return 'Confirm your email first. Check your inbox for the link.';
  if (/rate limit|too many/i.test(m)) return 'Too many emails sent. Wait a few minutes and try again.';
  if (/failed to fetch|network/i.test(m)) return 'Could not reach the server. Check your connection.';
  return m;
};

let mode = 'login';
let tasks = [];

/* ---------- Auth form ---------- */
const MODES = {
  login:  { title: 'Log in',          btn: 'Log in',            pw: true,  auto: 'current-password' },
  signup: { title: 'Create account',  btn: 'Sign up',           pw: true,  auto: 'new-password' },
  forgot: { title: 'Reset password',  btn: 'Send reset link',   pw: false, auto: 'current-password' },
};
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
$('toSignup').onclick = () => setMode('signup');
$('toLogin').onclick = () => setMode('login');
$('toForgot').onclick = () => setMode('forgot');

$('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('email').value.trim();
  const password = $('password').value;
  if (!email) return say('authMsg', 'Enter your email address.', 'err');
  if (mode !== 'forgot' && password.length < 8) return say('authMsg', 'Use a password of at least 8 characters.', 'err');

  $('authBtn').disabled = true;
  const label = $('authBtn').textContent;
  $('authBtn').textContent = 'Working…';
  say('authMsg', '');
  try {
    if (mode === 'login') {
      const { error } = await db.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } else if (mode === 'signup') {
      const { data, error } = await db.auth.signUp({ email, password, options: { emailRedirectTo: SITE_URL } });
      if (error) throw error;
      if (data.user && data.user.identities && data.user.identities.length === 0) {
        say('authMsg', 'That email already has an account. Log in instead.', 'err');
      } else if (!data.session) {
        say('authMsg', 'Almost there. Check your email and click the confirmation link, then log in.', 'ok');
      }
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

$('logout').onclick = async () => {
  $('logout').disabled = true;
  await db.auth.signOut();
  $('logout').disabled = false;
};

/* ---------- Tasks ---------- */
function draw() {
  $('listState').textContent = tasks.length ? '' : 'Nothing pinned yet. Add your first task above.';
  $('tasks').replaceChildren(...tasks.map(row));
}

function row(t) {
  const li = h('li', { class: `task${t.done ? ' done' : ''}` });
  const tick = h('button', { class: 'tick', type: 'button', 'aria-pressed': String(t.done), 'aria-label': `Tick off: ${t.text}`,
    onclick: () => change(t, { done: !t.done }) });
  const edit = h('button', { class: 'link', type: 'button', onclick: () => startEdit(li, t) }, 'Edit');
  const del = h('button', { class: 'link', type: 'button', onclick: () => remove(t) }, 'Delete');
  li.append(tick, h('span', { class: 'text' }, t.text), edit, del);
  return li;
}

function startEdit(li, t) {
  const input = h('input', { class: 'edit', value: t.text, maxlength: '200', 'aria-label': 'Edit task' });
  input.value = t.text;
  const save = h('button', { class: 'link', type: 'button', onclick: () => finish(true) }, 'Save');
  const cancel = h('button', { class: 'link', type: 'button', onclick: () => draw() }, 'Cancel');
  const finish = (ok) => {
    const text = input.value.trim();
    if (!ok || !text) return draw();
    change(t, { text });
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') draw(); });
  li.replaceChildren(input, save, cancel);
  input.focus();
}

async function load() {
  say('appMsg', '');
  $('listState').textContent = 'Loading your notes…';
  const { data, error } = await db.from('tasks').select('*').order('created_at', { ascending: false });
  if (error) { $('listState').textContent = ''; return say('appMsg', `Could not load tasks. ${friendly(error)}`, 'err'); }
  tasks = data;
  draw();
}

async function change(t, patch) {
  say('appMsg', '');
  const { data, error } = await db.from('tasks').update(patch).eq('id', t.id).select().single();
  if (error) { say('appMsg', `Could not save that change. ${friendly(error)}`, 'err'); return draw(); }
  tasks = tasks.map((x) => (x.id === t.id ? data : x));
  draw();
}

async function remove(t) {
  say('appMsg', '');
  const { error } = await db.from('tasks').delete().eq('id', t.id);
  if (error) return say('appMsg', `Could not delete that task. ${friendly(error)}`, 'err');
  tasks = tasks.filter((x) => x.id !== t.id);
  draw();
}

$('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('newText').value.trim();
  if (!text) return say('appMsg', 'Type a task first.', 'err');
  $('addBtn').disabled = true;
  say('appMsg', '');
  const { data, error } = await db.from('tasks').insert({ text }).select().single();
  $('addBtn').disabled = false;
  if (error) return say('appMsg', `Could not add that task. ${friendly(error)}`, 'err');
  tasks = [data, ...tasks];
  $('newText').value = '';
  draw();
});

/* ---------- Session handling ---------- */
function show(user) {
  $('boot').hidden = true;
  $('auth').hidden = !!user;
  $('app').hidden = !user;
  if (user) {
    $('who').textContent = user.email;
    load();
  } else {
    tasks = [];
    $('password').value = '';
  }
}

if (!configured) {
  $('boot').hidden = true;
  $('setup').hidden = false;
} else {
  setMode('login');
  // Fires on load (with any saved session), on login, and on logout.
  db.auth.onAuthStateChange((event, session) => {
    setTimeout(() => show(session ? session.user : null), 0);
  });
}
