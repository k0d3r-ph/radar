import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carrega o .env localizado na raiz da pasta server
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  /** URL do CSV publicado (Arquivo → Compartilhar → Publicar na web) da aba de controle do CS. */
  planilhaCentraisCsvUrl: process.env.PLANILHA_CENTRAIS_CSV_URL || ''
};

