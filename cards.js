'use strict';

/* =========================================================
   Cartões de crédito — limites, faturas e avisos de vencimento
   Compras no cartão não saem do saldo em conta na data da compra:
   o valor só sai quando a fatura é paga.
   Usa as funções e o estado globais definidos em app.js.
   ========================================================= */

const CARD_COLORS = ['#7c3aed', '#ea580c', '#0f766e', '#2563eb', '#db2777', '#475569', '#ca8a04', '#16a34a'];
const alertDays = () => state.settings?.alertDays ?? 7; // avisar com N dias de antecedência

const cardById = (id) => state.cards.find((c) => c.id === id);
const fmtDate = (iso) => iso.split('-').reverse().join('/');

/** Data ISO para (ano, mês 1-12 podendo passar de 12, dia) com o dia limitado ao fim do mês. */
function ymdClamp(y, m, d) {
  const first = new Date(y, m - 1, 1);
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return `${first.getFullYear()}-${pad(first.getMonth() + 1)}-${pad(Math.min(d, last))}`;
}

/**
 * Em qual fatura cai uma compra feita em `dateISO`.
 * Compras a partir do dia de fechamento vão para a fatura seguinte.
 */
function invoiceFor(card, dateISO) {
  const [y, m, d] = dateISO.split('-').map(Number);
  const closeM = d >= card.closingDay ? m + 1 : m;
  const closeISO = ymdClamp(y, closeM, card.closingDay);
  const [cy, cm] = closeISO.split('-').map(Number);
  const dueISO = ymdClamp(cy, card.dueDay > card.closingDay ? cm : cm + 1, card.dueDay);
  return { closeISO, dueISO };
}

const invoiceKey = (cardId, dueISO) => `${cardId}|${dueISO}`;

/** Todas as faturas de um cartão, agrupadas pela data de vencimento. */
function invoicesOf(card) {
  const map = {};
  for (const t of state.transactions) {
    if (t.cardId !== card.id || t.type !== 'expense') continue;
    const { closeISO, dueISO } = invoiceFor(card, t.date);
    const inv = (map[dueISO] ||= { card, dueISO, closeISO, items: [], total: 0 });
    inv.items.push(t);
    inv.total += t.amount;
  }
  return Object.values(map).map((inv) => {
    const pay = state.invoicePayments[invoiceKey(card.id, inv.dueISO)];
    inv.paid = !!pay;
    inv.paidDate = pay?.date || null;
    inv.items.sort((a, b) => a.date.localeCompare(b.date));
    return inv;
  }).sort((a, b) => a.dueISO.localeCompare(b.dueISO));
}
const allInvoices = () => state.cards.flatMap(invoicesOf);

function invoiceStatus(inv, today = todayISO()) {
  if (inv.paid) return { key: 'paid', label: 'paga' };
  if (today > inv.dueISO) return { key: 'overdue', label: 'vencida' };
  if (today >= inv.closeISO) return { key: 'closed', label: 'fechada' };
  return { key: 'open', label: 'aberta' };
}

/** Limite comprometido: tudo que está em faturas ainda não pagas (inclui parcelas futuras). */
const cardUsed = (card) => invoicesOf(card).filter((i) => !i.paid).reduce((s, i) => s + i.total, 0);

/** Quanto as faturas tiram do saldo em conta até a data (pagas; com includePending, também as a vencer). */
function invoicesBalanceEffect(untilISO, includePending) {
  let out = 0;
  for (const inv of allInvoices()) {
    if (inv.paid ? inv.paidDate <= untilISO : includePending && inv.dueISO <= untilISO) out += inv.total;
  }
  return out;
}

/** Faturas não pagas vencidas ou que vencem nos próximos dias. */
function invoiceAlerts() {
  const today = todayISO();
  const limit = addDaysISO(today, alertDays());
  return allInvoices().filter((i) => !i.paid && i.total > 0 && i.dueISO <= limit);
}

