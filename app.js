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
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const data = JSON.parse(raw);
    return { ...defaultState(), ...data };
  } catch (e) {
    console.error(e);
    return defaultState();
  }
}

let state = loadState();
const ui = {
  view: 'dashboard',
  month: monthOf(todayISO()),
  filter: { q: '', type: 'all', cat: 'all', status: 'all' },
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
  let income = 0, expense = 0, pendingExpense = 0, pendingIncome = 0;
  for (const t of list) {
    if (t.type === 'income') { income += t.amount; if (!t.paid) pendingIncome += t.amount; }
    else { expense += t.amount; if (!t.paid) pendingExpense += t.amount; }
  }
  return { income, expense, balance: income - expense, pendingExpense, pendingIncome };
}

/** Saldo acumulado (somente lançamentos efetivados) até o fim do mês informado. */
function accumulatedBalance(ym) {
  let b = 0;
  for (const t of state.transactions) {
    if (monthOf(t.date) <= ym && t.paid) b += t.type === 'income' ? t.amount : -t.amount;
  }
  return b;
}

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
  $('#monthLabel').textContent = ml.charAt(0).toUpperCase() + ml.slice(1);
  const showMonth = ['dashboard', 'transactions', 'budgets'].includes(ui.view);
  $('.month-picker').style.visibility = showMonth ? 'visible' : 'hidden';
  const views = { dashboard: renderDashboard, transactions: renderTransactions, budgets: renderBudgets, goals: renderGoals, settings: renderSettings };
  $('#view').innerHTML = views[ui.view]();
  bindView();
}

