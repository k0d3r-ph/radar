# Modo claro

O CSS das páginas é escrito para o modo escuro. O modo claro é **derivado automaticamente** dele, em vez de mantido à mão regra por regra. Assim, toda tela nova ou alterada ganha um modo claro coerente, e o escuro nunca é afetado.

## Como funciona

1. `npm run tema:claro` (a partir de `app/`) executa dois passos:
   - `scripts/temaClaroInline.mjs` troca, dentro de blocos `style={{ }}` dos `.tsx`, cores de tema escuro por `var(--lt-<papel>-<cor>, <cor original>)`. No escuro a variável não existe e vale a cor original.
   - `scripts/gerarTemaClaro.mjs` lê todos os `.css` de `src/` e gera `src/themes.light.generated.css`, com a versão `body.light-theme` de cada regra com cor e as variáveis `--lt-*` usadas nos componentes.
2. `main.tsx` carrega o arquivo gerado **antes** de `themes.css`. A seção "2. TEMA CLARO" de `themes.css` contém só a base visual (fundo, navbar, rolagem, seleção) e ajustes que o gerador não resolve.

As regras de conversão ficam em `scripts/temaClaroCores.mjs`:

- **Superfícies escuras neutras** viram branco ou cinzas claros (`#0b0f19` → fundo da página, `#1e293b` → cartão branco, `#0f172a` → painel interno `#f8fafc`).
- **Textos claros** viram textos escuros por nível de ênfase (`#f1f5f9` → `#0f172a`, `#94a3b8` → `#475569`).
- **Textos coloridos** são escurecidos, mantendo o matiz, até contraste AA (4,5:1). Amarelos tendem ao âmbar.
- **Bordas brancas translúcidas** viram bordas sólidas suaves.
- **Sombras pretas** ficam bem mais leves.
- **Destaques saturados** (botões, cards ativos, gradientes coloridos) são mantidos, e o texto claro sobre eles também.
- **Cores já claras** passam sem mudança. Por isso páginas escritas em claro não são alteradas.
- **Overlays de modal** (seletores com `overlay`, `backdrop`…) viram um véu `rgba(15, 23, 42, 0.4)`.
- **Variáveis próprias** de um componente (`--gp-text`, `--gp-border`…) são convertidas pelo papel indicado no nome.

## Ao alterar cores

- Rode `npm run tema:claro` e faça commit do CSS gerado junto. **Não edite `themes.light.generated.css` à mão.**
- Para algo que deve ficar idêntico nos dois temas (ex.: a prévia exportada como imagem na Esteira), inclua o seletor em `SELETOR_SEM_TEMA` no gerador.
- Para um caso pontual que a regra automática não acerte, adicione um ajuste `body.light-theme ...` na seção 2 de `themes.css`. Esse arquivo é carregado depois do gerado e prevalece.
- Cores inline usadas em atributos SVG (`fill`, `stroke` como atributo) não são convertidas, porque atributos SVG não aceitam `var()`. Use `style` ou uma classe CSS.

## Validação

As telas foram conferidas por capturas de tela nos dois temas: Home (com modais), Esteira, Histórico (com detalhe), Usuários, Gamificação, WhatsApp, Tabulações, Login e as seis abas de Relatórios.