/** Contas a pagar (fora do cartão) vencidas ou que vencem nos próximos dias. */
function billAlerts() {
  const limit = addDaysISO(todayISO(), alertDays());
  return state.transactions.filter((t) => t.type === 'expense' && !t.cardId && !t.paid && t.date <= limit)
    .sort((a, b) => a.date.localeCompare(b.date));
}
/** Receitas previstas (ex.: salário) cuja data chegou e ainda não foram confirmadas. */
function incomeAlerts() {
  const today = todayISO();
  return state.transactions.filter((t) => t.type === 'income' && !t.paid && t.date <= today)
    .sort((a, b) => a.date.localeCompare(b.date));
}
function expectedText(iso) {
  const n = daysUntil(iso);
  if (n === 0) return 'previsto para hoje';
  return `previsto para ${fmtDate(iso)} (há ${-n} dia${n === -1 ? '' : 's'}) — já caiu?`;
}
function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const x = new Date(y, m - 1, d + n);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}
function daysUntil(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const [ty, tm, td] = todayISO().split('-').map(Number);
  return Math.round((new Date(y, m - 1, d) - new Date(ty, tm - 1, td)) / 86400000);
}
function dueText(iso) {
  const n = daysUntil(iso);
  if (n < 0) return `venceu há ${-n} dia${n === -1 ? '' : 's'}`;
  if (n === 0) return 'vence hoje';
  if (n === 1) return 'vence amanhã';
  return `vence em ${n} dias`;
}

