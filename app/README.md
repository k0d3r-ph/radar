# Radar CRM — frontend

## Conexão com o backend

Configure `app/.env` usando os endereços de `app/.env.example`:

```dotenv
VITE_RADAR_API_URL=http://localhost:5001
VITE_WHATSAPP_API_URL=http://localhost:5000
```

| Variável | Processo | Funcionalidades |
| --- | --- | --- |
| `VITE_RADAR_API_URL` | API do Radar | Sincronização de clientes, ocorrências, pontos e checklist; CSAT, estrelas, IA e Centrais |
| `VITE_WHATSAPP_API_URL` | Bot do WhatsApp | Mensagens, status, Socket.IO e demais rotas `/api/whatsapp` |

Em `server/`, `npm run dev:api` inicia a API na porta 5001 e `npm run dev` inicia o bot na porta 5000. Em `app/`, `npm run dev` inicia o frontend. O bot sozinho não atende as rotas de sincronização usadas pela Home e pelo Histórico.

Reinicie o Vite após alterar o `.env`. Em produção, configure as duas URLs HTTPS no ambiente de build e publique o frontend novamente. O domínio do frontend deve estar permitido em `CORS_ORIGIN` nos dois processos.

Para compatibilidade com instalações antigas que usam um domínio único com proxy, a API aceita `VITE_WHATSAPP_API_URL` como fallback quando `VITE_RADAR_API_URL` está ausente. Sem nenhuma variável, os padrões são 5001 para a API e 5000 para o bot. Em instalações com processos em endereços diferentes, informe as duas variáveis.

Testes do roteamento, sem chamadas a serviços reais, em `app/`:

```sh
node --experimental-vm-modules --test tests/apiConfig.test.mjs
npm run test:sincronizacao
```

## Template React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