/* ---------- Componentes ---------- */
function txItem(t, { showDate = true } = {}) {
  const c = catById(t.categoryId);
  const sign = t.type === 'income' ? '+' : '−';
  const cls = t.type === 'income' ? 'pos' : 'neg';
  const pending = !t.paid ? `<span class="badge">${t.type === 'income' ? 'a receber' : 'a pagar'}</span>` : '';
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

function donutChart(items) {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!total) return '<div class="empty">Sem despesas neste mês</div>';
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
    <div class="chart-wrap"><svg viewBox="0 0 180 180" role="img" aria-label="Despesas por categoria">${segs}
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
  const acc = accumulatedBalance(ui.month);

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

  const pending = list.filter((x) => !x.paid).sort((a, b) => a.date.localeCompare(b.date));
  const recent = [...list].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 8);

  return `
  <div class="grid cols-4">
    <div class="card stat"><div class="label">Receitas</div><div class="value pos">${money(t.income)}</div>
      <div class="sub">${t.pendingIncome ? money(t.pendingIncome) + ' a receber' : 'tudo recebido'}</div></div>
    <div class="card stat"><div class="label">Despesas</div><div class="value neg">${money(t.expense)}</div>
      <div class="sub">${t.pendingExpense ? money(t.pendingExpense) + ' a pagar' : 'tudo pago'}</div></div>
    <div class="card stat"><div class="label">Resultado do mês</div><div class="value ${t.balance >= 0 ? 'pos' : 'neg'}">${money(t.balance)}</div>
      <div class="sub">${t.income ? Math.round((t.balance / t.income) * 100) + '% da renda' : '—'}</div></div>
    <div class="card stat"><div class="label">Saldo acumulado</div><div class="value ${acc >= 0 ? '' : 'neg'}">${money(acc)}</div>
      <div class="sub">efetivado até o fim do mês</div></div>
  </div>

  <div class="grid cols-2 mt">
    <div class="card"><h2>Despesas por categoria</h2>${donutChart(items)}</div>
    <div class="card"><h2>Últimos 6 meses</h2>${barsChart(months)}</div>
  </div>

  <div class="grid cols-2 mt">
    <div class="card">
      <div class="card-head"><h2>Contas pendentes</h2><span class="muted">${pending.length}</span></div>
      ${pending.length ? `<ul class="tx-list">${pending.slice(0, 8).map((x) => txItem(x)).join('')}</ul>` : '<div class="empty">Nenhuma pendência 🎉</div>'}
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
  if (ui.view === 'settings') {
    $('#newCat').addEventListener('click', () => openCatForm());
    $$('[data-editcat]', v).forEach((el) => el.addEventListener('click', () => openCatForm(state.categories.find((c) => c.id === el.dataset.editcat))));
    $('#exportJson').addEventListener('click', exportJson);
    $('#importJson').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', importJson);
    $('#exportCsv').addEventListener('click', exportCsv);
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

function openTxForm(tx) {
  const isEdit = !!tx;
  const t = tx || { type: 'expense', amount: 0, date: monthOf(todayISO()) === ui.month ? todayISO() : `${ui.month}-01`, categoryId: '', description: '', paid: true, notes: '' };
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
      <label class="field"><span>Data</span><input type="date" name="date" value="${t.date}" required></label>
      <label class="check full"><input type="checkbox" name="paid" ${t.paid ? 'checked' : ''}><span id="paidLabel">${t.type === 'income' ? 'Já recebido' : 'Já pago'}</span></label>
      ${isEdit ? '' : `
      <label class="field"><span>Repetir</span>
        <select name="repeat" id="txRepeat">
          <option value="once">Não repetir</option>
          <option value="installments">Parcelado (divide o valor)</option>
          <option value="monthly">Fixo mensal (mesmo valor)</option>
        </select></label>
      <label class="field" id="repeatCountWrap" style="visibility:hidden"><span>Quantidade de meses</span>
        <input type="number" name="count" min="2" max="120" value="12" inputmode="numeric"></label>`}
      <label class="field full"><span>Observações</span><textarea name="notes" rows="2">${esc(t.notes)}</textarea></label>
    </div>
    <div class="modal-actions">
      ${isEdit ? '<button class="btn danger" value="delete" formnovalidate>Excluir</button>' : ''}
      ${isEdit && t.groupId ? '<button class="btn danger" value="deleteFuture" formnovalidate>Excluir este e próximos</button>' : ''}
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
    };
    if (isEdit) {
      Object.assign(tx, data);
    } else {
      const repeat = fd.get('repeat');
      const count = Math.max(2, Math.min(120, Number(fd.get('count')) || 2));
      if (repeat === 'once') {
        state.transactions.push({ id: uid(), createdAt: Date.now(), ...data });
      } else {
        const groupId = uid();
        const per = repeat === 'installments' ? Math.floor(amount / count) : amount;
        const remainder = repeat === 'installments' ? amount - per * count : 0;
        for (let i = 0; i < count; i++) {
          state.transactions.push({
            ...data,
            id: uid(), createdAt: Date.now() + i, groupId,
            amount: per + (i === 0 ? remainder : 0),
            date: addMonthsToDate(data.date, i),
            paid: i === 0 ? data.paid : false,
            installment: repeat === 'installments' ? `${i + 1}/${count}` : '',
          });
        }
      }
    }
    save(); render(); toast(isEdit ? 'Lançamento atualizado' : 'Lançamento salvo');
  }, () => {
    const amountEl = $('[name="amount"]', modalForm);
    if (!isEdit) setTimeout(() => amountEl.focus(), 50);
    $$('[name="type"]', modalForm).forEach((r) => r.addEventListener('change', () => {
      $('#txCat').innerHTML = catOptions(r.value, '');
      $('#paidLabel').textContent = r.value === 'income' ? 'Já recebido' : 'Já pago';
    }));
    $('#txRepeat')?.addEventListener('change', (e) => {
      $('#repeatCountWrap').style.visibility = e.target.value === 'once' ? 'hidden' : 'visible';
    });
  });
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
      state = { ...defaultState(), ...data };
      save(); setView('dashboard'); toast('Backup restaurado');
    } catch {
      alert('Arquivo de backup inválido.');
    }
  };
  reader.readAsText(file);
}

function exportCsv() {
  const rows = [['Data', 'Tipo', 'Categoria', 'Descrição', 'Valor', 'Situação', 'Parcela', 'Observações']];
  [...state.transactions].sort((a, b) => a.date.localeCompare(b.date)).forEach((t) => {
    rows.push([
      t.date.split('-').reverse().join('/'),
      t.type === 'income' ? 'Receita' : 'Despesa',
      catById(t.categoryId).name,
      t.description,
      ((t.type === 'income' ? 1 : -1) * t.amount / 100).toFixed(2).replace('.', ','),
      t.paid ? 'Efetivado' : 'Pendente',
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
  state.budgets = { ...state.budgets, 'c-mercado': 130000, 'c-alimentacao': 40000, 'c-lazer': 35000, 'c-transporte': 50000 };
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
$('#monthLabel').addEventListener('click', () => { ui.month = monthOf(todayISO()); render(); });

// Atalhos de teclado (Magic Keyboard)
document.addEventListener('keydown', (e) => {
  if (modal.open || e.target.matches('input, textarea, select')) return;
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openTxForm(); }
  if (e.key === 'ArrowLeft') { ui.month = addMonths(ui.month, -1); render(); }
  if (e.key === 'ArrowRight') { ui.month = addMonths(ui.month, 1); render(); }
  const map = { 1: 'dashboard', 2: 'transactions', 3: 'budgets', 4: 'goals', 5: 'settings' };
  if (map[e.key]) setView(map[e.key]);
});

// Pede ao navegador para não apagar os dados automaticamente
navigator.storage?.persist?.();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

setView('dashboard');
