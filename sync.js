'use strict';

/* =========================================================
   Sincronização entre aparelhos (iPad, celular…) via Supabase.

   - Cada aparelho continua funcionando offline com os dados no próprio aparelho.
   - Com internet e login feito, os dados são enviados/recebidos automaticamente.
   - A junção é feita registro por registro (lançamentos, cartões, metas…):
     vale a versão alterada por último, e exclusões são lembradas.
     Assim, lançamentos feitos em aparelhos diferentes, mesmo offline, não se perdem.

   Configuração: config.js (endereço do projeto e chave pública do Supabase).
   Usa as funções e o estado globais definidos em app.js.
   ========================================================= */

const AUTH_KEY = 'plano-financeiro:auth';
const SYNC_COLLECTIONS = ['transactions', 'categories', 'goals', 'investments', 'cards'];
const SYNC_FIELDS = ['budgets', 'market', 'openingBalance', 'balanceSetAt', 'invoicePayments', 'settings', 'lastBackup'];

const syncCfg = () => (window.SYNC_CONFIG && window.SYNC_CONFIG.url && window.SYNC_CONFIG.key ? window.SYNC_CONFIG : null);
const sync = { status: 'off', message: '', lastSync: null, timer: null, running: false, again: false };

/* ---------- Registro de alterações (carimbo de data em cada mudança) ---------- */
let snapshot = null;
const recKey = (r) => { const { updatedAt, ...rest } = r; return JSON.stringify(rest); };

function ensureSyncMeta(s) {
  s.sync ||= {};
  s.sync.deleted ||= {};
  s.sync.fieldTimes ||= {};
  return s;
}

/** Guarda como os dados estão agora, para comparar no próximo save(). */
function takeSnapshot() {
  ensureSyncMeta(state);
  snapshot = { colls: {}, fields: {} };
  for (const c of SYNC_COLLECTIONS) snapshot.colls[c] = new Map((state[c] || []).map((r) => [r.id, recKey(r)]));
  for (const f of SYNC_FIELDS) snapshot.fields[f] = JSON.stringify(state[f] ?? null);
}

/** Marca com a hora atual tudo que mudou desde o último snapshot (chamado dentro de save()). */
function stampChanges() {
  if (!snapshot) return takeSnapshot();
  ensureSyncMeta(state);
  const now = Date.now();
  let changed = false;
  for (const c of SYNC_COLLECTIONS) {
    const prev = snapshot.colls[c];
    const seen = new Set();
    for (const r of state[c] || []) {
      seen.add(r.id);
      if (prev.get(r.id) !== recKey(r)) { r.updatedAt = now; changed = true; }
    }
    for (const id of prev.keys()) if (!seen.has(id)) { state.sync.deleted[id] = now; changed = true; }
  }
  for (const f of SYNC_FIELDS) {
    if (snapshot.fields[f] !== JSON.stringify(state[f] ?? null)) { state.sync.fieldTimes[f] = now; changed = true; }
  }
  takeSnapshot();
  return changed;
}

/** Junta os dados locais com os da nuvem. Empate: vale a nuvem. */
function mergeStates(local, remote) {
  ensureSyncMeta(local); ensureSyncMeta(remote);
  const out = { ...local, sync: { deleted: { ...local.sync.deleted }, fieldTimes: { ...local.sync.fieldTimes } } };
  for (const [id, t] of Object.entries(remote.sync.deleted)) out.sync.deleted[id] = Math.max(out.sync.deleted[id] || 0, t);
  for (const c of SYNC_COLLECTIONS) {
    const l = new Map((local[c] || []).map((r) => [r.id, r]));
    const r = new Map((remote[c] || []).map((x) => [x.id, x]));
    const order = [...l.keys(), ...[...r.keys()].filter((id) => !l.has(id))];
    out[c] = order.map((id) => {
      const a = l.get(id), b = r.get(id);
      return !a ? b : !b ? a : (b.updatedAt || 0) >= (a.updatedAt || 0) ? b : a;
    }).filter((rec) => !(out.sync.deleted[rec.id] >= (rec.updatedAt || 0) && out.sync.deleted[rec.id]));
  }
  for (const f of SYNC_FIELDS) {
    const lt = local.sync.fieldTimes[f] || 0, rt = remote.sync.fieldTimes[f] || 0;
    if (remote[f] !== undefined && rt >= lt) out[f] = remote[f];
    out.sync.fieldTimes[f] = Math.max(lt, rt);
  }
  return out;
}

/* ---------- Login (Supabase Auth via HTTP) ---------- */
function getAuth() { try { return JSON.parse(localStorage.getItem(AUTH_KEY)); } catch { return null; } }
function setAuth(a) { try { a ? localStorage.setItem(AUTH_KEY, JSON.stringify(a)) : localStorage.removeItem(AUTH_KEY); } catch { /* ignora */ } }

