'use strict';

/* =========================================================
   Lançamento rápido — transforma uma frase em lançamento.
   Ex.: "mercado 85,90 nubank", "uber 23", "luz 310 dia 20",
        "salário 5000 dia 5 todo mês", "celular 1200 10x nubank"
   Funciona offline, sem inteligência artificial: regras simples em português.
   Usa as funções e o estado globais definidos em app.js / cards.js.
   ========================================================= */

/** Palavras-chave → categoria padrão. A primeira que aparecer na frase vence. */
const QUICK_KEYWORDS = [
  ['c-salario', 'salario holerite pagamento do mes adiantamento 13o decimo terceiro ferias'],
  ['c-invest', 'rendimento rendimentos dividendo dividendos juros cdb'],
  ['c-resgate', 'resgate resgatei'],
  ['c-extra', 'freela freelance extra bico venda vendi reembolso comissao bonus premio presente'],
  ['c-moradia', 'aluguel condominio iptu reforma moveis movel casa diarista faxina'],
  ['c-mercado', 'mercado supermercado feira padaria acougue hortifruti sacolao atacadao assai carrefour'],
  ['c-alimentacao', 'restaurante ifood lanche lanchonete almoco jantar pizza hamburguer cafe sorvete delivery marmita'],
  ['c-transporte', 'uber 99 taxi gasolina combustivel etanol alcool posto onibus metro estacionamento pedagio oficina mecanico ipva seguro do carro'],
  ['c-saude', 'farmacia remedio remedios medico consulta dentista exame exames hospital plano de saude academia psicologo'],
  ['c-educacao', 'escola curso faculdade livro livros mensalidade material escolar'],
  ['c-contas', 'luz energia agua internet celular telefone gas conta de luz conta de agua tv a cabo'],
  ['c-assinaturas', 'netflix spotify streaming assinatura prime disney youtube hbo max globoplay icloud deezer'],
  ['c-lazer', 'cinema show viagem bar passeio festa ingresso hotel praia jogo'],
  ['c-cartao', 'anuidade'],
  ['c-aplicacao', 'aplicacao aplicacao investi investimento poupei'],
];
const INCOME_WORDS = /\b(recebi|receita|recebimento|a receber|salario|freela|freelance|reembolso|rendimentos?|dividendos?|vendi|venda|bonus|comissao|resgate|resgatei|holerite|adiantamento)\b/;
const FILLER_START = /^(gastei|paguei|comprei|recebi|gasto|compra|despesa|receita|de|do|da|no|na|em|com|um|uma|o|a)\s+/i;
const FILLER_END = /\s+(de|do|da|no|na|em|com|e|o|a)$/i;

