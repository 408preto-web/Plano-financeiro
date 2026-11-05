# 💰 Plano Financeiro

App de controle financeiro pessoal feito para o **iPad** (otimizado para o iPad Pro 13" M4, mas funciona em qualquer tela).
Funciona **offline**, abre em tela cheia como um app nativo e **seus dados ficam só no seu aparelho** — nada é enviado para servidores.

## O que dá para fazer

- **Saldo em conta**: informe o saldo real do banco uma vez (toque no cartão no Resumo) e o app atualiza sozinho
  a cada receita/despesa paga, mostrando também o saldo previsto para o fim do mês.
- **Resumo do mês**: saldo em conta, receitas, despesas, resultado, gráfico de despesas por categoria e comparativo dos últimos 6 meses.
- **Lançamentos**: receitas e despesas com categoria, data, observações e situação (pago / a pagar, recebido / a receber).
  - **Parcelado**: divide uma compra em N parcelas mensais (ex.: 10x).
  - **Fixo mensal**: repete o mesmo valor por N meses (aluguel, assinaturas, salário).
  - Busca e filtros por tipo, categoria e situação.
- **Cartões de crédito**: cadastre cada cartão com limite, dia de fechamento e vencimento.
  - No lançamento, escolha a **forma de pagamento**: saldo em conta (débito/Pix/dinheiro) ou um cartão.
  - Compras no cartão **não saem do saldo** na hora: vão para a fatura certa (conforme o fechamento) e só
    saem do saldo quando você toca em **Pagar fatura**.
  - Limite usado/disponível (inclui parcelas futuras) e lista de faturas (aberta, fechada, vencida, paga).
  - **Aviso no Resumo** e número no menu quando uma fatura vence nos próximos 10 dias ou está vencida.
- **Contas a pagar com vencimento** (energia, água, boletos…): lance com a data de **vencimento** e "Já pago" desmarcado.
  - Aviso no topo do Resumo alguns dias antes (antecedência ajustável em Ajustes) e quando vencer.
  - Botão **Pagar** no aviso permite informar o valor real pago; só então sai do saldo.
  - **Todo mês (conta fixa)** cria as contas dos próximos meses já como "a pagar".
  - **🔁 Replicar nos próximos meses** copia uma conta já lançada para os meses seguintes, sem duplicar.
  - Ao editar uma conta repetida, dá para **aplicar o novo valor aos próximos meses**.
- **Receitas futuras** (salário, aluguel recebido…): lance como Receita com a data prevista e "Todo mês".
  - Ficam como **a receber** e entram no saldo **previsto**.
  - No dia, aparece o aviso verde "Salário previsto para hoje" com o botão **Recebi**, onde você confirma
    (e pode ajustar) o valor que caiu; só então entra no saldo em conta.
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
  `N` novo lançamento · `←`/`→` muda o mês · `1`–`7` troca de tela.

## Como colocar no seu iPad

### 1. Publicar o site (uma vez só — dá para fazer pelo Safari do iPad)

**Passo A – Tornar o repositório público** (na conta gratuita o GitHub só publica sites de repositórios públicos)
1. Abra `github.com/408preto-web/Plano-financeiro` e entre na sua conta.
2. Toque em **Settings** (barra superior do repositório; se não aparecer, toque em "…").
3. Role até o fim, em **Danger Zone** → **Change visibility** → **Change to public** e confirme.

> Só o **código** fica público. Seus **dados financeiros não** — eles ficam somente no iPad.

**Passo B – Ligar o site**
1. Em **Settings**, toque em **Pages** (menu lateral).
2. Em **Build and deployment → Source**, escolha **GitHub Actions**.

**Passo C – Publicar**
1. Toque em **Actions** (barra superior) → **Publicar no GitHub Pages** → **Run workflow** → **Run workflow**.
2. Aguarde ~1 minuto até aparecer o ✅ verde.

Endereço do app: **https://408preto-web.github.io/Plano-financeiro/**

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
| `cards.js` | Cartões de crédito, faturas e avisos |
| `sw.js` | Service worker (funcionamento offline) |
| `manifest.webmanifest` | Configuração para instalar como app |
| `icons/` | Ícones do app |
