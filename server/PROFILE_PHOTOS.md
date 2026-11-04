# Fotos de perfil

As fotos são armazenadas no disco da VM pela API, sem Firebase Storage. O cliente envia o token do Firebase; a API valida a sessão, permite leitura a usuários autenticados e restringe envio e remoção à própria conta. São aceitas imagens JPEG, PNG ou WebP de até 2 MB.

Configure `PROFILE_PHOTOS_DIR` para o caminho montado em um volume persistente do container. Exemplo:

```env
PROFILE_PHOTOS_DIR=/app/data/profile-photos
```

Monte um volume persistente nesse caminho ao iniciar o container da API e inclua o volume na rotina de backup da VM. Sem a variável, o padrão local é `server/data/profile-photos/`, ignorado pelo Git.

Rotas autenticadas:

- `GET /api/profile-photos`: lista os UIDs com foto.
- `GET /api/profile-photos/:uid`: retorna a imagem.
- `PUT /api/profile-photos/:uid`: recebe o arquivo no corpo, com `Content-Type` de imagem; o UID deve ser o da sessão.
- `DELETE /api/profile-photos/:uid`: remove a foto do próprio usuário.

Ao publicar, reinicie a API e depois publique a nova build do frontend. A API precisa permitir `PUT` no CORS, além dos métodos já usados.

Validação: `npm run test:profile-photos` em `server/`.
