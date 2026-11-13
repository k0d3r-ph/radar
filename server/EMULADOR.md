# Firebase Emulator Suite local

Por que existe: rodar o Radar localmente (app + `dev:api`) sempre leu e gravou direto no
Firestore de produção. Cada reinício do `npm run dev:api` (o `tsx watch` reinicia o
processo inteiro a cada arquivo salvo) refaz as leituras iniciais do índice de
sincronização e, se `SSX_DESK_API_KEY` estiver preenchida, também as leituras e
gravações da importação do SSX Desk — isso soma rápido contra a cota diária gratuita
(50 mil leituras/dia no plano Spark). O Emulator Suite resolve isso: Firestore e Auth
rodando só na sua máquina, com dados de exemplo, sem tocar em produção.

## Uso do dia a dia

1. Instale as dependências do `server/` uma vez (`npm install`) — já inclui
   `firebase-tools` como devDependency.
2. Em um terminal, suba o emulador (a partir de `server/`):
   ```
   npm run emulators
   ```
   Abre o Firestore (porta 8080), o Auth (porta 9099), o Storage (porta 9199) e uma UI
   de inspeção em http://localhost:4000. Deixe esse terminal aberto enquanto desenvolve.
3. Na primeira vez (ou sempre que quiser resetar os dados), em outro terminal, também a
   partir de `server/`:
   ```
   npm run seed:emulador
   ```
   Apaga e recria `usuarios`, `empresas`, `ocorrencias` e `gamificacao_pontos` com dados
   sintéticos (8 empresas em estados variados, ocorrências, treinamentos com CSAT).
   Imprime os e-mails de login ao final — a senha de todos é `senha123`.
4. Ligue o modo emulador nos dois `.env` locais:
   - `server/.env`: `USE_FIREBASE_EMULATOR=true`
   - `app/.env.local`: `VITE_USE_FIREBASE_EMULATOR=true`
5. Rode o app e o backend normalmente (`npm run dev` no `app/`, `npm run dev:api` no
   `server/`). Reinicie os dois processos depois de mudar os `.env` — variáveis de
   ambiente só são lidas na inicialização.
6. Para voltar a apontar para produção, mude as duas flags para `false` (ou apague as
   linhas) e reinicie os processos de novo.

Com `USE_FIREBASE_EMULATOR=true`, o backend ignora `serviceAccountKey.json` — não
precisa dele para rodar contra o emulador.

## Exemplos para a jornada do cliente

Com o Firestore local já rodando, execute em `server/`:

```powershell
npm run seed:jornada
```

Acrescenta 8 clientes e 95 ocorrências sintéticas, identificados por `[Demo Jornada]`, sem apagar os dados ou usuários existentes. Os IDs começam com `demo-jornada-`; repetir o comando atualiza apenas esses exemplos com datas relativas ao dia atual. O script fixa o destino em `127.0.0.1:8080`, ignora `.env` e não lê credenciais de produção.

No Radar, abra Relatórios > Jornada do cliente e busque `Demo Jornada`. Use Todos para incluir a jornada concluída. Há exemplos de queda por suporte, recuperação após 15 dias, mudança pelas respostas do questionário, Fast estável e ausência de score. O comando não cria logins; use os usuários locais já cadastrados. Detalhes das regras em `app/JORNADA_CLIENTE.md`.

## Exemplo para a aplicação dos temas (Esteira)

Com o Firestore local rodando, execute em `server/` `npm run seed:aplicacao`. Cria o cliente `[Demo Aplicação] Central Exemplo` (IDs `demo-aplicacao-`) com treinamentos passados e D-N já marcados, um treinamento recente sem marcação, um agendamento futuro e o tema "Início" (que não entra na tabela). Na Esteira, selecione o cliente e role até "Aplicação dos temas na base". Repetir o comando regrava só esses registros, com datas relativas ao dia atual; o destino é fixo em `127.0.0.1:8080`.

## Exemplo para a validação parcial do conhecimento

Com o Firestore local rodando e o `npm run seed:emulador` já executado, rode em `server/` `npm run seed:validacao-parcial`. Pelo fluxo real da API, cria `[Demo Validação] Concluída` (validação parcial e final marcadas, avaliação concluída e ocorrência de Treinamento no Histórico) e `[Demo Validação] Em andamento` (parcial marcada em parte das perguntas, final sem resposta). Entre como `treinador2@local.test` e abra Validação do conhecimento. O script imprime o texto da ocorrência gerada. Repetir o comando recria só esses registros (IDs `demo-validacao-`).

## O que NÃO depende do emulador

A sincronização do SSX Desk ainda faz chamadas HTTP reais ao vendor (`SSX_DESK_API_KEY`)
mesmo em modo emulador — só as leituras/gravações no Firestore é que vão para o
emulador em vez de produção. Se não estiver testando a importação do SSX Desk de
propósito, deixe `SSX_DESK_API_KEY` em branco no `server/.env` independentemente do
modo emulador estar ligado.

## Arquivos envolvidos

- `firebase.json`, `.firebaserc`, `firestore.rules`, `storage.rules`, `firestore.indexes.json` (raiz do
  repo) — configuração do Emulator Suite. `firestore.rules` é deliberadamente aberto
  (`allow read, write: if true`) e só vale para o emulador; nunca existe produção atrás
  dele, e nunca deve ser publicado com `firebase deploy`.
- `storage.rules` também é carregado pelo emulador e restringe fotos de perfil a
  usuários autenticados, permitindo que cada usuário altere somente a própria imagem
  (JPEG, PNG ou WebP, até 2 MB). Em produção, confirme que o bucket do Firebase Storage
  está habilitado e publique uma regra equivalente pelo fluxo de administração usado
  pelo projeto; o arquivo local não altera as regras de produção automaticamente.
- `server/scripts/seedEmulador.ts` — popula o emulador. Força os hosts do emulador
  independentemente do que estiver no `.env`, então é seguro rodar mesmo sem
  `USE_FIREBASE_EMULATOR=true` — mas só funciona com o emulador já rodando.
- `app/src/services/firebase.ts` e
  `server/src/infrastructure/firebase/firebaseAdmin.ts` — leem as flags
  `VITE_USE_FIREBASE_EMULATOR`/`USE_FIREBASE_EMULATOR` e decidem para onde apontar.
- `.emulator-data/` (raiz do repo, criada no primeiro `npm run emulators`) — snapshot dos
  dados do emulador entre sessões (`--import`/`--export-on-exit`); git-ignorada.

## Limitações

- O seed cobre `usuarios`, `empresas`, `ocorrencias` e `gamificacao_pontos` — não
  popula `checklist_tarefas`, reservas de CSAT nem a importação do SSX Desk. Para testar
  essas áreas específicas, ainda é preciso ambiente real (ou estender o seed).
- `firestore.indexes.json` está vazio; se uma consulta precisar de índice composto que
  só existe em produção, ela falha no emulador até o índice equivalente ser adicionado
  ali.
