# Operação da validação do conhecimento

Regras funcionais e componentes: [documentação do módulo](../app/VALIDACAO_CONHECIMENTO.md).

## Publicação

1. Confirme as regras Firestore descritas abaixo antes de disponibilizar a tela.
2. Publique o backend da API (processo `start:api`, separado do bot). As tarefas automáticas começam no processo da API; o bot não as executa.
3. Publique o frontend com `VITE_RADAR_API_URL` apontando para a API atualizada. O fallback público `/csat/:token` permanece necessário.

O banco inicial é criado de forma idempotente no primeiro acesso autenticado ao módulo. Não exige migração de empresas nem execução manual de seed em produção. Os templates são definições do frontend; esteiras já salvas não são reescritas.

## Dados e autorização

Coleções novas: `validacao_perguntas`, `validacao_tentativas`, `validacao_clientes` (trava por cliente) e `validacao_controle` (versão do banco e controle de descartes). Somente a API acessa essas coleções; o SDK do navegador nunca lê `validacao_tentativas` diretamente do Firestore. As rotas autenticam token Firebase revogado, usuário ativo, senha definida e perfil Master/treinador. Cadastro no banco exige Master; alterar/concluir tentativa exige seu criador ou Master. CSAT público continua limitado ao token e respostas, sem expor banco, tentativa ou dados administrativos.

`validacao_tentativas` também está em `COLECOES_SINCRONIZADAS` (ver `server/SINCRONIZACAO.md`), com o mesmo recorte de acesso Master/treinador — usada pelo card "Validação do Conhecimento" do painel ao vivo (`RelatorioIndicadoresTreinamento.tsx`). Isso devolve o documento completo de cada tentativa (inclusive `csatToken` e as respostas) a qualquer Master/treinador autenticado, igual ao que `GET /api/validacao/tentativas?empresaId=` já devolve hoje por empresa — não é uma exposição nova, só deixa de ser por empresa.

`POST /api/validacao/tentativas/:id/cancelar` recebe a `revisao` atual e exige o criador ou Master. Descarta formulários em andamento ou pausados: exclui o documento de `validacao_tentativas` e libera a trava do cliente na mesma transação. Retorna `{ id }`. Guarda apenas `treinadorId`, `canceladaPorId` e `canceladaEm` em `validacao_controle/descarte-{id}`, sem perguntas, respostas nem número de tentativa, para autorizar reenvios idempotentes sem alterar travas posteriores. A próxima geração usa o número da última avaliação concluída + 1 (ou 1 se não houver), reutilizando o número descartado. Canceladas legadas são filtradas na listagem e ignoradas na seleção e numeração, sem migração nem reescrita de avaliações concluídas. Atualize API e frontend juntos, pois a resposta do cancelamento mudou.

Nas regras de produção, incorpore aos bloqueios administrativos existentes:

```text
match /validacao_perguntas/{document=**} { allow read, write: if false; }
match /validacao_tentativas/{document=**} { allow read, write: if false; }
match /validacao_clientes/{document=**} { allow read, write: if false; }
match /validacao_controle/{document=**} { allow read, write: if false; }
```

Como no CSAT, remova essas coleções de qualquer `allow` abrangente: permissões são combinadas por OR, e um deny específico não anula um allow global. Não publique `firestore.rules` do repositório: ele é aberto deliberadamente para o emulador e não representa as regras de produção.

Nas permissões de escrita de ocorrências, restrinja também a criação/alteração de registros que contenham `validacaoTentativaId` à API, preservando a leitura para perfis autorizados. Isso impede modificar respostas históricas indiretamente pelo SDK. A API Admin continuará podendo registrar notificações e respostas do CSAT. A interface bloqueia a edição genérica, mas o controle definitivo é a regra de escrita publicada. A exclusão de ocorrências deve seguir a política existente; uma tentativa concluída nunca deve ser reaberta nem recriada por ausência da ocorrência.

A cópia de referência das regras de produção fica em `firestore.rules.producao` (ver [AUTENTICACAO.md](AUTENTICACAO.md)), com esses bloqueios já incorporados; a publicação é feita manualmente no console.

## Tarefas automáticas