async function authRequest(path, body) {
  const cfg = syncCfg();
  const res = await fetch(`${cfg.url}/auth/v1/${path}`, {
    method: 'POST', headers: { apikey: cfg.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(authErrorText(data));
  return data;
}
function authErrorText(d) {
  const m = String(d.error_description || d.msg || d.message || d.error || 'erro desconhecido');
  if (/invalid login/i.test(m)) return 'E-mail ou senha incorretos.';
  if (/already registered|already exists/i.test(m)) return 'Este e-mail já tem conta. Use “Entrar”.';
  if (/password.*(6|short|least)/i.test(m)) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (/not confirmed/i.test(m)) return 'Confirme o e-mail (veja sua caixa de entrada) e tente de novo.';
  if (/signups? not allowed|disabled/i.test(m)) return 'Criação de novas contas está desativada no Supabase.';
  return m;
}
function saveSession(d) {
  if (!d.access_token) throw new Error('Conta criada. Confirme o e-mail recebido e depois toque em “Entrar”.');
  setAuth({ access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + (d.expires_in || 3600) * 1000, user: { id: d.user.id, email: d.user.email } });
}
async function signIn(email, password) { saveSession(await authRequest('token?grant_type=password', { email, password })); }
async function signUp(email, password) { saveSession(await authRequest('signup', { email, password })); }
function signOut() { setAuth(null); sync.status = 'loggedout'; updateSyncBadge(); }

async function validToken() {
  const a = getAuth();
  if (!a) return null;
  if (Date.now() < a.expires_at - 60000) return a;
  try {
    saveSession(await authRequest('token?grant_type=refresh_token', { refresh_token: a.refresh_token }));
    return getAuth();
  } catch (e) {
    if (!navigator.onLine) throw e;
    setAuth(null);
    throw new Error('Sua sessão expirou. Entre novamente em Ajustes → Sincronização.');
  }
}

/* ---------- Dados na nuvem (tabela app_state) ---------- */
async function rest(method, query, body, token) {
  const cfg = syncCfg();
  const res = await fetch(`${cfg.url}/rest/v1/app_state${query}`, {
    method,
    headers: { apikey: cfg.key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 409) return { conflict: true };
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.message || `erro ${res.status}`;
    throw new Error(/does not exist|relation|schema cache/i.test(msg) ? 'A tabela app_state não foi criada no Supabase (veja o passo 2 das instruções).' : msg);
  }
  return { rows: data || [] };
}

const comparable = (s) => { const c = { ...s }; delete c.lastSyncAt; return JSON.stringify(c); };

/** Baixa, junta e envia. Seguro para chamar várias vezes. */
async function syncNow({ manual = false } = {}) {
  if (!syncCfg()) { sync.status = 'off'; return updateSyncBadge(); }
  if (!getAuth()) { sync.status = 'loggedout'; return updateSyncBadge(); }
  if (!navigator.onLine) { sync.status = 'offline'; return updateSyncBadge(); }
  if (sync.running) { sync.again = true; return; }
  sync.running = true; sync.status = 'syncing'; updateSyncBadge();
  try {
    const auth = await validToken();
    for (let attempt = 0; attempt < 4; attempt++) {
      stampChanges();
      const { rows } = await rest('GET', '?select=data,rev', null, auth.access_token);
      const remote = rows[0];
      const merged = remote ? mergeStates(state, remote.data) : state;
      if (comparable(merged) !== comparable(state)) applyMerged(merged);
      if (remote && comparable(remote.data) === comparable(state)) break; // nuvem já está igual
      const res = remote
        ? await rest('PATCH', `?user_id=eq.${auth.user.id}&rev=eq.${remote.rev}`, { data: state, rev: remote.rev + 1, updated_at: new Date().toISOString() }, auth.access_token)
        : await rest('POST', '', { user_id: auth.user.id, data: state, rev: 1 }, auth.access_token);
      if (!res.conflict && res.rows.length) break; // enviado
      // outro aparelho enviou ao mesmo tempo: baixa de novo e junta
    }
    sync.lastSync = new Date();
    sync.status = 'ok'; sync.message = '';
    if (manual) toast('Sincronizado ☁️');
  } catch (e) {
    sync.status = navigator.onLine ? 'error' : 'offline';
    sync.message = e.message || String(e);
    if (!getAuth()) sync.status = 'loggedout';
    if (manual) toast(sync.message);
  } finally {
    sync.running = false;
    updateSyncBadge();
    if (ui.view === 'settings' && !modal.open && !document.activeElement?.closest?.('#syncCard')) render();
    if (sync.again) { sync.again = false; scheduleSync(500); }
  }
}

/** Aplica dados juntados sem marcá-los como “alterados neste aparelho”. */
function applyMerged(merged) {
  state = migrate(merged);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignora */ }
  takeSnapshot();
  if (!modal.open) render();
}

function scheduleSync(ms = 1500) {
  if (!syncCfg() || !getAuth()) return;
  clearTimeout(sync.timer);
  sync.timer = setTimeout(() => syncNow(), ms);
}

/* ---------- Interface ---------- */
function syncLabel() {
  switch (sync.status) {
    case 'off': return { icon: '☁️', text: 'Sincronização não configurada', cls: 'muted' };
    case 'loggedout': return { icon: '☁️', text: 'Entrar para sincronizar', cls: 'warn' };
    case 'syncing': return { icon: '🔄', text: 'Sincronizando…', cls: 'muted' };
    case 'offline': return { icon: '📴', text: 'Sem internet — sincroniza quando voltar', cls: 'muted' };
    case 'error': return { icon: '⚠️', text: 'Erro ao sincronizar', cls: 'warn' };
    default: return { icon: '✅', text: `Sincronizado ${sync.lastSync ? 'às ' + sync.lastSync.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}`, cls: 'ok' };
  }
}
function updateSyncBadge() {
  const el = $('#syncStatus');
  if (!el) return;
  if (!syncCfg()) { el.hidden = true; return; }
  const l = syncLabel();
  el.hidden = false;
  el.className = `sync-pill ${l.cls}`;
  el.innerHTML = `<span>${l.icon}</span><span class="sync-text">${esc(l.text)}</span>`;
  el.title = sync.message || l.text;
}

function syncCardHtml() {
  if (!syncCfg()) {
    return `<div class="card mt" id="syncCard"><h2>☁️ Sincronização entre aparelhos</h2>
      <p class="muted">Ainda não configurada. Depois de criar o projeto gratuito no Supabase, informe o endereço e a chave em <code>config.js</code>
      (o passo a passo está no README do projeto).</p></div>`;
  }
  const a = getAuth();
  if (!a) {
    return `<div class="card mt" id="syncCard"><h2>☁️ Sincronização entre aparelhos</h2>
      <p class="muted">Entre com a mesma conta no iPad e no celular para os dados ficarem iguais nos dois.</p>
      <div class="form-grid">
        <label class="field full"><span>E-mail</span><input type="email" id="syncEmail" autocomplete="username" inputmode="email" autocapitalize="off"></label>
        <label class="field full"><span>Senha (mínimo 6 caracteres)</span><input type="password" id="syncPass" autocomplete="current-password"></label>
      </div>
      ${sync.message ? `<p class="neg" style="font-size:14px">${esc(sync.message)}</p>` : ''}
      <div class="row-actions mt">
        <button class="btn primary" id="syncLogin">Entrar</button>
        <button class="btn" id="syncSignup">Criar conta (primeira vez)</button>
      </div></div>`;
  }
  const l = syncLabel();
  return `<div class="card mt" id="syncCard"><h2>☁️ Sincronização entre aparelhos</h2>
    <p>Conectado como <b>${esc(a.user.email)}</b></p>
    <p class="sync-line ${l.cls}">${l.icon} ${esc(l.text)}</p>
    ${sync.message && sync.status === 'error' ? `<p class="neg" style="font-size:14px">${esc(sync.message)}</p>` : ''}
    <p class="muted" style="font-size:13px">Sincroniza sozinho a cada alteração, ao abrir o app e quando a internet volta.</p>
    <div class="row-actions">
      <button class="btn primary" id="syncNowBtn">Sincronizar agora</button>
      <button class="btn" id="syncLogout">Sair desta conta</button>
    </div></div>`;
}

function bindSyncCard(v) {
  const card = $('#syncCard', v);
  if (!card) return;
  const creds = () => ({ email: $('#syncEmail').value.trim(), pass: $('#syncPass').value });
  const doAuth = async (fn, btn) => {
    const { email, pass } = creds();
    if (!email || !pass) { toast('Informe e-mail e senha'); return; }
    btn.disabled = true; btn.textContent = 'Aguarde…';
    try {
      await fn(email, pass);
      sync.message = '';
      toast('Conectado ☁️');
      await syncNow({ manual: true });
    } catch (e) {
      sync.message = e.message;
    }
    render();
  };
  $('#syncLogin', card)?.addEventListener('click', (e) => doAuth(signIn, e.target));
  $('#syncSignup', card)?.addEventListener('click', (e) => doAuth(signUp, e.target));
  $('#syncNowBtn', card)?.addEventListener('click', () => syncNow({ manual: true }));
  $('#syncLogout', card)?.addEventListener('click', () => {
    if (!confirm('Sair da conta neste aparelho? Os dados continuam salvos aqui e na nuvem.')) return;
    signOut(); render();
  });
}

function initSync() {
  takeSnapshot();
  sync.status = !syncCfg() ? 'off' : getAuth() ? (navigator.onLine ? 'ok' : 'offline') : 'loggedout';
  updateSyncBadge();
  $('#syncStatus')?.addEventListener('click', () => setView('settings'));
  if (!syncCfg()) return;
  window.addEventListener('online', () => syncNow());
  window.addEventListener('offline', () => { sync.status = 'offline'; updateSyncBadge(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60000);
  syncNow();
}