const normChar = (c) => (c.normalize('NFD')[0] || c).toLowerCase();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function parseQuick(text) {
  const orig = String(text || '');
  const norm = orig.split('').map(normChar).join('');
  const mask = new Array(orig.length).fill(false);
  const free = (m) => !mask.slice(m.index, m.index + m[0].length).some(Boolean);
  /** Procura o primeiro trecho ainda não usado que casa com a regex e marca como usado. */
  const take = (re, pick) => {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    const all = [...norm.matchAll(g)].filter(free);
    const m = pick ? pick(all) : all[0];
    if (m) for (let i = m.index; i < m.index + m[0].length; i++) mask[i] = true;
    return m || null;
  };
  const rest = () => norm.split('').map((c, i) => (mask[i] ? ' ' : c)).join('');

  const today = todayISO();
  const r = { type: 'expense', amount: 0, date: today, cardId: '', paid: null, repeat: 'once', count: 1, categoryId: '', description: '', notes: '', warnings: [] };

  // Parcelas: "10x", "em 3 vezes", "6 parcelas"
  const inst = take(/\b(?:em\s+)?(\d{1,2})\s*(?:x|vezes|parcelas)(?![a-z])/);
  if (inst && Number(inst[1]) >= 2) { r.repeat = 'installments'; r.count = Number(inst[1]); }

  // Repetição mensal: "todo mês", "mensal", "fixo", "por 6 meses"
  const per = take(/\bpor\s+(\d{1,3})\s+meses\b/);
  if (take(/\b(?:todo\s+mes|todos\s+os\s+meses|mensal(?:mente)?|fix[oa])\b/) || per) {
    if (r.repeat === 'once') { r.repeat = 'monthly'; r.count = per ? Number(per[1]) : 12; }
  }

  // Data: "15/11", "15/11/2026", "dia 15", "hoje", "ontem", "anteontem", "amanhã"
  const [ty, tm] = today.split('-').map(Number);
  let m;
  if ((m = take(/\b(?:dia\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    let y = m[3] ? Number(m[3]) : ty;
    if (y < 100) y += 2000;
    r.date = ymdClamp(y, Number(m[2]), Number(m[1]));
  } else if ((m = take(/\b(?:vence(?:ndo)?\s+)?dia\s+(\d{1,2})\b/))) {
    r.date = ymdClamp(ty, tm, Number(m[1]));
  } else if (take(/\banteontem\b/)) r.date = addDaysISO(today, -2);
  else if (take(/\bontem\b/)) r.date = addDaysISO(today, -1);
  else if (take(/\bamanha\b/)) r.date = addDaysISO(today, 1);
  else take(/\bhoje\b/);

  // Cartão pelo nome ("nubank", "itau"…), ou genérico ("no cartão", "crédito")
  const cards = [...state.cards].sort((a, b) => b.name.length - a.name.length);
  for (const c of cards) {
    const name = c.name.split('').map(normChar).join('');
    if (take(new RegExp(`\\b(?:no\\s+|cartao\\s+)?${escapeRe(name)}\\b`))) { r.cardId = c.id; break; }
  }
  if (!r.cardId && take(/\b(?:no\s+|pelo\s+)?(?:cartao(?:\s+de\s+credito)?|credito)\b/)) {
    if (state.cards.length) {
      r.cardId = state.cards[0].id;
      if (state.cards.length > 1) r.warnings.push(`Usei o cartão ${state.cards[0].name}; escreva o nome do cartão para escolher outro.`);
    } else r.warnings.push('Você ainda não cadastrou cartões (aba Cartões); lancei como saldo em conta.');
  }
  take(/\b(?:no\s+|pelo\s+|via\s+|em\s+)?(?:debito|pix|dinheiro|especie|boleto pago)\b/); // saldo em conta (padrão)

  // Situação: pago / a pagar
  if (take(/\b(?:a\s+pagar|a\s+receber|pendente|vence|vencimento|nao\s+pag[oa])\b/)) r.paid = false;
  else if (take(/\b(?:pago|paga|paguei|recebido|recebida|quitad[oa])\b/)) r.paid = true;

  // Receita ou despesa
  if (/^\s*\+/.test(orig) || INCOME_WORDS.test(norm)) r.type = 'income';
  if (/^\s*-/.test(orig)) r.type = 'expense';
  if (r.type === 'income') r.cardId = '';

  // Valor: prefere o número com vírgula ou "R$"; aceita "1.234,56", "85,90", "85.90", "50 reais"
  const amt = take(/(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?:\s*(?:reais|real|conto|contos|pila))?(?![\d/x])/,
    (all) => all.find((x) => /,|r\$/.test(x[0])) || all[0]);
  if (amt) r.amount = parseMoney(amt[1]);

  // Categoria: palavras-chave no texto que sobrou, depois nomes das suas categorias
  const leftover = ` ${rest().replace(/\s+/g, ' ')} `;
  const valid = (id) => state.categories.find((c) => c.id === id && c.type === r.type);
  let best = null;
  for (const [id, words] of QUICK_KEYWORDS) {
    for (const w of words.split(' ')) {
      const i = leftover.search(new RegExp(`\\b${escapeRe(w)}\\b`));
      if (i >= 0 && (!best || i < best.i) && valid(id)) best = { id, i };
    }
  }
  for (const c of state.categories.filter((x) => x.type === r.type)) {
    const name = c.name.split('').map(normChar).join('');
    const i = leftover.indexOf(` ${name} `);
    if (i >= 0 && (!best || i <= best.i)) best = { id: c.id, i };
  }
  // Parcelado quase sempre é compra de um produto (ex.: "celular 1200 10x"), não conta mensal.
  if (best && r.repeat === 'installments' && ['c-contas', 'c-assinaturas'].includes(best.id)) best = null;
  r.categoryId = best?.id || (state.categories.find((c) => c.type === r.type && /outros|extra/i.test(c.name)) || state.categories.find((c) => c.type === r.type))?.id || '';

  // Descrição: o que sobrou da frase, sem palavras de ligação
  let desc = orig.split('').map((c, i) => (mask[i] ? ' ' : c)).join('')
    .replace(/[+\-–—:;,.]+(\s|$)/g, ' ').replace(/^[+\-\s]+/, '').replace(/\s+/g, ' ').trim();
  for (let k = 0; k < 3; k++) desc = desc.replace(FILLER_START, '').replace(FILLER_END, '').trim();
  r.description = desc ? desc.charAt(0).toUpperCase() + desc.slice(1) : catById(r.categoryId).name;

  // Pago? padrão: cartão = sim; data futura = não; caso contrário = sim
  if (r.cardId) r.paid = true;
  else if (r.paid === null) r.paid = r.date <= today;
  return r;
}

/* ---------- Interface ---------- */
const QUICK_EXAMPLES = ['mercado 85,90 nubank', 'uber 23', 'luz 310 dia 20', 'salário 5000 dia 5 todo mês', 'celular 1200 10x nubank', 'farmácia 42 ontem pix'];

function quickBar() {
  const last = ui.lastQuick;
  return `<div class="card quick">
    <form class="quick-row" id="quickForm" autocomplete="off">
      <span class="quick-icon">⚡</span>
      <input id="quickInput" enterkeyhint="done" placeholder="Lançamento rápido — ex.: mercado 85,90 nubank" value="${esc(ui.quickText || '')}">
      <button class="btn primary" id="quickAdd">Adicionar</button>
    </form>
    <div id="quickPreview" class="quick-preview"></div>
    ${last ? `<div class="quick-last">✅ Lançado: <b>${esc(last.label)}</b> <button class="link-btn" id="quickUndo">Desfazer</button> <button class="link-btn" id="quickEditLast">Editar</button></div>` : ''}
  </div>`;
}

function quickPreviewHtml(text) {
  if (!text.trim()) {
    return `<span class="muted">Escreva o que aconteceu, do seu jeito. Exemplos: ${QUICK_EXAMPLES.map((e) => `<button type="button" class="chip" data-example="${esc(e)}">${esc(e)}</button>`).join(' ')}
      <button type="button" class="link-btn" id="quickHelp">Como escrever?</button></span>`;
  }
  const r = parseQuick(text);
  if (!r.amount) return '<span class="muted">Falta o <b>valor</b> (ex.: 85,90).</span>';
  const c = catById(r.categoryId);
  const card = r.cardId && cardById(r.cardId);
  const when = r.date === todayISO() ? 'hoje' : fmtDate(r.date);
  const chips = [
    `<span class="chip ${r.type === 'income' ? 'pos' : 'neg'}">${r.type === 'income' ? 'Receita' : 'Despesa'}</span>`,
    `<span class="chip"><b>${money(r.amount)}</b>${r.repeat === 'installments' ? ` em ${r.count}x de ${money(Math.floor(r.amount / r.count))}` : ''}</span>`,
    `<span class="chip">${c.icon} ${esc(c.name)}</span>`,
    `<span class="chip">📅 ${when}</span>`,
    card ? `<span class="chip">💳 ${esc(card.name)} · fatura ${shortDate(invoiceFor(card, r.date).dueISO)}</span>`
      : r.type === 'expense' ? '<span class="chip">🏦 saldo em conta</span>' : '',
    r.repeat === 'monthly' ? `<span class="chip">🔁 todo mês · ${r.count} meses</span>` : '',
    card ? '' : `<span class="chip">${r.paid ? (r.type === 'income' ? '✅ recebido' : '✅ pago') : (r.type === 'income' ? '⏳ a receber' : '⏳ a pagar')}</span>`,
    `<span class="chip">📝 ${esc(r.description)}</span>`,
  ].filter(Boolean).join(' ');
  return `${chips}${r.warnings.map((w) => `<div class="quick-warn">⚠️ ${esc(w)}</div>`).join('')}
    <div class="quick-hint muted">Enter para adicionar · <button type="button" class="link-btn" id="quickDetails">ajustar detalhes antes</button></div>`;
}

function bindQuick(v) {
  const input = $('#quickInput', v);
  if (!input) return;
  const preview = $('#quickPreview', v);
  const refresh = () => {
    ui.quickText = input.value;
    preview.innerHTML = quickPreviewHtml(input.value);
    $$('[data-example]', preview).forEach((b) => b.addEventListener('click', () => { input.value = b.dataset.example; refresh(); input.focus(); }));
    $('#quickHelp', preview)?.addEventListener('click', openQuickHelp);
    $('#quickDetails', preview)?.addEventListener('click', () => {
      const r = parseQuick(input.value);
      const { warnings, repeat, count, ...data } = r;
      openTxForm(null, data);
    });
  };
  input.addEventListener('input', refresh);
  refresh();
  $('#quickForm', v).addEventListener('submit', (e) => {
    e.preventDefault();
    const r = parseQuick(input.value);
    if (!r.amount) { toast('Informe o valor (ex.: mercado 85,90)'); input.focus(); return; }
    const { warnings, repeat, count, ...data } = r;
    const created = addTransactions(data, repeat, count);
    const extra = repeat === 'installments' ? ` em ${count}x` : repeat === 'monthly' ? ` · ${count} meses` : '';
    ui.lastQuick = { ids: created.map((t) => t.id), label: `${data.description} ${money(data.amount)}${extra}` };
    ui.quickText = '';
    save(); render();
    toast('Lançado ⚡');
    setTimeout(() => $('#quickInput')?.focus(), 30);
  });
  $('#quickUndo', v)?.addEventListener('click', () => {
    const ids = new Set(ui.lastQuick.ids);
    state.transactions = state.transactions.filter((t) => !ids.has(t.id));
    ui.lastQuick = null;
    save(); render(); toast('Lançamento desfeito');
  });
  $('#quickEditLast', v)?.addEventListener('click', () => {
    const t = state.transactions.find((x) => x.id === ui.lastQuick.ids[0]);
    if (t) openTxForm(t);
  });
}

function openQuickHelp() {
  const ex = (a, b) => `<tr><td><code>${esc(a)}</code></td><td>${b}</td></tr>`;
  openModal(`
    <h2>⚡ Como escrever um lançamento rápido</h2>
    <p class="muted" style="margin-top:-6px">Escreva do seu jeito, em qualquer ordem. Você também pode <b>ditar</b> pelo microfone do teclado 🎤.</p>
    <table class="help-table">
      ${ex('mercado 85,90', 'Despesa de hoje, categoria Mercado, paga pelo saldo')}
      ${ex('mercado 85,90 nubank', 'Mesma coisa, mas no cartão Nubank (vai para a fatura)')}
      ${ex('tv 2400 10x nubank', 'Compra parcelada em 10 vezes no cartão (valor total)')}
      ${ex('luz 310 dia 20', 'Conta a pagar com vencimento no dia 20')}
      ${ex('aluguel 1800 dia 10 todo mês', 'Conta fixa: cria os próximos 12 meses')}
      ${ex('salário 5000 dia 5 todo mês', 'Receita prevista todo dia 5')}
      ${ex('+ venda 150 pix', 'O “+” no começo força ser receita')}
      ${ex('farmácia 42 ontem', 'Data: hoje, ontem, anteontem, amanhã, dia 15 ou 15/11')}
      ${ex('internet 120 dia 12 a pagar', '“a pagar”/“pago” definem a situação')}
    </table>
    <p class="muted" style="font-size:13px">A categoria é escolhida por palavras-chave (mercado, uber, farmácia, luz, netflix…) ou pelo nome das suas categorias.
      Antes de adicionar, confira a prévia; se algo sair errado, toque em <b>Desfazer</b> ou <b>Editar</b>.</p>
    <div class="modal-actions"><button class="btn primary" value="cancel" formnovalidate>Entendi</button></div>`, () => {});
}
