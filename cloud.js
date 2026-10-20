/* Supabase account isolation + revision-checked cloud persistence. */
(() => {
  'use strict';
  const URL = 'https://ayzwhavgzzxkosggwgkq.supabase.co';
  const KEY = 'sb_publishable_kuiMBQa58mLC65LdEwICIg_vuB7j2K-';
  const $ = id => document.getElementById(id);
  const copy = value => JSON.parse(JSON.stringify(value));
  let client, user = null, revision = 0, ready = false, pending = null;
  let saving = false, refreshing = false, loading = false, conflict = false, mode = 'login';
  let queued = null, timer, generation = 0;
  const draftKey = () => `mobile-shop-cloud-draft:${user.id}`;
  const message = text => { $('cloud-auth-message').textContent = text; };
  const status = text => { $('cloud-status').textContent = text; };
  function persistedPayload() {
    syncActiveToStoreData();
    const result = copy(appState);
    delete result.auth;
    if (result.settings) delete result.settings.aiApiKey;
    (result.stores || []).forEach(store => delete store.pin);
    result.pinResetRequests = [];
    (result.storeRequests || []).forEach(store => delete store.pin);
    return result;
  }
  function validate(value) {
    if (!value || !Array.isArray(value.stores) || !value.stores.length || !value.storeData || typeof value.storeData !== 'object') throw new Error('Invalid shop backup / نسخة البيانات غير صالحة');
    if (!value.stores.some(s => s.id === value.currentStoreId)) value.currentStoreId = value.stores[0].id;
    return value;
  }
  function apply(payload) {
    const data = validate(copy(payload));
    appState = {...copy(defaultInitialState), ...data};
    appState.settings = {...defaultInitialState.settings, ...data.settings, aiApiKey: ''};
    appState.auth = {isAuthenticated: true, role: 'admin', activeStoreId: appState.currentStoreId};
    appState.pinResetRequests = [];
    loadStoreSnapshotIntoActive(appState.currentStoreId);
    renderApp();
    $('sidebar-user-name').textContent = user.email;
    $('sidebar-user-role').textContent = 'Your account • Your branches';
  }
  function storeDraft() {
    try {
      if (pending) localStorage.setItem(draftKey(), JSON.stringify({pending, queued}));
      else localStorage.removeItem(draftKey());
    } catch (_) {
      status('Local backup unavailable — keep this page open until saved / لا تغلق الصفحة قبل الحفظ');
    }
  }
  function problem(text, isConflict = false) {
    conflict = isConflict;
    $('cloud-problem-message').textContent = text;
    $('cloud-problem').classList.remove('hidden');
    $('cloud-problem-retry').hidden = isConflict;
    status(isConflict ? 'Conflict — NOT saved / تعارض: لم يُحفظ' : 'NOT saved / لم يُحفظ');
  }
  async function flush() {
    if (!ready || !user || !pending || saving || conflict) return;
    saving = true;
    const epoch = generation;
    const request = pending;
    status('Saving… / جارٍ الحفظ…');
    try {
      const {data, error} = await client.rpc('save_shop_workspace', {
        expected_revision: request.base, new_payload: request.payload, request_id: request.id
      });
      if (epoch !== generation) return;
      if (error) throw error;
      revision = Number(data);
      pending = queued ? {payload: queued, base: revision, id: crypto.randomUUID()} : null;
      queued = null;
      storeDraft();
      $('cloud-retry').classList.add('hidden');
      $('cloud-problem').classList.add('hidden');
      status('Saved to cloud ✓ / محفوظ سحابياً ✓');
    } catch (error) {
      if (epoch !== generation) return;
      $('cloud-retry').classList.remove('hidden');
      problem(error.code === '40001'
        ? 'Another device saved changes first. Your unsaved work is preserved here. Download it before loading the cloud version, then reapply only the missing changes.\nجهاز آخر حفظ تعديلات قبلك. نزّل نسختك أولاً، ثم حمّل النسخة السحابية وأعد التعديلات الناقصة.'
        : `The cloud did not confirm this save. Your work remains on this device; reconnect and retry before closing.\nلم يتأكد الحفظ السحابي. أعد الاتصال وحاول مجدداً.\n${error.message || 'Network error'}`, error.code === '40001');
    } finally {
      saving = false;
      if (epoch === generation && pending && !conflict && pending !== request) void flush();
    }
  }
  function save() {
    if (!ready || !user) return;
    const payload = persistedPayload();
    if (pending) queued = payload;
    else pending = {payload, base: revision, id: crypto.randomUUID()};
    storeDraft();
    status('Pending cloud save… / بانتظار الحفظ…');
    clearTimeout(timer);
    timer = setTimeout(flush, 200);
  }
  async function getRow() {
    const {data, error} = await client.from('shop_workspaces').select('payload,revision,write_id').eq('user_id', user.id).maybeSingle();
    if (error) throw error;
    return data;
  }
  async function loadUser(session) {
    if (loading || (ready && user?.id === session?.user.id)) return;
    if (!session) { reset(); return; }
    if (user && user.id !== session.user.id) { storeDraft(); reset(); }
    loading = true;
    ready = false;
    user = session.user;
    const epoch = ++generation;
    message('Loading your shop… / جارٍ تحميل بياناتك…');
    $('cloud-auth-retry').classList.add('hidden');
    try {
      let row = await getRow();
      if (epoch !== generation) return;
      if (!row) {
        loadState();
        appState.stores[0].name = user.user_metadata?.shop_name || 'My Shop';
        appState.stores[0].owner = user.email;
        loadStoreSnapshotIntoActive('store-01');
        const payload = persistedPayload();
        const {error} = await client.rpc('save_shop_workspace', {expected_revision: 0, new_payload: payload, request_id: crypto.randomUUID()});
        if (error && error.code !== '40001') throw error;
        row = await getRow();
      }
      if (epoch !== generation) return;
      if (!row) throw new Error('Unable to load your workspace');
      revision = Number(row.revision);
      apply(row.payload);
      ready = true;
      $('cloud-bar').classList.remove('hidden');
      $('cloud-account').textContent = user.email;
      $('cloud-migrate').classList.toggle('hidden', !localStorage.getItem(STORAGE_KEY));
      status('Saved to cloud ✓ / محفوظ سحابياً ✓');
      let draft;
      try { draft = JSON.parse(localStorage.getItem(draftKey())); } catch (_) { /* ignore invalid cache */ }
      if (draft?.pending) {
        pending = draft.pending;
        queued = draft.queued || null;
        // A response may have been lost after the database committed.
        if (row.write_id === pending.id) {
          pending = queued ? {payload: queued, base: revision, id: crypto.randomUUID()} : null;
          queued = null;
        }
        if (pending) {
          apply(queued || pending.payload);
          problem('Unsaved work was recovered from this device. Retry to save it, or download it before loading the cloud version.\nتم استرجاع تعديلات غير محفوظة من هذا الجهاز.', pending.base !== revision);
        }
        storeDraft();
      }
    } catch (error) {
      ready = false;
      appState.auth.isAuthenticated = false;
      renderAuthGateway();
      message(`Could not load cloud data. No local data was uploaded.\nتعذّر تحميل بياناتك.\n${error.message || 'Network error'}`);
      $('cloud-auth-retry').classList.remove('hidden');
    } finally { loading = false; }
  }
  function reset() {
    generation++;
    ready = false; user = null; pending = null; queued = null; conflict = false;
    clearTimeout(timer); currentCart = [];
    loadState(); renderApp();
    $('cloud-bar').classList.add('hidden');
    $('cloud-problem').classList.add('hidden');
    document.querySelectorAll('body > div[id^="modal-"]').forEach(el => el.classList.add('hidden'));
    message('Sign in to your account / سجّل الدخول لحسابك');
  }
  async function refresh(manual = false) {
    if (!ready || !user || pending || saving || refreshing || loading) return;
    // Never replace state underneath an open form or a sale in progress.
    if (!manual && (currentCart.length || document.querySelector('body > div[id^="modal-"]:not(.hidden)') || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName))) return;
    const epoch = generation;
    refreshing = true;
    try {
      const {data, error} = await client.from('shop_workspaces').select('revision').eq('user_id', user.id).single();
      if (error) throw error;
      if (epoch !== generation || pending || saving) return;
      if (Number(data.revision) !== revision) {
        const row = await getRow();
        if (epoch !== generation || pending || saving) return;
        revision = Number(row.revision); apply(row.payload);
      }
      status('Saved to cloud ✓ / محفوظ سحابياً ✓');
    } catch (_) { status('Cannot reach cloud / تعذّر الاتصال بالسحابة'); }
    finally { refreshing = false; }
  }
  async function signOut() {
    if (pending || saving) {
      problem('Save or download your pending work before signing out.\nاحفظ التعديلات أو نزّل نسخة قبل تسجيل الخروج.', conflict);
      return;
    }
    const {error} = await client.auth.signOut({scope: 'local'});
    if (error) { showToast(error.message, 'error'); return; }
    reset();
  }
  function downloadDraft() {
    const payload = queued || pending?.payload;
    if (!payload) return;
    const blob = new Blob([JSON.stringify({data: payload, exportedAt: new Date().toISOString(), unsaved: true}, null, 2)], {type:'application/json'});
    const url = window.URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'mobile-shop-unsaved-backup.json'; a.click();
    setTimeout(() => window.URL.revokeObjectURL(url), 1000);
  }
  async function useServer() {
    if (saving) return;
    if (!confirm('Discard the local pending changes and load the cloud copy? Download the unsaved copy first.\nتجاهل التعديلات غير المحفوظة وتحميل السحابة؟ نزّل نسختك أولاً.')) return;
    try {
      const row = await getRow();
      apply(row.payload); revision = Number(row.revision);
      pending = queued = null; conflict = false; storeDraft();
      $('cloud-problem').classList.add('hidden');
      status('Saved to cloud ✓ / محفوظ سحابياً ✓');
    } catch (e) { $('cloud-problem-message').textContent = e.message; }
  }
  async function submit(event) {
    event.preventDefault();
    if (!client) return;
    const email = $('cloud-email').value.trim(), password = $('cloud-password').value;
    $('cloud-submit').disabled = true;
    message('Please wait… / لحظة…');
    try {
      let result;
      if (mode === 'recovery') {
        result = await client.auth.updateUser({password});
        if (result.error) throw result.error;
        mode = 'login'; updateForm();
        message('Password updated. Sign in with your new password. / تم تغيير كلمة السر');
        await client.auth.signOut({scope: 'local'});
        return;
      }
      if (mode === 'signup') result = await client.auth.signUp({email, password, options: {data: {shop_name: $('cloud-shop').value.trim() || 'My Shop'}, emailRedirectTo: location.origin + '/'}});
      else result = await client.auth.signInWithPassword({email, password});
      if (result.error) throw result.error;
      $('cloud-password').value = '';
      if (result.data.session) await loadUser(result.data.session);
      else message('Check your email to confirm your account, then sign in.\nافتح رسالة تأكيد الإيميل، بعدها سجّل الدخول.');
    } catch (e) { message(e.message || 'Unable to sign in / تعذّر الدخول'); }
    finally { $('cloud-submit').disabled = false; }
  }
  function updateForm() {
    $('cloud-shop-label').classList.toggle('hidden', mode !== 'signup');
    $('cloud-submit').textContent = mode === 'signup' ? 'Create account / إنشاء حساب' : mode === 'recovery' ? 'Save new password / حفظ كلمة السر' : 'Sign in / دخول';
    $('cloud-toggle').textContent = mode === 'signup' ? 'Already registered? Sign in / عندك حساب؟' : 'Create account / حساب جديد';
    $('cloud-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    $('cloud-email').required = mode !== 'recovery';
    $('cloud-email').closest('label').classList.toggle('hidden', mode === 'recovery');
    $('cloud-toggle').classList.toggle('hidden', mode === 'recovery');
    $('cloud-reset').classList.toggle('hidden', mode === 'recovery');
  }
  async function start() {
    setupApp();
    // Block interactions behind the auth gateway, including keyboard focus.
    const baseGateway = renderAuthGateway;
    renderAuthGateway = function() {
      baseGateway();
      const locked = !appState.auth?.isAuthenticated;
      document.querySelectorAll('body > header, body > div.flex-1, body > nav').forEach(el => el.inert = locked);
    };
    const originalOpen = window.openAuthGateway;
    window.openAuthGateway = function() {
      if (ready) { showToast('Use Sign out / Lock to switch accounts. سجّل الخروج لتبديل الحساب.', 'info'); return; }
      originalOpen();
    };
    window.closeAuthGateway = function() { if (ready) $('auth-gateway-overlay').classList.add('hidden'); };
    renderAuthGateway();
    $('cloud-auth-form').addEventListener('submit', submit);
    $('cloud-toggle').onclick = () => { mode = mode === 'signup' ? 'login' : 'signup'; updateForm(); message(''); };
    $('cloud-reset').onclick = async () => {
      if (!client) return message('Check your connection and reload.');
      const email = $('cloud-email').value.trim();
      if (!email) return message('Enter your email first / أدخل الإيميل أولاً');
      const {error} = await client.auth.resetPasswordForEmail(email, {redirectTo: location.origin + '/'});
      message(error ? error.message : 'Check your inbox for the password reset link / راجع بريدك');
    };
    $('cloud-auth-retry').onclick = async () => {
      const {data} = await client.auth.getSession(); await loadUser(data.session);
    };
    $('cloud-refresh').onclick = () => refresh(true);
    $('cloud-retry').onclick = $('cloud-problem-retry').onclick = flush;
    $('cloud-download-draft').onclick = downloadDraft;
    $('cloud-use-server').onclick = useServer;
    $('cloud-migrate').onclick = () => {
      if (!ready || pending || saving) return;
      if (!confirm('Import this browser’s old shop data into the signed-in account? This replaces the account’s current workspace. Export a backup first if it contains data.\nنقل بيانات المتصفّح القديمة إلى حسابك الحالي واستبدال بياناته؟')) return;
      try {
        const old = validate(JSON.parse(localStorage.getItem(STORAGE_KEY)));
        apply(old); save();
      } catch(e) { showToast(e.message, 'error'); }
    };
    if (!window.supabase) { message('Unable to load the sign-in library. Check your connection and reload.\nتعذّر الاتصال. حدّث الصفحة.'); return; }
    client = window.supabase.createClient(URL, KEY);
    client.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        mode = 'recovery'; ready = false; updateForm(); openAuthGateway();
        message('Choose a new password / اختر كلمة سر جديدة');
      } else if (event === 'SIGNED_OUT') reset();
      else if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && mode !== 'recovery') {
        setTimeout(() => loadUser(session), 0);
      }
    });
    const {data, error} = await client.auth.getSession();
    if (error) message(error.message);
    else if (mode !== 'recovery') await loadUser(data.session);
    setInterval(() => refresh(), 15000);
    window.addEventListener('focus', () => refresh());
    window.addEventListener('online', () => pending ? flush() : refresh());
    window.addEventListener('offline', () => status('Offline — changes cannot sync / دون اتصال'));
    window.addEventListener('beforeunload', event => { if (pending || saving) { event.preventDefault(); event.returnValue = ''; } });
  }
  window.Cloud = {save, signOut};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else void start();
})();