/* ---------- Componentes usados em outras telas ---------- */
function alertsBanner() {
  const items = [
    ...invoiceAlerts().map((i) => ({ date: i.dueISO, icon: '💳', title: `Fatura ${i.card.name}`, amount: i.total, btn: `data-payinv="${invoiceKey(i.card.id, i.dueISO)}"` })),
    ...billAlerts().map((t) => ({ date: t.date, icon: catById(t.categoryId).icon, title: t.description || catById(t.categoryId).name, amount: t.amount, btn: `data-paybill="${t.id}"` })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  const incomes = incomeAlerts().map((t) => `<div class="alert income">
      <span class="alert-icon">${catById(t.categoryId).icon}</span>
      <div class="alert-text"><b>${esc(t.description || catById(t.categoryId).name)}</b> ${expectedText(t.date)}: <b class="pos">${money(t.amount)}</b></div>
      <button class="btn small primary" data-receive="${t.id}">Recebi</button>
    </div>`).join('');
  if (!items.length && !incomes) return '';
  return `<div class="alerts">${incomes}${items.map((a) => {
    const overdue = daysUntil(a.date) < 0;
    return `<div class="alert ${overdue ? 'danger' : ''}">
      <span class="alert-icon">${overdue ? '🚨' : a.icon}</span>
      <div class="alert-text"><b>${esc(a.title)}</b> ${dueText(a.date)} (${fmtDate(a.date)}): <b>${money(a.amount)}</b></div>
      <button class="btn small primary" ${a.btn}>Pagar</button>
    </div>`;
  }).join('')}</div>`;
}

/** Confirmar pagamento (despesa) ou recebimento (receita): permite ajustar o valor real e a data. */
function openBillPay(tx) {
  const inc = tx.type === 'income';
  openModal(`
    <h2>${inc ? '💰 Confirmar recebimento' : '✅ Pagar conta'}</h2>
    <p class="muted" style="margin-top:-6px"><b>${esc(tx.description || catById(tx.categoryId).name)}</b> · ${inc ? 'previsto para' : 'vencimento'} ${fmtDate(tx.date)}</p>
    <div class="form-grid">
      <label class="field"><span>${inc ? 'Valor recebido' : 'Valor pago'} (R$)</span><input class="amount-input" name="amount" inputmode="decimal" value="${centsToInput(tx.amount)}" required autocomplete="off"></label>
      <label class="field"><span>${inc ? 'Data do recebimento' : 'Data do pagamento'}</span><input type="date" name="date" value="${todayISO()}" required></label>
    </div>
    <p class="muted" style="font-size:13px">${inc ? 'O valor entra no seu <b>saldo em conta</b>. Se o valor mudou (ex.: aumento, horas extras), corrija acima.' : 'O valor sai do seu <b>saldo em conta</b>.'}</p>
    <div class="modal-actions"><button class="btn" value="cancel" formnovalidate>Cancelar</button><button class="btn primary" value="save">${inc ? 'Confirmar recebimento' : 'Confirmar pagamento'}</button></div>`,
  (action, fd) => {
    const amount = parseMoney(fd.get('amount'));
    if (amount <= 0) { toast(inc ? 'Informe o valor recebido' : 'Informe o valor pago'); return false; }
    tx.amount = amount;
    tx.paid = true;
    const date = fd.get('date');
    if (date !== tx.date) tx.paidDate = date; else delete tx.paidDate;
    save(); render(); toast(inc ? 'Recebimento confirmado 💰' : 'Conta paga ✅');
  }, () => setTimeout(() => { const el = $('[name="amount"]', modalForm); el.focus(); el.select(); }, 50));
}

/** Linha de fatura para a lista de contas pendentes do Resumo. */
function invoiceItem(inv) {
  const st = invoiceStatus(inv);
  return `<li class="tx" data-invoice="${invoiceKey(inv.card.id, inv.dueISO)}">
    <div class="tx-icon" style="background:${inv.card.color}22">💳</div>
    <div class="tx-main">
      <div class="tx-title">Fatura ${esc(inv.card.name)}<span class="badge ${st.key === 'overdue' ? 'danger' : ''}">${st.label}</span></div>
      <div class="tx-meta">Vence ${shortDate(inv.dueISO)} · ${inv.items.length} compra${inv.items.length === 1 ? '' : 's'}</div>
    </div>
    <div class="tx-amount neg">− ${money(inv.total)}</div>
  </li>`;
}

function cardOptions(selected) {
  if (!state.cards.length) return '<option value="">🏦 Saldo em conta (débito, Pix, dinheiro)</option><option value="" disabled>— cadastre cartões na aba Cartões —</option>';
  return `<option value="">🏦 Saldo em conta (débito, Pix, dinheiro)</option>` +
    state.cards.map((c) => `<option value="${c.id}" ${c.id === selected ? 'selected' : ''}>💳 ${esc(c.name)}</option>`).join('');
}

/* ---------- Tela ---------- */
function renderCards() {
  const today = todayISO();
  const cards = state.cards;
  const totalLimit = cards.reduce((s, c) => s + c.limit, 0);
  const used = cards.reduce((s, c) => s + cardUsed(c), 0);
  const unpaidDue = allInvoices().filter((i) => !i.paid && i.dueISO <= addDaysISO(today, 40)).reduce((s, i) => s + i.total, 0);

  if (!cards.length) {
    return `<div class="card"><div class="empty">
      <div style="font-size:44px">💳</div>
      <p>Cadastre seus cartões de crédito com o limite, o dia de fechamento e o dia de vencimento.<br>
      Depois, ao lançar uma despesa, escolha o cartão em <b>Forma de pagamento</b>:<br>
      a compra vai para a fatura certa e só sai do saldo em conta quando você pagar a fatura.</p>
      <button class="btn primary" id="newCard">+ Cadastrar cartão</button></div></div>`;
  }

  const cardHtml = cards.map((c) => {
    const invs = invoicesOf(c);
    const u = cardUsed(c);
    const pct = c.limit ? Math.round((u / c.limit) * 100) : 0;
    const shown = [...invs.filter((i) => i.paid).slice(-2), ...invs.filter((i) => !i.paid)];
    const rows = shown.map((i) => {
      const st = invoiceStatus(i, today);
      const key = invoiceKey(c.id, i.dueISO);
      return `<li class="inv-row">
        <div><b>Vence ${fmtDate(i.dueISO)}</b><span class="badge ${st.key}">${st.label}</span>
          <div class="tx-meta">${i.paid ? `Paga em ${fmtDate(i.paidDate)}` : st.key === 'open' ? `Fecha em ${fmtDate(i.closeISO)}` : dueText(i.dueISO)} · ${i.items.length} compra${i.items.length === 1 ? '' : 's'}</div></div>
        <b class="inv-total">${money(i.total)}</b>
        <div class="row-actions">
          <button class="btn small" data-invoice="${key}">Ver</button>
          ${i.paid ? `<button class="btn small" data-unpayinv="${key}">Desfazer</button>` : `<button class="btn small primary" data-payinv="${key}">Pagar</button>`}
        </div>
      </li>`;
    }).join('');
    return `<div class="card">
      <div class="card-head">
        <div style="display:flex;gap:12px;align-items:center;min-width:0">
          <div class="cc-chip" style="background:${c.color}">💳</div>
          <div style="min-width:0"><h2 style="margin:0">${esc(c.name)}</h2>
            <div class="tx-meta">Fecha dia ${c.closingDay} · vence dia ${c.dueDay}</div></div>
        </div>
        <button class="btn small" data-editcard="${c.id}">Editar</button>
      </div>
      <div class="budget-top"><span class="muted">Limite usado</span><span class="budget-nums">${money(u)} de ${money(c.limit)}</span></div>
      <div class="progress ${pct > 100 ? 'over' : pct >= 80 ? 'near' : ''}"><div style="width:${Math.min(pct, 100)}%"></div></div>
      <div class="tx-meta" style="margin-top:6px">Disponível: <b class="${c.limit - u < 0 ? 'neg' : 'pos'}">${money(c.limit - u)}</b></div>
      <h3 class="muted" style="font-size:14px;margin:16px 0 4px">Faturas</h3>
      ${rows ? `<ul class="inv-list">${rows}</ul>` : '<div class="muted" style="font-size:14px;padding:8px 0">Nenhuma compra lançada neste cartão ainda.</div>'}
      <div class="row-actions mt"><button class="btn small primary" data-cardbuy="${c.id}">+ Compra neste cartão</button></div>
    </div>`;
  }).join('');

  return `
  ${alertsBanner()}
  <div class="grid cols-4">
    <div class="card stat"><div class="label">Limite total</div><div class="value">${money(totalLimit)}</div></div>
    <div class="card stat"><div class="label">Limite usado</div><div class="value neg">${money(used)}</div>
      <div class="sub">inclui parcelas futuras</div></div>
    <div class="card stat"><div class="label">Disponível</div><div class="value ${totalLimit - used >= 0 ? 'pos' : 'neg'}">${money(totalLimit - used)}</div></div>
    <div class="card stat"><div class="label">Faturas a pagar</div><div class="value">${money(unpaidDue)}</div>
      <div class="sub">vencendo nos próximos 40 dias</div></div>
  </div>
  <div class="card-head mt" style="margin-top:24px"><h2 style="font-size:20px">Meus cartões</h2><button class="btn primary" id="newCard">+ Novo cartão</button></div>
  <div class="grid cols-2">${cardHtml}</div>`;
}

/** Liga os botões de faturas/cartões presentes em qualquer tela. */
function bindCardActions(v) {
  $$('[data-payinv]', v).forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); openInvoicePay(el.dataset.payinv); }));
  $$('[data-paybill], [data-receive]', v).forEach((el) => el.addEventListener('click', (e) => {
    e.stopPropagation();
    const t = state.transactions.find((x) => x.id === (el.dataset.paybill || el.dataset.receive));
    if (t) openBillPay(t);
  }));
  $$('[data-unpayinv]', v).forEach((el) => el.addEventListener('click', () => {
    if (!confirm('Desfazer o pagamento desta fatura? O valor volta para o saldo em conta.')) return;
    delete state.invoicePayments[el.dataset.unpayinv];
    save(); render(); toast('Pagamento desfeito');
  }));
  $$('[data-invoice]', v).forEach((el) => el.addEventListener('click', () => openInvoiceDetails(el.dataset.invoice)));
  if (ui.view === 'cards') {
    $('#newCard')?.addEventListener('click', () => openCardForm());
    $$('[data-editcard]', v).forEach((el) => el.addEventListener('click', () => openCardForm(cardById(el.dataset.editcard))));
    $$('[data-cardbuy]', v).forEach((el) => el.addEventListener('click', () => openTxForm(null, { cardId: el.dataset.cardbuy })));
  }
}

