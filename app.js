'use strict';

/* =========================================================
   Plano Financeiro — controle financeiro pessoal offline
   Todos os dados ficam salvos no próprio aparelho (localStorage).
   ========================================================= */

const STORAGE_KEY = 'plano-financeiro:v1';

const DEFAULT_CATEGORIES = [
  { id: 'c-salario', name: 'Salário', type: 'income', icon: '💼', color: '#16a34a' },
  { id: 'c-extra', name: 'Renda extra', type: 'income', icon: '💡', color: '#0d9488' },
  { id: 'c-invest', name: 'Rendimentos', type: 'income', icon: '📈', color: '#2563eb' },
  { id: 'c-resgate', name: 'Resgate de investimento', type: 'income', icon: '🏧', color: '#0891b2' },
  { id: 'c-moradia', name: 'Moradia', type: 'expense', icon: '🏠', color: '#7c3aed' },
  { id: 'c-mercado', name: 'Mercado', type: 'expense', icon: '🛒', color: '#ea580c' },
  { id: 'c-alimentacao', name: 'Alimentação', type: 'expense', icon: '🍽️', color: '#f59e0b' },
  { id: 'c-transporte', name: 'Transporte', type: 'expense', icon: '🚗', color: '#0284c7' },
  { id: 'c-saude', name: 'Saúde', type: 'expense', icon: '💊', color: '#dc2626' },
  { id: 'c-educacao', name: 'Educação', type: 'expense', icon: '📚', color: '#4f46e5' },
  { id: 'c-lazer', name: 'Lazer', type: 'expense', icon: '🎉', color: '#db2777' },
  { id: 'c-contas', name: 'Contas e serviços', type: 'expense', icon: '💡', color: '#0891b2' },
  { id: 'c-assinaturas', name: 'Assinaturas', type: 'expense', icon: '📺', color: '#9333ea' },
  { id: 'c-cartao', name: 'Cartão de crédito', type: 'expense', icon: '💳', color: '#475569' },
  { id: 'c-aplicacao', name: 'Investimentos', type: 'expense', icon: '💰', color: '#0f766e' },
  { id: 'c-outros', name: 'Outros', type: 'expense', icon: '📦', color: '#64748b' },
];

/* ---------- Utilidades ---------- */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = (cents) => brl.format((cents || 0) / 100);
const moneyShort = (cents) => {
  const v = Math.abs(cents) / 100;
  if (v >= 1e6) return (cents < 0 ? '-' : '') + 'R$ ' + (v / 1e6).toFixed(1).replace('.', ',') + 'M';
  if (v >= 1e3) return (cents < 0 ? '-' : '') + 'R$ ' + (v / 1e3).toFixed(1).replace('.', ',') + 'k';
  return (cents < 0 ? '-' : '') + 'R$ ' + Math.round(v);
};

