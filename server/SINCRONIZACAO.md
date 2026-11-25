# Sincronização das listas

As listas de ocorrências, empresas, pontos, tarefas do checklist e tentativas de validação do conhecimento não são relidas inteiras a cada abertura de tela. O navegador busca só o que mudou desde a última vez.

Desde a migração para o PostgreSQL ([MIGRACAO_POSTGRES.md](MIGRACAO_POSTGRES.md)), o mecanismo é este:

1. **Índice no backend.** `IndiceSincronizacao` (`src/infrastructure/postgres/`) mantém em memória, por processo, os documentos e versões dessas cinco coleções. Cada consulta lê no banco só as linhas e exclusões gravadas desde a anterior. Ela usa a coluna `transacao` e o `xmin` do snapshot, então gravações confirmadas fora de ordem não se perdem. Chamadas dentro de 1 segundo reutilizam a memória, e chamadas simultâneas compartilham a mesma consulta. As [tarefas automáticas](VALIDACAO_CONHECIMENTO.md) usam o mesmo índice.
2. **`GET /api/sincronizacao/:colecao`** devolve só ids e versões. A versão é um número que muda a cada gravação.
3. **`POST /api/sincronizacao/:colecao/documentos`** devolve o conteúdo direto da memória do índice. O corpo opcional `{ "ids": [...] }` filtra o retorno; sem `ids`, vem a coleção inteira.
4. **No navegador**, `sincronizarColecao` (`app/src/services/sincronizacaoIncremental.ts`):
   - compara o índice com as versões guardadas em `localStorage`;
   - pede só os documentos novos ou alterados, em lotes de até 500 ids;
   - mantém uma cópia local em IndexedDB (`app/src/services/cacheDocumentos.ts`), separada por usuário e coleção, que substituiu o cache persistente do SDK do Firestore;
   - descarta documentos que não estão mais no índice, mesmo sem nenhuma alteração.

   Na primeira carga, ou quando a cópia local se perdeu, faz uma única requisição com a coleção inteira. `obterColecaoCompleta` (usada pelo painel ao vivo) busca a coleção inteira sem cópia local.

## Acesso

As duas rotas exigem:
- token Firebase válido;
- usuário cadastrado, **ativo**, com perfil do Radar e senha já definida.

Os índices de pontos (`gamificacao_pontos`) e de tentativas de validação (`validacao_tentativas`) são restritos a master e treinador. As tentativas trazem as perguntas e respostas de cada cliente, não só um indicador agregado.

O cadastro usado nessa validação fica em memória por 60 segundos, então uma revogação pode levar até esse prazo para valer aqui. Na API de dados (`/api/dados`), ela vale na hora.

## Comportamento

- O cache em memória dos serviços do frontend dura cinco minutos. Uma atualização forçada consulta o índice de novo e busca só o que mudou.
- Falhas do índice ou dos documentos aparecem como erro. Não há recarga completa automática, e as versões anteriores são mantidas para a próxima tentativa.
- Reinícios do backend fazem uma nova leitura inicial de cada coleção no banco, sem impacto para os navegadores.
- O sincronizador do SSX Desk relê a coleção `usuarios` no máximo uma vez por hora, não a cada ciclo de 5 minutos.
- Com o PostgreSQL não há cobrança por leitura. O custo que importa é o tamanho das respostas: a primeira carga de uma coleção grande trafega a coleção inteira.

## Validação

- Em `app/`: `npm run test:sincronizacao` (sincronização e cliente da API de dados).
- Em `server/`: `npm run test:postgres` (índice, rotas, permissões e integração com o PostgreSQL real).
- Os testes do app importam `.ts` diretamente: use Node 22.18 ou mais novo, ou acrescente `--experimental-strip-types`.
