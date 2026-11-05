# Integração com a Manager Ops (Daily)

> **Desativada em produção (2026-11-05).** A chamada que inicia o serviço foi removida de
> `server/src/infrastructure/web/index.ts` depois de causar leituras excessivas no Firestore
> (ver histórico de commits) e instabilidade na VM. O código e os testes continuam no
> repositório; reative chamando `iniciarSincronizacaoManagerOps` de novo só depois de
> investigar a fundo a causa da instabilidade.

Sincroniza as **tarefas do Radar** (`checklist_tarefas`, o painel flutuante "Minhas
tarefas") com os **combinados** registrados na daily (Manager Ops), nos dois sentidos:

- Um combinado criado ou alterado na daily aparece como tarefa no Radar, com o prazo
  informado lá.
- Uma tarefa registrada manualmente no Radar vira um novo combinado na daily.
- Marcar como feita em qualquer um dos dois lados reflete no outro.

## Por que existe

Pedido de integração entre o Radar e a ferramenta de daily do time, para quem registra o
combinado numa das telas não precisar repetir o registro na outra.

## Como funciona

A API da Manager Ops **não tem webhook** — só endpoints REST (`server/docs/api.md` tem a
especificação completa recebida do fornecedor). Por isso a sincronização é por
**polling**: a cada ciclo (padrão 5 min, `MANAGER_OPS_SYNC_INTERVAL_MS`), o processo do
bot do WhatsApp (`index.ts`) chama `GET /agreements?updatedSince=...` para puxar o que
mudou na daily, e consulta o Firestore para empurrar o que mudou no Radar.

Roda em `index.ts`, não em `apiIndex.ts` (que concentra CSAT/ocorrências/SSX Desk):
é só HTTP + Firestore, leve o bastante para não competir com o Chromium do
whatsapp-web.js, e fica num processo que não reinicia a cada deploy da API —
mais estável para o cursor de sincronização.

### Vínculo entre os dois sistemas

- `TarefaChecklist.idTarefaDaily` guarda o id do combinado na Manager Ops. Uma tarefa sem
  esse campo ainda não foi enviada; um combinado sem tarefa vinculada ainda não foi
  importado.
- `TarefaChecklist.managerOpsSyncedAt` marca a última vez que aquele documento foi
  sincronizado (puxado ou empurrado) — usado para decidir o que falta empurrar e para
  evitar que puxar uma mudança da daily pareça uma edição nova do Radar e seja
  empurrada de volta sem necessidade.

### Quem é quem

A pessoa é casada pelo **e-mail cadastrado no Radar** (`usuarios.email`) com o
`memberEmail` da Manager Ops — assume que o e-mail é o mesmo nos dois sistemas. Tarefa
sem treinador com e-mail correspondente na daily, ou combinado cujo e-mail não bate com
nenhum usuário do Radar, fica só no sistema de origem (contabilizado nas estatísticas do
ciclo, não é erro).

### O que sincroniza

| Campo do Radar | Campo da daily | Observação |
|---|---|---|
| `descricao` | `title` + `description` | `title` é um recorte de até 160 caracteres da descrição; o texto completo fica em `description` |
| `prioridade` | `priority` | `baixa→LOW`, `normal→NORMAL`, `alta` e `urgente→HIGH` (a daily não tem nível acima de HIGH) |
| `concluida` | `status: DONE` | |
| `slaEm` | `dueDate` | só na criação — ver limitação abaixo |
| tarefa excluída | combinado excluído | exclusão lógica dos dois lados |

Tarefas automáticas do sistema (lembretes de follow-up, `automatica: true`) **não**
sincronizam — só as registradas manualmente.

### Conflito de edição simultânea

Quem editou por último vence: a sincronização compara o `updatedAt` de cada lado e só
aplica a versão mais recente.

## Limitações conhecidas

- **Prazo não muda depois de criado.** A API da daily recusa `dueDate` num `PATCH`
  (`422` — "o prazo só é reagendado na daily, para o histórico de arrasto continuar
  honesto"). Um prazo editado depois, em qualquer um dos dois lados, não é empurrado
  para o outro.
- **Reabrir uma tarefa já enviada como concluída** (marcar como "a fazer" de novo depois
  de ter sido empurrada como `DONE`) não é suportado pela API — ela não documenta como
  reverter o status de um combinado. A tarefa volta a "a fazer" só no Radar; o texto e a
  prioridade continuam sincronizando normalmente.
- **Excluir (não só concluir) uma tarefa nunca enviada antes, direto no Radar**, é uma
  exclusão definitiva local (`deleteDoc`, sem passar por `excluida: true`) — não deixa
  rastro para a sincronização detectar e replicar na daily.
- **Excluir um combinado direto na daily** (não cancelar — excluir mesmo) o tira da
  listagem da API por completo; sem webhook, a sincronização não tem como diferenciar
  "nunca existiu" de "foi excluído" para um combinado já vinculado que simplesmente
  parou de aparecer nas páginas de `updatedSince`. Fica como possível melhoria futura
  (checar periodicamente cada vínculo ainda ativo com `GET /agreements/{id}`).

## Configuração

- `server/.env`: `MANAGER_OPS_API_KEY` (gerada pelo administrador do time na Manager Ops,
  aparece uma única vez — guarde num gerenciador de senhas) e, opcionalmente,
  `MANAGER_OPS_SYNC_INTERVAL_MS` (padrão 300000 = 5 min, mínimo 60000).
- Sem a chave configurada, a sincronização fica desativada (log no início do processo do
  bot) e o resto do Radar funciona normalmente.
- Estado da sincronização (cursores e estatísticas do último ciclo) fica em
  `integracoes/managerOps` no Firestore.

## Arquivos envolvidos

- `server/src/infrastructure/managerOps/ManagerOpsClient.ts` — cliente HTTP da API.
- `server/src/infrastructure/managerOps/ManagerOpsSyncService.ts` — lógica de
  sincronização (puxar e empurrar) e o agendador.
- `server/src/infrastructure/web/index.ts` — liga a sincronização na inicialização do
  bot.
- `app/src/types.ts` — `TarefaChecklist.idTarefaDaily` e `.managerOpsSyncedAt`.
