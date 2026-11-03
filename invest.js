'use strict';

/* =========================================================
   Investimentos — carteira, rentabilidade e indicadores (CDI/IPCA)
   Usa as funções e o estado globais definidos em app.js.
   ========================================================= */

const INV_KINDS = {
  cdb: { label: 'CDB', icon: '🏦', color: '#0f766e', taxFree: false, indexer: 'cdi' },
  lci: { label: 'LCI / LCA', icon: '🏡', color: '#16a34a', taxFree: true, indexer: 'cdi' },
  tesouro_selic: { label: 'Tesouro Selic', icon: '🇧🇷', color: '#2563eb', taxFree: false, indexer: 'selic' },
  tesouro_pre: { label: 'Tesouro Prefixado', icon: '📜', color: '#4f46e5', taxFree: false, indexer: 'pre' },
  tesouro_ipca: { label: 'Tesouro IPCA+', icon: '📈', color: '#7c3aed', taxFree: false, indexer: 'ipca' },
  poupanca: { label: 'Poupança', icon: '🐷', color: '#db2777', taxFree: true, indexer: 'poupanca' },
  fundo: { label: 'Fundo', icon: '🧺', color: '#0891b2', taxFree: false, indexer: 'cdi' },
  acoes: { label: 'Ações', icon: '📊', color: '#ea580c', taxFree: false, indexer: 'manual' },
  fii: { label: 'Fundos imobiliários', icon: '🏢', color: '#f59e0b', taxFree: false, indexer: 'manual' },
  cripto: { label: 'Cripto', icon: '🪙', color: '#ca8a04', taxFree: false, indexer: 'manual' },
  outro: { label: 'Outro', icon: '💼', color: '#64748b', taxFree: false, indexer: 'manual' },
};

const INDEXERS = {
  cdi: 'Pós-fixado (% do CDI)',
  selic: 'Selic (+ taxa)',
  pre: 'Prefixado (% ao ano)',
  ipca: 'IPCA + taxa',
  poupanca: 'Regra da poupança',
  manual: 'Valor de mercado (atualizo manualmente)',
};

