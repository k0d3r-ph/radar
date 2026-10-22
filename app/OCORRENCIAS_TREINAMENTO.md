# Treinamento para clientes suspensos

O Histórico impede criar ocorrências do tipo **Treinamento** para clientes com `isSuspended`. A opção fica indisponível no formulário, com uma mensagem explicativa. Os demais tipos mantêm as opções e permissões existentes. Marcar retorno à esteira no próprio treinamento não contorna o bloqueio: primeiro registre o retorno por outro tipo de ocorrência ou pelo cadastro do cliente.

O bloqueio também se aplica a converter outro tipo em Treinamento e transferir um treinamento para outro cliente suspenso. Treinamentos anteriores continuam visíveis no Histórico e nos relatórios; editar seu texto, seus dados ou comentários no mesmo cliente continua permitido.

Antes dos efeitos de um novo registro, o formulário faz uma leitura pontual atualizada do cadastro. O serviço de ocorrências confere novamente a suspensão na transação de criação, conversão ou transferência. O formulário fornece o ID do cliente; chamadas antigas sem ID usam uma consulta pelo nome exato limitada a dois resultados, rejeitando ausência ou ambiguidade. Outros tipos e edições do treinamento original não precisam dessa leitura adicional. O cálculo de score grava apenas seus próprios campos, preservando uma suspensão feita em outra sessão. Se houver um bloqueio por suspensão após criar um novo lançamento de pontos, o fluxo tenta desfazê-lo e informa qualquer falha na interface.

Reservas CSAT também respeitam a suspensão no frontend e na API. Reservas pendentes ficam preservadas e pausadas durante a suspensão, sem bloquear o trabalho com outros clientes. Após o retorno, podem ser concluídas. Respostas públicas a treinamentos já concluídos continuam disponíveis. Ver `server/CSAT.md`; o backend precisa ser atualizado junto com o frontend para aplicar a regra no CSAT.

A alteração não exclui nem migra registros antigos, não altera os cálculos dos relatórios e não interrompe ocorrências de suporte importadas pelo SSX Desk. Não há gravações em produção necessárias para habilitá-la.

Validação na raiz:

```powershell
node --experimental-vm-modules --test app/tests/registroTreinamentoSuspenso.test.mjs app/tests/ocorrenciaMotivoEspera.test.mjs app/tests/ocorrenciasExclusao.test.mjs app/tests/edicaoAtualizacao.test.mjs
```

Em `server/`: `npm run build`, seguido de `node --test tests/csat.test.mjs`. Os testes usam mocks e não enviam mensagens nem gravam em serviços reais.
