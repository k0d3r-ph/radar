# Ambiente local

Para desenvolver sem tocar em produção, rode na sua máquina:
- um **PostgreSQL local**, para os dados;
- o **Firebase Auth Emulator**, para os logins.

Dados e autenticação ficam isolados de produção.

## Uso do dia a dia

1. Instale as dependências do `server/` e do `app/` uma vez (`npm install` em cada um). O `server/` já inclui `firebase-tools` e `embedded-postgres` como devDependencies.
2. Em um terminal, a partir de `server/`, suba o banco local e deixe-o aberto:
   ```
   npm run db:local
   ```
   É um PostgreSQL 18 sem instalação, com dados em `server/.postgres-local/` (persistem entre execuções; apague a pasta para recomeçar do zero).
3. Em outro terminal, também em `server/`, suba o Auth Emulator (precisa de Java 11+):
   ```
   npm run emulators
   ```
   A UI de inspeção fica em http://localhost:4000.
4. Na primeira vez (ou para resetar os dados), em `server/`:
   ```
   npm run seed:emulador
   ```
   Recria `usuarios`, `empresas`, `ocorrencias` e `gamificacao_pontos` no banco local com dados sintéticos e cria os logins no Auth Emulator. A senha de todos é `senha123`, e os e-mails são impressos no final.
5. Configure os `.env` locais:
   - `server/.env`: `USE_FIREBASE_EMULATOR=true` e `DATABASE_URL=postgres://postgres:radar-local@127.0.0.1:54329/radar`
   - `app/.env.local`: `VITE_USE_FIREBASE_EMULATOR=true`
6. Rode o backend (`npm run dev:api` em `server/`) e o app (`npm run dev` em `app/`). Reinicie os processos depois de mudar os `.env`.

Os scripts de exemplo (`seed:*`) gravam **sempre** no banco local (`scripts/bancoLocal.ts`), ignorando o `.env`. Assim não alcançam o banco de produção, mesmo que o `server/.env` aponte para ele.

## Exemplos adicionais

Todos exigem o banco local rodando e regravam só os próprios registros, com datas relativas ao dia atual.

- **Jornada do cliente** (`npm run seed:jornada`): 8 clientes `[Demo Jornada]` e 95 ocorrências (ids `demo-jornada-`). Em Relatórios > Jornada do cliente, busque `Demo Jornada`. Detalhes em `app/JORNADA_CLIENTE.md`.
- **Aplicação dos temas** (`npm run seed:aplicacao`): cliente `[Demo Aplicação] Central Exemplo`, com treinamentos passados e D-N já marcados (inclui um dia com dois temas em que só um foi aplicado e um dia ainda no formato antigo de marcação por dia). Na Esteira, role até "Aplicação dos temas na base". Repetir o comando também apaga os ajustes de temas feitos na tabela (renomeados, retirados e incluídos).
- **Validação parcial do conhecimento** (`npm run seed:validacao-parcial`, depois do `seed:emulador`): cria `[Demo Validação] Concluída` e `[Demo Validação] Em andamento` pelo fluxo real. Entre como `treinador2@local.test`.
- **Indicador de Validação do Conhecimento** (`npm run seed:indicador-validacao`, depois do `seed:emulador`): oito clientes `[Demo Indicador]` pelo fluxo real da API, cobrindo avaliações concluídas, prévias pela validação parcial (inclusive no limite de 80%) e uma tentativa abaixo do mínimo de perguntas marcadas. O script imprime o resultado pela regra antiga e pela nova. Abra Relatórios › Indicadores de Treinamento.
- **Certificados de treinamento** (`npm run seed:certificado`, depois do `seed:emulador`): `[Demo Certificado] Central Exemplo`, com treinamentos com duração de agenda (inclui uma revisão e uma ausência, que não soma), dois contatos fictícios e uma validação aprovada com três participantes no CSAT. Entre como `treinador2@local.test`, abra Validação do conhecimento e use "Gerar certificados". O script imprime a carga horária e o período esperados.

## O que não fica isolado

A sincronização do SSX Desk faz chamadas HTTP reais ao fornecedor (`SSX_DESK_API_KEY`). Se não estiver testando a importação, deixe essa chave em branco no `server/.env`.

## Limitações

- O seed não popula `checklist_tarefas`, reservas de CSAT nem a importação do SSX Desk.
- Sem Java, o Auth Emulator não sobe e não há login local. Os testes automatizados (`npm run test:postgres`) não precisam dele.