const fmtPct = (n, d = 2) => (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }) + '%';
const parsePct = (s) => { const n = Number(String(s ?? '').replace(/\s|%/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };

/* ---------- Indicadores de mercado ---------- */
function defaultMarket() {
  return {
    cdi: [{ date: '2000-01-01', rate: 14.9 }], // % ao ano — ajuste em Investimentos → Atualizar CDI
    selicSpread: 0.1,                          // Selic ≈ CDI + 0,10 p.p.
    ipca: 4.5,                                 // projeção de IPCA % ao ano
  };
}
const cdiHistory = () => [...state.market.cdi].sort((a, b) => a.date.localeCompare(b.date));
function cdiAt(iso) {
  let rate = cdiHistory()[0]?.rate ?? 0;
  for (const h of cdiHistory()) if (h.date <= iso) rate = h.rate;
  return rate;
}
const currentCdi = () => cdiAt(todayISO());

/* ---------- Cálculo ---------- */
const isoToDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const dayDiff = (a, b) => Math.round((isoToDate(b) - isoToDate(a)) / 86400000);

/** Feriados nacionais (fixos + móveis baseados na Páscoa) de um ano, em ISO. */
const holidayCache = {};
function holidays(year) {
  if (holidayCache[year]) return holidayCache[year];
  // Páscoa (algoritmo de Meeus/Jones/Butcher)
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = new Date(year, month - 1, day);
  const rel = (n) => { const x = new Date(easter); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`; };
  const fixed = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '12-25'];
  if (year >= 2024) fixed.push('11-20'); // Consciência Negra
  const list = [...fixed.map((md) => `${year}-${md}`), rel(-48), rel(-47), rel(-2), rel(60)]; // Carnaval, Sexta-feira Santa, Corpus Christi
  return (holidayCache[year] = list);
}

/** Dias úteis no intervalo [a, b): seg–sex, descontando feriados nacionais. */
function bizDays(a, b) {
  if (b <= a) return 0;
  const total = dayDiff(a, b);
  let count = Math.floor(total / 7) * 5;
  const start = isoToDate(a).getDay();
  for (let i = 0; i < total % 7; i++) {
    const wd = (start + i) % 7;
    if (wd !== 0 && wd !== 6) count++;
  }
  for (let y = Number(a.slice(0, 4)); y <= Number(b.slice(0, 4)); y++) {
    for (const h of holidays(y)) {
      const wd = isoToDate(h).getDay();
      if (h >= a && h < b && wd !== 0 && wd !== 6) count--;
    }
  }
  return count;
}

/** Taxa anual efetiva (%) de um indexador sem o “% do CDI”, num dado momento. */
function poupancaAnnual(cdi) {
  const selic = cdi + state.market.selicSpread;
  const monthly = selic > 8.5 ? 0.5 : (selic * 0.7) / 12; // TR considerada zero
  return (Math.pow(1 + monthly / 100, 12) - 1) * 100;
}

/** Fator de crescimento de um valor aplicado entre as datas a e b. */
function growthFactor(inv, a, b) {
  if (b <= a) return 1;
  const rate = Number(inv.rate) || 0;
  if (inv.indexer === 'pre') return Math.pow(1 + rate / 100, bizDays(a, b) / 252);
  if (inv.indexer === 'ipca') return Math.pow((1 + state.market.ipca / 100) * (1 + rate / 100), bizDays(a, b) / 252);

  // Indexadores que dependem do CDI: percorre cada período do histórico.
  const hist = cdiHistory();
  let f = 1;
  for (let i = 0; i < hist.length; i++) {
    const segStart = i === 0 ? a : (hist[i].date > a ? hist[i].date : a);
    const segEnd = hist[i + 1] && hist[i + 1].date < b ? hist[i + 1].date : b;
    if (i > 0 && hist[i].date >= b) break;
    if (segEnd <= segStart) continue;
    const n = bizDays(segStart, segEnd);
    const cdi = hist[i].rate;
    let daily;
    if (inv.indexer === 'cdi') daily = (Math.pow(1 + cdi / 100, 1 / 252) - 1) * (rate / 100);
    else if (inv.indexer === 'selic') daily = Math.pow((1 + (cdi + state.market.selicSpread) / 100) * (1 + rate / 100), 1 / 252) - 1;
    else if (inv.indexer === 'poupanca') daily = Math.pow(1 + poupancaAnnual(cdi) / 100, 1 / 252) - 1;
    else daily = 0;
    f *= Math.pow(1 + daily, n);
  }
  return f;
}

/** Alíquota de IR regressiva (renda fixa) conforme dias corridos. */
function irRate(days) {
  if (days <= 180) return 0.225;
  if (days <= 360) return 0.2;
  if (days <= 720) return 0.175;
  return 0.15;
}

/** Valores de um investimento hoje (ou na data de vencimento, se já passou). */
function invValue(inv) {
  const moves = inv.movements || [];
  const invested = moves.reduce((s, m) => s + m.amount, 0);
  if (inv.indexer === 'manual') {
    const gross = inv.currentValue ?? invested;
    const gain = gross - invested;
    const tax = inv.taxFree ? 0 : Math.max(0, Math.round(gain * 0.15));
    return { invested, gross, gain, tax, net: gross - tax };
  }
  const today = todayISO();
  const end = inv.maturity && inv.maturity < today ? inv.maturity : today;
  let gross = 0, grossPos = 0, tax = 0;
  for (const m of moves) {
    const v = m.amount * growthFactor(inv, m.date, end);
    gross += v;
    if (m.amount > 0) {
      grossPos += v;
      if (!inv.taxFree) tax += (v - m.amount) * irRate(dayDiff(m.date, end));
    }
  }
  // Resgates reduzem o IR proporcionalmente ao saldo que sobrou.
  if (grossPos > 0) tax *= Math.max(0, gross) / grossPos;
  gross = Math.round(gross);
  tax = Math.max(0, Math.round(tax));
  return { invested, gross, gain: gross - invested, tax, net: gross - tax };
}

function rateLabel(inv) {
  const r = Number(inv.rate) || 0;
  switch (inv.indexer) {
    case 'cdi': return `${fmtPct(r, r % 1 ? 1 : 0)} do CDI`;
    case 'selic': return r ? `Selic + ${fmtPct(r)}` : 'Selic';
    case 'pre': return `Pré ${fmtPct(r)} a.a.`;
    case 'ipca': return `IPCA + ${fmtPct(r)}`;
    case 'poupanca': return 'Poupança';
    default: return 'Valor de mercado';
  }
}

/** Rentabilidade anual equivalente (%) hoje — usada nos cards e no simulador. */
function annualRateNow(indexer, rate) {
  const cdi = currentCdi();
  switch (indexer) {
    case 'cdi': return (Math.pow(1 + ((Math.pow(1 + cdi / 100, 1 / 252) - 1) * rate) / 100, 252) - 1) * 100;
    case 'selic': return ((1 + (cdi + state.market.selicSpread) / 100) * (1 + rate / 100) - 1) * 100;
    case 'pre': return rate;
    case 'ipca': return ((1 + state.market.ipca / 100) * (1 + rate / 100) - 1) * 100;
    case 'poupanca': return poupancaAnnual(cdi);
    default: return 0;
  }
}

function portfolioTotals() {
  return state.investments.reduce((t, inv) => {
    const v = invValue(inv);
    t.invested += v.invested; t.gross += v.gross; t.tax += v.tax; t.net += v.net;
    return t;
  }, { invested: 0, gross: 0, tax: 0, net: 0 });
}

/* ---------- Tela ---------- */
function renderInvestments() {
  const t = portfolioTotals();
  const gain = t.gross - t.invested;
  const cdi = currentCdi();
  const hist = cdiHistory();
  const lastChange = hist[hist.length - 1];

  const byKind = {};
  state.investments.forEach((inv) => { const v = invValue(inv).gross; if (v > 0) byKind[inv.kind] = (byKind[inv.kind] || 0) + v; });
  const alloc = Object.entries(byKind).map(([k, value]) => ({ label: INV_KINDS[k]?.label || k, icon: INV_KINDS[k]?.icon || '💼', color: INV_KINDS[k]?.color || '#64748b', value }))
    .sort((a, b) => b.value - a.value);

  const today = todayISO();
  const cards = [...state.investments].sort((a, b) => invValue(b).gross - invValue(a).gross).map((inv) => {
    const k = INV_KINDS[inv.kind] || INV_KINDS.outro;
    const v = invValue(inv);
    const pct = v.invested > 0 ? (v.gain / v.invested) * 100 : 0;
    const matured = inv.maturity && inv.maturity <= today;
    const annual = inv.indexer !== 'manual' ? `<span class="muted"> · ≈ ${fmtPct(annualRateNow(inv.indexer, Number(inv.rate) || 0))} a.a. hoje</span>` : '';
    return `<div class="card">
      <div class="card-head">
        <div style="display:flex;gap:12px;align-items:center;min-width:0">
          <div class="tx-icon" style="background:${k.color}22">${k.icon}</div>
          <div style="min-width:0"><h2 style="margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(inv.name)}</h2>
            <div class="tx-meta">${k.label} · ${rateLabel(inv)}${inv.taxFree ? ' · isento de IR' : ''}</div></div>
        </div>
        ${matured ? '<span class="badge">vencido</span>' : ''}
      </div>
      <div class="inv-nums">
        <div><div class="label">Aplicado</div><b>${money(v.invested)}</b></div>
        <div><div class="label">Valor atual</div><b>${money(v.gross)}</b></div>
        <div><div class="label">Rendimento</div><b class="${v.gain >= 0 ? 'pos' : 'neg'}">${money(v.gain)} <small>(${fmtPct(pct)})</small></b></div>
        <div><div class="label">Líquido ${inv.taxFree ? '' : '(após IR)'}</div><b>${money(v.net)}</b></div>
      </div>
      <div class="tx-meta mt">${inv.maturity ? `Vence em ${inv.maturity.split('-').reverse().join('/')}` : 'Sem vencimento'}${annual}
        ${inv.indexer === 'manual' && inv.valueUpdatedAt ? ` · valor atualizado em ${shortDate(inv.valueUpdatedAt)}` : ''}</div>
      <div class="row-actions mt">
        <button class="btn small primary" data-invmove="${inv.id}" data-dir="1">+ Aportar</button>
        <button class="btn small" data-invmove="${inv.id}" data-dir="-1">− Resgatar</button>
        ${inv.indexer === 'manual' ? `<button class="btn small" data-invvalue="${inv.id}">Atualizar valor</button>` : ''}
        <button class="btn small" data-invedit="${inv.id}">Editar</button>
      </div>
    </div>`;
  }).join('');

  const histRows = [...hist].reverse().map((h, i) => `<li class="hist-row">
      <span>${h.date === '2000-01-01' ? 'Valor inicial' : 'Desde ' + h.date.split('-').reverse().join('/')}</span>
      <b>${fmtPct(h.rate)} a.a.</b>
      ${hist.length > 1 ? `<button class="btn small" data-cdidel="${h.date}" aria-label="Remover">✕</button>` : '<span></span>'}
    </li>`).join('');

  return `
  <div class="grid cols-4">
    <div class="card stat"><div class="label">Total aplicado</div><div class="value">${money(t.invested)}</div></div>
    <div class="card stat"><div class="label">Valor bruto hoje</div><div class="value">${money(t.gross)}</div></div>
    <div class="card stat"><div class="label">Rendimento</div><div class="value ${gain >= 0 ? 'pos' : 'neg'}">${money(gain)}</div>
      <div class="sub">${t.invested > 0 ? fmtPct((gain / t.invested) * 100) + ' sobre o aplicado' : '—'}</div></div>
    <div class="card stat"><div class="label">Líquido estimado</div><div class="value">${money(t.net)}</div>
      <div class="sub">IR estimado: ${money(t.tax)}</div></div>
  </div>

  <div class="grid cols-2 mt">
    <div class="card">
      <div class="card-head"><h2>Indicadores de mercado</h2><button class="btn small primary" id="editCdi">Atualizar CDI</button></div>
      <div class="grid" style="grid-template-columns:repeat(3,minmax(0,1fr));gap:10px">
        <div class="stat"><div class="label">CDI</div><div class="value" style="font-size:24px">${fmtPct(cdi)}</div><div class="sub">ao ano</div></div>
        <div class="stat"><div class="label">Selic (aprox.)</div><div class="value" style="font-size:24px">${fmtPct(cdi + state.market.selicSpread)}</div><div class="sub">CDI + ${fmtPct(state.market.selicSpread)}</div></div>
        <div class="stat"><div class="label">IPCA (proj.)</div><div class="value" style="font-size:24px">${fmtPct(state.market.ipca)}</div><div class="sub"><button class="link-btn" id="editIpca">alterar</button></div></div>
      </div>
      <p class="muted" style="font-size:13px">Quando o CDI mudar, toque em <b>Atualizar CDI</b> e informe a nova taxa e a data. O histórico é mantido:
        os rendimentos já acumulados não mudam, só os dias a partir da nova data usam a taxa nova.</p>
      <h3 class="muted" style="font-size:14px;margin:14px 0 4px">Histórico do CDI</h3>
      <ul class="hist-list">${histRows}</ul>
      ${lastChange && lastChange.date > today ? '<p class="muted" style="font-size:13px">Há uma taxa programada para uma data futura.</p>' : ''}
    </div>
    <div class="card"><h2>Distribuição da carteira</h2>${donutChart(alloc, 'Nenhum investimento cadastrado')}</div>
  </div>

  <div class="card-head mt" style="margin-top:24px"><h2 style="font-size:20px">Meus investimentos</h2><button class="btn primary" id="newInv">+ Novo investimento</button></div>
  ${state.investments.length ? `<div class="grid cols-2">${cards}</div>`
    : '<div class="card"><div class="empty"><div style="font-size:44px">📈</div><p>Cadastre seus CDBs, Tesouro, LCI/LCA, ações e fundos<br>para acompanhar quanto estão rendendo.</p></div></div>'}

  <div class="card mt">
    <h2>Simulador de rendimento</h2>
    <div class="form-grid sim-grid">
      <label class="field"><span>Valor inicial (R$)</span><input id="simAmount" inputmode="decimal" value="10.000,00"></label>
      <label class="field"><span>Aporte mensal (R$)</span><input id="simMonthly" inputmode="decimal" value="0,00"></label>
      <label class="field"><span>Prazo (meses)</span><input id="simMonths" type="number" min="1" max="600" value="12" inputmode="numeric"></label>
      <label class="field"><span>Tipo</span><select id="simIndexer">
        <option value="cdi">% do CDI</option><option value="pre">Prefixado % a.a.</option><option value="ipca">IPCA + %</option><option value="poupanca">Poupança</option>
      </select></label>
      <label class="field"><span>Taxa</span><input id="simRate" inputmode="decimal" value="100"></label>
      <label class="check"><input type="checkbox" id="simTaxFree"><span>Isento de IR (LCI/LCA)</span></label>
    </div>
    <div id="simResult" class="sim-result"></div>
  </div>`;
}

function runSimulator() {
  const amount = parseMoney($('#simAmount').value);
  const monthly = parseMoney($('#simMonthly').value);
  const months = Math.max(1, Math.min(600, Number($('#simMonths').value) || 1));
  const indexer = $('#simIndexer').value;
  const rate = parsePct($('#simRate').value);
  const taxFree = $('#simTaxFree').checked || indexer === 'poupanca';
  const annual = annualRateNow(indexer, rate);
  const mRate = Math.pow(1 + annual / 100, 1 / 12) - 1;

  let gross = 0, tax = 0;
  const contribs = [{ amount, age: months }];
  for (let i = 1; i < months; i++) if (monthly) contribs.push({ amount: monthly, age: months - i });
  for (const c of contribs) {
    const v = c.amount * Math.pow(1 + mRate, c.age);
    gross += v;
    if (!taxFree) tax += (v - c.amount) * irRate(c.age * 30);
  }
  const invested = contribs.reduce((s, c) => s + c.amount, 0);
  gross = Math.round(gross); tax = Math.round(tax);
  const poup = poupancaAnnual(currentCdi());
  $('#simResult').innerHTML = `
    <div><div class="label">Rentabilidade</div><b>${fmtPct(annual)} a.a.</b></div>
    <div><div class="label">Total aplicado</div><b>${money(invested)}</b></div>
    <div><div class="label">Valor bruto</div><b>${money(gross)}</b></div>
    <div><div class="label">Rendimento bruto</div><b class="pos">${money(gross - invested)}</b></div>
    <div><div class="label">IR</div><b class="neg">${money(tax)}</b></div>
    <div><div class="label">Valor líquido</div><b>${money(gross - tax)}</b></div>
    <p class="muted" style="grid-column:1/-1;font-size:13px;margin:0">Com CDI a ${fmtPct(currentCdi())}: poupança rende ≈ ${fmtPct(poup)} a.a.
      Estimativa sem IOF e taxas de administração.</p>`;
}

function bindInvestments(v) {
  $('#newInv').addEventListener('click', () => openInvForm());
  $('#editCdi').addEventListener('click', openCdiForm);
  $('#editIpca').addEventListener('click', openIpcaForm);
  $$('[data-invedit]', v).forEach((el) => el.addEventListener('click', () => openInvForm(state.investments.find((i) => i.id === el.dataset.invedit))));
  $$('[data-invmove]', v).forEach((el) => el.addEventListener('click', () => openInvMove(el.dataset.invmove, Number(el.dataset.dir))));
  $$('[data-invvalue]', v).forEach((el) => el.addEventListener('click', () => openInvValue(el.dataset.invvalue)));
  $$('[data-cdidel]', v).forEach((el) => el.addEventListener('click', () => {
    if (!confirm('Remover esta taxa do histórico do CDI?')) return;
    state.market.cdi = state.market.cdi.filter((h) => h.date !== el.dataset.cdidel);
    save(); render(); toast('Taxa removida');
  }));
  const simIdx = $('#simIndexer');
  simIdx.addEventListener('change', () => {
    $('#simRate').value = { cdi: '100', pre: '13,00', ipca: '7,00', poupanca: '0' }[simIdx.value];
    $('#simRate').disabled = simIdx.value === 'poupanca';
    runSimulator();
  });
  $$('#simAmount, #simMonthly, #simMonths, #simRate, #simTaxFree', v).forEach((el) => el.addEventListener('input', runSimulator));
  runSimulator();
}

/* ---------- Modais ---------- */
function openCdiForm() {
  openModal(`
    <h2>Atualizar CDI</h2>
    <p class="muted" style="margin-top:-6px">CDI atual: <b>${fmtPct(currentCdi())} ao ano</b>. Informe a nova taxa anual e a partir de quando ela vale
      (normalmente o dia seguinte à reunião do Copom).</p>
    <div class="form-grid">
      <label class="field"><span>Nova taxa CDI (% ao ano)</span>
        <input class="amount-input" name="rate" inputmode="decimal" placeholder="14,90" value="${String(currentCdi()).replace('.', ',')}" required autocomplete="off"></label>
      <label class="field"><span>Vale a partir de</span><input type="date" name="date" value="${todayISO()}" required></label>
    </div>
    <div class="modal-actions"><button class="btn" value="cancel" formnovalidate>Cancelar</button><button class="btn primary" value="save">Salvar</button></div>`,
  (action, fd) => {
    const rate = parsePct(fd.get('rate'));
    if (rate <= 0 || rate > 100) { toast('Informe uma taxa válida'); return false; }
    const date = fd.get('date');
    state.market.cdi = state.market.cdi.filter((h) => h.date !== date);
    state.market.cdi.push({ date, rate });
    save(); render(); toast(`CDI atualizado para ${fmtPct(rate)}`);
  }, () => setTimeout(() => { const el = $('[name="rate"]', modalForm); el.focus(); el.select(); }, 50));
}

function openIpcaForm() {
  openModal(`
    <h2>Projeção do IPCA</h2>
    <p class="muted" style="margin-top:-6px">Usada para estimar investimentos IPCA+ (ex.: Tesouro IPCA+).</p>
    <label class="field"><span>IPCA (% ao ano)</span><input class="amount-input" name="ipca" inputmode="decimal" value="${String(state.market.ipca).replace('.', ',')}" required></label>
    <label class="field mt"><span>Diferença Selic − CDI (p.p.)</span><input name="spread" inputmode="decimal" value="${String(state.market.selicSpread).replace('.', ',')}"></label>
    <div class="modal-actions"><button class="btn" value="cancel" formnovalidate>Cancelar</button><button class="btn primary" value="save">Salvar</button></div>`,
  (action, fd) => {
    state.market.ipca = parsePct(fd.get('ipca'));
    state.market.selicSpread = parsePct(fd.get('spread'));
    save(); render(); toast('Indicadores atualizados');
  });
}

function openInvForm(inv) {
  const isEdit = !!inv;
  const i = inv || { name: '', kind: 'cdb', indexer: 'cdi', rate: 100, taxFree: false, maturity: '', movements: [] };
  const kindOpts = Object.entries(INV_KINDS).map(([k, d]) => `<option value="${k}" ${k === i.kind ? 'selected' : ''}>${d.icon} ${d.label}</option>`).join('');
  const idxOpts = Object.entries(INDEXERS).map(([k, l]) => `<option value="${k}" ${k === i.indexer ? 'selected' : ''}>${l}</option>`).join('');
  const moves = (i.movements || []).slice().sort((a, b) => a.date.localeCompare(b.date)).map((m) => `<li class="hist-row">
      <span>${m.date.split('-').reverse().join('/')} · ${m.amount >= 0 ? 'Aporte' : 'Resgate'}</span>
      <b class="${m.amount >= 0 ? '' : 'neg'}">${money(m.amount)}</b>
      <button class="btn small" value="rm:${m.id}" formnovalidate aria-label="Remover">✕</button></li>`).join('');

  openModal(`
    <h2>${isEdit ? 'Editar investimento' : 'Novo investimento'}</h2>
    <div class="form-grid">
      <label class="field full"><span>Nome</span><input name="name" value="${esc(i.name)}" required placeholder="Ex.: CDB Banco X 2028"></label>
      <label class="field"><span>Tipo</span><select name="kind" id="invKind">${kindOpts}</select></label>
      <label class="field"><span>Rentabilidade</span><select name="indexer" id="invIndexer">${idxOpts}</select></label>
      <label class="field" id="invRateWrap"><span id="invRateLabel">Taxa</span><input name="rate" inputmode="decimal" value="${String(i.rate ?? '').replace('.', ',')}"></label>
      <label class="field"><span>Vencimento (opcional)</span><input type="date" name="maturity" value="${i.maturity || ''}"></label>
      <label class="check full"><input type="checkbox" name="taxFree" id="invTaxFree" ${i.taxFree ? 'checked' : ''}><span>Isento de imposto de renda</span></label>
      ${isEdit ? '' : `
      <label class="field"><span>Valor aplicado (R$)</span><input name="amount" inputmode="decimal" placeholder="0,00" required autocomplete="off"></label>
      <label class="field"><span>Data da aplicação</span><input type="date" name="date" value="${todayISO()}" required></label>
      <label class="field full" id="invCurWrap" style="display:none"><span>Valor atual de mercado (R$, opcional)</span><input name="currentValue" inputmode="decimal" placeholder="igual ao aplicado"></label>
      <label class="check full"><input type="checkbox" name="register"><span>Registrar saída nos lançamentos (categoria Investimentos)</span></label>`}
    </div>
    ${isEdit && moves ? `<h3 class="muted" style="font-size:14px;margin:16px 0 4px">Aportes e resgates</h3><ul class="hist-list">${moves}</ul>` : ''}
    <div class="modal-actions">
      ${isEdit ? '<button class="btn danger" value="delete" formnovalidate>Excluir</button>' : ''}
      <span class="spacer"></span>
      <button class="btn" value="cancel" formnovalidate>Cancelar</button><button class="btn primary" value="save">Salvar</button>
    </div>`,
  (action, fd) => {
    if (action.startsWith('rm:')) {
      if (inv.movements.length <= 1) { toast('O investimento precisa ter ao menos uma aplicação'); return false; }
      if (!confirm('Remover esta movimentação?')) return false;
      inv.movements = inv.movements.filter((m) => m.id !== action.slice(3));
      save(); render();
      setTimeout(() => openInvForm(inv), 0);
      return;
    }
    if (action === 'delete') {
      if (!confirm('Excluir este investimento? (lançamentos já registrados não são apagados)')) return false;
      state.investments = state.investments.filter((x) => x.id !== inv.id);
      save(); render(); toast('Investimento excluído');
      return;
    }
    const data = {
      name: fd.get('name').trim(),
      kind: fd.get('kind'),
      indexer: fd.get('indexer'),
      rate: parsePct(fd.get('rate')),
      maturity: fd.get('maturity'),
      taxFree: fd.get('taxFree') === 'on',
    };
    if (isEdit) {
      Object.assign(inv, data);
    } else {
      const amount = parseMoney(fd.get('amount'));
      if (amount <= 0) { toast('Informe o valor aplicado'); return false; }
      const date = fd.get('date');
      const n = { id: uid(), ...data, movements: [{ id: uid(), date, amount }] };
      if (data.indexer === 'manual') {
        const cur = parseMoney(fd.get('currentValue'));
        n.currentValue = cur > 0 ? cur : amount;
        n.valueUpdatedAt = todayISO();
      }
      state.investments.push(n);
      if (fd.get('register') === 'on') addInvTx('expense', 'c-aplicacao', `Aplicação: ${data.name}`, amount, date);
    }
    save(); render(); toast(isEdit ? 'Investimento atualizado' : 'Investimento cadastrado');
  }, () => {
    const kind = $('#invKind'), idx = $('#invIndexer');
    const sync = () => {
      const v = idx.value;
      $('#invRateWrap').style.display = ['poupanca', 'manual'].includes(v) ? 'none' : '';
      $('#invRateLabel').textContent = { cdi: '% do CDI (ex.: 110)', selic: 'Taxa adicional % a.a. (ex.: 0,10)', pre: 'Taxa % ao ano', ipca: 'Taxa acima do IPCA % a.a.' }[v] || 'Taxa';
      const cur = $('#invCurWrap'); if (cur) cur.style.display = v === 'manual' ? '' : 'none';
    };
    kind.addEventListener('change', () => {
      const d = INV_KINDS[kind.value];
      idx.value = d.indexer;
      $('#invTaxFree').checked = d.taxFree;
      const rate = $('[name="rate"]', modalForm);
      rate.value = { cdi: '100', selic: '0,10', pre: '', ipca: '' }[d.indexer] ?? '';
      sync();
    });
    idx.addEventListener('change', sync);
    sync();
  });
}

function addInvTx(type, categoryId, description, amount, date) {
  state.transactions.push({ id: uid(), createdAt: Date.now(), type, categoryId, description, amount, date, paid: true, notes: '' });
}

function openInvMove(invId, dir) {
  const inv = state.investments.find((x) => x.id === invId);
  const v = invValue(inv);
  openModal(`
    <h2>${dir > 0 ? 'Aportar em' : 'Resgatar de'} ${esc(inv.name)}</h2>
    ${dir < 0 ? `<p class="muted" style="margin-top:-6px">Disponível (bruto): <b>${money(v.gross)}</b></p>` : ''}
    <div class="form-grid">
      <label class="field"><span>Valor (R$)</span><input class="amount-input" name="amount" inputmode="decimal" placeholder="0,00" required autocomplete="off"></label>
      <label class="field"><span>Data</span><input type="date" name="date" value="${todayISO()}" required></label>
      <label class="check full"><input type="checkbox" name="register"><span>${dir > 0 ? 'Registrar saída nos lançamentos' : 'Registrar entrada nos lançamentos'}</span></label>
    </div>
    <div class="modal-actions"><button class="btn" value="cancel" formnovalidate>Cancelar</button><button class="btn primary" value="save">Confirmar</button></div>`,
  (action, fd) => {
    const amount = parseMoney(fd.get('amount'));
    if (amount <= 0) { toast('Informe um valor'); return false; }
    if (dir < 0 && amount > v.gross) { toast('Valor maior que o saldo do investimento'); return false; }
    const date = fd.get('date');
    inv.movements.push({ id: uid(), date, amount: dir * amount });
    if (inv.indexer === 'manual') { inv.currentValue = Math.max(0, (inv.currentValue ?? 0) + dir * amount); inv.valueUpdatedAt = todayISO(); }
    if (fd.get('register') === 'on') {
      if (dir > 0) addInvTx('expense', 'c-aplicacao', `Aporte: ${inv.name}`, amount, date);
      else addInvTx('income', 'c-resgate', `Resgate: ${inv.name}`, amount, date);
    }
    save(); render(); toast(dir > 0 ? 'Aporte registrado' : 'Resgate registrado');
  }, () => setTimeout(() => $('[name="amount"]', modalForm).focus(), 50));
}

function openInvValue(invId) {
  const inv = state.investments.find((x) => x.id === invId);
  openModal(`
    <h2>Valor atual de ${esc(inv.name)}</h2>
    <p class="muted" style="margin-top:-6px">Confira o valor na corretora e informe aqui.</p>
    <label class="field"><span>Valor de mercado hoje (R$)</span><input class="amount-input" name="amount" inputmode="decimal" value="${centsToInput(inv.currentValue ?? 0)}" required autocomplete="off"></label>
    <div class="modal-actions"><button class="btn" value="cancel" formnovalidate>Cancelar</button><button class="btn primary" value="save">Salvar</button></div>`,
  (action, fd) => {
    inv.currentValue = parseMoney(fd.get('amount'));
    inv.valueUpdatedAt = todayISO();
    save(); render(); toast('Valor atualizado');
  }, () => setTimeout(() => { const el = $('[name="amount"]', modalForm); el.focus(); el.select(); }, 50));
}
