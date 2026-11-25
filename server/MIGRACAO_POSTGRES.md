# Migração Firestore → PostgreSQL

Os dados do Radar saem do Firestore e passam para o PostgreSQL da VPS. **A autenticação continua no Firebase Auth**: o navegador faz login no Firebase e a API valida o token com o Firebase Admin (`verifyIdToken`). O cadastro e o perfil do usuário (`usuarios`) passam a ficar no PostgreSQL.

## Situação na branch `migracao-postgres`

| Etapa | Situação |
| --- | --- |
| Banco `radar` e usuário `radar` na VPS | Feito (16/11/2026) |
| Backend (API e bot) lendo e gravando no PostgreSQL | Feito |
| Script de cópia dos dados do Firestore | Feito |
| API de dados para o navegador (`/api/dados`), com as permissões das antigas regras do Firestore | Feito |
| Frontend usando a API em vez do Firestore | Feito |
| Backup diário do banco | Feito (17/11/2026) |
| Ensaio da cópia na VPS | Feito (17/11/2026): 4.488 documentos, conferência sem divergências, nenhuma conversão de tipo |
| Teste das telas contra o banco copiado | **Pendente** |
| Virada | **Pendente** (janela a combinar) |

Backend e frontend desta branch precisam ser publicados **juntos**, na virada. Publicar só um deles separaria os dados em dois bancos.

## Como os dados ficam no PostgreSQL

Cada coleção do Firestore virou uma tabela de mesmo formato. O mapeamento está em `src/infrastructure/postgres/colecoes.ts`, e a criação em `src/infrastructure/postgres/migracoes.ts`.

| Coluna | Conteúdo |
| --- | --- |
| `id` (e `pai_id` em subcoleções) | Id original do documento no Firestore |
| `dados` (`jsonb`) | O documento, com os mesmos nomes de campo |
| `criado_em`, `atualizado_em` | Mantidos pelo banco; a importação preserva as datas do Firestore |
| `versao` | Muda a cada gravação; substitui o `updateTime` do Firestore na sincronização |
| `transacao` (`xid8`) | Transação que gravou; usada pelo índice para ler só o que mudou |

Tabelas: `usuarios`, `empresas`, `ocorrencias`, `gamificacao_pontos`, `checklist_tarefas`, `configuracoes`, `temas_ocorrencia`, `integracoes`, `favoritos_ocorrencias`, `csat_reservas`, `csat_reservas_respostas` (subcoleção `respostas`), `csat_links`, `csat_controle`, `validacao_perguntas`, `validacao_tentativas`, `validacao_clientes`, `validacao_controle`, `ssx_desk_importacoes` e `ssx_desk_sessoes`.

O documento continua em JSON para manter a compatibilidade com registros antigos e campos opcionais, sem reescrever as regras de negócio. Os campos consultados têm índice: GIN em `dados` para igualdades e índices de expressão para os intervalos (`empresas.updatedAt` e `validacao_tentativas.concluidaEm`). Exclusões ficam registradas em `radar_exclusoes` por 30 dias.

### Acesso pelo backend

Os casos de uso dependem de `BancoDocumentos` (`src/domain/interfaces/BancoDocumentos.ts`). Esse contrato reproduz o trecho da API do Firestore Admin que o Radar já usava: `collection`, `doc`, `where` (`==`, `<`, `<=`, `>`, `>=`, `in`), `orderBy`, `limit`, `get`, `set` (com `merge`), `update`, `create`, `delete`, `runTransaction` e `batch`. A implementação fica em `BancoDocumentosPostgres.ts`. Diferenças em relação ao Firestore:

- **Transações:** `SERIALIZABLE`. Quando outra gravação invalida as leituras, a função é executada de novo (até 10 tentativas, com espera crescente), como no Firestore. Leituras continuam obrigatoriamente antes das escritas, e as escritas só são aplicadas no commit.
- **Gravações avulsas e lotes:** também usam transação, então um `set(..., { merge: true })` concorrente não perde campos.
- **Igualdade:** compara tipo e valor (`"1"` ≠ `1`), e um array que contém o valor não conta como igual. Intervalos só casam com o mesmo tipo, e textos são comparados por bytes, como no Firestore.
- **Valores:** `undefined` e objetos que não sejam JSON (`Date`, classes) são recusados. `NaN` e `Infinity` viram `null`.

`IndiceSincronizacao` (`src/infrastructure/postgres/`) substitui o listener `onSnapshot`. Cada chamada lê só as linhas e exclusões com `transacao >= xmin` da leitura anterior, então gravações confirmadas fora de ordem não se perdem. Chamadas dentro de 1 segundo reutilizam a memória. O contrato de `/api/sincronizacao/:colecao` não mudou; a `versao` passou a ser um número.

