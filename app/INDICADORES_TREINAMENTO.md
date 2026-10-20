# Comparação de indicadores de treinamento

Os treinamentos usam as **ocorrências do tipo Treinamento**, uma vez por ID, e o mesmo critério do filtro **Treinamento (Rea.)** do Histórico: qualquer registro sem tema Ausente ou Cancelado, inclusive sem tema. A data é `createdAt`, com fallback para `dataOcorrencia`, como no Histórico; registros sem data válida não são posicionados artificialmente no dia atual. Solicitação e próximo agendamento não mudam a data de realização.

Clientes de todos os status são considerados, incluindo suspensos e cancelados. Apenas clientes atualmente marcados como ongoing são excluídos dos treinamentos, pelo nome da empresa **na ocorrência**, normalizado sem acentos e sem diferença entre maiúsculas e minúsculas. O nome divergente em um lançamento não altera essa exclusão. Ocorrências sem cadastro atual continuam contabilizadas. O tempo médio de espera inclui suspensos e cancelados com cadastro e solicitação válida, até a realização registrada na ocorrência. Os indicadores de atendimento e de suspensão/cancelamento mantêm suas regras próprias.

Lançamentos da gamificação complementam CSAT e solicitação ausentes na ocorrência, somente por vínculo explícito (`gamificacaoPontoId` ou `ocorrenciaId`). Não geram treinamentos adicionais. Isso evita duplicar os registros antigos de junho, que possuem ocorrências e lançamentos sem vínculo. Não há casamento automático por empresa/data, pois podem existir sessões distintas no mesmo dia. Campos explicitamente vazios na ocorrência prevalecem sobre o lançamento. Dados persistidos e pontos da gamificação não são alterados.

O filtro e os detalhamentos incluem treinadores ativos e autores históricos das ocorrências e lançamentos, mesmo após mudança de perfil ou inativação. **Natália Teixeira** permanece disponível após sua mudança para CS; o primeiro nome é resolvido quando existe um único candidato. A autoria do treinamento é a da ocorrência, sem transferi-la ao responsável atual pelo cliente. Ausência de autor aparece como **Não informado**. Nenhuma dessas regras exige novas consultas ao Firebase.

Variações históricas confirmadas são padronizadas no filtro e nos cálculos: **Jeff Borges da Costa** e **Jeff Costa** aparecem juntos como **Jeff Costa**, inclusive nos indicadores de atendimento e status de clientes. Essa equivalência não altera os dados persistidos nem une pessoas apenas por terem o mesmo primeiro nome.

Em **Relatórios → Indicadores de Treinamento**, marque **Comparar períodos** abaixo dos cartões de indicadores. O período anterior já vem selecionado. Adicione quantos meses, semanas ou intervalos anteriores precisar; use o botão de remover em cada período selecionado para excluí-lo da comparação.

- **Mês atual:** compara com meses completos escolhidos pelo usuário, incluindo outros anos.
- **Semana atual:** compara com semanas completas (somente os dias úteis entram no cálculo). Selecione qualquer dia da semana desejada.
- **Personalizado:** escolha a data inicial da comparação; a data final é calculada com a mesma quantidade de dias corridos do intervalo principal, contando as duas extremidades.

O período principal mantém as datas do filtro (até hoje nos atalhos de mês e semana atuais). Portanto, um período atual parcial pode ser comparado com um período anterior completo. As datas efetivamente utilizadas ficam visíveis em cada resultado. Só são aceitos períodos que terminem antes do início do principal, sem duplicações.

O comparativo agrupa a configuração dos períodos no topo. O resultado principal fica em destaque ao lado dos períodos anteriores, com barras proporcionais, valores e variações na mesma linha. **Detalhamento por treinador** expande a tabela. Todas as visualizações usam o indicador selecionado e o filtro de treinador. A evolução diária/semanal original permanece abaixo. As comparações usam os dados já carregados, sem consultas adicionais ao Firebase. Alterar o modo ou as datas principais reinicia a seleção de comparações.

Ao ativar **Comparar períodos**, o gráfico também desenha uma linha com cor distinta para cada período selecionado. Remover ou desativar comparações atualiza as linhas. O eixo horizontal usa a posição no período (**Dia 1**, **Dia 2**, ou **Semana 1**, etc.), e o tooltip identifica as datas reais de cada série. Períodos com menos dias úteis e a parte futura do período atual ficam sem ponto, sem gerar zeros artificiais. Comparações diárias alinham os períodos pela posição do **dia útil** (Dia 1 é o primeiro dia útil de cada período). Semanas são limitadas às datas de cada período.

No indicador **Taxa CSAT**, a evolução é exibida em **colunas** (agrupadas por período quando há comparação, com as comparações em tom mais claro); os demais indicadores continuam em linhas. Tooltips, navegação por Tab e legendas são os mesmos nos dois formatos.

