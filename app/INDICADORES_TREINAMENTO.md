# Comparação de indicadores de treinamento

Os treinamentos usam as **ocorrências do tipo Treinamento**, uma vez por ID, e o mesmo critério do filtro **Treinamento (Rea.)** do Histórico: qualquer registro sem tema Ausente ou Cancelado, inclusive sem tema. A data é `createdAt`, com fallback para `dataOcorrencia`, como no Histórico; registros sem data válida não são posicionados artificialmente no dia atual. Solicitação e próximo agendamento não mudam a data de realização.

Clientes de todos os status são considerados, incluindo suspensos e cancelados. Apenas clientes atualmente marcados como ongoing são excluídos dos treinamentos, pelo nome da empresa **na ocorrência**, normalizado sem acentos e sem diferença entre maiúsculas e minúsculas. O nome divergente em um lançamento não altera essa exclusão. Ocorrências sem cadastro atual continuam contabilizadas. O tempo médio de espera inclui suspensos e cancelados com cadastro e solicitação válida, até a realização registrada na ocorrência. Os indicadores de atendimento e de suspensão/cancelamento mantêm suas regras próprias.

Lançamentos da gamificação complementam CSAT e solicitação ausentes na ocorrência, somente por vínculo explícito (`gamificacaoPontoId` ou `ocorrenciaId`). Não geram treinamentos adicionais. Isso evita duplicar os registros antigos de junho, que possuem ocorrências e lançamentos sem vínculo. Não há casamento automático por empresa/data, pois podem existir sessões distintas no mesmo dia. Campos explicitamente vazios na ocorrência prevalecem sobre o lançamento. Dados persistidos e pontos da gamificação não são alterados.

O filtro e os detalhamentos incluem treinadores ativos e autores históricos das ocorrências e lançamentos, mesmo após mudança de perfil ou inativação. **Natália Teixeira** permanece disponível após sua mudança para CS; o primeiro nome é resolvido quando existe um único candidato. A autoria do treinamento é a da ocorrência, sem transferi-la ao responsável atual pelo cliente. Ausência de autor aparece como **Não informado**. Nenhuma dessas regras exige novas consultas ao Firebase.

Em **Relatórios → Indicadores de Treinamento**, marque **Comparar períodos** abaixo dos cartões de indicadores. O período anterior já vem selecionado. Adicione quantos meses, semanas ou intervalos anteriores precisar; use o botão de remover em cada período selecionado para excluí-lo da comparação.

- **Mês atual:** compara com meses completos escolhidos pelo usuário, incluindo outros anos.
- **Semana atual:** compara com semanas completas, de segunda a domingo. Selecione qualquer dia da semana desejada.
- **Personalizado:** escolha a data inicial da comparação; a data final é calculada com a mesma quantidade de dias corridos do intervalo principal, contando as duas extremidades.

O período principal mantém as datas do filtro (até hoje nos atalhos de mês e semana atuais). Portanto, um período atual parcial pode ser comparado com um período anterior completo. As datas efetivamente utilizadas ficam visíveis em cada resultado. Só são aceitos períodos que terminem antes do início do principal, sem duplicações.

O comparativo agrupa a configuração dos períodos no topo. O resultado principal fica em destaque ao lado dos períodos anteriores, com barras proporcionais, valores e variações na mesma linha. **Detalhamento por treinador** expande a tabela. Todas as visualizações usam o indicador selecionado e o filtro de treinador. A evolução diária/semanal original permanece abaixo. As comparações usam os dados já carregados, sem consultas adicionais ao Firebase. Alterar o modo ou as datas principais reinicia a seleção de comparações.

Treinamentos, avaliações e espera incluem registros em fins de semana; a evolução diária mostra sábado e domingo nesses indicadores. Os indicadores de atendimento e de status de clientes mantêm somente dias úteis. A variação é `(principal - comparação) / comparação × 100`; para CSAT, exibe a diferença em pontos percentuais. Base anterior zero não gera percentual quando o principal é diferente de zero; falta de amostra mantém `—` e informa que não há dados para comparar. A linha da equipe recalcula o indicador sobre os eventos, sem somar médias ou taxas individuais.

Regressões das datas e variações: `node --test app/tests/comparativoTreinamento.test.mjs` a partir da raiz, com Node que suporte os imports TypeScript usados pelos testes existentes.

Regressões dos status dos clientes e dos treinadores históricos: `node --experimental-vm-modules --test app/tests/indicadoresTreinamento.test.mjs`.
