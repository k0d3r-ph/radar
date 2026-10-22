# Gamificação dos treinadores

A página apresenta o desempenho pessoal, um pódio responsivo e o ranking completo. Selecionar um treinador no pódio ou no ranking abre sua composição de pontos no próprio painel. O botão **Ver atividades deste treinador** filtra o histórico e leva o foco até ele; os links das ocorrências continuam disponíveis na tabela.

## Períodos e filtros

- **Período do ranking** controla o pódio, o resumo pessoal, a composição e as atividades. **Todo o período** remove apenas as datas.
- **Treinador** e **Motivo**, na seção de atividades, filtram somente o histórico. **Limpar filtros do histórico** preserva o período do ranking.
- O modal **Indicadores** mantém seu próprio período e suas permissões existentes.

## Apuração preservada

A base soma os lançamentos, inclusive descontos. O bônus é aplicado à base: taxa de resposta ao CSAT de pelo menos 70%, 80% ou 90% corresponde a 10%, 20% ou 30%, respectivamente. Uma base negativa também recebe o percentual, conforme a regra existente; o painel mostra o efeito em pontos.

A taxa de resposta conta treinamentos realizados com pelo menos uma resposta Bom/Ruim ou nota antiga. Cada treinamento conta uma vez, independentemente do número de participantes. Cancelado e Ausente ficam fora dessa taxa. Taxa de resposta e satisfação positiva são conceitos diferentes.

A classificação continua ordenada por pontos, taxa de resposta, menos falhas comprovadas e nome. Participantes com os mesmos três primeiros critérios recebem indicação de empate; a ordem alfabética existente é mantida. O pódio mostra até três participantes com pontuação positiva. Sem pontuação positiva, apresenta um estado vazio. Pessoas sem lançamentos aparecem com posição “—”; o resumo mantém pontos zero.

## Interface e operação

No celular, o pódio usa cartões empilhados. As animações de entrada e atualização são breves e respeitam `prefers-reduced-motion`. Um erro no carregamento apresenta uma ação para tentar novamente.

A mudança utiliza os dados já carregados pela página, sem novas coleções, dependências ou chamadas de infraestrutura. Basta publicar o frontend. As permissões para lançamentos, metas e distribuição de clientes permanecem as existentes.

## Remoção de pontos excedentes de treinamento

Masters podem usar a lixeira **Remover ponto excedente** nas atividades de treinamento sem vínculo oficial com uma ocorrência. A confirmação remove somente o lançamento e ajusta o ranking; preserva o treinamento e o CSAT. Um `ocorrenciaId` no próprio ponto não prova vínculo: a referência oficial é `gamificacaoPontoId` da ocorrência ou reserva.

Requer publicar frontend e API. `DELETE /api/gamificacao/pontos/:id/excedente` valida o token e o perfil do cadastro e verifica, dentro de uma transação, se alguma ocorrência ou reserva CSAT usa o ponto. Havendo vínculo, retorna 409 e preserva os dados. A ação é restrita a lançamentos de treinamento e repetir uma exclusão concluída é seguro. As regras de produção do Firestore continuam administradas no console; esta rota não depende de permissões de exclusão do SDK cliente.

Essa ação permite limpar excedentes existentes; não altera o fluxo de conclusão das reservas que originou a duplicação.

Validação do backend: em `server/`, `npm run build` e `node --test tests/pontoTreinamentoExcedente.test.mjs`.

## Validação do frontend

Em `app/`:

```sh
node --experimental-strip-types --test tests/rankingGamificacao.test.mjs
npm run build
npx --no-install tsc -b
npm run lint
```

Os testes de regressão cobrem os limites de bônus, CSAT antigo, cancelamentos, descontos, bases negativas, empates e isolamento dos lançamentos por treinador. Para inspeção visual, utilizar dados de teste e conferir os temas claro/escuro, teclado, movimento reduzido e larguras menores.
