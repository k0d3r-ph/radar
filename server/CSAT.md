# CSAT direto no Radar

Na Home, abra o cadastro do cliente e clique em **Ver ocorrências**. Treinadores e masters podem gerar um link de CSAT, copiar o endereço e clicar no ID reservado para preencher o treinamento. IDs CSAT têm uma sequência própria permanente (`CSAT-000001`), independente da numeração calculada das ocorrências antigas. A reserva fica fora dos relatórios e só é listada para seu criador; ao concluir, a ocorrência passa ao histórico normal.

Cada participante informa nome, Bom/Ruim e opinião opcional de até 100 caracteres. O link aceita vários participantes; reenvios do mesmo navegador são idempotentes. As respostas atualizam `treinamentoResultados` e `csatRespostas` na ocorrência, inclusive depois da conclusão. Não há envio automático do link pelo WhatsApp.

## Publicação

Atualize o frontend **e** o backend. O endereço público `/csat/:token` precisa usar o mesmo fallback para `index.html` das outras rotas React. `VITE_WHATSAPP_API_URL` deve apontar para a API HTTPS acessível aos clientes, e o domínio do frontend precisa estar autorizado em `CORS_ORIGIN`.

As coleções `csatReservas`, `csatLinks` e `csatControle` são acessadas exclusivamente pelo Firebase Admin no backend. Nas regras Firestore publicadas, negue acesso de clientes a essas coleções e subcoleções. Exemplo para incorporar às regras existentes:

```text
match /csatReservas/{document=**} { allow read, write: if false; }
match /csatLinks/{document=**} { allow read, write: if false; }
match /csatControle/{document=**} { allow read, write: if false; }
```

Regras permissivas com `match /{document=**}` também precisam excluir essas coleções: permissões Firestore são combinadas por OR, então um deny específico não anula um allow abrangente. As regras do projeto não estão neste repositório e precisam ser conferidas no Firebase antes da publicação para garantir a privacidade das reservas e dos tokens.

Validação: `node node_modules/typescript/bin/tsc` seguido de `node --test tests/csat.test.mjs` no diretório `server`.