No gráfico de **Treinamentos realizados**, o tooltip apresenta também **Taxa CSAT** e **Tempo médio de espera**, calculados para o mesmo dia (ou semana), treinador e período da linha. A taxa CSAT sem amostra aparece como **0,0% no gráfico e no tooltip**, mantendo o traçado conectado; períodos/dias que não existem na comparação continuam sem ponto. Essa apresentação não modifica o cálculo agregado dos cartões e comparativos, que mantém `—` quando não há treinamentos. Para tempo de espera sem amostra, mantém `—`. As taxas e médias são recalculadas sobre os eventos do intervalo. O tooltip pode ser aberto com mouse, toque ou foco nos pontos por Tab; Escape fecha a consulta. Não são necessárias consultas adicionais ao Firestore.

### Motivo da espera longa

O tempo de espera considera somente **dias úteis, de segunda a sexta**, tanto no modal de confirmação quanto nos relatórios, tooltips e indicadores da Gamificação. O dia da solicitação não entra; o dia da realização entra se for de segunda a sexta. Segunda a quinta são 3 dias úteis, sexta a segunda é 1 e uma semana completa são 5. Feriados em dias de semana são contabilizados, pois esta regra usa somente o dia da semana.

Ao registrar ou editar uma ocorrência de treinamento realizado com **3 dias úteis ou mais** entre solicitação e realização, o Histórico solicita o motivo antes de qualquer gravação. As opções são **a pedido do cliente** e **disponibilidade da agenda do treinador**. Ausências e cancelamentos não pedem justificativa. Cancelar o modal mantém o formulário e não salva a ocorrência. Solicitação posterior à realização é rejeitada.

A escolha é salva no campo opcional `treinamentoMotivoEspera`, com os valores `cliente` ou `agenda_treinador`, e espelhada no lançamento da gamificação. `null` limpa uma classificação anterior, pois campos `undefined` são omitidos pelo serviço de persistência. Na edição, a escolha é preservada e pode ser corrigida no formulário; alterar solicitação ou data de criação/realização exige nova confirmação. Reduzir a espera para menos de 3 dias úteis ou mudar para ausência/cancelamento limpa o motivo. Conclusões de reservas CSAT preservam o campo e a API valida os valores permitidos.

O motivo aparece apenas nos detalhes e na edição da ocorrência, sem rótulo na listagem do Histórico. Em **Treinamentos realizados** e **Tempo médio de espera**, o relatório mostra **Contexto do tempo de espera**, com contagens por motivo e detalhamento de cliente, treinador, data e dias de espera, respeitando o período principal e o filtro de treinador. O tooltip também informa os motivos das esperas longas do ponto, sem categoria de espera sem motivo. **Todos os registros continuam na média geral**, inclusive os pedidos do cliente e os antigos ainda sem classificação. Para estes, a coluna de motivo mostra um travessão até serem classificados em uma edição; não há migração automática ou inferência de culpa. Escolher um dos dois motivos é obrigatório para salvar uma realização com espera longa; voltar ou fechar o modal cancela a gravação. A classificação não altera score, TME da esteira, pontos ou notificações.

**Todos os indicadores consideram somente dias úteis (segunda a sexta).** Treinamentos, ausências, cancelamentos, avaliações, esperas, atendimentos e status de clientes registrados em sábado ou domingo não entram nos cartões, no gráfico, nas comparações nem na tabela por treinador; os dados persistidos não são alterados. A evolução diária mostra apenas dias úteis e a semanal agrupa segunda a sexta. A duração da espera conta somente segunda a sexta. A variação é `(principal - comparação) / comparação × 100`; para CSAT, exibe a diferença em pontos percentuais. Base anterior zero não gera percentual quando o principal é diferente de zero; falta de amostra mantém `—` e informa que não há dados para comparar. A linha da equipe recalcula o indicador sobre os eventos, sem somar médias ou taxas individuais.

Regressões das datas e variações: `node --test app/tests/comparativoTreinamento.test.mjs` a partir da raiz, com Node que suporte os imports TypeScript usados pelos testes existentes.

Regressões dos status dos clientes e dos treinadores históricos: `node --experimental-vm-modules --test app/tests/indicadoresTreinamento.test.mjs`.

Regressões do gráfico e dos tooltips: `node --experimental-vm-modules --test app/tests/graficoIndicadoresTreinamento.test.mjs`.

Regressões da espera e da persistência: `node --experimental-vm-modules --test app/tests/esperaTreinamento.test.mjs app/tests/ocorrenciaMotivoEspera.test.mjs`.

A edição do texto de uma atualização no Histórico preserva a data e o autor originais da atualização (`atualizacoes[].updatedAt` e `responsavel`). O `updatedAt` do documento da ocorrência continua sendo atualizado pelo serviço para a sincronização incremental. Regressão: `node --test app/tests/edicaoAtualizacao.test.mjs`.
