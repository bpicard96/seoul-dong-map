// Seoul Dong Map: opening splash, account sign-in and cloud sync (Firebase Auth + Firestore).
// With no config in firebase-config.js, or if Firebase can't load (first launch offline),
// the splash steps aside and the map keeps marks on the device as before.
import config from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const box = document.getElementById('account');
const M = window.SeoulMap;
const S = window.SeoulSplash;
const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

const SAME = 'That email and password don’t match. Check them, or use “Forgot password?”.';
const CLOSED = 'New accounts are turned off for this map. Ask whoever set it up to add you.';
const AUTH_ERR = {
  'auth/invalid-credential': SAME, 'auth/wrong-password': SAME, 'auth/user-not-found': SAME,
  'auth/invalid-email': 'That email address doesn’t look right.',
  'auth/missing-email': 'Enter your email.',
  'auth/missing-password': 'Enter your password.',
  'auth/email-already-in-use': 'There’s already an account with that email. Sign in instead.',
  'auth/weak-password': 'Use a password of at least 6 characters.',
  'auth/too-many-requests': 'Too many tries. Wait a few minutes, then try again.',
  'auth/network-request-failed': 'No connection. Try again when you’re online.',
  'auth/operation-not-allowed': CLOSED, 'auth/admin-restricted-operation': CLOSED,
};
function authMsg(e) { return AUTH_ERR[e && e.code] || 'That didn’t work. Try again in a moment.'; }
function saveMsg(e) {
  return e && e.code === 'permission-denied'
    ? 'Could not save that change to your account. Sign out, sign back in, and make the change again.'
    : 'Could not save that change to your account. Make the change again in a moment.';
}

function readLocal() {
  try { return JSON.parse(localStorage.getItem(M.localKey) || '{}') || {}; } catch (e) { return {}; }
}
function writeLocal(key, value) { try { localStorage.setItem(key, value); return true; } catch (e) { return false; } }
function firstName(u) { const n = ((u && u.displayName) || '').trim(); return n ? n.split(/\s+/)[0] : ''; }

// Combine one place's marks from this device (b) into the account's copy (a), losing nothing.
function mergeRec(a, b) {
  const r = { visited: a.visited || b.visited, worth: a.worth || b.worth, want: false, note: a.note || '', places: [] };
  r.want = !r.visited && (a.want || b.want);
  if (!r.visited) r.worth = false;
  const na = (a.note || '').trim(), nb = (b.note || '').trim();
  if (!na) r.note = b.note || '';
  else if (nb && na !== nb && !na.includes(nb)) r.note = (a.note + '\n\n' + b.note).slice(0, 4000);
  const seen = new Set();
  for (const p of (a.places || []).concat(b.places || [])) {
    if (!seen.has(p.url)) { seen.add(p.url); r.places.push(p); }
  }
  r.places = r.places.slice(0, 40);
  return r;
}

if (!(config && M && box)) {
  if (S) S.hide();
} else {
  start().catch(() => {
    if (S) S.hide();
    box.hidden = false;
    box.textContent = 'Sync is unavailable right now. Your marks are still saved on this device.';
  });
}

