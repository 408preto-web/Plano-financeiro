# 💰 Plano Financeiro

App de controle financeiro pessoal feito para o **iPad** (otimizado para o iPad Pro 13" M4, mas funciona em qualquer tela).
Funciona **offline**, abre em tela cheia como um app nativo e **seus dados ficam só no seu aparelho** — nada é enviado para servidores.

## O que dá para fazer

- **Resumo do mês**: receitas, despesas, resultado, saldo acumulado, gráfico de despesas por categoria e comparativo dos últimos 6 meses.
- **Lançamentos**: receitas e despesas com categoria, data, observações e situação (pago / a pagar, recebido / a receber).
  - **Parcelado**: divide uma compra em N parcelas mensais (ex.: 10x).
  - **Fixo mensal**: repete o mesmo valor por N meses (aluguel, assinaturas, salário).
  - Busca e filtros por tipo, categoria e situação.
- **Contas pendentes**: lista do que ainda falta pagar ou receber no mês.
- **Orçamentos**: limite mensal por categoria com barra de progresso (amarelo a 80%, vermelho quando estoura).
- **Metas**: reserva de emergência, viagem etc., com quanto guardar por mês para chegar no prazo.
- **Investimentos**: CDB, LCI/LCA, Tesouro (Selic, Prefixado, IPCA+), poupança, fundos, ações, FIIs e cripto.
  - Rendimento calculado automaticamente para % do CDI, Selic, prefixado, IPCA+ e poupança (252 dias úteis, descontando feriados nacionais).
  - **CDI ajustável**: em *Investimentos → Atualizar CDI* informe a nova taxa e a data em que passa a valer.
    O histórico é mantido, então o que já rendeu não muda; só os dias seguintes usam a taxa nova.
  - Projeção do IPCA também editável.
  - IR regressivo estimado (22,5% → 15%) e isenção para LCI/LCA/poupança.
  - Aportes e resgates (podem gerar o lançamento correspondente automaticamente).
  - Ações/FIIs/cripto: você atualiza o valor de mercado manualmente.
  - Gráfico de distribuição da carteira e **simulador** de rendimento com aportes mensais.
- **Categorias** personalizáveis (nome, emoji, cor).
- **Backup**: exporta/restaura um arquivo `.json` (salve no iCloud Drive) e exporta planilha `.csv` (abre no Numbers/Excel).
- Modo escuro automático e atalhos de teclado para o Magic Keyboard:
  `N` novo lançamento · `←`/`→` muda o mês · `1`–`6` troca de tela.

## Como colocar no seu iPad

### 1. Publicar o site (uma vez só)

1. No GitHub, abra o repositório → **Settings** → **Pages**.
2. Em **Build and deployment → Source**, escolha **GitHub Actions**.
3. Vá em **Actions** → **Publicar no GitHub Pages** → **Run workflow** (ou faça qualquer push).
4. Ao terminar, o endereço aparece em Settings → Pages, algo como
   `https://408preto-web.github.io/Plano-financeiro/`.

> Se o repositório for privado, o GitHub Pages pode exigir plano pago. Nesse caso, torne o repositório público
> (o código é público, mas **seus dados financeiros não** — eles ficam somente no iPad).

### 2. Instalar no iPad

1. Abra o endereço no **Safari** do iPad.
2. Toque em **Compartilhar** (quadrado com seta ↑) → **Adicionar à Tela de Início**.
3. Pronto! Abra pelo ícone **Finanças**: tela cheia e funciona sem internet.

## ⚠️ Sobre seus dados

- Ficam salvos no armazenamento local do app no iPad. Use sempre o app pelo ícone da Tela de Início.
- Se você apagar o app da Tela de Início ou limpar dados do Safari, **os dados são apagados**.
- Faça **backup** regularmente em **Ajustes → Exportar backup** e guarde o arquivo no iCloud Drive.

## Testar no computador

```bash
python3 -m http.server 8000
# abra http://localhost:8000
```

Em **Ajustes → Carregar dados de exemplo** você pode ver o app preenchido.

## Estrutura

| Arquivo | Função |
|---|---|
| `index.html` | Estrutura da página |
| `styles.css` | Visual (adaptado para iPad, retrato/paisagem e Split View) |
| `app.js` | Lógica principal do app |
| `invest.js` | Investimentos, CDI/IPCA e simulador |
| `sw.js` | Service worker (funcionamento offline) |
| `manifest.webmanifest` | Configuração para instalar como app |
| `icons/` | Ícones do app |
