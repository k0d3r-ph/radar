# Jornada do cliente

Em Relatórios > Jornada do cliente, os cartões filtram a carteira e a lista prioriza clientes fora do SLA, sem próximo passo e Safety. A busca aceita cliente ou treinador. O filtro Todos inclui jornadas concluídas e canceladas; ongoing permanece fora da jornada de capacitação.

A faixa cronológica e os conectores entre etapas usam verde para Fast (score efetivo ≥ 6), vermelho para Safety (< 6) e cinza quando não há score conhecido. A cor dos círculos identifica a etapa, independentemente da classificação. A última etapa em aberto tem um conector até Hoje, para mostrar também mudanças ocorridas depois do último agendamento. Em telas estreitas, a régua fica vertical com o texto ao lado das linhas.

Os quadrados e a lista de mudanças abrem o detalhe com score antes/depois, respostas alteradas do questionário, reduções ativas, seus vencimentos e links para as ocorrências. Mudanças causadas pelo vencimento de reduções também aparecem. O foco vai para o detalhe e há uma ação para retornar à etapa atual.

## Agendamento e treinamento

Uma ocorrência **Informativa** com data agendada gera a etapa **Agendamento realizado** na lista de clientes, na régua e no detalhe, com ícone de calendário. Seus temas aparecem como **Temas Agendados**. Ocorrências informativas sem data continuam fora da régua. Um registro de tipo **Treinamento** mantém a etapa **Em treinamento**, incluindo o tratamento de cancelamento e ausência.

O agendamento sozinho não conta como sessão concluída no diagnóstico. Quando há uma ocorrência de treinamento finalizadora, a sessão continua sendo contabilizada. Os períodos da jornada, SLA, checkpoints, suspensão e encerramento mantêm suas regras. A mudança requer apenas publicar o frontend, sem migração de dados.

## Regra de score e suporte

O score efetivo é o último cálculo menos as reduções temporárias vigentes. Uma dúvida com Suporte ou Treinamento reduz 1 ponto por 15 dias; o intervalo maior que 5 dias entre agendas mantém a regra já existente. Somente cruzar o limite de 6 pontos altera Fast/Safety. Ex.: score 6 com um desconto de 1 vira Safety 5 sem preencher outro questionário. Ao vencer o desconto, volta a Fast 6 se não houver outros descontos. O relatório reavalia os vencimentos a cada minuto enquanto permanece aberto, sem novas leituras do Firestore.

No Histórico, a aplicação manual do desconto lê a empresa atual em uma transação e deduplica pelo ID da ocorrência e motivo. Isso evita perder descontos concorrentes ou usar o score anterior a um questionário recém-salvo. Grava `updatedAt`, atualiza o cache local e registra uma ocorrência de Mudança de score ao cruzar de Fast para Safety. Essa ocorrência descritiva não é um novo cálculo de score. Falhas parciais na aplicação do desconto são avisadas na interface.

A importação SSX Desk já grava a redução em transação e atualiza `updatedAt`, tanto na criação quanto no preenchimento posterior de uma tag Dúvida. A Home e o relatório usam `obterTipoEfetivo`, portanto não dependem de um novo cálculo ou do campo `tipo` antigo para reconhecer uma redução importada. Problemas e solicitações não foram convertidos em descontos de score; suas regras de gamificação permanecem independentes.

## Histórico disponível

`historicoScore.ts` reconstrói o score pelos campos `scoreCalculado`/`scoreAnswers`, pelas descrições antigas de cálculo e pelos ajustes temporários do cadastro. Ajustes ainda não iniciados ou já vencidos não afetam a classificação atual. Para contatos importados com ajuste histórico ausente, a referência é a data do atendimento, em vez da data de importação.

Quando só existe score no cadastro, sua aplicação ao passado é uma **estimativa**. Reduções antigas já vencidas podem ser deduzidas das ocorrências e também são identificadas como estimadas. Não há reconstrução garantida de ajustes removidos manualmente, alterações antigas sem registro ou questionários não preservados. Reduções recentes ausentes no cadastro não são recriadas por inferência, respeitando remoções manuais. A visualização não grava nem migra dados históricos.

## Exemplos e validação

`npm run seed:jornada`, em `server/`, acrescenta 8 clientes e 95 ocorrências sintéticas ao emulador local, com prefixo `[Demo Jornada]`. Exemplos: Fast estável, queda por suporte, recuperação por vencimento, respostas do questionário, combinação de respostas e suporte, ausência de score, conclusão e suspensão. O comando usa IDs reservados e não limpa os demais dados ou usuários. Pode ser executado novamente para renovar as datas dos mesmos exemplos.

Testes isolados, a partir da raiz:

```powershell
node --experimental-vm-modules --test app/tests/historicoScore.test.mjs app/tests/reducaoScoreEmpresa.test.mjs
node --test app/tests/jornadaAgendamento.test.mjs
```

Cobrem mudanças por suporte e questionário, vencimentos, limites temporais, importação tardia, ausência de score, deduplicação e gravação transacional. Os mesmos fixtures alimentam os exemplos do emulador.