function findInvoice(key) {
  const [cardId, dueISO] = key.split('|');
  const card = cardById(cardId);
  return card && invoicesOf(card).find((i) => i.dueISO === dueISO);
}

/* ---------- Modais ---------- */
function openCardForm(card) {
  const c = card || { name: '', limit: 0, closingDay: 8, dueDay: 15, color: CARD_COLORS[state.cards.length % CARD_COLORS.length] };
  openModal(`
    <h2>${card ? 'Editar cartão' : 'Novo cartão de crédito'}</h2>
    <div class="form-grid">
      <label class="field full"><span>Nome do cartão</span><input name="name" value="${esc(c.name)}" required placeholder="Ex.: Nubank, Itaú Visa…"></label>
      <label class="field full"><span>Limite total (R$)</span><input class="amount-input" name="limit" inputmode="decimal" placeholder="0,00" value="${c.limit ? centsToInput(c.limit) : ''}" required></label>
      <label class="field"><span>Dia de fechamento da fatura</span><input type="number" name="closingDay" min="1" max="31" value="${c.closingDay}" required inputmode="numeric"></label>
      <label class="field"><span>Dia de vencimento</span><input type="number" name="dueDay" min="1" max="31" value="${c.dueDay}" required inputmode="numeric"></label>
      <p class="muted full" style="margin:0;font-size:13px">Os dois dias aparecem na fatura ou no app do banco. Compras feitas <b>a partir</b> do dia de fechamento entram na fatura do mês seguinte.</p>
      <label class="field"><span>Cor</span><input type="color" name="color" value="${c.color}"></label>
    </div>
    <div class="modal-actions">
      ${card ? '<button class="btn danger" value="delete" formnovalidate>Excluir</button>' : ''}
      <span class="spacer"></span>
      <button class="btn" value="cancel" formnovalidate>Cancelar</button><button class="btn primary" value="save">Salvar</button>
    </div>`,
  (action, fd) => {
    if (action === 'delete') {
      const n = state.transactions.filter((t) => t.cardId === card.id).length;
      const msg = n ? `Este cartão tem ${n} compra(s). Ao excluir, elas passam a contar como pagas pelo saldo em conta. Excluir mesmo assim?` : 'Excluir este cartão?';
      if (!confirm(msg)) return false;
      state.transactions.forEach((t) => { if (t.cardId === card.id) delete t.cardId; });
      for (const k of Object.keys(state.invoicePayments)) if (k.startsWith(card.id + '|')) delete state.invoicePayments[k];
      state.cards = state.cards.filter((x) => x.id !== card.id);
      save(); render(); toast('Cartão excluído');
      return;
    }
    const day = (v) => Math.max(1, Math.min(31, Number(v) || 1));
    const data = { name: fd.get('name').trim(), limit: parseMoney(fd.get('limit')), closingDay: day(fd.get('closingDay')), dueDay: day(fd.get('dueDay')), color: fd.get('color') };
    if (!data.name) { toast('Informe o nome do cartão'); return false; }
    if (card) Object.assign(card, data); else state.cards.push({ id: 'cc-' + uid(), ...data });
    save(); render(); toast(card ? 'Cartão atualizado' : 'Cartão cadastrado');
  });
}

