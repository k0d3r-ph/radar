# Colunas das esteiras da Home

O botão **Colunas** de cada esteira oferece todas as colunas já disponíveis nas esteiras da Home. Marcar inclui a coluna nessa tabela; desmarcar oculta. Por exemplo, **Dias suspenso** pode ser incluída em **Clientes Cancelados**. A ordem pode ser alterada no painel ou pelo arraste dos cabeçalhos, e as larguras continuam ajustáveis. As colunas essenciais já fixas permanecem fixas.

Cada esteira mantém preferências independentes no `localStorage`, com as mesmas chaves anteriores (`radar:colunas:esteira-atual`, `ongoing`, `suspensos`, `concluidos` e `cancelados`). Não há limpeza do cache nem gravação no Firestore. Ao carregar uma preferência antiga, preservam-se ordem, visibilidade e larguras válidas. As colunas que passaram a estar disponíveis ficam inicialmente ocultas, sem modificar a tabela que o usuário já organizou.

No primeiro acesso, cada tabela conserva sua organização anterior. **Restaurar padrão** volta à seleção, à ordem e às larguras originais daquela esteira, deixando as colunas adicionais ocultas. Depois que uma coluna adicional é selecionada, a seleção também é persistida e restaurada nas próximas visitas.

`ampliarCatalogoColunas` reúne as opções sem duplicar chaves e preserva as definições locais: por exemplo, a largura padrão de Cliente em Suspensos não é substituída pela de outra esteira. `resolverPreferenciasColunas` valida e adapta o formato de cache anterior, sem acrescentar campos ou mudar sua chave. Cache ilegível usa o padrão; se o navegador bloquear o armazenamento, a seleção funciona na sessão, sem persistência garantida após recarregar.

As tabelas e a exportação para Excel usam as mesmas colunas visíveis, na ordem escolhida, incluindo colunas adicionadas de outras esteiras. Os valores e os cálculos existentes são reutilizados, sem novas leituras ou mudanças nas regras de suspensão, cancelamento, score ou TME.

Validação na raiz:

```powershell
node --test app/tests/preferenciasColunas.test.mjs
```

Os testes usam as definições reais das cinco esteiras para conferir padrões, migração de cache, larguras, inclusão em Cancelados, independência das escolhas, restauração e tratamento de dados inválidos.