As migrações de esquema rodam sozinhas quando a API ou o bot iniciam (`prepararBanco()`), protegidas por advisory lock, e ficam registradas em `radar_migracoes`. Uma migração publicada nunca é editada: mudanças entram como uma nova versão.

## Acesso pelo navegador (`/api/dados`)

O navegador não usa mais o SDK do Firestore, só o Firebase Auth. `app/src/services/dados.ts` oferece as mesmas funções que os serviços usavam (`doc`, `getDoc`, `getDocs`, `setDoc`, `updateDoc`, `deleteDoc`, `addDoc`, `query/where/orderBy/limit`, `runTransaction`, `writeBatch`, `deleteField` e `FieldPath`), então os serviços só trocaram o import. Os erros mantêm os códigos do Firestore (ex.: `permission-denied`).

| Rota | Uso |
| --- | --- |
| `GET /api/dados/:colecao/:id` | Lê um documento (devolve também a `versao`) |
| `POST /api/dados/:colecao/consultar` | Consulta com `filtros`, `ordens` e `limite` |
| `POST /api/dados/gravar` | Aplica `escritas` (`set`/`update`/`delete`) de uma vez. O `update` aceita `dados` (chaves com ponto viram campos aninhados) ou `campos` (caminhos literais, para `FieldPath` — ex.: nome de tema com ponto em `aplicacaoTemasDias`). com `leituras`, só grava se nenhum documento lido mudou de versão (409 `aborted`) |

- **Coleções acessíveis:** `usuarios`, `empresas`, `ocorrencias`, `gamificacao_pontos`, `checklist_tarefas`, `configuracoes` e `temasOcorrencia`. As demais seguem só pelas rotas específicas (CSAT, validação, SSX Desk).
- **Permissões:** `src/domain/regrasAcessoDados.ts`, conferidas sobre o documento resultante de cada gravação. Detalhes em [AUTENTICACAO.md](AUTENTICACAO.md).
- **Transações do navegador:** a leitura guarda a versão de cada documento, e o commit envia essas versões. Se outra pessoa alterou algo nesse meio-tempo, a função é refeita (até 5 tentativas), como no SDK do Firestore.
- **Diferenças para o usuário:**
  - não há mais leitura offline;
  - uma gravação só termina quando o servidor confirma;
  - ao abrir o app, a cópia local que o SDK do Firestore guardava no navegador é apagada.

## Configuração

Variáveis lidas por `src/infrastructure/postgres/conexao.ts`:

- `DATABASE_URL`, ou `POSTGRES_HOST`, `POSTGRES_PORT` (5432), `POSTGRES_DB` (`radar`), `POSTGRES_USER` (`radar`) e `POSTGRES_PASSWORD`.
- `POSTGRES_SSL=true` para conexões fora da máquina. `POSTGRES_POOL_MAX` define o limite de conexões por processo (padrão 10; o usuário `radar` aceita 30 no total).

Na VPS:

- PostgreSQL 18 instalado direto no sistema (cluster `18-main`). Banco `radar`, de propriedade do usuário `radar`, sem superusuário e com fuso `America/Sao_Paulo`.
- A credencial fica em `/etc/radar/postgres.env` (root, permissão 600), fora do repositório. O `docker-compose.yml` a carrega como `env_file`, e `host.docker.internal` aponta para o host.
- O `pg_hba.conf` só aceita o usuário `radar` no banco `radar`, vindo de `127.0.0.1` ou da rede Docker `172.20.0.0/16`. Qualquer outra origem é recusada. Por isso a sub-rede está fixada no compose. O backup do arquivo original está em `/etc/postgresql/18/main/pg_hba.conf.bak-*`.

## Desenvolvimento local

1. Em `server/`, rode `npm run db:local` (deixe aberto). Ele sobe um PostgreSQL 18 local, sem instalação, com dados em `server/.postgres-local/` (ignorado pelo git).
2. No `server/.env` local, configure `DATABASE_URL=postgres://postgres:radar-local@127.0.0.1:54329/radar`.
3. Para logins locais, use o Auth Emulator (`npm run emulators`, que agora sobe só o Auth) e depois `npm run seed:emulador`. Os seeds gravam **sempre** no banco local, ignorando o `.env`, então não alcançam produção.

Testes: `npm run test:postgres` (adaptador, concorrência real, fluxos de validação, CSAT, favoritos, importação e índice). Cada arquivo sobe um PostgreSQL descartável.

