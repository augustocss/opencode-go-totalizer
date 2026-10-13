# OpenCode Go Usage Totalizer

[![Tampermonkey](https://img.shields.io/badge/Tampermonkey-✅-brightgreen)](https://www.tampermonkey.net/)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**Totalizador de crédito/uso do OpenCode Go.** Um userscript para Tampermonkey que adiciona um painel flutuante na página de logs do OpenCode Console (`/console/wrk_.../logs`), mostrando:

- **Total geral** de todos os custos somados do período de cobrança atual
- **Card do período anterior** — totais do último ciclo fechado (sujeito à retenção de logs do servidor)
- **Breakdown por modelo** — quanto cada modelo consumiu (custo e tokens in/out)
- **Breakdown por dia** — gasto por data
- **Limites do Go em tempo real** — percentuais de Uso contínuo, Semanal e Mensal capturados da aba `/go`
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

6. Pronto! Navegue até a página de logs do Console (`/console/wrk_.../logs`) que o painel aparece acima da tabela. Abra a aba Go (`/console/wrk_.../go`) pelo menos uma vez para o script capturar o período de cobrança e os limites (ele captura automaticamente enquanto você estiver nela).

## Como usar

- Ao entrar na página, o script restaura os últimos totais salvos e o período de cobrança
- Clique em **Atualizar totais** para buscar o período atual + anterior direto da API `request-logs` (rápido — sem paginar tabela)
- Clique em **Resetar** para limpar os dados e recomeçar
- O card do **período anterior** pode indicar "parcial" ou "sem logs disponíveis": o servidor guarda os logs por ~30 dias (na prática, menos). Dica: rode um **Atualizar totais** logo após o dia do reset do ciclo (ex.: dia 18) para congelar o período recém-encerrado enquanto ele ainda está na retenção

## Funcionalidades

| Funcionalidade | Descrição |
|---|---|
| **Total geral** | Soma de todos os custos em dólar |
| **Por modelo** | Custo e tokens (in/out) agrupados por modelo de IA |
| **Por dia** | Gasto agregado por data |
| **Limites Go** | Barras de progresso de Uso Contínuo, Semanal e Mensal |
| **Projeção 30 dias** | Calcula se o ritmo atual vai estourar o limite mensal |
| **i18n** | Detecta o idioma do navegador — painel em português ou inglês |
| **Cache** | Dados persistem entre páginas e reinícios (via GM_setValue) |
| **Scan via API** | Busca o período inteiro pela API `request-logs` com paginação por cursor — sem raspar a tabela |
| **Consciente de retenção** | Marca o período anterior como parcial (ou vazio) quando a retenção de logs do servidor não o cobre mais |

## Compatibilidade

- Requer o OpenCode Console (`https://opencode.ai/console/wrk_...`)
- Testado no Chrome, Firefox e Edge com Tampermonkey
- Pode funcionar em Violentmonkey/Greasemonkey (não testado)

## Licença

MIT
