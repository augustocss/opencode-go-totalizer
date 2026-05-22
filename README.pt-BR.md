# OpenCode Go Usage Totalizer

[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-✅-brightgreen)](https://www.tampermonkey.net/)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Totalizador de crédito/uso do OpenCode Go.** Um userscript para Tampermonkey que adiciona um painel flutuante na página de uso do OpenCode, mostrando:

- **Total geral** de todos os custos somados
- **Breakdown por modelo** — quanto cada modelo consumiu (custo e tokens in/out)
- **Breakdown por dia** — gasto por data
- **Limites do Go em tempo real** — busca os percentuais de Uso Contínuo, Semanal e Mensal direto da página `/go`
- **Projeção mensal** — calcula se o ritmo atual vai estourar o limite de $60/mês

*(Adicione aqui um screenshot do painel em ação)*

## Instalação

1. Instale a extensão [Tampermonkey](https://www.tampermonkey.net/) no seu navegador:
   - [Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
   - [Firefox](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)
   - [Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)

2. Abra o arquivo [`opencode-go-totalizer.user.js`](opencode-go-totalizer.user.js) e copie o conteúdo (ou clique no link raw).

3. No Tampermonkey, clique no ícone da extensão → **Adicionar novo script**.

4. Apague o conteúdo padrão e cole o script.

5. Pressione `Ctrl+S` (ou `Cmd+S`) para salvar.

6. Pronto! Navegue até a página de uso do OpenCode (`/workspace/wrk_.../go`) que o painel vai aparecer automaticamente.

## Como usar

- Ao entrar na página de uso, o script escaneia a página atual e exibe os totais
- Clique em **Escanear todas as páginas** para percorrer o histórico completo
- Clique em **Resetar** para limpar o cache e recomeçar do zero
- Os limites do Go são atualizados automaticamente de fundo

## Funcionalidades

| Funcionalidade | Descrição |
|---|---|
| **Total geral** | Soma de todos os custos em dólar |
| **Por modelo** | Custo e tokens (in/out) agrupados por modelo de IA |
| **Por dia** | Gasto agregado por data |
| **Limites Go** | Barras de progresso de Uso Contínuo, Semanal e Mensal |
| **Projeção 30 dias** | Calcula se o ritmo atual vai estourar o limite mensal |
| **i18n** | Detecta o idioma do navegador — painel em português ou inglês |
| **Cache** | Dados persistem entre páginas (via GM_setValue) |
| **Paginação** | Escaneia automaticamente todas as páginas do histórico |

## Compatibilidade

- Funciona em todas as páginas `https://opencode.ai/*`
- Testado no Chrome, Firefox e Edge com Tampermonkey
- Pode funcionar em Violentmonkey/Greasemonkey (não testado)

## Licença

MIT
