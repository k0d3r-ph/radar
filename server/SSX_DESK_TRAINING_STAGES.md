# Envio da trilha de treinamento para o SSX Desk (training-stages)

Publica a trilha de treinamento de cada cliente (`Empresa.temaText`/`currentPhase`) na
API de etapas de treinamento ("training stages") do SSX Desk, para o analista de Suporte
ver de lá quais temas já passaram e quais ainda faltam antes de responder um cliente que
se antecipou a um assunto.

## Por que existe

Quando um cliente entra em contato com o Suporte querendo tirar dúvida de um tema que
ainda não foi dado no treinamento, o analista não tinha como saber quais temas da
esteira já passaram. Essa integração resolve isso publicando o estado atual da trilha no
próprio SSX Desk.

## Como funciona

Sincronização por **polling** (a API do SSX Desk para isso não tem webhook, só REST), a
cada ciclo (padrão 5 min, `SSX_DESK_TRAINING_STAGES_SYNC_INTERVAL_MS`): consulta o
Firestore por empresas alteradas desde o cursor e publica a trilha de cada uma no Desk.

Roda em `apiIndex.ts`, junto da sincronização de leitura do SSX Desk — é só HTTP +
Firestore, mesmo processo.

### Cada fase vira uma etapa

Uma linha de `Empresa.temaText` (alinhada por índice com `dataText`) vira uma etapa
(`name`, `status`, `sortOrder`) no Desk. Status pela posição relativa a
`Empresa.currentPhase`:

| Posição da linha | Status no Desk |
|---|---|
| Antes da fase atual | `Concluído` |
| A fase atual | `Em andamento` |
| Depois da fase atual | `Não concluído` |

Linhas em branco não são enviadas (e, se já tinham uma etapa criada antes, ela é
excluída do Desk).

### Vínculo entre os dois sistemas

- `Empresa.ssxDeskTrainingStageIds`: um id de etapa do Desk por linha de `temaText`, na
  mesma posição — alinhado por índice, mesma convenção de `blocoText`/`reagendamentosText`.
  Reordenar linhas manualmente na Esteira pode desalinhar um id antigo; é o mesmo
  trade-off que já existe hoje para bloco/reagendamento, não um risco novo.
- `Empresa.ssxDeskTrainingStagesSyncedAt`: marca a última vez que a trilha daquela
  empresa foi publicada — usado para decidir se precisa reenviar (compara contra
  `updatedAt` da empresa), mesmo papel do `managerOpsSyncedAt` do Manager Ops.

### Vínculo da empresa com o `companyId` do Desk

Resolvido por `Empresa.idCentral`: só aceita quando identifica uma única empresa do lado
do Desk (`GET /companies`, cacheado por 1h). Sem `idCentral`, ou com `idCentral`
compartilhado por mais de uma empresa do Desk, a empresa fica em `semVinculo` e é
retentada no próximo ciclo. **Não verifica duplicidade de `idCentral` entre empresas do
próprio Radar** (exigiria carregar a coleção inteira a cada ciclo) — um cadastro
duplicado no Radar já quebraria a sincronização de entrada do SSX Desk
(`trainingConversations.resolverEmpresa`) antes de chegar aqui, então não é um risco novo.

### Cursor e falhas

Mesma correção já aplicada ao Manager Ops: o cursor sempre avança no fim do ciclo,
independente de alguma empresa ter falhado — uma falha permanente nunca trava o cursor
nem faz a consulta por `updatedAt` reler quase a coleção inteira a cada ciclo. Empresas
com falha ficam marcadas em `empresasComFalha` e são retentadas por id, fora da janela de
tempo do cursor.

### Rate limit

A API do Desk permite até 120 req/min por chave. O serviço aguarda ~600 ms entre cada
chamada de saída (POST/PUT/DELETE) e processa empresas em sequência, não em paralelo —
mesmo padrão de `trainingConversations.listarConversas`.

## Configuração

- `server/.env`: `SSX_DESK_TRAINING_STAGES_API_KEY` (escopo `training-stages:write`) e,
  opcionalmente, `SSX_DESK_TRAINING_STAGES_SYNC_INTERVAL_MS` (padrão 300000 = 5 min,
  mínimo 60000).
- **Chave separada** da leitura de conversas (`SSX_DESK_API_KEY`) — nunca reaproveitar a
  mesma chave entre os dois serviços, conforme a própria documentação do SSX Desk pede.
- Sem a chave configurada, a sincronização fica desativada (log no início do processo da
  API) e o resto do Radar funciona normalmente.
- Estado da sincronização (cursor e estatísticas do último ciclo) fica em
  `integracoes/ssxDeskTrainingStages` no Firestore.

## Limitações conhecidas

- **Alinhamento por índice** entre `temaText` e `ssxDeskTrainingStageIds`: reordenar
  linhas manualmente pode fazer um id antigo apontar para a etapa errada do Desk. Mesmo
  trade-off já aceito para `blocoText`/`reagendamentosText`.
- **Duplicidade de `idCentral` no Radar** não é verificada por este serviço (ver acima).
- **A resposta do `GET /companies`** segue o mesmo formato paginado de
  `training-conversations` (campos `data`/`meta.hasMore`/`meta.offset`/`meta.total`) por
  inferência — **confirme contra a documentação real do SSX Desk antes de ligar em
  produção**; o print original só mostrava o nome do endpoint no menu lateral, não o
  corpo da resposta.

## Arquivos envolvidos

- `server/src/infrastructure/ssxDesk/trainingStages.ts` — cliente HTTP.
- `server/src/infrastructure/ssxDesk/TrainingStagesSyncService.ts` — lógica de
  sincronização e o agendador.
- `server/src/infrastructure/web/apiIndex.ts` — liga a sincronização na inicialização da API.
- `app/src/types.ts` — `Empresa.ssxDeskTrainingStageIds` e `.ssxDeskTrainingStagesSyncedAt`.

## Testes

Em `server/`: `npm run test:ssx-desk-training-stages`.