function openInvoicePay(key) {
  const inv = findInvoice(key);
  if (!inv) return;
  openModal(`
    <h2>💳 Pagar fatura ${esc(inv.card.name)}</h2>
    <p class="muted" style="margin-top:-6px">Vencimento: <b>${fmtDate(inv.dueISO)}</b> · ${inv.items.length} compra${inv.items.length === 1 ? '' : 's'}</p>
    <div class="stat" style="margin:6px 0 14px"><div class="label">Valor da fatura</div><div class="value neg">${money(inv.total)}</div></div>
    <label class="field"><span>Data do pagamento</span><input type="date" name="date" value="${todayISO()}" required></label>
    <p class="muted" style="font-size:13px">O valor da fatura será descontado do seu <b>saldo em conta</b> nesta data.</p>
    <div class="modal-actions"><button class="btn" value="cancel" formnovalidate>Cancelar</button><button class="btn primary" value="save">Confirmar pagamento</button></div>`,
  (action, fd) => {
    state.invoicePayments[key] = { date: fd.get('date') };
    save(); render(); toast('Fatura paga ✅');
  });
}

function openInvoiceDetails(key) {
  const inv = findInvoice(key);
  if (!inv) return;
  const st = invoiceStatus(inv);
  const rows = inv.items.map((t) => {
    const c = catById(t.categoryId);
    return `<li class="tx" data-edittx="${t.id}">
      <div class="tx-icon" style="background:${c.color}22">${c.icon}</div>
      <div class="tx-main"><div class="tx-title">${esc(t.description || c.name)}</div>
        <div class="tx-meta">${shortDate(t.date)} · ${esc(c.name)}${t.installment ? ' · parcela ' + esc(t.installment) : ''}</div></div>
      <div class="tx-amount neg">${money(t.amount)}</div></li>`;
  }).join('');
  openModal(`
    <h2>Fatura ${esc(inv.card.name)}</h2>
    <p class="muted" style="margin-top:-6px">Fecha ${fmtDate(inv.closeISO)} · vence ${fmtDate(inv.dueISO)} · <span class="badge ${st.key}">${st.label}</span></p>
    <ul class="tx-list" style="max-height:50vh;overflow:auto">${rows}</ul>
    <div class="budget-top mt"><b>Total</b><b class="neg">${money(inv.total)}</b></div>
    <div class="modal-actions">
      <span class="spacer"></span>
      <button class="btn" value="cancel" formnovalidate>Fechar</button>
      ${inv.paid ? '' : '<button class="btn primary" value="pay">Pagar fatura</button>'}
    </div>`,
  (action) => {
    if (action === 'pay') setTimeout(() => openInvoicePay(key), 0);
  }, () => {
    $$('[data-edittx]', modalForm).forEach((el) => el.addEventListener('click', () => {
      modal.close();
      openTxForm(state.transactions.find((t) => t.id === el.dataset.edittx));
    }));
  });
}

/** Atualiza o número de avisos no menu e no ícone do app (quando o iPadOS permitir). */
function updateCardBadges() {
  const nInv = invoiceAlerts().length;
  const nBill = billAlerts().length + incomeAlerts().length;
  const set = (view, n) => { const el = $(`.nav-item[data-view="${view}"] .nav-badge`); if (el) { el.textContent = n; el.hidden = !n; } };
  set('cards', nInv);
  set('dashboard', nBill + nInv);
  const n = nInv + nBill;
  try { n ? navigator.setAppBadge?.(n) : navigator.clearAppBadge?.(); } catch { /* sem suporte */ }
}