/** Converte "1.234,56", "1234,56" ou "1234.56" em centavos. */
function parseMoney(str) {
  let s = String(str || '').replace(/[^\d,.-]/g, '');
  if (!s) return 0;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (lastDot > lastComma && lastComma !== -1) {
    s = s.replace(/,/g, '');
  } else if (lastComma === -1 && (s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
const centsToInput = (c) => (c / 100).toFixed(2).replace('.', ',');

const pad = (n) => String(n).padStart(2, '0');
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const monthOf = (iso) => iso.slice(0, 7);
function addMonths(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
function addMonthsToDate(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(y, m - 1 + delta, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(Math.min(d, last))}`;
}
const monthName = (ym, opts = { month: 'long', year: 'numeric' }) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', opts);
};
const dayLabel = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'short' });
};
const shortDate = (iso) => iso.split('-').reverse().slice(0, 2).join('/');

/* ---------- Estado ---------- */
function defaultState() {
  return {
    version: 1,
    transactions: [],
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    budgets: {},
    goals: [],
    investments: [],
    market: defaultMarket(),
    openingBalance: 0,     // ajustado em “Saldo em conta” (centavos)
    balanceSetAt: null,
    cards: [],             // cartões de crédito
    invoicePayments: {},   // "cartão|vencimento" -> { date } das faturas pagas
    settings: { alertDays: 7 }, // avisar contas/faturas com N dias de antecedência
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return migrate(JSON.parse(raw));
  } catch (e) {
    console.error(e);
    return defaultState();
  }
}

/** Completa dados salvos por versões anteriores do app. */
function migrate(data) {
  const s = { ...defaultState(), ...data };
  s.market = { ...defaultMarket(), ...(data.market || {}) };
  if (!Array.isArray(s.market.cdi) || !s.market.cdi.length) s.market.cdi = defaultMarket().cdi;
  if (!Array.isArray(s.cards)) s.cards = [];
  s.settings = { ...defaultState().settings, ...(data.settings || {}) };
  if (!s.invoicePayments || typeof s.invoicePayments !== 'object') s.invoicePayments = {};
  for (const id of ['c-aplicacao', 'c-resgate']) {
    if (!s.categories.some((c) => c.id === id)) s.categories.push({ ...DEFAULT_CATEGORIES.find((c) => c.id === id) });
  }
  return s;
}

let state = loadState();
const ui = {
  view: 'dashboard',
  month: monthOf(todayISO()),
  filter: { q: '', type: 'all', cat: 'all', status: 'all' },
  quickText: '',   // texto em digitação no lançamento rápido
  lastQuick: null, // último lançamento rápido (para desfazer)
};

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('Não foi possível salvar os dados!');
  }
}

const catById = (id) => state.categories.find((c) => c.id === id) || { name: 'Sem categoria', icon: '❔', color: '#94a3b8', type: 'expense' };
const txOfMonth = (ym) => state.transactions.filter((t) => monthOf(t.date) === ym);

function totals(list) {
  let income = 0, expense = 0, pendingExpense = 0, pendingIncome = 0, card = 0;
  for (const t of list) {
    if (t.type === 'income') { income += t.amount; if (!t.paid) pendingIncome += t.amount; }
    else if (t.cardId) { expense += t.amount; card += t.amount; }
    else { expense += t.amount; if (!t.paid) pendingExpense += t.amount; }
  }
  return { income, expense, balance: income - expense, pendingExpense, pendingIncome, card };
}

/**
 * Saldo em conta: saldo inicial + lançamentos até a data informada (inclusive).
 * Por padrão conta só o que já foi pago/recebido; com includePending conta também o previsto.
 * Compras no cartão não entram aqui: o que sai do saldo é o pagamento da fatura.
 */
function accountBalance(untilISO, includePending = false) {
  let b = state.openingBalance || 0;
  for (const t of state.transactions) {
    if (t.cardId) continue;
    const when = t.paid ? t.paidDate || t.date : t.date; // pago antes do vencimento sai do saldo no dia do pagamento
    if (when <= untilISO && (t.paid || includePending)) b += t.type === 'income' ? t.amount : -t.amount;
  }
  return b - invoicesBalanceEffect(untilISO, includePending);
}
const endOfMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${pad(new Date(y, m, 0).getDate())}`; };

/* ---------- Toast ---------- */
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------- Navegação ---------- */
function setView(v) {
  ui.view = v;
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  render();
  window.scrollTo({ top: 0 });
}

function render() {
  const ml = monthName(ui.month);
  const showMonth = ['dashboard', 'transactions', 'budgets'].includes(ui.view);
  const titles = { cards: 'Cartões de crédito', goals: 'Metas', investments: 'Investimentos', settings: 'Ajustes' };
  $('#monthLabel').textContent = showMonth ? ml.charAt(0).toUpperCase() + ml.slice(1) : titles[ui.view];
  $('#monthLabel').style.textAlign = showMonth ? '' : 'left';
  $$('#prevMonth, #nextMonth').forEach((el) => { el.style.display = showMonth ? '' : 'none'; });
  const views = { dashboard: renderDashboard, transactions: renderTransactions, cards: renderCards, budgets: renderBudgets, goals: renderGoals, investments: renderInvestments, settings: renderSettings };
  $('#view').innerHTML = views[ui.view]();
  bindView();
  updateCardBadges();
}

/* ---------- Componentes ---------- */
function txItem(t, { showDate = true } = {}) {
  const c = catById(t.categoryId);
  const sign = t.type === 'income' ? '+' : '−';
  const cls = t.type === 'income' ? 'pos' : 'neg';
  const card = t.cardId && cardById(t.cardId);
  const pending = card ? `<span class="badge cc" style="--cc:${card.color}">💳 ${esc(card.name)}</span>`
    : !t.paid ? (t.type === 'income' ? '<span class="badge paid">a receber</span>' : '<span class="badge">a pagar</span>') : '';
  const inst = t.installment ? ` · ${t.installment}` : '';
  return `<li class="tx" data-tx="${t.id}">
    <div class="tx-icon" style="background:${c.color}22">${c.icon}</div>
    <div class="tx-main">
      <div class="tx-title">${esc(t.description || c.name)}${pending}</div>
      <div class="tx-meta">${esc(c.name)}${showDate ? ' · ' + shortDate(t.date) : ''}${esc(inst)}</div>
    </div>
    <div class="tx-amount ${cls}">${sign} ${money(t.amount)}</div>
  </li>`;
}

function donutChart(items, emptyMsg = 'Sem despesas neste mês') {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!total) return `<div class="empty">${emptyMsg}</div>`;
  const r = 70, cx = 90, cy = 90, sw = 26, C = 2 * Math.PI * r;
  let offset = 0;
  const segs = items.map((i) => {
    const len = (i.value / total) * C;
    const seg = `<circle r="${r}" cx="${cx}" cy="${cy}" fill="none" stroke="${i.color}" stroke-width="${sw}"
      stroke-dasharray="${Math.max(len - 1.5, 0.5)} ${C}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"><title>${esc(i.label)}: ${money(i.value)}</title></circle>`;
    offset += len;
    return seg;
  }).join('');
  const legend = items.map((i) => `<li><span class="dot" style="background:${i.color}"></span><span>${i.icon} ${esc(i.label)}</span><span class="v">${money(i.value)} <span class="muted">${Math.round(i.value / total * 100)}%</span></span></li>`).join('');
  return `<div class="donut-layout">
    <div class="chart-wrap"><svg viewBox="0 0 180 180" role="img" aria-label="Gráfico de distribuição">${segs}
      <text x="90" y="86" text-anchor="middle" font-size="12" fill="var(--muted)">Total</text>
      <text x="90" y="104" text-anchor="middle" font-size="15" font-weight="700" fill="var(--text)">${moneyShort(total)}</text>
    </svg></div>
    <ul class="legend">${legend}</ul>
  </div>`;
}

function barsChart(months) {
  const W = 560, H = 220, padL = 52, padB = 28, padT = 10;
  const max = Math.max(1, ...months.flatMap((m) => [m.income, m.expense]));
  const step = (W - padL) / months.length;
  const bw = Math.min(22, step / 3);
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  const ticks = [0, 0.5, 1].map((f) => {
    const v = max * f;
    return `<line x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="var(--border)" />
      <text x="${padL - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${moneyShort(v)}</text>`;
  }).join('');
  const bars = months.map((m, i) => {
    const x = padL + step * i + step / 2;
    return `<rect x="${x - bw - 2}" y="${y(m.income)}" width="${bw}" height="${H - padB - y(m.income)}" rx="4" fill="var(--income)"><title>Receitas: ${money(m.income)}</title></rect>
      <rect x="${x + 2}" y="${y(m.expense)}" width="${bw}" height="${H - padB - y(m.expense)}" rx="4" fill="var(--expense)"><title>Despesas: ${money(m.expense)}</title></rect>
      <text x="${x}" y="${H - 8}" text-anchor="middle" font-size="12" fill="${m.current ? 'var(--text)' : 'var(--muted)'}" font-weight="${m.current ? 700 : 400}">${esc(m.label)}</text>`;
  }).join('');
  return `<div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Receitas e despesas dos últimos meses">${ticks}${bars}</svg></div>
    <div class="chart-legend"><span style="color:var(--income)">Receitas</span><span style="color:var(--expense)">Despesas</span></div>`;
}

/* ---------- Telas ---------- */
function renderDashboard() {
  const list = txOfMonth(ui.month);
  const t = totals(list);
  const today = todayISO();
  const isCurrent = ui.month === monthOf(today);
  const isPast = ui.month < monthOf(today);
  // Mês atual/passado: saldo real hoje (ou no fim do mês passado). Mês futuro: projeção.
  const bal = isPast ? accountBalance(endOfMonth(ui.month)) : isCurrent ? accountBalance(today) : accountBalance(endOfMonth(ui.month), true);
  const forecast = accountBalance(endOfMonth(ui.month), true);
  const shortMonth = monthName(ui.month, { month: 'short' }).replace('.', '');
  const invested = state.investments.length ? portfolioTotals().gross : 0;

  const byCat = {};
  list.filter((x) => x.type === 'expense').forEach((x) => { byCat[x.categoryId] = (byCat[x.categoryId] || 0) + x.amount; });
  let items = Object.entries(byCat).map(([id, value]) => { const c = catById(id); return { label: c.name, icon: c.icon, color: c.color, value }; })
    .sort((a, b) => b.value - a.value);
  if (items.length > 7) {
    const rest = items.slice(6).reduce((s, i) => s + i.value, 0);
    items = [...items.slice(0, 6), { label: 'Demais', icon: '…', color: '#94a3b8', value: rest }];
  }

  const months = [];
  for (let i = 5; i >= 0; i--) {
    const ym = addMonths(ui.month, -i);
    const tt = totals(txOfMonth(ym));
    months.push({ label: monthName(ym, { month: 'short' }).replace('.', ''), income: tt.income, expense: tt.expense, current: i === 0 });
  }

  const pending = list.filter((x) => !x.paid && !x.cardId).sort((a, b) => a.date.localeCompare(b.date));
  const monthInvoices = allInvoices().filter((i) => !i.paid && monthOf(i.dueISO) === ui.month);
  const pendingHtml = [...monthInvoices.map((i) => ({ date: i.dueISO, html: invoiceItem(i) })), ...pending.map((x) => ({ date: x.date, html: txItem(x) }))]
    .sort((a, b) => a.date.localeCompare(b.date)).map((x) => x.html);
  const recent = [...list].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 8);

  return `
  ${alertsBanner()}
  ${quickBar()}
  <div class="grid cols-4">
    <button class="card stat balance-card" id="balanceCard" aria-label="Ajustar saldo em conta">
      <div class="label">${isPast ? `Saldo em conta (fim de ${shortMonth})` : isCurrent ? 'Saldo em conta hoje' : `Saldo previsto (fim de ${shortMonth})`} <span class="edit-hint">✎</span></div>
      <div class="value ${bal >= 0 ? '' : 'neg'}">${money(bal)}</div>
      <div class="sub">${state.balanceSetAt == null ? 'Toque para informar seu saldo'
        : isCurrent ? `Previsto no fim de ${shortMonth}: <b class="${forecast >= 0 ? '' : 'neg'}">${money(forecast)}</b>` : 'conforme lançamentos'}
        ${invested ? `<br>+ ${money(invested)} investidos` : ''}</div>
    </button>
    <div class="card stat"><div class="label">Receitas</div><div class="value pos">${money(t.income)}</div>
      <div class="sub">${t.pendingIncome ? money(t.pendingIncome) + ' a receber' : 'tudo recebido'}</div></div>
    <div class="card stat"><div class="label">Despesas</div><div class="value neg">${money(t.expense)}</div>
      <div class="sub">${t.pendingExpense ? money(t.pendingExpense) + ' a pagar' : 'tudo pago'}${t.card ? `<br>💳 ${money(t.card)} no cartão` : ''}</div></div>
    <div class="card stat"><div class="label">Resultado do mês</div><div class="value ${t.balance >= 0 ? 'pos' : 'neg'}">${money(t.balance)}</div>
      <div class="sub">${t.income ? Math.round((t.balance / t.income) * 100) + '% da renda' : '—'}</div></div>
  </div>

  <div class="grid cols-2 mt">
    <div class="card"><h2>Despesas por categoria</h2>${donutChart(items)}</div>
    <div class="card"><h2>Últimos 6 meses</h2>${barsChart(months)}</div>
  </div>

  <div class="grid cols-2 mt">
    <div class="card">
      <div class="card-head"><h2>A pagar e a receber</h2><span class="muted">${pendingHtml.length}</span></div>
      ${pendingHtml.length ? `<ul class="tx-list">${pendingHtml.slice(0, 10).join('')}</ul>` : '<div class="empty">Nenhuma pendência 🎉</div>'}
    </div>
    <div class="card">
      <div class="card-head"><h2>Lançamentos recentes</h2><button class="btn small" data-go="transactions">Ver todos</button></div>
      ${recent.length ? `<ul class="tx-list">${recent.map((x) => txItem(x)).join('')}</ul>` : '<div class="empty">Nenhum lançamento neste mês.<br>Toque em “+ Novo lançamento”.</div>'}
    </div>
  </div>`;
}

function renderTransactions() {
  const f = ui.filter;
  const q = f.q.trim().toLowerCase();
  let list = txOfMonth(ui.month).filter((t) =>
    (f.type === 'all' || t.type === f.type) &&
    (f.cat === 'all' || t.categoryId === f.cat) &&
    (f.status === 'all' || (f.status === 'paid' ? t.paid : !t.paid)) &&
    (!q || (t.description || '').toLowerCase().includes(q) || catById(t.categoryId).name.toLowerCase().includes(q) || (t.notes || '').toLowerCase().includes(q))
  ).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);

  const t = totals(list);
  const groups = {};
  list.forEach((x) => { (groups[x.date] ||= []).push(x); });

  const catOpts = state.categories.map((c) => `<option value="${c.id}" ${f.cat === c.id ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('');
  return `
  ${quickBar()}
  <div class="card">
    <div class="filters">
      <input type="search" id="fq" placeholder="Buscar descrição ou categoria…" value="${esc(f.q)}">
      <select id="ftype">
        <option value="all">Todos os tipos</option>
        <option value="income" ${f.type === 'income' ? 'selected' : ''}>Receitas</option>
        <option value="expense" ${f.type === 'expense' ? 'selected' : ''}>Despesas</option>
      </select>
      <select id="fcat"><option value="all">Todas as categorias</option>${catOpts}</select>
      <select id="fstatus">
        <option value="all">Todas as situações</option>
        <option value="paid" ${f.status === 'paid' ? 'selected' : ''}>Pagos / recebidos</option>
        <option value="pending" ${f.status === 'pending' ? 'selected' : ''}>Pendentes</option>
      </select>
    </div>
    <div class="grid cols-4" style="gap:10px">
      <div class="stat"><div class="label">Itens</div><div class="value" style="font-size:20px">${list.length}</div></div>
      <div class="stat"><div class="label">Receitas</div><div class="value pos" style="font-size:20px">${money(t.income)}</div></div>
      <div class="stat"><div class="label">Despesas</div><div class="value neg" style="font-size:20px">${money(t.expense)}</div></div>
      <div class="stat"><div class="label">Saldo</div><div class="value" style="font-size:20px">${money(t.balance)}</div></div>
    </div>
  </div>
  <div class="card mt">
    ${list.length ? Object.entries(groups).map(([day, items]) => `<div class="day-head">${dayLabel(day)}</div><ul class="tx-list">${items.map((x) => txItem(x, { showDate: false })).join('')}</ul>`).join('')
      : '<div class="empty">Nenhum lançamento encontrado.</div>'}
  </div>`;
}

function renderBudgets() {
  const list = txOfMonth(ui.month).filter((t) => t.type === 'expense');
  const spent = {};
  list.forEach((t) => { spent[t.categoryId] = (spent[t.categoryId] || 0) + t.amount; });
  const cats = state.categories.filter((c) => c.type === 'expense');
  const withBudget = cats.filter((c) => state.budgets[c.id] > 0);
  const totalBudget = withBudget.reduce((s, c) => s + state.budgets[c.id], 0);
  const totalSpent = withBudget.reduce((s, c) => s + (spent[c.id] || 0), 0);

  const row = (c) => {
    const limit = state.budgets[c.id] || 0;
    const s = spent[c.id] || 0;
    const pct = limit ? Math.round((s / limit) * 100) : 0;
    const cls = pct > 100 ? 'over' : pct >= 80 ? 'near' : '';
    return `<div class="budget-row">
      <div class="budget-top">
        <b>${c.icon} ${esc(c.name)}</b>
        <div class="row-actions" style="align-items:center">
          <div class="budget-nums">${money(s)} ${limit ? `de ${money(limit)}<br><span class="${pct > 100 ? 'neg' : ''}">${limit - s >= 0 ? 'restam ' + money(limit - s) : 'excedeu ' + money(s - limit)}</span>` : '<br>sem limite'}</div>
          <button class="btn small" data-budget="${c.id}">${limit ? 'Editar' : 'Definir'}</button>
        </div>
      </div>
      ${limit ? `<div class="progress ${cls}"><div style="width:${Math.min(pct, 100)}%"></div></div>` : ''}
    </div>`;
  };

  const pct = totalBudget ? Math.round((totalSpent / totalBudget) * 100) : 0;
  return `
  <div class="grid cols-4">
    <div class="card stat"><div class="label">Orçamento total</div><div class="value">${money(totalBudget)}</div></div>
    <div class="card stat"><div class="label">Gasto (categorias com limite)</div><div class="value neg">${money(totalSpent)}</div></div>
    <div class="card stat"><div class="label">Disponível</div><div class="value ${totalBudget - totalSpent >= 0 ? 'pos' : 'neg'}">${money(totalBudget - totalSpent)}</div></div>
    <div class="card stat"><div class="label">Utilizado</div><div class="value">${pct}%</div>
      <div class="progress mt ${pct > 100 ? 'over' : pct >= 80 ? 'near' : ''}"><div style="width:${Math.min(pct, 100)}%"></div></div></div>
  </div>
  <div class="card mt">
    <div class="card-head"><h2>Limites mensais por categoria</h2></div>
    <p class="muted" style="margin-top:-6px">Os limites valem para todos os meses. Barra amarela = 80% usado; vermelha = estourou.</p>
    ${cats.map(row).join('')}
  </div>`;
}

function renderGoals() {
  if (!state.goals.length) {
    return `<div class="card"><div class="empty">
      <div style="font-size:44px">🏦</div>
      <p>Crie metas como “Reserva de emergência”, “Viagem” ou “Trocar de carro”<br>e acompanhe quanto já guardou.</p>
      <button class="btn primary" id="newGoal">+ Nova meta</button></div></div>`;
  }
  const cards = state.goals.map((g) => {
    const pct = g.target ? Math.min(100, Math.round((g.saved / g.target) * 100)) : 0;
    let monthly = '';
    if (g.deadline && g.saved < g.target) {
      const now = monthOf(todayISO());
      const [y1, m1] = now.split('-').map(Number);
      const [y2, m2] = g.deadline.slice(0, 7).split('-').map(Number);
      const months = (y2 - y1) * 12 + (m2 - m1) + 1;
      monthly = months > 0
        ? `<div class="muted mt">Guardar <b>${money(Math.ceil((g.target - g.saved) / months))}</b>/mês até ${monthName(g.deadline.slice(0, 7))}</div>`
        : '<div class="neg mt">Prazo vencido</div>';
    }
    return `<div class="card">
      <div class="card-head"><h2>${esc(g.icon || '🎯')} ${esc(g.name)}</h2><span class="${pct >= 100 ? 'pos' : 'muted'}">${pct}%</span></div>
      <div class="stat"><div class="value">${money(g.saved)}</div><div class="sub">de ${money(g.target)} · faltam ${money(Math.max(0, g.target - g.saved))}</div></div>
      <div class="progress mt"><div style="width:${pct}%"></div></div>
      ${monthly}
      <div class="row-actions mt">
        <button class="btn small primary" data-deposit="${g.id}">+ Guardar</button>
        <button class="btn small" data-withdraw="${g.id}">− Retirar</button>
        <button class="btn small" data-editgoal="${g.id}">Editar</button>
      </div>
    </div>`;
  }).join('');
  const total = state.goals.reduce((s, g) => s + g.saved, 0);
  return `<div class="card-head"><h2 style="font-size:20px">Total guardado: ${money(total)}</h2><button class="btn primary" id="newGoal">+ Nova meta</button></div>
    <div class="grid cols-2">${cards}</div>`;
}

function renderSettings() {
  const catRow = (c) => `<div class="cat-row">
    <div class="tx-icon" style="background:${c.color}22;width:40px;height:40px">${c.icon}</div>
    <div><b>${esc(c.name)}</b><div class="tx-meta">${c.type === 'income' ? 'Receita' : 'Despesa'} · ${state.transactions.filter((t) => t.categoryId === c.id).length} lançamentos</div></div>
    <button class="btn small" data-editcat="${c.id}">Editar</button>
  </div>`;
  const inc = state.categories.filter((c) => c.type === 'income');
  const exp = state.categories.filter((c) => c.type === 'expense');
  return `
  <div class="grid cols-2">
    <div class="card">
      <div class="card-head"><h2>Categorias</h2><button class="btn small primary" id="newCat">+ Nova</button></div>
      <h3 class="muted" style="font-size:14px;margin:6px 0">Receitas</h3>${inc.map(catRow).join('')}
      <h3 class="muted" style="font-size:14px;margin:18px 0 6px">Despesas</h3>${exp.map(catRow).join('')}
    </div>
    <div>
      <div class="card">
        <h2>Backup dos dados</h2>
        <p class="muted">Seus dados ficam salvos <b>somente neste iPad</b>. Faça backup regularmente e guarde o arquivo no app Arquivos / iCloud Drive.</p>
        <div class="row-actions">
          <button class="btn primary" id="exportJson">Exportar backup</button>
          <button class="btn" id="importJson">Restaurar backup</button>
          <input type="file" id="importFile" accept="application/json,.json" hidden>
        </div>
        <div class="row-actions mt">
          <button class="btn" id="exportCsv">Exportar planilha (CSV)</button>
        </div>
        <p class="muted" style="font-size:13px">${state.transactions.length} lançamentos · ${state.goals.length} metas · último backup: ${state.lastBackup ? new Date(state.lastBackup).toLocaleString('pt-BR') : 'nunca'}</p>
      </div>
      <div class="card mt">
        <h2>Avisos de vencimento</h2>
        <label class="field"><span>Avisar contas e faturas com quantos dias de antecedência?</span>
          <input type="number" id="alertDays" min="0" max="60" value="${state.settings.alertDays}" inputmode="numeric"></label>
        <p class="muted" style="font-size:13px">Os avisos aparecem no topo do Resumo sempre que você abre o app.</p>
      </div>
      <div class="card mt">
        <h2>Instalar no iPad</h2>
        <p class="muted">No Safari, toque em <b>Compartilhar</b> (□↑) → <b>Adicionar à Tela de Início</b>. O app abre em tela cheia e funciona sem internet.</p>
      </div>
      <div class="card mt">
        <h2>Zona de perigo</h2>
        <div class="row-actions">
          <button class="btn" id="loadDemo">Carregar dados de exemplo</button>
          <button class="btn danger" id="resetAll">Apagar tudo</button>
        </div>
      </div>
    </div>
  </div>`;
}

/* ---------- Eventos das telas ---------- */
function bindView() {
  const v = $('#view');
  $$('[data-tx]', v).forEach((el) => el.addEventListener('click', () => openTxForm(state.transactions.find((t) => t.id === el.dataset.tx))));
  $$('[data-go]', v).forEach((el) => el.addEventListener('click', () => setView(el.dataset.go)));
  $('#balanceCard', v)?.addEventListener('click', openBalanceForm);
  bindCardActions(v);
  bindQuick(v);

  if (ui.view === 'transactions') {
    const fq = $('#fq');
    fq.addEventListener('input', () => {
      ui.filter.q = fq.value;
      const pos = fq.selectionStart;
      render();
      const n = $('#fq'); n.focus(); n.setSelectionRange(pos, pos);
    });
    $('#ftype').addEventListener('change', (e) => { ui.filter.type = e.target.value; render(); });
    $('#fcat').addEventListener('change', (e) => { ui.filter.cat = e.target.value; render(); });
    $('#fstatus').addEventListener('change', (e) => { ui.filter.status = e.target.value; render(); });
  }
  if (ui.view === 'budgets') {
    $$('[data-budget]', v).forEach((el) => el.addEventListener('click', () => openBudgetForm(el.dataset.budget)));
  }
  if (ui.view === 'goals') {
    $('#newGoal')?.addEventListener('click', () => openGoalForm());
    $$('[data-editgoal]', v).forEach((el) => el.addEventListener('click', () => openGoalForm(state.goals.find((g) => g.id === el.dataset.editgoal))));
    $$('[data-deposit]', v).forEach((el) => el.addEventListener('click', () => openGoalMove(el.dataset.deposit, 1)));
    $$('[data-withdraw]', v).forEach((el) => el.addEventListener('click', () => openGoalMove(el.dataset.withdraw, -1)));
  }
  if (ui.view === 'investments') bindInvestments(v);
  if (ui.view === 'settings') {
    $('#newCat').addEventListener('click', () => openCatForm());
    $$('[data-editcat]', v).forEach((el) => el.addEventListener('click', () => openCatForm(state.categories.find((c) => c.id === el.dataset.editcat))));
    $('#exportJson').addEventListener('click', exportJson);
    $('#importJson').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', importJson);
    $('#exportCsv').addEventListener('click', exportCsv);
    $('#alertDays').addEventListener('change', (e) => {
      state.settings.alertDays = Math.max(0, Math.min(60, Number(e.target.value) || 0));
      save(); updateCardBadges(); toast('Antecedência dos avisos salva');
    });
    $('#resetAll').addEventListener('click', () => {
      if (confirm('Apagar TODOS os dados? Esta ação não pode ser desfeita.') && confirm('Tem certeza absoluta?')) {
        state = defaultState(); save(); render(); toast('Dados apagados');
      }
    });
    $('#loadDemo').addEventListener('click', () => {
      if (state.transactions.length && !confirm('Isso vai adicionar lançamentos de exemplo aos seus dados. Continuar?')) return;
      loadDemo(); save(); setView('dashboard'); toast('Dados de exemplo carregados');
    });
  }
}

/* ---------- Modais ---------- */
const modal = $('#modal');
const modalForm = $('#modalForm');
function openModal(html, onSubmit, onReady) {
  modalForm.innerHTML = html;
  modalForm.onsubmit = (e) => {
    e.preventDefault();
    const action = e.submitter?.value || 'ok';
    if (action === 'cancel') { modal.close(); return; }
    if (onSubmit(action, new FormData(modalForm)) !== false) modal.close();
  };
  modal.showModal();
  onReady?.();
}
modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });

function catOptions(type, selected) {
  return state.categories.filter((c) => c.type === type)
    .map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('');
}

/**
 * Cria lançamento(s) novos. repeat: 'once' | 'installments' (divide o valor) | 'monthly' (mesmo valor todo mês).
 * Retorna os lançamentos criados.
 */
function addTransactions(data, repeat = 'once', count = 1) {
  const created = [];
  if (repeat !== 'installments' && repeat !== 'monthly') {
    created.push({ id: uid(), createdAt: Date.now(), ...data });
  } else {
    count = Math.max(2, Math.min(120, Number(count) || 2));
    const groupId = uid();
    const per = repeat === 'installments' ? Math.floor(data.amount / count) : data.amount;
    const remainder = repeat === 'installments' ? data.amount - per * count : 0;
    for (let i = 0; i < count; i++) {
      created.push({
        ...data,
        id: uid(), createdAt: Date.now() + i, groupId,
        amount: per + (i === 0 ? remainder : 0),
        date: addMonthsToDate(data.date, i),
        paid: data.cardId ? true : i === 0 ? data.paid : false,
        installment: repeat === 'installments' ? `${i + 1}/${count}` : '',
      });
    }
  }
  state.transactions.push(...created);
  return created;
}

function openTxForm(tx, defaults = {}) {
  const isEdit = !!tx;
  const t = tx || { type: 'expense', amount: 0, date: monthOf(todayISO()) === ui.month ? todayISO() : `${ui.month}-01`, categoryId: '', description: '', paid: true, notes: '', cardId: '', ...defaults };
  const html = `
    <h2>${isEdit ? 'Editar lançamento' : 'Novo lançamento'}</h2>
    <div class="seg" style="margin-bottom:14px">
      <input type="radio" name="type" id="tExp" value="expense" ${t.type === 'expense' ? 'checked' : ''}><label for="tExp">Despesa</label>
      <input type="radio" name="type" id="tInc" value="income" ${t.type === 'income' ? 'checked' : ''}><label for="tInc">Receita</label>
    </div>
    <div class="form-grid">
      <label class="field full"><span>Valor (R$)</span>
        <input class="amount-input" name="amount" inputmode="decimal" placeholder="0,00" value="${t.amount ? centsToInput(t.amount) : ''}" required autocomplete="off"></label>
      <label class="field full"><span>Descrição</span>
        <input name="description" value="${esc(t.description)}" placeholder="Ex.: Aluguel, Mercado, Salário…" autocomplete="off"></label>
      <label class="field"><span>Categoria</span><select name="categoryId" id="txCat">${catOptions(t.type, t.categoryId)}</select></label>
      <label class="field"><span id="dateLabel">Data</span><input type="date" name="date" value="${t.date}" required></label>
      <label class="field full" id="payWithWrap"><span>Forma de pagamento</span>
        <select name="cardId" id="txCard">${cardOptions(t.cardId)}</select>
        <small class="muted" id="cardHint" style="display:block;margin-top:6px"></small></label>
      <label class="check full" id="paidWrap"><input type="checkbox" name="paid" ${t.paid ? 'checked' : ''}><span id="paidLabel">${t.type === 'income' ? 'Já recebido' : 'Já pago'}</span></label>
      ${isEdit ? '' : `
      <label class="field"><span>Repetir</span>
        <select name="repeat" id="txRepeat">
          <option value="once">Não repetir</option>
          <option value="installments">Parcelado (divide valor)</option>
          <option value="monthly">Todo mês (conta fixa)</option>
        </select></label>
      <label class="field" id="repeatCountWrap" style="visibility:hidden"><span>Quantidade de meses</span>
        <input type="number" name="count" min="2" max="120" value="12" inputmode="numeric"></label>
      <small class="muted full" id="repeatHint" style="display:none;margin-top:-6px"></small>`}
      ${isEdit && t.groupId && !t.installment ? `<label class="check full"><input type="checkbox" name="applyFuture"><span>Aplicar valor, descrição e categoria também aos <b>próximos meses</b> desta conta</span></label>` : ''}
      <label class="field full"><span>Observações</span><textarea name="notes" rows="2">${esc(t.notes)}</textarea></label>
    </div>
    <div class="modal-actions">
      ${isEdit ? '<button class="btn danger" value="delete" formnovalidate>Excluir</button>' : ''}
      ${isEdit && t.groupId ? '<button class="btn danger" value="deleteFuture" formnovalidate>Excluir este e próximos</button>' : ''}
      ${isEdit && !t.installment ? '<button class="btn" value="replicate" formnovalidate>🔁 Replicar nos próximos meses</button>' : ''}
      <span class="spacer"></span>
      <button class="btn" value="cancel" formnovalidate>Cancelar</button>
      <button class="btn primary" value="save">Salvar</button>
    </div>`;

  openModal(html, (action, fd) => {
    if (action === 'delete') {
      if (!confirm('Excluir este lançamento?')) return false;
      state.transactions = state.transactions.filter((x) => x.id !== tx.id);
      save(); render(); toast('Lançamento excluído');
      return;
    }
    if (action === 'deleteFuture') {
      if (!confirm('Excluir este lançamento e todos os seguintes da mesma série?')) return false;
      state.transactions = state.transactions.filter((x) => !(x.groupId === tx.groupId && x.date >= tx.date));
      save(); render(); toast('Lançamentos excluídos');
      return;
    }
    if (action === 'replicate') { setTimeout(() => openReplicateForm(tx), 0); return; }
    const amount = parseMoney(fd.get('amount'));
    if (amount <= 0) { toast('Informe um valor maior que zero'); return false; }
    const data = {
      type: fd.get('type'),
      amount,
      description: fd.get('description').trim(),
      categoryId: fd.get('categoryId'),
      date: fd.get('date'),
      paid: fd.get('paid') === 'on',
      notes: fd.get('notes').trim(),
      cardId: fd.get('type') === 'expense' ? fd.get('cardId') || '' : '',
    };
    // Compra no cartão: o lançamento está "efetivado"; o que fica pendente é a fatura.
    if (data.cardId) data.paid = true;
    if (isEdit) {
      if (data.paid && !tx.paid && todayISO() < data.date) data.paidDate = todayISO(); // pago antes do vencimento
      if (!data.paid) delete tx.paidDate;
      Object.assign(tx, data);
      if (fd.get('applyFuture') === 'on') {
        const next = state.transactions.filter((x) => x.groupId === tx.groupId && x.date > tx.date && (!x.paid || x.cardId));
        next.forEach((x) => Object.assign(x, { amount: data.amount, description: data.description, categoryId: data.categoryId, cardId: data.cardId, notes: data.notes }));
        if (next.length) toast(`Atualizado este e mais ${next.length} mês(es)`);
      }
    } else {
      addTransactions(data, fd.get('repeat'), Number(fd.get('count')));
    }
    save(); render();
    if (!(isEdit && fd.get('applyFuture') === 'on')) toast(isEdit ? 'Lançamento atualizado' : 'Lançamento salvo');
  }, () => {
    const amountEl = $('[name="amount"]', modalForm);
    if (!isEdit) setTimeout(() => amountEl.focus(), 50);
    const syncPay = () => {
      const type = $('[name="type"]:checked', modalForm).value;
      const card = type === 'expense' && cardById($('#txCard').value);
      $('#payWithWrap').style.display = type === 'expense' ? '' : 'none';
      $('#paidWrap').style.display = card ? 'none' : '';
      const date = $('[name="date"]', modalForm).value;
      const paid = $('[name="paid"]', modalForm).checked;
      $('#dateLabel').textContent = card || paid ? 'Data' : type === 'expense' ? 'Vencimento' : 'Data prevista';
      const hint = $('#repeatHint');
      if (hint) hint.innerHTML = type === 'income'
        ? 'Os próximos meses ficam salvos como receitas <b>a receber</b>, no mesmo dia e valor. No dia, o app pergunta se o valor caiu e você confirma (podendo ajustar o valor).'
        : 'Os próximos meses ficam salvos como contas <b>a pagar</b>, com o mesmo valor e dia de vencimento. Quando a conta chegar, é só abrir e ajustar o valor.';
      $('#cardHint').innerHTML = card && date
        ? `Não sai do saldo agora: entra na fatura que vence em <b>${fmtDate(invoiceFor(card, date).dueISO)}</b>.`
        : type === 'expense' ? 'Sai do saldo em conta quando marcado como pago.' : '';
    };
    $$('[name="type"]', modalForm).forEach((r) => r.addEventListener('change', () => {
      $('#txCat').innerHTML = catOptions(r.value, '');
      $('#paidLabel').textContent = r.value === 'income' ? 'Já recebido' : 'Já pago';
      syncPay();
    }));
    $('#txCard').addEventListener('change', syncPay);
    $('[name="paid"]', modalForm).addEventListener('change', syncPay);
    $('[name="date"]', modalForm).addEventListener('change', (e) => {
      // Lançamento novo com data futura: provavelmente é uma conta a pagar/receber.
      if (!isEdit && e.target.value > todayISO()) $('[name="paid"]', modalForm).checked = false;
      syncPay();
    });
    syncPay();
    $('#txRepeat')?.addEventListener('change', (e) => {
      $('#repeatCountWrap').style.visibility = e.target.value === 'once' ? 'hidden' : 'visible';
      $('#repeatHint').style.display = e.target.value === 'monthly' ? '' : 'none';
      syncPay();
    });
  });
}

/** Copia um lançamento para os meses seguintes como contas futuras (a pagar/receber). */
function openReplicateForm(tx) {
  openModal(`
    <h2>🔁 Replicar nos próximos meses</h2>
    <p class="muted" style="margin-top:-6px"><b>${esc(tx.description || catById(tx.categoryId).name)}</b> · ${money(tx.amount)} · dia ${Number(tx.date.slice(8))}</p>
    <label class="field"><span>Quantos meses seguintes?</span>
      <input type="number" name="count" min="1" max="120" value="11" inputmode="numeric" required></label>
    <p class="muted" style="font-size:13px">As cópias ficam salvas como contas <b>${tx.type === 'income' ? 'a receber' : 'a pagar'}</b>, no mesmo dia de cada mês e com o mesmo valor.
      Se o valor mudar (ex.: energia), abra a conta do mês quando ela chegar e ajuste. Meses que já têm esta conta não são duplicados.</p>
    <div class="modal-actions"><button class="btn" value="cancel" formnovalidate>Cancelar</button><button class="btn primary" value="save">Replicar</button></div>`,
  (action, fd) => {
    const n = Math.max(1, Math.min(120, Number(fd.get('count')) || 1));
    tx.groupId ||= uid();
    const months = new Set(state.transactions.filter((x) => x.groupId === tx.groupId).map((x) => monthOf(x.date)));
    let created = 0;
    for (let i = 1; i <= n; i++) {
      const date = addMonthsToDate(tx.date, i);
      if (months.has(monthOf(date))) continue;
      const { id, createdAt, paidDate, installment, ...rest } = tx;
      state.transactions.push({ ...rest, id: uid(), createdAt: Date.now() + i, date, paid: !!tx.cardId });
      created++;
    }
    save(); render(); toast(created ? `${created} mês(es) criados` : 'Esses meses já tinham esta conta');
  });
}

function openBalanceForm() {
  const today = todayISO();
  const cur = accountBalance(today);
  openModal(`
    <h2>🏦 Saldo em conta</h2>
    <p class="muted" style="margin-top:-6px">Abra o app do seu banco e informe o saldo disponível <b>hoje</b>.
      A partir daí, o app atualiza o saldo sozinho com cada receita e despesa marcada como paga/recebida.</p>
    <label class="field"><span>Saldo atual no banco (R$)</span>
      <input class="amount-input" name="amount" inputmode="decimal" placeholder="0,00" value="${state.balanceSetAt != null ? centsToInput(cur) : ''}" required autocomplete="off"></label>
    <label class="check"><input type="checkbox" name="negative" ${cur < 0 ? 'checked' : ''}><span>Saldo negativo (cheque especial)</span></label>
    ${state.balanceSetAt ? `<p class="muted" style="font-size:13px">Último ajuste: ${new Date(state.balanceSetAt).toLocaleString('pt-BR')}</p>` : ''}
    <div class="modal-actions"><button class="btn" value="cancel" formnovalidate>Cancelar</button><button class="btn primary" value="save">Salvar</button></div>`,
  (action, fd) => {
    const value = Math.abs(parseMoney(fd.get('amount'))) * (fd.get('negative') === 'on' ? -1 : 1);
    // Guarda o saldo inicial necessário para que o saldo de hoje bata com o informado.
    state.openingBalance = (state.openingBalance || 0) + (value - cur);
    state.balanceSetAt = Date.now();
    save(); render(); toast('Saldo atualizado');
  }, () => setTimeout(() => { const el = $('[name="amount"]', modalForm); el.focus(); el.select(); }, 50));
}

function openBudgetForm(catId) {
  const c = catById(catId);
  const cur = state.budgets[catId] || 0;
  openModal(`
    <h2>${c.icon} Limite para ${esc(c.name)}</h2>
    <label class="field"><span>Limite mensal (R$)</span>
      <input class="amount-input" name="amount" inputmode="decimal" placeholder="0,00" value="${cur ? centsToInput(cur) : ''}" autocomplete="off"></label>
    <p class="muted">Deixe em branco ou 0 para remover o limite.</p>
    <div class="modal-actions"><button class="btn" value="cancel" formnovalidate>Cancelar</button><button class="btn primary" value="save">Salvar</button></div>`,
  (action, fd) => {
    const v = parseMoney(fd.get('amount'));
    if (v > 0) state.budgets[catId] = v; else delete state.budgets[catId];
    save(); render(); toast('Orçamento salvo');
  }, () => setTimeout(() => $('[name="amount"]', modalForm).focus(), 50));
}

function openGoalForm(goal) {
  const g = goal || { name: '', icon: '🎯', target: 0, saved: 0, deadline: '' };
  openModal(`
    <h2>${goal ? 'Editar meta' : 'Nova meta'}</h2>
    <div class="form-grid">
      <label class="field"><span>Ícone</span><input name="icon" value="${esc(g.icon)}" maxlength="4"></label>
      <label class="field"><span>Nome</span><input name="name" value="${esc(g.name)}" required placeholder="Reserva de emergência"></label>
      <label class="field"><span>Valor alvo (R$)</span><input name="target" inputmode="decimal" value="${g.target ? centsToInput(g.target) : ''}" required></label>
      <label class="field"><span>Já guardado (R$)</span><input name="saved" inputmode="decimal" value="${g.saved ? centsToInput(g.saved) : ''}"></label>
      <label class="field full"><span>Prazo (opcional)</span><input type="date" name="deadline" value="${g.deadline || ''}"></label>
    </div>
    <div class="modal-actions">
      ${goal ? '<button class="btn danger" value="delete" formnovalidate>Excluir</button>' : ''}
      <span class="spacer"></span>
      <button class="btn" value="cancel" formnovalidate>Cancelar</button><button class="btn primary" value="save">Salvar</button>
    </div>`,
  (action, fd) => {
    if (action === 'delete') {
      if (!confirm('Excluir esta meta?')) return false;
      state.goals = state.goals.filter((x) => x.id !== goal.id);
    } else {
      const data = { name: fd.get('name').trim(), icon: fd.get('icon').trim() || '🎯', target: parseMoney(fd.get('target')), saved: parseMoney(fd.get('saved')), deadline: fd.get('deadline') };
      if (data.target <= 0) { toast('Informe o valor alvo'); return false; }
      if (goal) Object.assign(goal, data); else state.goals.push({ id: uid(), ...data });
    }
    save(); render();
  });
}

function openGoalMove(goalId, dir) {
  const g = state.goals.find((x) => x.id === goalId);
  openModal(`
    <h2>${dir > 0 ? 'Guardar em' : 'Retirar de'} ${esc(g.name)}</h2>
    <label class="field"><span>Valor (R$)</span><input class="amount-input" name="amount" inputmode="decimal" placeholder="0,00" required autocomplete="off"></label>
    <div class="modal-actions"><button class="btn" value="cancel" formnovalidate>Cancelar</button><button class="btn primary" value="save">Confirmar</button></div>`,
  (action, fd) => {
    const v = parseMoney(fd.get('amount'));
    if (v <= 0) { toast('Informe um valor'); return false; }
    g.saved = Math.max(0, g.saved + dir * v);
    save(); render(); toast(dir > 0 ? 'Valor guardado 💪' : 'Valor retirado');
  }, () => setTimeout(() => $('[name="amount"]', modalForm).focus(), 50));
}

function openCatForm(cat) {
  const c = cat || { name: '', type: 'expense', icon: '📦', color: '#64748b' };
  openModal(`
    <h2>${cat ? 'Editar categoria' : 'Nova categoria'}</h2>
    <div class="seg" style="margin-bottom:14px">
      <input type="radio" name="type" id="cExp" value="expense" ${c.type === 'expense' ? 'checked' : ''}><label for="cExp">Despesa</label>
      <input type="radio" name="type" id="cInc" value="income" ${c.type === 'income' ? 'checked' : ''}><label for="cInc">Receita</label>
    </div>
    <div class="form-grid">
      <label class="field full"><span>Nome</span><input name="name" value="${esc(c.name)}" required></label>
      <label class="field"><span>Ícone (emoji)</span><input name="icon" value="${esc(c.icon)}" maxlength="4"></label>
      <label class="field"><span>Cor</span><input type="color" name="color" value="${c.color}"></label>
    </div>
    <div class="modal-actions">
      ${cat ? '<button class="btn danger" value="delete" formnovalidate>Excluir</button>' : ''}
      <span class="spacer"></span>
      <button class="btn" value="cancel" formnovalidate>Cancelar</button><button class="btn primary" value="save">Salvar</button>
    </div>`,
  (action, fd) => {
    if (action === 'delete') {
      const used = state.transactions.some((t) => t.categoryId === cat.id);
      if (used) { alert('Esta categoria possui lançamentos. Mude a categoria deles antes de excluí-la.'); return false; }
      if (!confirm('Excluir esta categoria?')) return false;
      state.categories = state.categories.filter((x) => x.id !== cat.id);
      delete state.budgets[cat.id];
    } else {
      const data = { name: fd.get('name').trim(), type: fd.get('type'), icon: fd.get('icon').trim() || '📦', color: fd.get('color') };
      if (cat) Object.assign(cat, data); else state.categories.push({ id: 'c-' + uid(), ...data });
    }
    save(); render();
  });
}

/* ---------- Backup ---------- */
function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function exportJson() {
  state.lastBackup = Date.now();
  save();
  download(`plano-financeiro-backup-${todayISO()}.json`, JSON.stringify(state, null, 2), 'application/json');
  render();
}

function importJson(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.transactions) || !Array.isArray(data.categories)) throw new Error('formato');
      if (!confirm(`Restaurar backup com ${data.transactions.length} lançamentos? Os dados atuais serão substituídos.`)) return;
      state = migrate(data);
      save(); setView('dashboard'); toast('Backup restaurado');
    } catch {
      alert('Arquivo de backup inválido.');
    }
  };
  reader.readAsText(file);
}

function exportCsv() {
  const rows = [['Data', 'Tipo', 'Categoria', 'Descrição', 'Valor', 'Situação', 'Pagamento', 'Parcela', 'Observações']];
  [...state.transactions].sort((a, b) => a.date.localeCompare(b.date)).forEach((t) => {
    rows.push([
      t.date.split('-').reverse().join('/'),
      t.type === 'income' ? 'Receita' : 'Despesa',
      catById(t.categoryId).name,
      t.description,
      ((t.type === 'income' ? 1 : -1) * t.amount / 100).toFixed(2).replace('.', ','),
      t.paid ? 'Efetivado' : 'Pendente',
      t.cardId ? 'Cartão ' + (cardById(t.cardId)?.name || '') : 'Conta',
      t.installment || '',
      t.notes || '',
    ]);
  });
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  download(`plano-financeiro-${todayISO()}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
}

/* ---------- Dados de exemplo ---------- */
function loadDemo() {
  const base = monthOf(todayISO());
  const add = (ym, day, type, cat, desc, value, paid = true) => state.transactions.push({
    id: uid(), createdAt: Date.now(), type, categoryId: cat, description: desc,
    amount: Math.round(value * 100), date: `${ym}-${pad(day)}`, paid, notes: '',
  });
  for (let i = 5; i >= 0; i--) {
    const ym = addMonths(base, -i);
    const cur = i === 0;
    const r = () => 0.85 + Math.random() * 0.3;
    add(ym, 5, 'income', 'c-salario', 'Salário', 7800);
    if (i % 2 === 0) add(ym, 18, 'income', 'c-extra', 'Freelance', 1200 * r());
    add(ym, 10, 'expense', 'c-moradia', 'Aluguel', 2200, !cur);
    add(ym, 12, 'expense', 'c-contas', 'Energia + água', 310 * r(), !cur);
    add(ym, 15, 'expense', 'c-contas', 'Internet e celular', 180, !cur);
    add(ym, 8, 'expense', 'c-mercado', 'Supermercado', 950 * r());
    add(ym, 22, 'expense', 'c-mercado', 'Feira e padaria', 260 * r());
    add(ym, 14, 'expense', 'c-transporte', 'Combustível', 420 * r());
    add(ym, 20, 'expense', 'c-alimentacao', 'Restaurantes', 380 * r());
    add(ym, 3, 'expense', 'c-assinaturas', 'Streaming e apps', 89.9);
    add(ym, 25, 'expense', 'c-lazer', 'Cinema e passeios', 300 * r(), !cur);
    if (i % 3 === 0) add(ym, 16, 'expense', 'c-saude', 'Farmácia', 140 * r());
  }
  if (!state.cards.length) {
    const card = { id: 'cc-' + uid(), name: 'Nubank', limit: 500000, closingDay: 8, dueDay: 15, color: '#7c3aed' };
    state.cards.push(card);
    // Restaurantes e assinaturas dos exemplos passam a ser no cartão; mais uma compra parcelada.
    state.transactions.forEach((t) => { if (['Restaurantes', 'Streaming e apps'].includes(t.description)) { t.cardId = card.id; t.paid = true; } });
    const g = uid();
    for (let i = 0; i < 6; i++) state.transactions.push({ id: uid(), createdAt: Date.now() + i, groupId: g, type: 'expense', categoryId: 'c-outros',
      description: 'Celular novo', amount: 30000, date: addMonthsToDate(`${addMonths(base, -2)}-20`, i), paid: true, notes: '', cardId: card.id, installment: `${i + 1}/6` });
    for (const inv of invoicesOf(card)) if (inv.dueISO < todayISO()) state.invoicePayments[invoiceKey(card.id, inv.dueISO)] = { date: inv.dueISO };
  }
  state.budgets = { ...state.budgets, 'c-mercado': 130000, 'c-alimentacao': 40000, 'c-lazer': 35000, 'c-transporte': 50000 };
  if (!state.investments.length) {
    const ago = (m) => `${addMonths(base, -m)}-05`;
    state.market.cdi = [{ date: '2000-01-01', rate: 14.9 }];
    state.investments.push(
      { id: uid(), name: 'CDB Banco Digital', kind: 'cdb', indexer: 'cdi', rate: 110, taxFree: false, maturity: `${addMonths(base, 24)}-05`,
        movements: [{ id: uid(), date: ago(14), amount: 1000000 }, { id: uid(), date: ago(6), amount: 300000 }] },
      { id: uid(), name: 'LCI 2 anos', kind: 'lci', indexer: 'cdi', rate: 92, taxFree: true, maturity: `${addMonths(base, 10)}-20`,
        movements: [{ id: uid(), date: ago(10), amount: 500000 }] },
      { id: uid(), name: 'Tesouro IPCA+ 2035', kind: 'tesouro_ipca', indexer: 'ipca', rate: 7.1, taxFree: false, maturity: '2035-05-15',
        movements: [{ id: uid(), date: ago(20), amount: 400000 }] },
      { id: uid(), name: 'Carteira de ações', kind: 'acoes', indexer: 'manual', rate: 0, taxFree: false, maturity: '',
        movements: [{ id: uid(), date: ago(12), amount: 600000 }], currentValue: 668000, valueUpdatedAt: todayISO() },
    );
  }
  if (!state.goals.length) {
    state.goals.push({ id: uid(), name: 'Reserva de emergência', icon: '🛟', target: 3000000, saved: 1150000, deadline: `${addMonths(base, 12)}-01` });
    state.goals.push({ id: uid(), name: 'Viagem de férias', icon: '✈️', target: 800000, saved: 210000, deadline: `${addMonths(base, 8)}-01` });
  }
}

/* ---------- Inicialização ---------- */
$$('.nav-item').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
$('#prevMonth').addEventListener('click', () => { ui.month = addMonths(ui.month, -1); render(); });
$('#nextMonth').addEventListener('click', () => { ui.month = addMonths(ui.month, 1); render(); });
$('#addBtn').addEventListener('click', () => openTxForm());
$('#fab').addEventListener('click', () => openTxForm());
$('#monthLabel').addEventListener('click', () => { if (!['dashboard', 'transactions', 'budgets'].includes(ui.view)) return; ui.month = monthOf(todayISO()); render(); });

// Atalhos de teclado (Magic Keyboard)
document.addEventListener('keydown', (e) => {
  if (modal.open || e.target.matches('input, textarea, select')) return;
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openTxForm(); }
  if (e.key === '/' && $('#quickInput')) { e.preventDefault(); $('#quickInput').focus(); }
  if (e.key === 'ArrowLeft') { ui.month = addMonths(ui.month, -1); render(); }
  if (e.key === 'ArrowRight') { ui.month = addMonths(ui.month, 1); render(); }
  const map = { 1: 'dashboard', 2: 'transactions', 3: 'cards', 4: 'budgets', 5: 'goals', 6: 'investments', 7: 'settings' };
  if (map[e.key]) setView(map[e.key]);
});

// Pede ao navegador para não apagar os dados automaticamente
navigator.storage?.persist?.();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

setView('dashboard');