async function start() {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js'),
  ]);
  // firestoreDatabase names the Firestore database when it isn't the built-in "(default)" one.
  const { firestoreDatabase, ...options } = config;
  const DB = firestoreDatabase || '(default)';
  const app = initializeApp(options);
  const auth = A.getAuth(app);
  let fs;
  try {
    fs = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }, DB);
  } catch (e) {
    fs = F.getFirestore(app, DB);
  }

  let user = null, unsub = null, pendingName = '';
  const queue = {};

  window.SeoulSync = {
    signedIn: () => !!user,
    save(id, data) {
      if (!user) return;
      const ref = F.doc(fs, 'users', user.uid, 'places', id);
      M.status(navigator.onLine ? 'Saving…' : 'Saved. It will sync when you’re back online.');
      queue[id] = (queue[id] || Promise.resolve())
        .then(() => (data ? F.setDoc(ref, data) : F.deleteDoc(ref)))
        .then(() => M.status('Saved and synced.'), (e) => M.status(saveMsg(e), true));
    },
  };

  async function migrate(col) {
    const local = M.clean(readLocal());
    const ids = Object.keys(local);
    if (!ids.length) return;
    let snap;
    try { snap = await F.getDocs(col); } catch (e) { return; } // offline: try again next launch
    const raw = {};
    snap.forEach((d) => { raw[d.id] = d.data(); });
    const cloud = M.clean(raw), merged = Object.assign({}, cloud), changed = [];
    for (const id of ids) {
      const m = cloud[id] ? mergeRec(cloud[id], local[id]) : local[id];
      if (JSON.stringify(m) !== JSON.stringify(cloud[id])) { merged[id] = m; changed.push(id); }
    }
    writeLocal(M.localKey + '-before-sync', JSON.stringify(local));
    M.replace(merged);
    if (!changed.length) { writeLocal(M.localKey, '{}'); return; }
    const batch = F.writeBatch(fs);
    changed.forEach((id) => { const d = M.docFor(id); if (d) batch.set(F.doc(col, id), d); });
    batch.commit().then(() => {
      writeLocal(M.localKey, '{}');
      M.status('Added ' + changed.length + ' marked place' + (changed.length === 1 ? '' : 's') + ' from this device to your account.');
    }, (e) => M.status(saveMsg(e), true));
  }

  /* ---------- small DOM helpers ---------- */
  function button(text, cls, act) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.textContent = text;
    if (act) b.dataset.act = act;
    return b;
  }
  function input(id, type, auto, placeholder, extra) {
    const i = document.createElement('input');
    i.id = id; i.type = type; i.autocomplete = auto; i.placeholder = placeholder;
    i.setAttribute('aria-label', placeholder);
    Object.assign(i, extra || {});
    return i;
  }
  function para(cls, text) { const p = document.createElement('p'); p.className = cls; p.textContent = text; return p; }

  /* ---------- account bar inside the app ---------- */
  function render() {
    box.hidden = false;
    box.textContent = '';
    if (user) {
      const who = document.createElement('span');
      who.className = 'who';
      who.append('Synced as ');
      const b = document.createElement('b');
      b.textContent = (user.displayName || '').trim() || user.email || 'your account';
      who.append(b);
      const out = button('Sign out', 'linkbtn');
      out.addEventListener('click', () => { M.flush(); A.signOut(auth); });
      box.append(who, out);
      return;
    }
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = 'Sign in to keep your marks in sync on your phone and laptop.';
    const open = button('Sign in', 'btn');
    open.addEventListener('click', () => { S.show(); splashForm('in'); });
    box.append(who, open);
  }

  /* ---------- splash screens ---------- */
  function splashHello(name) {
    S.body.textContent = '';
    S.body.append(para('sp-hello', name ? 'Hello, ' + name : 'Hello'), para('sp-note', 'Opening your map…'));
    setTimeout(() => S.hide(), reduce ? 700 : 1400);
  }

  function formShell(title) {
    const form = document.createElement('form');
    form.className = 'sp-form'; form.noValidate = true;
    form.append(para('sp-h', title));
    const msg = para('sp-msg', ''); msg.hidden = true; msg.setAttribute('role', 'status');
    const say = (t, err) => { msg.textContent = t; msg.hidden = !t; msg.classList.toggle('err', !!err); };
    const busy = (on) => form.querySelectorAll('button,input').forEach((el) => { el.disabled = on; });
    return { form, msg, say, busy };
  }

  // mode: 'in' (sign in) or 'up' (create an account)
  function splashForm(mode) {
    const up = mode === 'up';
    const { form, msg, say, busy } = formShell(up ? 'Create an account' : 'Sign in');
    const name = up ? input('sp-name', 'text', 'given-name', 'Your first name', { maxLength: 40 }) : null;
    const email = input('sp-email', 'email', 'username', 'Email', { inputMode: 'email' });
    const pass = input('sp-pass', 'password', up ? 'new-password' : 'current-password', up ? 'Password (6 or more characters)' : 'Password');
    const go = document.createElement('button');
    go.type = 'submit'; go.className = 'sp-go'; go.textContent = up ? 'Create account' : 'Sign in';
    const links = document.createElement('div');
    links.className = 'sp-links';
    links.append(up ? button('I already have an account', 'linkbtn', 'in') : button('Create an account', 'linkbtn', 'up'));
    if (!up) links.append(button('Forgot password?', 'linkbtn', 'reset'));
    const skip = button('Use without an account', 'linkbtn sp-skip', 'skip');
    if (name) form.append(name);
    form.append(email, pass, go, msg, links, skip);

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const em = email.value.trim();
      if (up && !name.value.trim()) { say('Tell us your first name so we can say hello.', true); name.focus(); return; }
      busy(true); say('Working…');
      try {
        if (up) {
          pendingName = name.value.trim().slice(0, 40);
          await A.createUserWithEmailAndPassword(auth, em, pass.value);
        } else {
          await A.signInWithEmailAndPassword(auth, em, pass.value);
        }
        // the sign-in handler takes over from here and says hello
      } catch (e) {
        pendingName = '';
        say(authMsg(e), true); busy(false);
      }
    });
    form.addEventListener('click', async (ev) => {
      const act = ev.target.dataset && ev.target.dataset.act;
      if (act === 'up' || act === 'in') {
        splashForm(act);
      } else if (act === 'skip') {
        S.hide();
      } else if (act === 'reset') {
        if (!email.value.trim()) { say('Type your email first, then tap “Forgot password?”.', true); email.focus(); return; }
        busy(true);
        try {
          await A.sendPasswordResetEmail(auth, email.value.trim());
          say('If there’s an account for that email, a reset link is on its way.');
        } catch (e) { say(authMsg(e), true); }
        busy(false);
      }
    });
    S.body.textContent = '';
    S.body.append(form);
    (name || email).focus({ preventScroll: true });
  }

  // For accounts made before names existed: ask once, then say hello.
  function splashName(u) {
    const { form, msg, say, busy } = formShell('What should we call you?');
    const name = input('sp-name', 'text', 'given-name', 'Your first name', { maxLength: 40 });
    const go = document.createElement('button');
    go.type = 'submit'; go.className = 'sp-go'; go.textContent = 'Continue';
    form.append(name, go, msg);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const n = name.value.trim().slice(0, 40);
      if (!n) { say('Type a name, or anything you’d like to be greeted with.', true); return; }
      busy(true);
      try {
        await A.updateProfile(u, { displayName: n });
        render(); splashHello(firstName(u) || n);
      } catch (e) { say(authMsg(e), true); busy(false); }
    });
    S.body.textContent = '';
    S.body.append(form);
    name.focus({ preventScroll: true });
  }

  /* ---------- sign-in state ---------- */
  A.onAuthStateChanged(auth, async (u) => {
    M.flush(); // save any half-typed note where it belongs before switching accounts
    if (unsub) { unsub(); unsub = null; }
    const was = user;
    user = u;
    if (u && !u.displayName && pendingName) {
      try { await A.updateProfile(u, { displayName: pendingName }); } catch (e) { /* asked again below */ }
    }
    pendingName = '';
    render();
    if (!u) {
      M.replace(M.clean(readLocal()));
      if (was) M.status('Signed out. Marks you make now stay on this device only.');
      S.show(); splashForm('in');
      return;
    }
    if (firstName(u)) splashHello(firstName(u)); else { S.show(); splashName(u); }
    M.status('Syncing…');
    const col = F.collection(fs, 'users', u.uid, 'places');
    await migrate(col);
    let first = true;
    unsub = F.onSnapshot(col, (snap) => {
      const raw = {};
      snap.forEach((d) => { raw[d.id] = d.data(); });
      M.replace(M.clean(raw));
      if (first && !snap.metadata.fromCache) { first = false; M.status('Synced.'); }
    }, () => M.status('Could not load your synced marks. Check your connection, then reopen the app.', true));
  });
}
