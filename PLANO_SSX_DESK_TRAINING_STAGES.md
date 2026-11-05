# Enviar a trilha de treinamento para o SSX Desk (training-stages)

> Plano guardado para implementar mais tarde — ver seção "Momento da implantação".

## Contexto

Quando um cliente entra em contato com o Suporte (SSX Desk) querendo se antecipar a um
tema que ainda não foi dado, o analista do Desk não sabe quais temas da esteira já
passaram e quais ainda faltam. A SSX Desk expõe uma API nova para isso
(`POST/PUT/DELETE /api/integrations/v1/training-stages`, escopo
`training-stages:write`, 120 req/min por chave) onde o Radar pode publicar a trilha de
cada empresa (`companyId`, `name`, `status`, `sortOrder`, `notes`).

O Radar já guarda essa trilha: `Empresa.temaText`/`dataText` (uma linha por fase,
alinhadas por índice — ver `app/src/utils/temasEsteira.ts`) e `Empresa.currentPhase`
(índice da fase atual). O pedido é avaliar o custo de leitura no Firestore dessa
integração **antes** de implementar, e já deixar o desenho pronto — a resposta curta é
**não há risco de leitura se seguir o padrão já corrigido do Manager Ops** (cursor
incremental por `updatedAt`, nunca full-scan por ciclo); o risco real é o **rate limit de
120 req/min do lado do Desk**, que pede paginação/pacing nas chamadas de saída, não nas
leituras do Firestore.

## Resposta à pergunta (leitura no Firestore)

- `empresas` tem ~156 documentos (contagem já confirmada em produção nesta sessão). Uma
  consulta incremental `where('updatedAt', '>', desde)` a cada ciclo lê só o que mudou
  (igual ao padrão já usado em `SsxDeskSyncService.carregarEmpresas` e, agora, em
  `ManagerOpsSyncService.carregarTarefasParaEmpurrar`), não a coleção inteira.
- O bug que causou os picos de leitura este mês (Manager Ops, CSAT) era sempre o mesmo
  padrão: um cursor que trava (Manager Ops) ou uma consulta sem filtro de status
  (CSAT), fazendo a mesma janela ser relida quase por completo a cada ciclo. O desenho
  abaixo evita os dois: o cursor sempre avança (não depende de toda empresa ter sucesso
  no envio) e cada empresa só é reenviada quando algo relevante mudou nela.
- O lado que **pode** virar gargalo é o HTTP de saída para o Desk, não o Firestore: se
  muitas empresas mudarem no mesmo ciclo de 5 min, o número de chamadas POST/PUT pode se
  aproximar do limite de 120 req/min. Por isso o desenho inclui pacing entre chamadas
  (mesmo padrão de `listarConversas`, 600 ms de espera) e evita reenviar etapas que não
  mudaram.

## Desenho da implementação

### 1. Cliente HTTP — `server/src/infrastructure/ssxDesk/trainingStages.ts`

Seguir o padrão fino de `ManagerOpsClient.ts` (nunca logar corpo/chave, `AbortSignal.timeout`,
`redirect: 'error'`):

- `listarEmpresasDesk(apiKey, fetchApi?)`: `GET /api/integrations/v1/companies`, paginado
  como `listarConversas` — devolve `{ id, idCentral, name }[]` para resolver o
  `companyId` (uuid) a partir do `idCentral` do Radar.
- `criarEtapaTreinamento(apiKey, dados, fetchApi?)`: `POST /training-stages`.
- `atualizarEtapaTreinamento(apiKey, id, dados, fetchApi?)`: `PUT /training-stages/{id}`.
- `excluirEtapaTreinamento(apiKey, id, fetchApi?)`: `DELETE /training-stages/{id}`
  (tratar 404 como sucesso, igual a `excluirCombinado`).

### 2. Resolução de empresa → companyId do Desk

