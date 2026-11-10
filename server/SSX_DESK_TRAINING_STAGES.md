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
| Até a fase atual (inclusive) | `Concluído` |
| Depois da fase atual | `Não concluído` |

Só dois estados — nunca `Em andamento`. `currentPhase` só avança quando um tema é
efetivamente ensinado (ver `reordenarTemasEnsinados` em
app/src/utils/reordenarTemasEnsinados.ts e o fluxo manual em Esteira.tsx): o Radar não
distingue "começando a aprender" de "já aprendeu" pra um tema — ou foi dado, ou não foi.
Mostrar "Em andamento" pra fase atual sugeria uma granularidade que o Radar não tem, e
causava confusão real (ex.: cliente Numpe, já tinha aprendido "Videotelemetria", a fase
atual, mas o Desk mostrava "Em andamento" como se ainda estivesse em curso).

Linhas em branco não são enviadas (e, se já tinham uma etapa criada antes, ela é
excluída do Desk).

### Vínculo entre os dois sistemas

- `Empresa.ssxDeskTrainingStageIds`: um id de etapa do Desk por linha de `temaText`, na
  mesma posição — alinhado por índice, mesma convenção de `blocoText`/`reagendamentosText`.
  Reordenar linhas manualmente na Esteira (ou um tema ensinado fora de sequência via
  `reordenarTemasEnsinados`, no Histórico) desalinha esse array do array local. Para não
  depender só dele, cada ciclo reconcilia pelo estado ATUAL das etapas no Desk (o
  `trainingStages` embutido em cada empresa de `GET /companies`): recupera o id certo pelo
  **nome** da etapa quando o id salvo localmente aponta pra um nome diferente, e exclui
  qualquer etapa duplicada que sobre sem corresponder a nenhuma linha atual (ver
  `reconciliarEtapasEmpresa` em TrainingStagesSyncService.ts). Sem esse cuidado, uma
  reordenação acabava renomeando a etapa errada e/ou criando uma etapa duplicada para um
  tema que já existia no Desk — já aconteceu em produção (duas etapas de "Validação do
  Conhecimento" para o mesmo cliente). Quando o Desk não traz esse campo (ausente/vazio),
  a reconciliação volta a confiar cegamente no array local, como antes.
- `Empresa.ssxDeskTrainingStagesSyncedAt`: marca a última vez que a trilha daquela
  empresa foi publicada — usado para decidir se precisa reenviar (compara contra
  `updatedAt` da empresa). Uma
  duplicata encontrada na reconciliação acima, ou uma etapa já existente cujo `status`
  no Desk diverge do que o Radar calcula agora, também força o reenvio mesmo sem
  `updatedAt` ter mudado — sem isso, um PUT que saiu com o status errado uma única vez
  (por qualquer motivo transitório) ficava errado pra sempre, porque nada no Radar muda
  depois disso pra disparar um novo envio. Caso real confirmado em produção: a etapa
  "Conclusão" do cliente Altotrak foi criada com `status: "Em andamento"` no primeiro
  envio (06/11/2026) e ficou presa assim por semanas, mesmo com o Radar já calculando
  `"Concluído"` pra ela o tempo todo — nada no cadastro mudou depois daquele envio, então
  `precisaReenviar` continuava `false` em todo ciclo seguinte. Essa checagem de status só
  se aplica a empresas que entram no ciclo (pelo cursor incremental ou por falha
  conhecida); uma empresa já travada como o Altotrak só é reconsiderada por um backfill
  (`SSX_DESK_TRAINING_STAGES_FORCAR_BACKFILL=true`, ver "Configuração" abaixo) — rode um
  após publicar essa correção pra sanar quem já ficou preso.

### Vínculo da empresa com o `companyId` do Desk

Prioriza `Empresa.idCentral`: aceita quando identifica uma única empresa do lado do Desk
(`GET /companies`, cacheado por 1h). Sem `idCentral` no Radar (cadastro antigo, ver
`vincularIdCentral.ts`), ou com `idCentral` compartilhado por mais de uma empresa do
Desk, cai para nome exato e único (ignorando acentos, caixa e espaços) — mesma regra já
usada pela sincronização de entrada (`trainingConversations.resolverEmpresa`); rejeita o
nome quando a empresa já tem um `idCentral` próprio que diverge do idCentral já cadastrado
no Desk pra essa mesma empresa (conflito real, não "sem idCentral"). Sem resolver nem por
id nem por nome, a empresa fica em `semVinculo` e é retentada no próximo ciclo; os nomes
(até 50 por ciclo) ficam em `integracoes/ssxDeskTrainingStages.nomesSemVinculo`, pra saber
quem revisar sem precisar ler logs. **Não verifica duplicidade de `idCentral`/nome entre
empresas do próprio Radar** (exigiria carregar a coleção inteira a cada ciclo) — um
cadastro duplicado no Radar já quebraria a sincronização de entrada do SSX Desk antes de
chegar aqui, então não é um risco novo.

### Cursor e falhas

O cursor sempre avança no fim do ciclo,
independente de alguma empresa ter falhado — uma falha permanente nunca trava o cursor
nem faz a consulta por `updatedAt` reler quase a coleção inteira a cada ciclo. Empresas
com falha ficam marcadas em `empresasComFalha` e são retentadas por id, fora da janela de
tempo do cursor.

### Rotas

`POST /training-stages` cria (corpo com `companyId`). `PUT` e `DELETE` usam a mesma rota
com o **id na query string**: `/training-stages?id={id}` — conforme o guia da API do Desk.
`/training-stages/{id}` não existe e responde 404: até 09/11/2026 o cliente usava essa
rota, então nenhuma atualização nem exclusão chegava ao Desk, e cada PUT com 404 era
tratado como "etapa excluída, recriar" — origem das etapas duplicadas e dos status presos
(ex.: Altotrak em "Em andamento", Numpe com três cópias de cada etapa).

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
  linhas manualmente pode desalinhar um id antigo. Mitigado pela reconciliação por nome
  contra o estado atual do Desk (ver "Vínculo entre os dois sistemas" acima) — mas só
  funciona quando o Desk devolve o `trainingStages` embutido por empresa; sem esse campo,
  ainda vale o comportamento anterior (confia no array local). Continua existindo também
  quando duas linhas do meio têm exatamente o mesmo nome (sem como diferenciar por nome).
- **Duplicidade de `idCentral`/nome no Radar** não é verificada por este serviço (ver acima).
- **Paginação de `GET /companies` não documentada**: a resposta real confirmada traz
  `{ data: [...], meta: { total } }`, sem `hasMore` nem `offset` (diferente de
  `training-conversations`). `listarEmpresasDesk` faz uma única chamada sem parâmetros de
  página; se `data.length` vier menor que `meta.total`, a lista está incompleta e a
  função erra de forma explícita em vez de seguir com um subconjunto de empresas — se
  isso acontecer em produção, confirme com o SSX Desk como pedir as páginas seguintes
  (parâmetro `page`? `limit`/`offset`, mas com `meta` diferente de `training-conversations`?)
  antes de reativar.

## Arquivos envolvidos

- `server/src/infrastructure/ssxDesk/trainingStages.ts` — cliente HTTP.
- `server/src/infrastructure/ssxDesk/TrainingStagesSyncService.ts` — lógica de
  sincronização e o agendador.
- `server/src/infrastructure/web/apiIndex.ts` — liga a sincronização na inicialização da API.
- `app/src/types.ts` — `Empresa.ssxDeskTrainingStageIds` e `.ssxDeskTrainingStagesSyncedAt`.

## Testes

Em `server/`: `npm run test:ssx-desk-training-stages`.
