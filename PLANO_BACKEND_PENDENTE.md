# Pendências de backend — branch `feature/backend-pendente`

> Junta os dois planos que antes viviam em `PLANO_VALIDACAO_CONHECIMENTO_BOLSA.md` e
> `PLANO_SSX_DESK_TRAINING_STAGES.md` (substituídos por este arquivo nesta branch).
> Os dois itens abaixo são as mudanças de backend ainda não mescladas em `main` nem
> publicadas na VM — por isso ficam juntas numa branch só, para ir num deploy combinado.

## 1. Card "Validação do Conhecimento" no painel Indicadores de Treinamento

> Status: **implementado e testado nesta branch.**

### O que muda

No painel "Indicadores de Treinamento" (`/relatorios` → aba Indicadores, e a tela
dedicada `/indicadores-treinamento-tv`), o card "Treinamentos" foi substituído por
"Validação do Conhecimento":

- Meta oficial: **80%**.
- Por cliente, conta só a **tentativa concluída mais recente** — uma reprovação seguida
  de uma aprovação posterior passa a contar só como aprovado (a mais nova substitui a
  mais antiga para fins de resultado).
- Métrica sempre do **mês corrente** (mesmo padrão do "Gol no Prazo", que também passou a
  ter meta de 100% nesta mesma leva de mudanças, já em `main`).
- Abaixo do percentual aparece a fração absoluta, ex. "12/15" (aprovados / total de
  clientes avaliados no mês).

### Por que precisa de deploy na VM

O painel só usa dados que o backend já mantém sincronizados em memória (`ocorrencias`,
`empresas`, `gamificacao_pontos`, `checklist_tarefas`) — por isso atualiza sozinho "sem
consumir leituras do Firebase". As tentativas de validação do conhecimento não faziam
parte dessa lista. Para manter o mesmo princípio (sem leitura recorrente do Firestore),
a coleção `validacao_tentativas` foi adicionada ao mesmo índice em memória:

- `server/src/infrastructure/firebase/IndiceSincronizacao.ts`: `validacao_tentativas`
  entrou em `COLECOES_SINCRONIZADAS`.
- `server/src/adapters/controllers/SincronizacaoController.ts`: acesso restrito a
  Master/treinador, igual ao que a tela de validação já permite hoje por cliente (não é
  uma exposição nova, só deixa de ser por empresa) — ver `server/VALIDACAO_CONHECIMENTO.md`.

### O que já está pronto (nesta branch)

- `app/src/utils/validacaoConhecimentoIndicadores.ts` — `calcularValidacaoPorCliente`
  (a lógica de "só a mais recente conta"), com 4 testes em
  `app/tests/validacaoConhecimentoIndicadores.test.mjs`.
- `app/src/pages/RelatorioIndicadoresTreinamento/BolsaIndicadoresTreinamento.tsx` — card
  "Validação do Conhecimento", meta 80%, granularidade mensal, fração "aprovados/total".
- `app/src/pages/RelatorioIndicadoresTreinamento/RelatorioIndicadoresTreinamento.tsx` —
  busca `validacao_tentativas` via `obterColecaoCompleta`, com `.catch(() => [])` isolado:
  um 403 (perfil sem acesso) não derruba o resto do painel, só deixa o card "sem dados".
- `server/tests/sincronizacao.test.mjs` — casos novos de autorização (bloqueia `cs`,
  libera `master`/`treinador`). 9/9 passando.
- Build do backend (`npm run build`) e `npm run test:sincronizacao` (frontend e backend)
  passando. `tsc -b` e `eslint` sem erros novos nos arquivos alterados.

## 2. Enviar a trilha de treinamento para o SSX Desk (training-stages)

> Status: **ainda não implementado nesta branch** — este é o próximo item a desenvolver.

### Contexto

Quando um cliente entra em contato com o Suporte (SSX Desk) querendo se antecipar a um
tema que ainda não foi dado, o analista do Desk não sabe quais temas da esteira já
passaram e quais ainda faltam. A SSX Desk expõe uma API nova para isso
(`POST/PUT/DELETE /api/integrations/v1/training-stages`, escopo
`training-stages:write`, 120 req/min por chave) onde o Radar pode publicar a trilha de
cada empresa (`companyId`, `name`, `status`, `sortOrder`, `notes`).

O Radar já guarda essa trilha: `Empresa.temaText`/`dataText` (uma linha por fase,
alinhadas por índice — ver `app/src/utils/temasEsteira.ts`) e `Empresa.currentPhase`
(índice da fase atual).

### Resposta à pergunta original (leitura no Firestore)

- `empresas` tem ~156 documentos (contagem já confirmada em produção). Uma consulta
  incremental `where('updatedAt', '>', desde)` a cada ciclo lê só o que mudou (igual ao
  padrão já usado em `SsxDeskSyncService.carregarEmpresas` e em
  `ManagerOpsSyncService.carregarTarefasParaEmpurrar`), não a coleção inteira.
- O bug que causou os picos de leitura este mês (Manager Ops, CSAT) era sempre o mesmo
  padrão: um cursor que trava (Manager Ops) ou uma consulta sem filtro de status (CSAT),
  fazendo a mesma janela ser relida quase por completo a cada ciclo. O desenho abaixo
  evita os dois: o cursor sempre avança (não depende de toda empresa ter sucesso no
  envio) e cada empresa só é reenviada quando algo relevante mudou nela.
