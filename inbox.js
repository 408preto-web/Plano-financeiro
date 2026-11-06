'use strict';

/* =========================================================
   Caixa de entrada das notificações do banco (Android + MacroDroid).

   O MacroDroid envia o texto de cada notificação dos apps do banco para o
   Supabase (função add_notification, protegida por um código secreto).
   O app baixa as notificações novas, entende quais são compras/Pix e
   mostra no Resumo para você lançar com um toque.

   Usa as funções globais de app.js, sync.js, cards.js e quick.js.
   ========================================================= */

const INBOX_DONE_KEY = 'plano-financeiro:inbox-done';
const inbox = { items: [], token: null, ready: null, error: '', loading: false };

/* ---------- Leitura das notificações ---------- */
const normTxt = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const NOTIF_IGNORE = /(oferta|promoc|recomenda|sugest|usou o limite|limite da conta|nao perca|vencendo hoje|boleto venc|fatura (fechou|esta fechada|disponivel|vence)|negad|recusad|nao aprovad|nao autorizad|cancelad|estorn|cashback|emprestimo|pre-aprovad|convite|investiment|rendeu|resgate disponivel|cupom|desconto de)/;
const NOTIF_INCOME = /(pix recebido|recebeu (um )?pix|voce recebeu|transferencia recebida|recebimento de|credito em conta|deposito recebido|caiu na (sua )?conta|salario)/;
const NOTIF_ACCOUNT = /(pix enviado|pix realizado|pix de r\$|enviou (um )?pix|transferencia (enviada|realizada)|compra no debito|debito aprovad|no debito|pagamento (de boleto |de conta )?(realizado|efetuado|confirmado)|boleto pago|saque)/;
const NOTIF_CARD = /(compra|credito|nupay|cartao)/;

