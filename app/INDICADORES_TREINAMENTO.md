# Comparação de indicadores de treinamento

Em **Relatórios → Indicadores de Treinamento**, marque **Comparar períodos** abaixo dos cartões de indicadores. O período anterior já vem selecionado. Adicione quantos meses, semanas ou intervalos anteriores precisar; use o botão de remover em cada período selecionado para excluí-lo da comparação.

- **Mês atual:** compara com meses completos escolhidos pelo usuário, incluindo outros anos.
- **Semana atual:** compara com semanas completas, de segunda a domingo. Selecione qualquer dia da semana desejada.
- **Personalizado:** escolha a data inicial da comparação; a data final é calculada com a mesma quantidade de dias corridos do intervalo principal, contando as duas extremidades.

O período principal mantém as datas do filtro (até hoje nos atalhos de mês e semana atuais). Portanto, um período atual parcial pode ser comparado com um período anterior completo. As datas efetivamente utilizadas ficam visíveis em cada resultado. Só são aceitos períodos que terminem antes do início do principal, sem duplicações.

O comparativo agrupa a configuração dos períodos no topo. O resultado principal fica em destaque ao lado dos períodos anteriores, com barras proporcionais, valores e variações na mesma linha. **Detalhamento por treinador** expande a tabela. Todas as visualizações usam o indicador selecionado e o filtro de treinador. A evolução diária/semanal original permanece abaixo. As comparações usam os dados já carregados, sem consultas adicionais ao Firebase. Alterar o modo ou as datas principais reinicia a seleção de comparações.

As regras de cálculo dos indicadores são preservadas, incluindo a exclusão dos fins de semana. A variação é `(principal - comparação) / comparação × 100`; para CSAT, exibe a diferença em pontos percentuais. Base anterior zero não gera percentual quando o principal é diferente de zero; falta de amostra mantém `—` e informa que não há dados para comparar. A linha da equipe recalcula o indicador sobre os eventos, sem somar médias ou taxas individuais.

Regressões das datas e variações: `node --test app/tests/comparativoTreinamento.test.mjs` a partir da raiz, com Node que suporte os imports TypeScript usados pelos testes existentes.