A verificação reutiliza o mesmo `IndiceSincronizacao` das rotas de sincronização: não há consultas completas recorrentes de empresas/ocorrências/tarefas. Um listener inicial por coleção mantém o cache; novos candidatos são conferidos em transação com leituras pontuais do cliente, da tarefa e das ocorrências daquele cliente. Usuários são consultados uma vez por hora. IDs determinísticos permitem mais de um processo da API sem duplicar tarefas. Falhas são registradas e uma nova tentativa acontece em um minuto. Encerrar o servidor HTTP cancela o timer e os listeners.

Tarefas são persistidas em `checklist_tarefas`, com `empresaId`, `empresa`, `automatica`, `origemAutomatica`, `baseAutomatica`, `pausada`, `historicoAutomatico` e timestamps. Campos são opcionais para manter tarefas manuais compatíveis. Conclusão manual é preservada; a mesma situação não recria uma tarefa já encerrada. Mudança de responsável atualiza a atribuição enquanto ela está aberta. `empresa.responsavel` é associado por `encontrarResponsavel` (domínio): nome completo idêntico ou primeiro nome único entre Master/treinadores ativos, sem diferenciar acentos. Homônimos não recebem tarefa e geram um `console.warn` por vínculo, sem repetir a cada minuto.

`DELETE /api/checklist/tarefas/:id/concluida` exige usuário ativo com token válido e tarefa concluída na leitura transacional. Usuários podem excluir suas próprias tarefas; Master pode excluir as da equipe. Grava `excluida`, `excluidaEm`, `excluidaPorId` e `updatedAt`, preservando o documento e a conclusão. A lista do frontend filtra o marcador, inclusive após recarregar. Reenvios são idempotentes. O gerador ignora tarefas excluídas, conservando o bloqueio do ciclo já atendido. A exclusão de tarefas manuais ainda pendentes mantém o fluxo existente. Publique a API antes do frontend; não há migração nem nova coleção.

Teste de serviço do frontend, em `app/`: `node --experimental-vm-modules --test tests/checklistExclusao.test.mjs`.

## Desenvolvimento e testes

Use o [emulador local](EMULADOR.md) para validação manual com Firestore/Auth isolados. Não suba `dev:api` apenas para compilar: ele inicia as tarefas e pode iniciar a sincronização SSX conforme a configuração do ambiente.

Em `server/`:

```powershell
npm run test:validacao
node --test tests/sincronizacao.test.mjs
```

Na raiz:

```powershell
node --test app/tests/pendenciasFarol.test.mjs app/tests/statusEsteiraCliente.test.mjs app/tests/reordenarTemasEnsinados.test.mjs
```

Os testes usam Firestore em memória com transações serializadas, rollback e verificação de leituras anteriores às escritas. Cobrem distribuição, banco idempotente, 80% inclusive, tentativas concorrentes, revisão, pausa/retomada, reprovação sem avanço, CSAT idempotente, permissões e tarefas por ciclo. Builds: `npm run build` em cada pacote. Para cores, `npm run tema:claro` em `app/`.

O campo **Quem solicitou** usa as mesmas opções das ocorrências de Treinamento (`SOLICITANTES_TREINAMENTO`: CS, Cliente, Suporte, Comercial, Hardware e Aplicações). Novas tentativas começam com CS. O rascunho aceita o campo vazio; valores fora da lista são rejeitados ao salvar, e a conclusão exige uma das opções.

## Banco de perguntas, indicadores e CSAT

- `POST /api/validacao/perguntas/:id/atualizar` (Master): aceita `texto`, `preferida` e `ativa`. Mantém ID e seção, recusa texto duplicado na seção e invalida o cache do banco. Perguntas novas cujo hash coincida com o ID de uma pergunta editada recebem um sufixo aleatório.
- `GET /api/validacao/indicadores?inicio=YYYY-MM-DD&fim=YYYY-MM-DD` (Master/treinador): período inclusivo em Brasília, até um ano. Consulta só as tentativas com `concluidaEm` no intervalo (filtro de intervalo em um único campo, sem índice composto) e guarda o resultado por 5 minutos por período.
- A ocorrência de cada tentativa não grava mais `csatLinkPath`: o token fica só em `validacao_tentativas`, que é acessível apenas pela API. Ocorrências já gravadas com o campo continuam válidas.
- Se o treinador tiver uma reserva CSAT comum pendente, a conclusão responde 409 com orientação específica para registrar essa ocorrência no Histórico antes de concluir a validação.
