A integração consulta o SSX Desk na inicialização do backend e a cada cinco minutos. Funciona mesmo sem o painel aberto, enquanto o servidor estiver em execução.

Configure no ambiente do **backend**:

```dotenv
SSX_DESK_API_KEY=<chave com escopo training-conversations:read>
SSX_DESK_SYNC_INTERVAL_MS=300000
```

A chave deve permanecer no ambiente do servidor. Nunca use `VITE_` nem a coloque no código do frontend. Configure também as credenciais do Firebase Admin, já usadas pelo backend (`FIREBASE_SERVICE_ACCOUNT_PATH`). Após publicar o backend e configurar a chave, reinicie o serviço. Publique o frontend atualizado para exibir a classificação pendente no painel.

A partir de `server/`, é possível verificar os vínculos sem gravar:

```powershell
npm run sincronizar-ssx-desk -- --dry-run
```

Para executar uma importação imediatamente, use `npm run sincronizar-ssx-desk`. Para validar o código, use `npm run test:ssx-desk`.

Cada sessão por empresa (`company.id` + `sessionId`) gera uma ocorrência do departamento **Suporte**, com tipo **Dúvida**, **Solicitação** ou **Problema** conforme as tags, resumo da IA e data/hora de início do atendimento. Quando a API retorna várias conversas da mesma sessão, a integração combina as tags, usa o resumo gerado mais recentemente e preserva o primeiro início e o último encerramento. Os IDs recebidos ficam em `ssxDesk.conversationIds`. A comparação ignora acentos, caixa e espaços nas extremidades. Sem tag reconhecida ou com tipos conflitantes, fica **Sem classificação**. No Histórico, o usuário seleciona o assunto da dúvida na lista do Radar. Ocorrências antigas com tipo vazio são preenchidas na próxima sincronização quando houver uma tag de tipo reconhecida. A sincronização nunca altera uma classificação já preenchida nem dispara WhatsApp.

Sessões que possuem somente a tag **Abandono** são ignoradas, inclusive quando ela aparece repetida ou com variações de acentos, caixa e espaços nas extremidades. A regra é aplicada após combinar as tags de todas as conversas da sessão: **Abandono + Dúvida**, por exemplo, continua seguindo as regras normais de importação. Sessões sem tags também mantêm o comportamento anterior. Sessões ignoradas por abandono não geram ocorrência, ajuste de score, desconto de pontos nem controles de importação; se receberem outra tag posteriormente, podem ser importadas no próximo ciclo. O contador `ignoradasPorAbandono` informa quantas sessões foram ignoradas por esse motivo em cada execução. Ocorrências e controles já existentes são preservados e não recebem atualizações enquanto a sessão tiver apenas Abandono; a alteração não faz limpeza retroativa do histórico.

O vínculo transacional em `ssxDeskSessoes` evita duplicações quando o Desk retorna novos IDs de conversa para a mesma sessão, inclusive entre instâncias concorrentes. A primeira ocorrência existente da sessão é reutilizada; duplicatas legadas não são excluídas automaticamente, preservando edições e referências. Preserve tanto `ssxDeskSessoes` quanto `ssxDeskImportacoes`: esses controles impedem recriar ocorrências excluídas, mesmo quando o ID de conversa muda.

Somente empresas marcadas como `isInTraining: true` no SSX Desk são consideradas. O cliente precisa existir no Radar e estar na esteira: sem ongoing ou cancelamento; clientes suspensos também são considerados. A data de finalização da esteira não bloqueia a importação. A conversa deve estar encerrada e ter começado desde a data de entrada do cliente no Radar. A primeira execução também considera o histórico disponível nesse período. Conversas antes ignoradas apenas pela suspensão ou pela data de finalização são reavaliadas na próxima sincronização e podem ser importadas, inclusive do histórico disponível.

O vínculo usa `company.idCentral` quando ele identifica uma única empresa dos dois lados. Quando o ID é compartilhado, exige nome exato (ignorando acentos, espaços e caixa) para distinguir as empresas. Sem ID, aceita apenas nome exato e único, sem conflito com o ID já cadastrado no Radar. Não há correspondência por aproximação. Empresas sem vínculo ficam em `semVinculo`; revise o cadastro e o ID do Central no Radar e/ou o cadastro no SSX Desk. A próxima execução tenta novamente os registros ignorados.

A rotina lê todas as páginas, sem um corte incremental por data de início: uma conversa antiga pode encerrar hoje e o resumo pode ficar pronto depois. Os registros de empresas são lidos de forma incremental por `updatedAt`, com reconciliação completa a cada seis horas; a memória de importações evita reler ocorrências já importadas e sem mudança no resumo. Todo ajuste de empresa deve manter `updatedAt` atualizado, como os serviços atuais do Radar já fazem.

Uma transação cria a ocorrência e seu controle em `ssxDeskImportacoes`, usando um ID determinístico por conversa. Isso evita duplicações entre execuções, reinícios e instâncias concorrentes. Preserve essa coleção: ela também impede recriar uma ocorrência excluída manualmente. Ocorrências manuais antigas não têm ID da conversa e não são deduplicadas automaticamente contra a API; confira a simulação antes de importar um histórico que já tenha sido lançado manualmente.

Se o resumo ainda não estiver pronto, a ocorrência aparece como aguardando processamento. Quando ficar disponível, o texto é atualizado somente se ainda corresponder à última descrição importada. Edições manuais têm prioridade.

O último resultado e eventual erro ficam no documento `integracoes/ssxDesk` e nos logs do backend. Falhas de rede, HTTP 401/403/429 e respostas inválidas são registradas e a rotina tenta novamente no próximo ciclo. A paginação aguarda 600 ms entre requisições, abaixo do limite documentado de 120 req/min por chave; evite compartilhar a mesma chave entre serviços adicionais.

Na simulação local de 01/10/2026, a API retornou 39 conversas. Uma ocorrência seria criada para **Altotrak**, iniciada em 30/09/2026 às 19h28 em Brasília. Foram ignoradas 25 conversas por status do Radar ou período anterior à entrada; outras 13 ficaram sem vínculo seguro. Os cinco cadastros a revisar são: START 163 (Central 1077), Atos 3 (1055), CONTROL ON/ TOMI 567 (1046), SN Rastreamento (Farejador) (1086) e GBORBA RASTREAMENTO (sem ID Central). Nenhuma ocorrência foi gravada na simulação.
