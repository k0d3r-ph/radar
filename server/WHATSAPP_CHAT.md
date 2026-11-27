# Chat do WhatsApp (tela Conversas)

A tela **Conversas** (`/conversas`) permite que master e treinadores leiam e respondam, dentro do Radar, as conversas do número conectado na tela **WhatsApp**. É a mesma sessão (QR Code) usada pelos avisos automáticos; nenhum aparelho novo é conectado.

## Como funciona

- O processo do **bot** (`index.ts`, container `bot`) escuta toda mensagem criada no número (evento `message_create`): as recebidas e as enviadas de qualquer aparelho, inclusive celular e WhatsCRM. Grupos, status, canais e avisos de sistema são ignorados.
- As mensagens ficam nas tabelas `whatsapp_conversas` e `whatsapp_mensagens` (migração 2). Elas **não** fazem parte de `/api/dados`: só as rotas abaixo as leem.
- Cada mensagem é gravada uma única vez, pelo id do WhatsApp. Quando o envio pelo Radar e o evento do WhatsApp chegam em ordem trocada, o registro de quem enviou é completado sem duplicar.
- A conversa é ligada ao cliente comparando o telefone com `telefone` e `contatos[].telefones` do cadastro (DDD + 8 últimos dígitos, então números com e sem o 9 ou o 55 casam). O vínculo é calculado na leitura, com o cadastro em cache por 60 s; corrigir um telefone no cliente corrige a conversa.
- "Vincular a um cliente" grava o telefone num contato do cadastro (novo ou existente) e recarrega o índice na hora.
- Ao conectar ou reconectar, o bot busca as últimas 30 mensagens das 30 conversas mais recentes para cobrir o período em que ficou fora. Só quando essa recuperação traz mensagem recebida nova as não lidas passam a seguir o contador do WhatsApp.
- Conversas `@lid` (identificador novo do WhatsApp) têm o telefone resolvido pelo próprio WhatsApp; se ele não informar, a conversa aparece sem telefone e não pode ser vinculada.
- Imagem, áudio, vídeo e documento aparecem só com o rótulo (ex.: "📷 Imagem · abra no celular para ver"). O envio pelo Radar é só de texto (até 4096 caracteres).

## Rotas (processo do bot, só `master` e `treinador`)

| Rota | Uso |
|---|---|
| `GET /api/whatsapp/conversas[?recarregar=1]` | Lista (até 300), com `vinculos` do cadastro |
| `GET /api/whatsapp/conversas/:id/mensagens[?antesEm=&antesId=]` | 50 mensagens por página, da mais recente para trás |
| `POST /api/whatsapp/conversas/:id/mensagens` `{ texto }` | Envia texto e registra quem enviou |
| `POST /api/whatsapp/conversas/:id/lida` | Zera as não lidas no Radar (não marca como lida no celular) |

O socket do bot (já restrito a master e treinador) emite `whatsapp-chat` com `{ tipo: 'mensagem', conversa, mensagem }` ou `{ tipo: 'conversa', conversa }`.

## Variáveis do bot

| Variável | Efeito |
|---|---|
| `WHATSAPP_CHAT_SOMENTE_CLIENTES=true` | Grava e mostra só conversas de telefones cadastrados em clientes. Para teste com número pessoal; em produção fica desligada. |
| `WHATSAPP_ENVIO_AUTOMATICO_BLOQUEADO=true` | A rota `/api/whatsapp/send` (avisos de progresso, gestão, chamados) responde 403. Só o chat envia. Para teste local com dados reais. |

## Teste local com dados reais

1. Na VPS, exporte só os dados e copie o arquivo para fora do repositório no seu computador:
   ```
   sudo -u postgres pg_dump --data-only --column-inserts radar > /tmp/radar-dados.sql
   ```
   Depois apague `/tmp/radar-dados.sql` na VPS.
2. Em `server/`, com `npm run db:local` aberto: `npm run db:local:importar -- caminho/radar-dados.sql`. Os dados locais são substituídos; produção não é tocada. Apague o arquivo depois: ele contém dados de clientes.
3. Suba os processos com login real do Firebase (os usuários da cópia têm os ids de produção) e as proteções ligadas:
   - API: `USE_FIREBASE_EMULATOR=false API_PORT=5002 DATABASE_URL=postgres://postgres:radar-local@127.0.0.1:54329/radar SSX_DESK_API_KEY= npm run dev:api`
   - Bot: `USE_FIREBASE_EMULATOR=false PORT=5003 DATABASE_URL=... WWEBJS_AUTH_PATH=./.wwebjs_auth/teste-local WHATSAPP_CHAT_SOMENTE_CLIENTES=true WHATSAPP_ENVIO_AUTOMATICO_BLOQUEADO=true npm run dev`
   - App (em `app/`): `VITE_USE_FIREBASE_EMULATOR=false VITE_RADAR_API_URL=http://localhost:5002 VITE_WHATSAPP_API_URL=http://localhost:5003 npx vite --port 5174`
4. Na tela WhatsApp do app local, leia o QR Code com o número de teste. Ao terminar, desconecte o aparelho em "Aparelhos conectados" no celular.
5. Não use a tela Usuários no ambiente local: ela altera as contas reais do Firebase.

## Validação

`npm run test:whatsapp-chat` (regras de telefone e tipos, gravação sem duplicar, não lidas, autor, paginação, recuperação, modo só clientes e bloqueio de envios) e `npm run test:postgres` (migrações).
