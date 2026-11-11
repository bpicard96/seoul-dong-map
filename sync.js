// Seoul Dong Map: optional account sign-in and cloud sync (Firebase Auth + Firestore).
// Loaded only by the standalone app. With no config in firebase-config.js it does nothing,
// and the map keeps marks on the device as before.
import config from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const box = document.getElementById('account');
const M = window.SeoulMap;

const SAME = 'That email and password don’t match. Check them, or use “Forgot password?”.';
const CLOSED = 'New accounts are turned off for this map. Ask whoever set it up to add you.';
const AUTH_ERR = {
  'auth/invalid-credential': SAME, 'auth/wrong-password': SAME, 'auth/user-not-found': SAME,
  'auth/invalid-email': 'That email address doesn’t look right.',
  'auth/missing-password': 'Enter your password.',
  'auth/email-already-in-use': 'There’s already an account with that email. Use Sign in instead.',
  'auth/weak-password': 'Use a password of at least 6 characters.',
  'auth/too-many-requests': 'Too many tries. Wait a few minutes, then try again.',
  'auth/network-request-failed': 'No connection. Try again when you’re online.',
  'auth/operation-not-allowed': CLOSED, 'auth/admin-restricted-operation': CLOSED,
};
function authMsg(e) { return AUTH_ERR[e && e.code] || 'Sign-in didn’t work. Try again in a moment.'; }
function saveMsg(e) {
  return e && e.code === 'permission-denied'
    ? 'Could not save that change to your account. Sign out, sign back in, and make the change again.'
    : 'Could not save that change to your account. Make the change again in a moment.';
}

function readLocal() {
  try { return JSON.parse(localStorage.getItem(M.localKey) || '{}') || {}; } catch (e) { return {}; }
}
function writeLocal(key, value) { try { localStorage.setItem(key, value); return true; } catch (e) { return false; } }

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

if (config && M && box) {
  start().catch(() => {
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

  let user = null, unsub = null, formOpen = false;
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

  function render() {
    box.hidden = false;
    box.textContent = '';
    if (user) {
      const who = document.createElement('span');
      who.className = 'who';
      who.append('Synced as ');
      const b = document.createElement('b');
      b.textContent = user.email || 'your account';
      who.append(b);
      const out = button('Sign out', 'linkbtn');
      out.addEventListener('click', () => { M.flush(); A.signOut(auth); });
      box.append(who, out);
      return;
    }
    if (!formOpen) {
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = 'Sign in to keep your marks in sync on your phone and laptop.';
      const open = button('Sign in', 'btn');
      open.addEventListener('click', () => { formOpen = true; render(); box.querySelector('input').focus(); });
      box.append(who, open);
      return;
    }
    const form = document.createElement('form');
    form.noValidate = true;
    form.innerHTML =
      '<input id="acct-email" type="email" autocomplete="username" inputmode="email" placeholder="Email" aria-label="Email">' +
      '<input id="acct-pass" type="password" autocomplete="current-password" placeholder="Password (6 or more characters)" aria-label="Password">' +
      '<div class="acts"><button class="btn" type="submit">Sign in</button>' +
      '<button class="btn" type="button" data-act="up">Create account</button>' +
      '<button class="linkbtn" type="button" data-act="reset">Forgot password?</button>' +
      '<button class="linkbtn" type="button" data-act="close">Cancel</button></div>' +
      '<p class="msg" role="status" hidden></p>';
    const email = form.querySelector('#acct-email'), pass = form.querySelector('#acct-pass'), msg = form.querySelector('.msg');
    const say = (t, err) => { msg.textContent = t; msg.hidden = false; msg.classList.toggle('err', !!err); };
    const busy = (on) => form.querySelectorAll('button,input').forEach((el) => { el.disabled = on; });
    async function go(fn, okText) {
      busy(true); say('Working…');
      try { await fn(); if (okText) say(okText); } catch (e) { say(authMsg(e), true); } finally { busy(false); }
    }
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      go(() => A.signInWithEmailAndPassword(auth, email.value.trim(), pass.value));
    });
    form.addEventListener('click', (ev) => {
      const act = ev.target.dataset && ev.target.dataset.act;
      if (act === 'up') {
        pass.autocomplete = 'new-password';
        go(() => A.createUserWithEmailAndPassword(auth, email.value.trim(), pass.value));
      } else if (act === 'reset') {
        if (!email.value.trim()) { say('Type your email first, then tap “Forgot password?”.', true); return; }
        go(() => A.sendPasswordResetEmail(auth, email.value.trim()), 'If there’s an account for that email, a reset link is on its way.');
      } else if (act === 'close') {
        formOpen = false; render();
      }
    });
    box.append(form);
  }

  function button(text, cls) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.textContent = text;
    return b;
  }

  A.onAuthStateChanged(auth, async (u) => {
    M.flush(); // save any half-typed note where it belongs before switching accounts
    if (unsub) { unsub(); unsub = null; }
    const was = user;
    user = u; formOpen = false; render();
    if (!u) {
      M.replace(M.clean(readLocal()));
      if (was) M.status('Signed out. Marks you make now stay on this device only.');
      return;
    }
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
