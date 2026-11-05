# Card "Validação do Conhecimento" no painel Indicadores de Treinamento

> Status: **implementado e testado na branch `feature/indicadores-treinamento-validacao`**,
> ainda não mesclado em `main` nem publicado — falta o deploy do backend na VM.

## Contexto

No painel "Indicadores de Treinamento" (`/relatorios` → aba Indicadores, e a tela
dedicada `/indicadores-treinamento-tv`), o card "Treinamentos" foi substituído por
"Validação do Conhecimento":

- Meta oficial: **80%**.
- Por cliente, conta só a **tentativa concluída mais recente** — uma reprovação seguida
  de uma aprovação posterior passa a contar só como aprovado (a mais nova substitui a
  mais antiga para fins de resultado).
- Métrica sempre do **mês corrente** (mesmo padrão do "Gol no Prazo", que também passou a
  ter meta de 100% nesta mesma leva de mudanças).
- Abaixo do percentual aparece a fração absoluta, ex. "12/15" (aprovados / total de
  clientes avaliados no mês).

## Por que precisa de deploy na VM

O painel só usa dados que o backend já mantém sincronizados em memória (`ocorrencias`,
`empresas`, `gamificacao_pontos`, `checklist_tarefas`) — por isso atualiza sozinho "sem
consumir leituras do Firebase". As tentativas de validação do conhecimento não faziam
parte dessa lista. Para manter o mesmo princípio (sem leitura recorrente do Firestore),
a coleção `validacao_tentativas` foi adicionada ao mesmo índice em memória:

- `server/src/infrastructure/firebase/IndiceSincronizacao.ts`: `validacao_tentativas`
  entrou em `COLECOES_SINCRONIZADAS`.
- `server/src/adapters/controllers/SincronizacaoController.ts`: acesso restrito a
  Master/treinador, igual ao que a tela de validação já permite hoje por cliente (não é
  uma exposição nova, só deixa de ser por empresa) — ver `server/VALIDACAO_CONHECIMENTO.md`.

Isso é código novo no backend, então só entra em produção depois de um build da imagem
Docker e um restart do container `radar-api` na VM — mesmo fluxo do CSAT e do Manager Ops
desta semana. O custo de leitura desse restart é o mesmo padrão das outras quatro coleções
(uma leitura inicial da coleção inteira por processo, depois zero até o próximo restart).

## O que já está pronto (na branch)

- `app/src/utils/validacaoConhecimentoIndicadores.ts` — `calcularValidacaoPorCliente`
  (a lógica de "só a mais recente conta"), com 4 testes em
  `app/tests/validacaoConhecimentoIndicadores.test.mjs`.
- `app/src/pages/RelatorioIndicadoresTreinamento/BolsaIndicadoresTreinamento.tsx` — novo
  card, meta 80%, granularidade mensal, fração "aprovados/total".
- `app/src/pages/RelatorioIndicadoresTreinamento/RelatorioIndicadoresTreinamento.tsx` —
  busca `validacao_tentativas` via `obterColecaoCompleta`, com `.catch(() => [])` isolado:
  um 403 (perfil sem acesso) não derruba o resto do painel, só deixa o card "sem dados".
- `server/tests/sincronizacao.test.mjs` — casos novos de autorização (bloqueia `cs`,
  libera `master`/`treinador`). 9/9 passando.
- Build do backend (`npm run build`) e `npm run test:sincronizacao` (frontend e backend)
  passando. `tsc -b` e `eslint` sem erros novos nos arquivos alterados.

## Passos para publicar (quando decidirem seguir)

1. Revisar e mesclar `feature/indicadores-treinamento-validacao` em `main` (ou publicar
   direto dela, como preferirem).
2. Build de uma nova imagem Docker e restart só do container `radar-api` — não precisa
   tocar no `esteira-bot`.
3. Publicar o frontend atualizado.
4. Verificar no Query Insights se o restart do `radar-api` não ficou fora do padrão das
   outras quatro coleções (confirma que o índice novo não introduziu um custo diferente).

## Verificação já feita

- `server/`: `npm run build` e `npm run test:sincronizacao` (9/9).
- `app/`: `npx tsc -b`, `npx eslint` nos arquivos alterados, `npm run build` (Vite),
  `npm run test:sincronizacao` (16/16) e
  `node --experimental-vm-modules --test tests/validacaoConhecimentoIndicadores.test.mjs`
  (4/4).
- Não testado manualmente no navegador nem contra o Firestore de produção/emulador.
