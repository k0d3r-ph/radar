# Autenticação, gestão de usuários e regras do Firestore

## Quem pode chamar o quê

`AutenticadorRadar` (`src/adapters/middlewares/autenticacaoRadar.ts`) aceita uma requisição só se:
- o token do Firebase é válido e não foi revogado;
- existe `usuarios/{uid}`, sem `inativo` e sem senha pendente (`needsPasswordChange`);
- o perfil está na lista da rota.

O cadastro fica em cache por 60 segundos por processo, então inativar ou trocar o perfil de um usuário vale em até esse prazo.

| Processo | Rota | Perfis |
|---|---|---|
| bot (5000) | `GET /api/whatsapp/status` | treinador, master |
| bot | `POST /api/whatsapp/send` | qualquer perfil do Radar |
| bot | `POST /api/whatsapp/disconnect` | treinador, master |
| bot | `GET /api/whatsapp/screenshot` | master |
| bot | Socket.IO (handshake `auth.token`) | treinador, master. O status emitido traz o QR Code e o número conectado |
| API (5001) | `POST /api/usuarios` | treinador, master. Só master cadastra master |
| API | `POST /api/usuarios/:uid/redefinir-senha` | treinador, master. Só master altera master |
| API | `DELETE /api/usuarios/:uid` | treinador, master. Só master exclui master |
| API | `POST /api/ia/resumir` | qualquer perfil do Radar |

As rotas antigas `POST /api/whatsapp/users/:uid/reset-password` e `DELETE /api/whatsapp/users/:uid` deixaram de existir no bot e passaram para `/api/usuarios`. As demais rotas da API já validavam o token nos próprios controllers.

## Cadastro de usuários

Antes, o navegador criava a conta com `createUserWithEmailAndPassword`, e isso obrigava o cadastro público do Firebase Auth a ficar aberto. Com a chave pública do app, qualquer pessoa podia criar uma conta e, pela regra antiga, gravar o próprio `usuarios/{uid}` com `role: "master"`.

Agora a conta é criada pela API, com o Firebase Admin (`GerenciarUsuarios`). O cadastro nasce com `needsPasswordChange: true`, e a conta é desfeita se a gravação do cadastro falhar.

## Regras do Firestore

- `../firestore.rules`: aberto, **só para o emulador**. Nunca publique.
- `../firestore.rules.producao`: cópia de referência das regras de produção, publicada manualmente no console (Firestore > Regras). Ao alterar as regras, atualize este arquivo e publique o mesmo conteúdo no console.

Teste das regras de produção no emulador (precisa de Java 11+). Em `app/`:

```
npm run test:regras-firestore
```

## Publicação

1. Publicar o backend: os dois containers, `radar-api` e `esteira-bot`.
2. Publicar o frontend logo em seguida. Até isso acontecer, o frontend antigo:
   - não manda token ao bot, então os envios de WhatsApp falham com 401;
   - chama as rotas antigas de usuário, que respondem 404.
3. Conferir que a criação de usuário pela tela de Usuários funciona.
4. Só então, no console do Firebase, em Authentication > Configurações > Ações do usuário, desmarcar **"Ativar criação (inscrição)"**.
5. Publicar `firestore.rules.producao` no console. Antes, garantir que todo usuário legítimo tenha cadastro em `usuarios`: contas sem cadastro deixam de ler os dados.