## Cópia dos dados (Firestore → PostgreSQL)

`npm run migrar-firestore` (script `scripts/migrarFirestoreParaPostgres.ts`):

- Só **lê** o Firestore (uma leitura de cada documento) e salva um backup completo em `server/.private-backups/firestore-<data>.json`. Esse arquivo contém dados de clientes; não o copie para fora da VPS.
- Sem `--aplicar`, apenas simula e mostra: contagem por coleção, coleções que não têm tabela (não são copiadas) e conversões de tipo (`Timestamp` → milissegundos etc.).
- Com `--aplicar`, esvazia e recarrega todas as tabelas em **uma** transação, preservando as datas originais. Depois relê tudo e compara documento por documento. Pode ser repetido sem duplicar nada.

`--contar` só conta os documentos por coleção, com consultas de agregação (cerca de 1 leitura a cada 1.000 documentos). Rode antes de uma cópia completa se o volume tiver crescido muito. Em 17/11/2026 eram 4.488 documentos, ou seja, cerca de 4,5 mil leituras por cópia.

Na VPS, depois que esta branch estiver em `/opt/radar`: `docker compose run --rm api npx tsx scripts/migrarFirestoreParaPostgres.ts [--contar|--aplicar]`.

Antes disso, como no ensaio, use um container descartável com o código da branch em `~/radar-migracao/server`. Ele recebe a credencial do Postgres e a do Firebase (só leitura) e não traz o `.env` da aplicação:

```
sudo docker run --rm --network radar_default --add-host host.docker.internal:host-gateway   --env-file /etc/radar/postgres.env -e FIREBASE_SERVICE_ACCOUNT_PATH=/segredos/serviceAccountKey.json   -v "$HOME/radar-migracao/server:/app" -v /opt/radar/secrets/serviceAccountKey.json:/segredos/serviceAccountKey.json:ro   -w /app node:22-slim npx tsx scripts/migrarFirestoreParaPostgres.ts --aplicar
```

O backup JSON do ensaio ficou em `~/radar-migracao/server/.private-backups/` (arquivo do root, permissão 600).

## Backup do banco

- **Rotina:** `/usr/local/bin/radar-backup-postgres`, executada pelo cron (`/etc/cron.d/radar-backup-postgres`) todo dia às 03:00 de Brasília (06:00 UTC; a VPS está em UTC).
- **Como funciona:** gera `pg_dump` no formato custom em `/var/backups/radar-postgres/radar-AAAAMMDD-HHMMSS.dump` (só root e postgres leem), confere que o arquivo pode ser lido pelo `pg_restore` antes de dar o backup por concluído e apaga os arquivos com mais de 14 dias. O log fica em `/var/log/radar-backup-postgres.log`.
- **Limitação:** os backups ficam no mesmo disco da VPS e não protegem contra a perda da máquina. Para isso, copie-os periodicamente para fora (outro servidor ou armazenamento externo).
- **Restaurar em um banco de teste:** `sudo -u postgres createdb radar_restauracao && sudo -u postgres pg_restore --dbname=radar_restauracao --no-owner <arquivo.dump>`.
- **Restaurar no banco `radar`:** com a API e o bot parados, `sudo -u postgres pg_restore --clean --if-exists --dbname=radar <arquivo.dump>`.

## Virada (a combinar)

1. **Ensaio:** rodar com `--aplicar` antes da janela, conferir o relatório e testar a aplicação contra o banco copiado.
2. **Na janela:** avisar os usuários e parar API e bot (`docker compose down`).
3. **Bloquear o Firestore:** publicar o `firestore.rules.producao` desta branch no console (nega tudo). A partir daí, nenhuma aba aberta com o app antigo grava no Firestore. O Firebase Admin do script de cópia continua lendo.
4. **Cópia final:** rodar `--aplicar` mais uma vez. A conferência precisa terminar sem divergências.
5. **Publicar** o backend (`docker compose up -d --build`; o `down` anterior também recria a rede com a sub-rede fixa) e, logo em seguida, o frontend desta branch.
6. **Validar:** login (inclusive de usuário inativo), Home, Histórico, Esteira, gamificação, CSAT público e a sincronização do SSX Desk.

**Volta:** o Firestore não é alterado pela migração. Se algo falhar:
1. republique as regras anteriores (`git show 088e330:firestore.rules.producao`, último commit antes da migração);
2. volte o backend e o frontend para a versão anterior.

O Firestore volta a ser a fonte. Gravações feitas no PostgreSQL depois da virada não voltam automaticamente para o Firestore.
