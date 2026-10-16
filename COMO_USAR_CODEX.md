# Prompt permanente do projeto

O prompt de engenharia de software e UX está no arquivo [`AGENTS.md`](./AGENTS.md), na raiz de `automatiza-esteira`, ao lado de `app/` e `server/`. Ele foi elaborado a partir da estrutura, dos fluxos, dos scripts e da documentação deste repositório.

## O que a análise identificou

- O Radar CRM é um sistema operacional de acompanhamento de clientes, treinamento e atendimento. Uma alteração em uma ocorrência pode refletir no score, na esteira, na gamificação, nos relatórios e nas notificações.
- O frontend usa React, TypeScript, Vite, Firebase e CSS com temas claro e escuro. O backend possui camadas de domínio, casos de uso, controladores e infraestrutura, com processos separados para API e bot WhatsApp.
- Já existem utilitários de negócio, serviços, componentes e testes que devem ser reutilizados. A sincronização incremental do Firestore, as reservas CSAT e a deduplicação do SSX Desk exigem cuidados com custos e concorrência.
- Home e Histórico têm, respectivamente, cerca de 5,2 mil e 6,9 mil linhas nesta análise. Isso indica oportunidade de extrações graduais de componentes e lógica conforme as próximas tarefas, evitando uma reestruturação ampla sem objetivo definido.
- A experiência envolve tabelas, filtros, modais, formulários e diferentes permissões. Consistência entre telas, feedback de operações, acessibilidade e preservação do contexto são critérios importantes para futuras mudanças.
- `app/README.md` ainda contém o texto padrão do Vite. O `AGENTS.md` passa a oferecer um mapa específico do sistema para orientar o assistente.

Há também dois pontos concretos para uma revisão de segurança futura: `serviceAccountKey.json` consta entre os arquivos rastreados pelo Git, e as rotas administrativas de redefinição de senha e exclusão de usuários em `server/src/infrastructure/web/express.ts` não apresentam validação de identidade/perfil no código das rotas nem no middleware compartilhado examinado. O conteúdo da credencial não foi aberto; sua validade e as proteções externas de implantação não foram verificadas. Essas constatações não foram corrigidas nesta tarefa documental.

Esta foi uma análise estática para elaborar instruções. Não incluiu execução da interface, testes, auditoria completa ou verificação de produção.

## Como usar nas próximas conversas

1. Mantenha o nome exato `AGENTS.md` e deixe o arquivo na raiz do repositório.
2. Abra este mesmo projeto/pasta no Codex e inicie uma nova conversa. O Codex descobre as instruções do projeto ao iniciar a sessão; você não precisa colar o prompt em cada pedido.
3. Envie apenas a tarefa e os requisitos específicos. Exemplo: “Melhore os filtros do Histórico para facilitar a busca por cliente e período, mantendo as regras de acesso existentes”.
4. Para conferir o carregamento, peça: “Liste os arquivos de instruções carregados e resuma as orientações deste projeto”.
5. Para mudar o comportamento permanente, edite o `AGENTS.md` e inicie uma nova sessão para recarregar as instruções.

O arquivo fornece orientações persistentes para este repositório; não armazena automaticamente todo o histórico das conversas. Quando uma decisão precisar valer em tarefas futuras, registre-a no documento apropriado e, se necessário, referencie-o no `AGENTS.md`.

## Como manter e compartilhar

- Versione `AGENTS.md` junto com o código para que as instruções acompanhem o repositório em outras máquinas. Este trabalho criou os arquivos localmente e não realizou commit.
- Atualize caminhos e comandos quando a estrutura mudar. Prefira orientações úteis e verificáveis a um prompt muito longo com regras genéricas.
- Se surgirem instruções específicas de uma pasta, elas podem ficar em `app/AGENTS.md` ou `server/AGENTS.md`. Instruções mais próximas da pasta de trabalho refinam as gerais; um `AGENTS.override.md` na mesma pasta tem preferência sobre `AGENTS.md`.
- Em outras ferramentas de IA, verifique o mecanismo de instruções suportado; o carregamento descrito aqui corresponde ao Codex.

Referência oficial: [OpenAI Docs — instruções com AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md).