- O lado que **pode** virar gargalo é o HTTP de saída para o Desk, não o Firestore: se
  muitas empresas mudarem no mesmo ciclo de 5 min, o número de chamadas POST/PUT pode se
  aproximar do limite de 120 req/min. Por isso o desenho inclui pacing entre chamadas
  (mesmo padrão de `listarConversas`, 600 ms de espera) e evita reenviar etapas que não
  mudaram.

### Desenho da implementação

#### 2.1 Cliente HTTP — `server/src/infrastructure/ssxDesk/trainingStages.ts`

Seguir o padrão fino de `ManagerOpsClient.ts` (nunca logar corpo/chave,
`AbortSignal.timeout`, `redirect: 'error'`):

- `listarEmpresasDesk(apiKey, fetchApi?)`: `GET /api/integrations/v1/companies`, paginado
  como `listarConversas` — devolve `{ id, idCentral, name }[]` para resolver o
  `companyId` (uuid) a partir do `idCentral` do Radar.
- `criarEtapaTreinamento(apiKey, dados, fetchApi?)`: `POST /training-stages`.
- `atualizarEtapaTreinamento(apiKey, id, dados, fetchApi?)`: `PUT /training-stages/{id}`.
- `excluirEtapaTreinamento(apiKey, id, fetchApi?)`: `DELETE /training-stages/{id}`
  (tratar 404 como sucesso, igual a `excluirCombinado`).

#### 2.2 Resolução de empresa → companyId do Desk

Reutilizar a lógica de unicidade de `resolverEmpresa` (`trainingConversations.ts`): só
aceitar `idCentral` que identifica uma única empresa dos dois lados. Cachear a lista do
Desk por 1h (mesmo padrão de `carregarUsuarios` no Manager Ops) para não repetir
`GET /companies` a cada ciclo.

#### 2.3 Serviço de sincronização — `server/src/infrastructure/ssxDesk/TrainingStagesSyncService.ts`

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

#### 2.4 Onde rodar e configuração

- Registrar em `server/src/infrastructure/web/apiIndex.ts`, ao lado de
  `iniciarSincronizacaoSsxDesk` — é só HTTP + Firestore, mesmo processo que já hospeda a
  integração de leitura do SSX Desk; não precisa do processo do bot.
- `server/src/infrastructure/config/env.ts`: novas variáveis
  `SSX_DESK_TRAINING_STAGES_API_KEY` e, opcional,
  `SSX_DESK_TRAINING_STAGES_SYNC_INTERVAL_MS` (padrão 5 min, mínimo 1 min — mesmo padrão
  das demais).
- Documentar em `server/SSX_DESK.md` (nova seção) ou um novo
  `server/SSX_DESK_TRAINING_STAGES.md`, incluindo a limitação de alinhamento por índice.

#### 2.5 Testes

- `server/tests/ssxDeskTrainingStages.test.mjs` (novo), seguindo o padrão de
  `server/tests/managerOps.test.mjs`: fake Firestore + fake cliente HTTP injetável.
  Casos principais: cursor sempre avança mesmo com falha numa empresa; linha nova gera
  POST e grava o id; linha já enviada só gera PUT quando o conteúdo muda; trilha
  encolhida gera DELETE das linhas excedentes; empresa sem `idCentral` resolvível fica
  de fora sem travar as demais.

### Verificação planejada

- `server/`: `npm run build` e `node --test tests/ssxDeskTrainingStages.test.mjs`.
- Rodar `sincronizar(dryRun-like)` manual contra o Emulator Suite (`server/EMULADOR.md`)
  antes de qualquer execução contra o Firestore de produção.
- Validar manualmente (chave de teste, se o SSX Desk tiver ambiente de homologação) que
  uma empresa de teste aparece com as etapas corretas antes de ligar em produção.

## Deploy combinado (quando os dois itens estiverem prontos)

1. Revisar e mesclar `feature/backend-pendente` em `main` (ou publicar direto dela).
2. Configurar as variáveis de ambiente novas em `/home/ubuntu/esteira-bot.env` na VM:
   `SSX_DESK_TRAINING_STAGES_API_KEY` (e opcionalmente `SSX_DESK_TRAINING_STAGES_SYNC_INTERVAL_MS`).
   Sem a chave, o serviço de training-stages fica desativado e o resto do Radar funciona
   normal — mesmo comportamento do SSX Desk e do Manager Ops hoje.
3. Build de uma nova imagem Docker e restart só do container `radar-api` — não precisa
   tocar no `esteira-bot`. Os dois itens entram no mesmo restart, um único ciclo de
   leitura inicial em vez de dois.
4. Publicar o frontend atualizado.
5. Verificar no Query Insights se o restart do `radar-api` não ficou fora do padrão das
   coleções já sincronizadas hoje (confirma que os índices novos não introduziram um
   custo diferente).

### Cuidado com a cota do Firestore

A cota do Spark é 50 mil leituras/dia. Antes de publicar, confira o uso do dia no Query
Insights — se estiver perto do teto, prefira publicar depois da virada (meia-noite em
`America/Sao_Paulo`, quando o contador do Spark reseta) ou em outro momento de folga.
Nada no desenvolvimento (código, testes, emulador) consome a cota de produção; só o
deploy na VM consome.

## Verificação já feita (item 1, Validação do Conhecimento)

- `server/`: `npm run build` e `npm run test:sincronizacao` (9/9).
- `app/`: `npx tsc -b`, `npx eslint` nos arquivos alterados, `npm run build` (Vite),
  `npm run test:sincronizacao` (16/16) e
  `node --experimental-vm-modules --test tests/validacaoConhecimentoIndicadores.test.mjs`
  (4/4).
- Não testado manualmente no navegador nem contra o Firestore de produção/emulador.