Reutilizar a lógica de unicidade de `resolverEmpresa` (`trainingConversations.ts`): só
aceitar `idCentral` que identifica uma única empresa dos dois lados. Cachear a lista do
Desk por 1h (mesmo padrão de `carregarUsuarios` no Manager Ops) para não repetir
`GET /companies` a cada ciclo.

### 3. Serviço de sincronização — `server/src/infrastructure/ssxDesk/TrainingStagesSyncService.ts`

Modelado na metade "empurrar" do `ManagerOpsSyncService`, só que de saída (Radar →
Desk):

- Cursor incremental: `empresas.where('updatedAt', '>', desde)`, com a mesma margem de
  segurança (`MARGEM_SEGURANCA_MS`) e o mesmo cuidado de sempre avançar o cursor no
  início do ciclo (nunca condicionado a sucesso de todas as empresas) — é exatamente o
  bug corrigido no Manager Ops.
- Por empresa alterada: montar as linhas da trilha com a mesma lógica de
  `textosParaLinhasTema`/`normalizarTextosTema` (porta server-side, já que o backend não
  compila `app/`, mesmo motivo documentado em `ManagerOpsSyncService.prazoApartirDoDueDate`).
- Status por linha, pela regra escolhida (`currentPhase`):
  - índice `< currentPhase` → `"Concluído"`
  - índice `=== currentPhase` → `"Em andamento"`
  - índice `> currentPhase` → `"Não concluído"`
- Pular linha vazia (tema em branco) e empresa sem `temaText`.
- Idempotência/edição: persistir o id retornado pelo Desk por linha, alinhado por índice
  — mesma convenção já usada para `blocoText`/`reagendamentosText` (aceita o mesmo
  trade-off: reordenar linhas manualmente pode desalinhar um id antigo, igual já
  acontece hoje com bloco/reagendamento). Novo campo em `Empresa`:
  `ssxDeskTrainingStageIds?: string[]` (um id do Desk por linha, `""` quando ainda não
  enviado).
  - Linha sem id → `POST` (cria) e grava o id retornado.
  - Linha com id e conteúdo mudou desde o último envio → `PUT`.
  - Ids sobrando (trilha encolheu) → `DELETE` dos excedentes.
  - Só reenvia (PUT) quando `name`/`status` realmente mudou — comparar contra um
    snapshot salvo (`ssxDeskTrainingStagesSyncedAt` vs. `updatedAt` da empresa, mesmo
    padrão de `managerOpsSyncedAt`), para não dar PUT em todas as linhas de toda empresa
    alterada a cada ciclo.
- Pacing: aguardar ~600 ms entre chamadas HTTP de saída (mesmo valor de
  `listarConversas`), processando empresas em sequência, não em paralelo — protege o
  limite de 120 req/min compartilhado pela chave.
