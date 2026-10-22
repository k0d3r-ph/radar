# Dados de clientes na planilha do CS

A integração usa `PLANILHA_CENTRAIS_CSV_URL` no backend e a mesma aba já utilizada para resolver o ID Central. Aceita CSV publicado ou link compartilhado com acesso sem login, preservando o `gid`. Não é preciso configurar outra planilha.

Opcionalmente, `PLANILHA_CENTRAIS_ONGOING_CSV_URL` aponta para uma segunda aba da mesma planilha (ex.: a aba de clientes Ongoing, que usa colunas e layout próprios). Quando configurada, a resolução de ID Central busca nas duas abas juntas — útil para clientes Ongoing cujo ID Central só está cadastrado nessa aba separada. As duas abas são baixadas em paralelo e somadas antes de resolver o vínculo; um ID repetido entre as duas abas segue a mesma regra de conflito já usada dentro de uma única aba (exige nome igual, e não preenche automaticamente se os dados divergirem). Sem essa variável configurada, o comportamento é idêntico ao atual (uma única aba).

Colunas: `Cliente` (ou os nomes alternativos já suportados), `Id central` e, opcionalmente, `Valor de contrato`. Cabeçalhos numerados como `15 - Valor de contrato` também são aceitos. Valores como `R$ 1.500,25`, `1500,25`, `1500.25` e zero são convertidos em números. Campos vazios, negativos ou inválidos não são importados como zero e não apagam contratos existentes. Linhas sem ID podem fornecer contrato quando o nome identifica uma única central.

No cadastro e na edição de clientes, a Home consulta `GET /api/centrais/dados?nome=...&idCentral=...`. A rota exige token Firebase, cadastro ativo, senha definida e perfil master ou treinador. A autorização fica em cache por até 60 segundos. O endpoint público antigo `/api/centrais/id-central` continua retornando somente ID; não expõe valores de contrato.

O vínculo usa ID Central único. Para IDs compartilhados, exige também o nome normalizado. Sem ID, compara nomes normalizados como na integração anterior (acentos, caixa, espaços, pontuação e prefixo `SSX_`). IDs conflitantes, homônimos e linhas com valores divergentes não geram preenchimento automático. Não há casamento por aproximação.

A consulta automática ocorre ao abrir a edição ou após uma pausa ao alterar nome/ID. Preenche apenas campos vazios, preservando ajustes manuais, inclusive valor zero. Salvar aguarda a consulta quando ainda faltar ID ou contrato; se a planilha estiver indisponível, mostra um aviso e permite salvar com os dados manuais. Respostas de consultas anteriores não alteram um formulário com outra identificação. Não existe gravação automática no banco apenas por abrir o cadastro.

A planilha tem cache compartilhado de cinco minutos no backend. Consultas concorrentes compartilham o download. O frontend também reutiliza a resposta por cinco minutos, separada por usuário, nome e ID. A atualização em massa é pontual e não executa na inicialização do servidor.

## Atualização dos clientes existentes

Em `server/`, confira a prévia sem gravar:

```powershell
npm run atualizar-valores-contrato -- --dry-run --sobrescrever
```

Para atualizar todos os contratos da esteira com os valores válidos da planilha, inclusive os já preenchidos:

```powershell
npm run atualizar-valores-contrato -- --aplicar --sobrescrever
```

No Windows PowerShell, use `npm.cmd` no lugar de `npm` para garantir o repasse das opções ao script. Antes de ler a planilha, o comando informa se está em simulação/aplicação e se compara os contratos existentes.

Sem `--sobrescrever`, preenche somente valores ausentes. Sem `--aplicar`, sempre simula. A seleção segue os clientes da aba Esteira: exclui ongoing, suspensos, cancelados e a empresa interna Systemsat; inclui clientes concluídos que ainda constam nessa aba. Cada execução lê a coleção de empresas uma vez. A aplicação relê somente os candidatos dentro de transações, revalidando vínculo, status e valor antes da gravação. Altera apenas `valorContrato` e `updatedAt`. Uma segunda execução não regrava valores iguais. O relatório lista alterações, registros sem vínculo/valor válido, conflitos concorrentes e falhas parciais. Falhas em um cliente não interrompem os demais; o comando termina com erro e permite reexecutar para completar os pendentes. Não dispara WhatsApp nem sincronização do SSX Desk.

## Publicação e validação

Publique primeiro o backend e depois o frontend, pois a consulta autenticada usa uma rota nova. A atualização pontual pode ser executada antes da publicação, com as credenciais já configuradas, e os campos atualizados serão vistos pela sincronização incremental existente. Não requer nova coleção, índice ou migração de modelo.

Em `server/`: `npm run test:centrais`. Em `app/`: `node --experimental-vm-modules --test tests/centrais.test.mjs` e `npm run build`.