function titleCase(s) {
  return String(s || '').toLowerCase().replace(/(^|[\s\-/&.])([a-zà-ú])/g, (m, a, b) => a + b.toUpperCase()).trim();
}
function isoFromNotification(n) {
  const d = n.created_at ? new Date(n.created_at) : new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Transforma uma notificação em lançamento (ou null se não for movimentação).
 * Retorna o mesmo formato de parseQuick (quick.js), com description = nome da loja/pessoa.
 */
function parseBankNotification(n) {
  const full = `${n.title || ''}. ${n.body || ''}`.replace(/\s+/g, ' ').trim();
  const t = normTxt(full);
  const amt = full.match(/R\$\s*(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2}|\d+(?:\.\d{2})?)/i);
  if (!amt || NOTIF_IGNORE.test(t)) return null;
  const amount = parseMoney(amt[1]);
  if (amount <= 0) return null;

  const income = NOTIF_INCOME.test(t) && !/compra/.test(t);
  const account = !income && NOTIF_ACCOUNT.test(t);
  const card = !income && !account && NOTIF_CARD.test(t);
  if (!income && !account && !card) return null;

  const final = (full.match(/final\s*(\d{4})/i) || [])[1];
  const dm = full.match(/\b(\d{2})\/(\d{2})(?:\/(\d{2,4}))?\b/);
  let date = isoFromNotification(n);
  if (dm) {
    let y = dm[3] ? Number(dm[3]) : Number(date.slice(0, 4));
    if (y < 100) y += 2000;
    date = ymdClamp(y, Number(dm[2]), Number(dm[1]));
  }
  const inst = Number((full.match(/\bem\s+(\d{1,2})\s*x\b/i) || [])[1] || 1);

  // Loja / pessoa
  let who = '';
  let m = full.match(/aprovad[ao]\s+em\s+(.+?)(?:\s+para\s+o\s+cart[aã]o.*)?\.?$/i);
  if (m) who = m[1];
  if (!who && income) { m = full.match(/\b(?:de|por)\s+([A-ZÀ-Úa-zà-ú][^,.\d]{2,60}?)(?:[,.]|\s+(?:no valor|de R\$|R\$)|$)/); if (m) who = m[1]; }
  if (!who && account) { m = full.match(/\bpara\s+([A-ZÀ-Úa-zà-ú][^,.\d]{2,60}?)(?:[,.]|\s+(?:no valor|de R\$|R\$)|$)/); if (m) who = m[1]; }
  if (!who) {
    const ems = [...full.matchAll(/\bem\s+([^,]+?)(?=,|\.\s|\.?$)/gi)].map((x) => x[1].trim())
      .filter((x) => !/^\d|^R\$|^\d+x/i.test(x) && !/\d{2}\/\d{2}/.test(x));
    who = ems[ems.length - 1] || '';
  }
  who = who.replace(/\s+(?:as|às)\s+\d{1,2}[:h]\d{2}.*$/i, '').replace(/[.\s]+$/, '').trim();
  const pretty = who ? titleCase(who) : (income ? 'Pix recebido' : account ? 'Pagamento' : 'Compra');

  // Monta uma frase e reaproveita o lançamento rápido (categoria, cartão, parcelas…)
  const parts = [income ? '+' : '', who || pretty, centsToInput(amount), `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`];
  if (inst > 1) parts.push(`${inst}x`);
  if (card) {
    const appCard = state.cards.find((c) => n.app && (normTxt(n.app).includes(normTxt(c.name)) || normTxt(c.name).includes(normTxt(n.app))));
    const nu = /nubank|nupay|\bnu\b/.test(t + ' ' + normTxt(n.app)) && state.cards.find((c) => /nu/.test(normTxt(c.name)));
    const bankCard = appCard || nu;
    // final cadastrado → usa o final; senão, o cartão do banco que mandou a notificação
    if (final && (state.cards.some((c) => c.final === final) || !bankCard)) parts.push(`final ${final}`);
    else parts.push(bankCard ? bankCard.name : 'cartão');
  }
  if (account) parts.push('pix');
  const r = parseQuick(parts.filter(Boolean).join(' '));
  r.amount = amount;
  r.date = date;
  r.description = pretty;
  r.type = income ? 'income' : 'expense';
  if (income) r.cardId = '';
  r.paid = true; // a movimentação já aconteceu
  if (!card) r.cardId = '';
  return r;
}