- Chave de API **separada** da leitura de conversas: usar
  `SSX_DESK_TRAINING_STAGES_API_KEY` (escopo `training-stages:write`), nunca reaproveitar
  `SSX_DESK_API_KEY` — a própria doc do SSX Desk já pede isso ("evite compartilhar a
  mesma chave entre serviços adicionais") e o escopo documentado no print é diferente.
- Estado do ciclo em `integracoes/ssxDeskTrainingStages` (mesmo padrão de
  `integracoes/ssxDesk` e `integracoes/managerOps`): `lastSuccessAt`, `lastError`,
  `lastPushedAt`, estatísticas.

### 4. Onde rodar e configuração

- Registrar em `server/src/infrastructure/web/apiIndex.ts`, ao lado de
  `iniciarSincronizacaoSsxDesk` — é só HTTP + Firestore, mesmo processo que já hospeda a
  integração de leitura do SSX Desk; não precisa do processo do bot.
- `server/src/infrastructure/config/env.ts`: novas variáveis
  `SSX_DESK_TRAINING_STAGES_API_KEY` e, opcional, `SSX_DESK_TRAINING_STAGES_SYNC_INTERVAL_MS`
  (padrão 5 min, mínimo 1 min — mesmo padrão das demais).
- Documentar em `server/SSX_DESK.md` (nova seção) ou um novo
  `server/SSX_DESK_TRAINING_STAGES.md`, incluindo a limitação de alinhamento por índice.

### 5. Testes

- `server/tests/ssxDeskTrainingStages.test.mjs` (novo), seguindo o padrão de
  `server/tests/managerOps.test.mjs`: fake Firestore + fake cliente HTTP injetável.
  Casos principais: cursor sempre avança mesmo com falha numa empresa; linha nova gera
  POST e grava o id; linha já enviada só gera PUT quando o conteúdo muda; trilha
  encolhida gera DELETE das linhas excedentes; empresa sem `idCentral` resolvível fica
  de fora sem travar as demais.

## Momento da implantação

A cota do Spark é 50 mil leituras/dia e o uso de hoje já está em ~39 mil (78%). Mesmo o
serviço novo sendo incremental e barato por ciclo, ele ainda soma três coisas ao total do
dia: (1) a releitura de inicialização do `radar-api` no restart do deploy (mesmo custo de
qualquer reinício desse container, já visto nesta sessão), (2) o cache de empresas do
Desk a cada hora, e (3) um ciclo a mais rodando a cada 5 min pelo resto do dia. Isso é
pequeno isoladamente, mas somado ao que já está em 78% da cota, não é o momento ideal —
um pico inesperado em qualquer outra parte do sistema hoje poderia estourar o teto.

**Recomendação:** implementar e testar quando retomado (código, testes, emulador — nada
disso consome a cota de produção), mas só fazer o build e o restart do `radar-api` em
produção depois que a cota virar (meia-noite em `America/Sao_Paulo`, quando o contador do
Spark reseta) ou em outro momento de folga confirmado no Query Insights. Aviso para não
deixar passar: aguardar o ok explícito antes de subir na VM.

## Implantação na VM

Sim, vai exigir mudança na VM: o código novo entra em `apiIndex.ts`, que roda no
container `radar-api` (produção, Oracle Cloud). Depois de implementado e com os testes
passando, o fluxo é o mesmo já usado nas últimas entregas desta sessão:

1. Configurar `SSX_DESK_TRAINING_STAGES_API_KEY` (e, se quiser mudar o padrão,
   `SSX_DESK_TRAINING_STAGES_SYNC_INTERVAL_MS`) em `/home/ubuntu/esteira-bot.env` na VM —
   sem a chave, o serviço fica desativado e o resto do Radar funciona normal (mesmo
   comportamento do SSX Desk e do Manager Ops hoje).
2. Build de uma nova imagem Docker (`docker build -t radar-whatsapp:api-<hash> .`) e
   recriar só o container `radar-api` com `npm run start:api` (não precisa tocar no
   `esteira-bot`, que não entra nesse caminho de código).
3. Como é leitura incremental por `updatedAt`, o custo de cada reinício do `radar-api` é
   baixo (só relê o que mudou desde o último cursor salvo, igual ao SSX Desk e ao Manager
   Ops hoje) — não é um novo risco de consumo de cota como os bugs corrigidos esta semana.

Dado o estado da VM neste momento (pouca RAM livre, instabilidade de rede observada
nesta sessão), a implantação deve ser feita com o usuário por perto para confirmar que o
`radar-api` volta a responder, do mesmo jeito que nos deploys anteriores desta sessão.

## Verificação

- `server/`: `npm run build` e `node --test tests/ssxDeskTrainingStages.test.mjs`.
- Rodar `sincronizar(dryRun-like)` manual contra o Emulator Suite (`server/EMULADOR.md`)
  antes de qualquer execução contra o Firestore de produção.
- Validar manualmente (chave de teste, se o SSX Desk tiver ambiente de homologação) que
  uma empresa de teste aparece com as etapas corretas antes de ligar em produção.
