# API de combinados — Manager Ops

Para integrar outra ferramenta (planilha, script, automação) aos combinados de **um time**: listar, criar, alterar e excluir.

## Acesso

- **Endereço base:** `https://managerops-omega.vercel.app/api/v1`
- **Chave:** gerada pelo administrador em **Configurações › Times e acessos › Chaves da API**. Ela aparece **uma única vez**; guarde num lugar seguro (gerenciador de senhas, variável de ambiente), nunca em planilha compartilhada ou repositório.
- **Como enviar:** em todo pedido, o cabeçalho

  ```
  Authorization: Bearer mo_xxxxxxxxxx_xxxxxxxxxxxxxxxxxxxxxxxx
  ```

- A chave vale **só para o time em que foi gerada** e age **em nome do gestor dono dela**. Tudo o que for criado ou alterado aparece como feito por ele, e toda chamada fica registrada na auditoria.
- A chave para de funcionar quando é revogada, ou quando o dono perde o acesso de gestor ao time.
- Corpo e respostas em **JSON** (UTF-8). Datas no formato **`AAAA-MM-DD`**.

## Identificar a pessoa: `memberId` ou `memberEmail`

Onde a API pede a pessoa, basta **um dos dois**:

- `memberId`: o id da pessoa no Manager Ops (veja `GET /members`);
- `memberEmail`: o e-mail cadastrado da pessoa no time. A comparação ignora maiúsculas e espaços.

Vale na listagem (filtro), na criação e na transferência. Se você mandar os dois, eles precisam apontar para a mesma pessoa.

| Situação | Resposta |
|---|---|
| E-mail que não existe no time | `422` ao criar ou alterar; `404` na listagem |
| Mais de uma pessoa do time com o mesmo e-mail | `422`: use o `memberId` |
| `memberId` e `memberEmail` de pessoas diferentes | `422` |

## Combinados

### Listar — `GET /agreements`

Parâmetros (todos opcionais):

| Parâmetro | Exemplo | O que faz |
|---|---|---|
| `status` | `OPEN,IN_PROGRESS` | Filtra por situação: `OPEN`, `IN_PROGRESS`, `DONE`, `CANCELLED` |
| `memberId` | `cmv...` | Só os combinados de uma pessoa |
| `memberEmail` | `clarice@empresa.com.br` | O mesmo filtro, pelo e-mail da pessoa (no lugar do `memberId`) |
| `updatedSince` | `2026-11-01T00:00:00Z` | Só os alterados desde esse momento (para sincronizar) |
| `limit` | `100` | Itens por página, de 1 a 200 (padrão 100) |
| `cursor` | `cmv...` | Próxima página: use o `nextCursor` da resposta anterior |

Resposta:

```json
{
  "data": [
    {
      "id": "cmv...",
      "title": "Revisar macro de reembolso",
      "description": "Clientes recebendo resposta errada",
      "status": "OPEN",
      "priority": "NORMAL",
      "origin": "API",
      "member": { "id": "cmv...", "name": "Clarice", "email": "clarice@empresa.com.br" },
      "central": { "id": "cmv...", "name": "NET.COM" },
      "dueDate": "2026-11-05",
      "originalDueDate": "2026-11-05",
      "completedAt": null,
      "outcome": null,
      "createdAt": "2026-11-03T13:02:11.000Z",
      "updatedAt": "2026-11-03T13:02:11.000Z"
    }
  ],
  "nextCursor": null
}
```

`nextCursor` nulo significa que não há mais páginas. Combinados excluídos não aparecem.

### Ler um — `GET /agreements/{id}`

Devolve o combinado no mesmo formato. Se o id for de outro time ou de um combinado excluído, a resposta é `404`.

### Criar — `POST /agreements`

```json
{
  "memberEmail": "clarice@empresa.com.br",
  "title": "Revisar macro de reembolso",
  "dueDate": "2026-11-05",
  "description": "Clientes recebendo resposta errada",
  "priority": "NORMAL",
  "centralId": "cmv..."
}
```

| Campo | Obrigatório | Regra |
|---|---|---|
| `memberId` **ou** `memberEmail` | um dos dois | A pessoa do time responsável (veja `GET /members`) |
| `title` | sim | De 3 a 160 caracteres |
| `dueDate` | não | Sem prazo, vale hoje. Não pode estar no passado. Sábado, domingo e feriado nacional passam para o próximo dia útil |
| `description` | não | O porquê ou detalhes, até 2000 caracteres |
| `priority` | não | `LOW`, `NORMAL` (padrão) ou `HIGH` |
| `centralId` | não | Uma central ativa do time (veja `GET /centrals`) |

Resposta `201` com o combinado criado. A origem fica como **"Integração"** (`API`). O combinado entra na timeline da pessoa e na daily, como qualquer outro.

### Alterar — `PATCH /agreements/{id}`

Envie só o que muda:

| Campo | O que faz |
|---|---|
| `title`, `description`, `priority` | Editam o texto e a prioridade |
| `memberId` ou `memberEmail` + `transferReason` | **Transfere** para outra pessoa do time; o motivo é obrigatório |
| `status: "DONE"` + `outcome` (opcional) | Conclui o combinado, com o resultado em uma linha |
| `status: "CANCELLED"` + `reason` | Cancela; o motivo é obrigatório |

O **prazo não muda pela API**: ele só é reagendado na daily, para o histórico de arrasto continuar honesto. Um pedido com `dueDate` é recusado com `422`.

Resposta `200` com o combinado atualizado.

### Excluir — `DELETE /agreements/{id}`

Exclusão lógica: o combinado some das telas, das listas e da timeline, mas continua guardado no banco, com a auditoria de quem excluiu. Resposta: `{ "id": "...", "deleted": true }`.

## Apoio

- `GET /members` — pessoas do time (`id`, `name`, `fullName`, `email`, `status`), para preencher `memberId` ou conferir o `memberEmail`.
- `GET /centrals` — centrais ativas do time (`id`, `name`). A lista vem vazia se o time não usa centrais.

## Respostas de erro

| Status | Quando |
|---|---|
| `400` | Corpo que não é JSON, ou parâmetro inválido |
| `401` | Chave ausente, errada ou revogada, ou dono sem acesso |
| `403` | A ação não é permitida para o acesso do dono da chave |
| `404` | Combinado não existe neste time |
| `404` | Na listagem, `memberEmail` que não existe no time |
| `422` | Regra de negócio: `{ "error": "...", "fieldErrors": { "title": "..." } }`, incluindo pessoa não encontrada pelo e-mail |

As mensagens de erro vêm em português.

## Exemplo rápido (curl)

```bash
curl -H "Authorization: Bearer $MANAGER_OPS_KEY" \
  "https://managerops-omega.vercel.app/api/v1/agreements?status=OPEN,IN_PROGRESS&memberEmail=clarice@empresa.com.br"

curl -X POST -H "Authorization: Bearer $MANAGER_OPS_KEY" -H "Content-Type: application/json" \
  -d '{"memberEmail":"clarice@empresa.com.br","title":"Revisar macro de reembolso","dueDate":"2026-11-05"}' \
  https://managerops-omega.vercel.app/api/v1/agreements
```