/* ---------- Supabase ---------- */
async function sbFetch(path, { method = 'GET', body, headers = {} } = {}) {
  const cfg = syncCfg();
  const auth = await validToken();
  if (!cfg || !auth) throw new Error('Sincronização não conectada');
  const res = await fetch(`${cfg.url}/rest/v1/${path}`, {
    method,
    headers: { apikey: cfg.key, Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.message || `erro ${res.status}`;
    const e = new Error(/does not exist|relation|schema cache|could not find/i.test(msg) ? 'missing' : msg);
    throw e;
  }
  return data;
}

function doneMap() { try { return JSON.parse(localStorage.getItem(INBOX_DONE_KEY)) || {}; } catch { return {}; } }
function setDone(map) { try { localStorage.setItem(INBOX_DONE_KEY, JSON.stringify(map)); } catch { /* ignora */ } }

/** Envia para a nuvem as notificações já tratadas neste aparelho (lançadas/ignoradas). */
async function flushInboxDone() {
  const map = doneMap();
  for (const [id, status] of Object.entries(map)) {
    try { await sbFetch(`inbox?id=eq.${id}`, { method: 'PATCH', body: { status } }); delete map[id]; } catch (e) { if (e.message === 'missing') break; }
  }
  setDone(map);
}

/** Baixa as notificações novas (chamado após cada sincronização). */
async function fetchInbox() {
  if (!syncCfg() || !getAuth() || !navigator.onLine || inbox.loading) return;
  inbox.loading = true;
  try {
    await flushInboxDone();
    const rows = await sbFetch('inbox?select=id,app,title,body,created_at&status=eq.new&order=created_at.asc&limit=200');
    inbox.ready = true; inbox.error = '';
    const toIgnore = [];
    const items = [];
    for (const n of rows) {
      const parsed = parseBankNotification(n);
      if (parsed) items.push({ ...n, parsed });
      else toIgnore.push(n.id); // propaganda, avisos etc.
    }
    for (const id of toIgnore) sbFetch(`inbox?id=eq.${id}`, { method: 'PATCH', body: { status: 'ignored' } }).catch(() => {});
    const changed = JSON.stringify(items.map((i) => i.id)) !== JSON.stringify(inbox.items.map((i) => i.id));
    inbox.items = items;
    if (changed && !modal.open && ui.view === 'dashboard' && !document.activeElement?.matches?.('input, textarea')) render();
  } catch (e) {
    inbox.ready = e.message === 'missing' ? false : inbox.ready;
    inbox.error = e.message;
  } finally {
    inbox.loading = false;
  }
}

/** Notificações a mostrar: novas, não tratadas aqui e ainda não lançadas em outro aparelho. */
function pendingInbox() {
  const done = doneMap();
  const launched = new Set(state.transactions.map((t) => t.sourceId).filter(Boolean));
  return inbox.items.filter((i) => !done[i.id] && !launched.has(`inbox-${i.id}`));
}

function markInbox(id, status) {
  const map = doneMap(); map[id] = status; setDone(map);
  flushInboxDone().catch(() => {});
}

function launchInbox(item) {
  const { warnings, repeat, count, ...data } = item.parsed;
  addTransactions({ ...data, sourceId: `inbox-${item.id}` }, repeat, count);
  markInbox(item.id, 'added');
}

/* ---------- Interface: Resumo ---------- */
function inboxBanner() {
  const items = pendingInbox();
  if (!items.length) return '';
  const rows = items.map((i) => {
    const r = i.parsed;
    const c = catById(r.categoryId);
    const card = r.cardId && cardById(r.cardId);
    return `<li class="inbox-row">
      <div class="tx-icon" style="background:${c.color}22">${c.icon}</div>
      <div class="inbox-main">
        <div class="tx-title">${esc(r.description)} <b class="${r.type === 'income' ? 'pos' : 'neg'}">${r.type === 'income' ? '+' : '−'} ${money(r.amount)}</b></div>
        <div class="tx-meta">${fmtDate(r.date)} · ${esc(c.name)} · ${card ? '💳 ' + esc(cardLabel(card)) : r.type === 'income' ? '🏦 entrou na conta' : '🏦 saldo em conta'}${r.repeat === 'installments' ? ` · ${r.count}x` : ''}</div>
        ${r.warnings.length ? `<div class="quick-warn">⚠️ ${esc(r.warnings[0])}</div>` : ''}
        <details class="inbox-src"><summary>ver notificação</summary>${esc([i.app, i.title, i.body].filter(Boolean).join(' · '))}</details>
      </div>
      <div class="inbox-actions">
        <button class="btn small primary" data-inbox-add="${i.id}">Lançar</button>
        <button class="btn small" data-inbox-edit="${i.id}">Editar</button>
        <button class="btn small" data-inbox-skip="${i.id}" aria-label="Ignorar">Ignorar</button>
      </div>
    </li>`;
  }).join('');
  return `<div class="card inbox">
    <div class="card-head"><h2>📥 Detectado nas notificações do banco <span class="muted">(${items.length})</span></h2>
      ${items.length > 1 ? '<button class="btn small primary" id="inboxAddAll">Lançar todas</button>' : ''}</div>
    <ul class="inbox-list">${rows}</ul>
  </div>`;
}

function bindInbox(v) {
  const find = (id) => inbox.items.find((i) => String(i.id) === String(id));
  $$('[data-inbox-add]', v).forEach((b) => b.addEventListener('click', () => {
    const it = find(b.dataset.inboxAdd); if (!it) return;
    launchInbox(it); save(); render(); toast('Lançado ✅');
  }));
  $$('[data-inbox-skip]', v).forEach((b) => b.addEventListener('click', () => {
    markInbox(b.dataset.inboxSkip, 'ignored'); render(); toast('Notificação ignorada');
  }));
  $$('[data-inbox-edit]', v).forEach((b) => b.addEventListener('click', () => {
    const it = find(b.dataset.inboxEdit); if (!it) return;
    const { warnings, repeat, count, ...data } = it.parsed;
    const before = state.transactions.length;
    openTxForm(null, { ...data, sourceId: `inbox-${it.id}` });
    // quando o formulário salvar, marca a notificação como lançada
    const onClose = () => {
      modal.removeEventListener('close', onClose);
      if (state.transactions.length > before) { markInbox(it.id, 'added'); render(); }
    };
    modal.addEventListener('close', onClose);
  }));
  $('#inboxAddAll', v)?.addEventListener('click', () => {
    const items = pendingInbox();
    items.forEach(launchInbox);
    save(); render(); toast(`${items.length} lançamentos adicionados ✅`);
  });
}

/* ---------- Interface: Ajustes ---------- */
function randomToken() {
  const a = new Uint8Array(18); crypto.getRandomValues(a);
  return Array.from(a, (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
}

async function loadInboxToken(create = false) {
  const rows = await sbFetch('inbox_tokens?select=token');
  if (rows[0]) return (inbox.token = rows[0].token);
  if (!create) return null;
  const auth = getAuth();
  const ins = await sbFetch('inbox_tokens', { method: 'POST', body: { user_id: auth.user.id, token: randomToken() } });
  return (inbox.token = ins[0].token);
}

function macroBody(token) {
  return `{"p_token":"${token}","p_app":"[not_app_name]","p_title":"[not_title]","p_text":"[notification]"}`;
}

function inboxCardHtml() {
  if (!syncCfg() || !getAuth()) {
    return `<div class="card mt" id="inboxCard"><h2>📥 Notificações do banco (Android)</h2>
      <p class="muted">Conecte a sincronização acima primeiro.</p></div>`;
  }
  const cfg = syncCfg();
  if (!inbox.token) {
    return `<div class="card mt" id="inboxCard"><h2>📥 Notificações do banco (Android)</h2>
      <p class="muted">Com o app <b>MacroDroid</b> no celular, as notificações de compra e Pix dos seus bancos aparecem aqui para lançar com um toque.</p>
      ${inbox.ready === false || inbox.error === 'missing' ? '<p class="neg" style="font-size:14px">Falta criar a caixa de entrada no Supabase: rode o script <b>supabase-notificacoes.sql</b> no SQL Editor.</p>' : ''}
      ${inbox.error && inbox.error !== 'missing' ? `<p class="neg" style="font-size:14px">${esc(inbox.error)}</p>` : ''}
      <button class="btn primary" id="inboxEnable">Ativar notificações do banco</button></div>`;
  }
  const url = `${cfg.url}/rest/v1/rpc/add_notification`;
  const field = (label, value, id) => `<div class="copy-field"><span>${label}</span><code id="${id}">${esc(value)}</code><button class="btn small" data-copy="${id}">Copiar</button></div>`;
  return `<div class="card mt" id="inboxCard"><h2>📥 Notificações do banco (Android)</h2>
    <p class="muted">Configure no <b>MacroDroid</b> (no celular). Use os botões <b>Copiar</b> e cole em cada campo.</p>
    <ol class="steps">
      <li><b>Adicionar macro</b> → em <b>Gatilhos</b>, toque em <b>+</b> → <b>Notificação recebida</b> (Notification Received) → escolha os apps dos bancos (Santander, Nubank…) → conteúdo: <b>Qualquer</b>. Dê a permissão de acesso às notificações quando pedir.</li>
      <li>Em <b>Ações</b>, toque em <b>+</b> → <b>Requisição HTTP</b> (HTTP Request) → método <b>POST</b>.</li>
      <li>Cole a <b>URL</b>:${field('URL', url, 'cpUrl')}</li>
      <li>Em <b>Cabeçalhos</b> (Headers), adicione dois:
        ${field('Nome: apikey — Valor:', cfg.key, 'cpKey')}
        ${field('Nome: Content-Type — Valor:', 'application/json', 'cpCt')}</li>
      <li>Em <b>Corpo</b> (Body/Content), tipo <b>application/json</b>, cole:${field('Corpo', macroBody(inbox.token), 'cpBody')}
        <small class="muted">[not_app_name], [not_title] e [notification] são “textos mágicos” do MacroDroid (nome do app, título e texto da notificação). Se o MacroDroid não reconhecer, apague-os e insira pelo botão <b>…</b> / <b>Texto mágico</b>.</small></li>
      <li>Salve a macro (nome: “Plano Financeiro”). Em Configurações do Android, deixe o MacroDroid <b>sem restrição de bateria</b>.</li>
    </ol>
    <div class="row-actions">
      <button class="btn" id="inboxTest">Enviar notificação de teste</button>
      <button class="btn" id="inboxCheck">Buscar notificações agora</button>
    </div>
    ${inbox.error && inbox.error !== 'missing' ? `<p class="neg" style="font-size:14px">${esc(inbox.error)}</p>` : ''}
    <p class="muted" style="font-size:13px">Propagandas e avisos (ofertas, limite, boleto vencendo…) são ignorados automaticamente. O código no corpo é secreto: não compartilhe.</p></div>`;
}

function bindInboxCard(v) {
  const card = $('#inboxCard', v);
  if (!card) return;
  if (getAuth() && syncCfg() && !inbox.token && inbox.ready !== false && !inbox.tokenTried) {
    inbox.tokenTried = true;
    loadInboxToken(false).then((t) => { if (t && ui.view === 'settings') render(); }).catch((e) => { inbox.error = e.message; inbox.ready = e.message === 'missing' ? false : inbox.ready; if (ui.view === 'settings') render(); });
  }
  $('#inboxEnable', card)?.addEventListener('click', async (e) => {
    e.target.disabled = true; e.target.textContent = 'Ativando…';
    try { await loadInboxToken(true); inbox.error = ''; inbox.ready = true; toast('Ativado ✅'); }
    catch (err) { inbox.error = err.message; if (err.message === 'missing') inbox.ready = false; }
    render();
  });
  $$('[data-copy]', card).forEach((b) => b.addEventListener('click', async () => {
    const text = $('#' + b.dataset.copy).textContent;
    try { await navigator.clipboard.writeText(text); toast('Copiado ✅'); } catch { prompt('Copie:', text); }
  }));
  $('#inboxTest', card)?.addEventListener('click', async () => {
    const cfg = syncCfg();
    const d = new Date();
    const text = `Compra no cartão final 0000, de R$ 1,23, em ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}, às ${pad(d.getHours())}:${pad(d.getMinutes())}, em TESTE DO PLANO FINANCEIRO.`;
    try {
      const res = await fetch(`${cfg.url}/rest/v1/rpc/add_notification`, {
        method: 'POST', headers: { apikey: cfg.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_token: inbox.token, p_app: 'Teste', p_title: 'Compra aprovada!', p_text: text }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || `erro ${res.status}`);
      await fetchInbox();
      toast('Teste enviado ✅ Veja no Resumo');
      setView('dashboard');
    } catch (err) { toast('Falhou: ' + err.message); }
  });
  $('#inboxCheck', card)?.addEventListener('click', async () => {
    await fetchInbox();
    toast(pendingInbox().length ? `${pendingInbox().length} notificação(ões) para lançar` : 'Nenhuma notificação nova');
    if (pendingInbox().length) setView('dashboard');
  });
}
