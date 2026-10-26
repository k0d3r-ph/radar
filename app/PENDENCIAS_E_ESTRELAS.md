Para usar o novo semáforo, um master deve cadastrar os tipos de pendência na seção **Tabulações**, no card **Tipos de Pendência**. A lista começa vazia para que a equipe defina suas próprias opções.

Com progresso de 100%, o farol fica vermelho quando o TME atinge **20 dias ou mais**, enquanto o follow-up final não estiver registrado. O follow-up final registrado mantém o verde; pendência ativa tem prioridade e mantém o laranja.

Na Home, abra o cadastro do cliente, marque **Cliente possui pendências**, selecione um tipo e salve. A data de vencimento é opcional e inclusiva: o laranja permanece até o fim daquele dia no horário de Brasília. Sem data, permanece até desmarcar. Ao vencer, a Home e os Relatórios recalculam o semáforo pela regra anterior, inclusive com a tela aberta. Passe o mouse no laranja para ver a categoria. Renomear uma tabulação mantém os vínculos existentes; excluir uma tabulação não apaga a pendência já registrada no cliente.

Checkpoint deixa de ser uma opção para novos registros. Ocorrências antigas continuam preservadas, mas não ativam mais o laranja. Pendências alteram o semáforo; não congelam a contagem de dias na esteira.

No Histórico, abra uma ocorrência já registrada e clique na estrela no cabeçalho do modal. Apenas treinadores e masters podem marcar e desmarcar; os outros perfis podem visualizar a estrela e usar o filtro **Somente com estrela**. O limite é de **três ocorrências por cliente**, compartilhado entre todos os usuários. Desmarcar ou excluir libera uma vaga. Para transferir uma ocorrência com estrela para outro cliente, remova a estrela primeiro; renomear o próprio cadastro do cliente mantém suas estrelas.

A alteração de estrelas usa o endpoint autenticado `PATCH /api/ocorrencias/:id/favorito` na API do Radar, configurada em `VITE_RADAR_API_URL` (porta 5001 no desenvolvimento), separada do bot do WhatsApp. O backend valida o token do Firebase, o perfil cadastrado e o limite em uma transação. Portanto, publique **frontend e backend** para ativar esse recurso. O controle transacional fica na coleção `favoritosOcorrencias`, com um documento por cliente.

Validação: `npm run test:favoritos` em `server/` e `node --test app/tests/pendenciasFarol.test.mjs` a partir da raiz do projeto.
