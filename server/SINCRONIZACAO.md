# Redução de leituras do Firestore

As listas de ocorrências, empresas, pontos e tarefas do checklist usam `GET /api/sincronizacao/:colecao` no backend existente do Radar. A rota exige token Firebase válido, usuário cadastrado com perfil do Radar e senha já definida. Retorna somente IDs e versões; os documentos continuam sendo consultados diretamente pelo navegador, com as regras atuais do Firestore. O cadastro do usuário usado nessa validação fica em memória por 60 segundos, então uma revogação de acesso pode levar até esse prazo para valer.

O sincronizador do SSX Desk relê a coleção `usuarios` no máximo uma vez por hora, não a cada ciclo de 5 minutos.

Publique o backend antes do frontend: a lista do checklist passa a chamar a rota com `checklist_tarefas`, que o backend antigo recusa com 400.

O índice de pontos é restrito aos perfis master e treinador, os mesmos que acessam a gamificação no Radar.

O backend mantém um listener compartilhado por coleção e processo, criado na primeira solicitação autorizada. O listener faz uma leitura inicial da coleção e acompanha mudanças. Consultar o índice reutiliza a memória do processo; cada solicitação ainda lê o cadastro do usuário para validar acesso. Reinícios, reconexões e múltiplas instâncias podem causar novas leituras iniciais.

O navegador mantém as versões em localStorage, separadas por usuário, e os documentos no cache persistente do SDK. Na primeira carga ou após perder o cache, lê a coleção. Nas seguintes, consulta somente IDs novos, alterados ou ausentes do cache, em lotes de até 30. Documentos excluídos são descartados pela ausência no índice, mesmo com cache antigo e sem nenhuma edição. A versão usa `updateTime` do Firestore, inclusive para alterações sem `updatedAt`.

O cache em memória dos serviços dura cinco minutos. Atualização forçada consulta novamente o índice e os documentos alterados; não causa leitura completa. Requisições simultâneas compartilham uma sincronização. Falhas do índice são apresentadas como erro, sem uma consulta completa automática que elevaria o consumo.

## Publicação

1. Publique e reinicie primeiro o backend atualizado, com as credenciais Firebase Admin já usadas pelo Radar.
2. Confira que `VITE_WHATSAPP_API_URL` aponta para esse backend e que `CORS_ORIGIN` inclui a origem do frontend.
3. Publique o frontend atualizado.
4. Em uma sessão autenticada, abra o Radar, recarregue a página e exclua uma ocorrência de teste em outro navegador. Ao recarregar o primeiro, ela deve desaparecer. A aba Network deve mostrar chamadas ao índice; em listas sem mudanças, nenhuma consulta de documentos ao Firestore é necessária para esses três serviços.
5. Compare a evolução de leituras em Firestore > Uso em um dia de uso semelhante. Primeiros acessos após a atualização ainda fazem uma carga completa para iniciar o marcador v2; leituras já consumidas no dia não são recuperadas.

Não exige uma nova coleção, novos índices compostos nem alteração das regras do Firestore. O carregamento dessas listas passa a depender da disponibilidade do backend. Os demais serviços e a integração SSX ainda podem gerar leituras; esta mudança não garante ficar abaixo da cota em qualquer volume de usuários ou alterações.

## Validação

Em `app/`, execute `npm run test:sincronizacao` e `npm run build`. Em `server/`, execute `npm run test:sincronizacao`.

Os testes simulam persistência após recarregar, exclusão e criação simultâneas, edições sem `updatedAt`, cache incompleto, falhas, lotes e concorrência. Com mil documentos carregados, uma atualização sem mudanças não relê os documentos; com três edições, lê somente os três documentos alterados. Esse resultado não inclui a leitura de autorização do backend, a carga inicial do listener ou leituras dependentes das regras do Firestore.

A checagem completa de tipos do frontend apresenta 49 diagnósticos preexistentes. A comparação com os arquivos de HEAD, usando o mesmo compilador/configuração, confirmou os mesmos 49 diagnósticos após a alteração, sem erros novos. O build Vite e a compilação TypeScript do backend passam.

Referências: [cobrança e cota gratuita](https://firebase.google.com/docs/firestore/pricing), [limites de consultas](https://firebase.google.com/docs/firestore/query-data/queries).
