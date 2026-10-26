# CSAT direto no Radar

O módulo [Validação do conhecimento](VALIDACAO_CONHECIMENTO.md) reutiliza a reserva, a sequência e as respostas públicas do CSAT. Cada tentativa concluída gera seu próprio treinamento e CSAT em uma transação única. As respostas também atualizam a tentativa vinculada.

No **Histórico**, treinadores e masters podem clicar em **Gerar link CSAT** e selecionar o cliente na janela de confirmação. O campo **Pesquisar empresa** filtra os nomes sem diferenciar maiúsculas ou acentos; a lista indica a empresa selecionada e mantém essa escolha ao mudar a pesquisa. A seleção inclui empresas internas cadastradas, como a **Systemsat**, permitindo avaliar treinamentos internos sem depender do acesso pela Home. Ao entrar por **Ver ocorrências** na Home, o cliente do filtro vem pré-selecionado e pode ser alterado antes de gerar o link.

Após gerar, o endereço completo é copiado automaticamente para a área de transferência. Clique no ID reservado para preencher o treinamento. A mesma cópia acontece ao concluir uma validação do conhecimento, assim que seu CSAT é gerado. A interface confirma a cópia; se o navegador bloquear o acesso, mantém a operação concluída, apresenta um aviso e permite usar **Copiar link** ou selecionar o endereço no campo do CSAT. Abrir ou recarregar uma avaliação/reserva já existente não altera a área de transferência.

As reservas pendentes do usuário ficam visíveis mesmo quando o Histórico está filtrado por outro cliente. O CSAT reserva o próximo número na sequência do cliente: depois de `#14505`, a reserva é `#14506`. O número é preservado ao concluir a ocorrência e fica ocupado mesmo enquanto a reserva está pendente. A reserva fica fora dos relatórios e só é listada para seu criador; ao concluir, a ocorrência passa ao histórico normal. Reservas antigas com prefixo `CSAT-` mantêm o identificador original.

Cada participante informa nome, Bom/Ruim e opinião opcional de até 100 caracteres. O link aceita vários participantes; reenvios do mesmo navegador são idempotentes. As respostas atualizam `treinamentoResultados` e `csatRespostas` na ocorrência, inclusive depois da conclusão. Não há envio automático do link pelo WhatsApp.

## Publicação

A conclusão de uma reserva aceita o campo opcional `treinamentoMotivoEspera`: `cliente`, `agenda_treinador` ou `null`. O campo é preservado na ocorrência e valores diferentes são rejeitados. O Histórico solicita essa classificação para treinamentos realizados com espera de 3 dias úteis ou mais, considerando apenas segunda a sexta. A resposta contextualiza o relatório e não retira a espera da média geral. Reservas/registros antigos sem o campo continuam compatíveis.

Após gerar um link, o botão muda para **Registrar ocorrência** e abre o último CSAT pendente do usuário. Novos links ficam bloqueados até registrar a ocorrência, inclusive ao trocar de cliente ou tentar pela API/outra aba. Se houver reservas anteriores à implantação desta regra, todas precisam ser registradas antes de liberar a geração de novos links. O bloqueio é individual por treinador e validado por transação no backend.

Clientes suspensos não podem gerar novas reservas nem concluir reservas de treinamento. A API confere `isSuspended` dentro da transação, inclusive se a suspensão ocorrer depois de abrir o formulário. Uma reserva pendente de cliente que foi suspenso permanece preservada e aparece como registro pausado no Histórico; enquanto durar a suspensão, ela não impede gerar links para outros clientes. Ao retornar o cliente à esteira, a reserva volta a exigir conclusão normalmente. Avaliações públicas de treinamentos já concluídos continuam aceitas após a suspensão, sem criar outro treinamento.

Atualize o frontend **e** o backend. O endereço público `/csat/:token` precisa usar o mesmo fallback para `index.html` das outras rotas React. `VITE_RADAR_API_URL` deve apontar para a API HTTPS acessível aos clientes, e o domínio do frontend precisa estar autorizado em `CORS_ORIGIN`. O endereço do bot é configurado separadamente em `VITE_WHATSAPP_API_URL`. Publicações antigas com um domínio único mantêm essa variável antiga como fallback quando `VITE_RADAR_API_URL` não está definida.

As coleções `csatReservas`, `csatLinks` e `csatControle` são acessadas exclusivamente pelo Firebase Admin no backend. Nas regras Firestore publicadas, negue acesso de clientes a essas coleções e subcoleções. Exemplo para incorporar às regras existentes:

```text
match /csatReservas/{document=**} { allow read, write: if false; }
match /csatLinks/{document=**} { allow read, write: if false; }
match /csatControle/{document=**} { allow read, write: if false; }
```

Regras permissivas com `match /{document=**}` também precisam excluir essas coleções: permissões Firestore são combinadas por OR, então um deny específico não anula um allow abrangente. As regras do projeto não estão neste repositório e precisam ser conferidas no Firebase antes da publicação para garantir a privacidade das reservas e dos tokens.

Validação: `node node_modules/typescript/bin/tsc` seguido de `node --test tests/csat.test.mjs` no diretório `server`. Para a cópia automática no frontend, em `app/`: `node --experimental-vm-modules --test tests/csatClipboard.test.mjs`. Cobre os dois fluxos, ordem da cópia, bloqueio/ausência da área de transferência e falhas de geração sem copiar links.
