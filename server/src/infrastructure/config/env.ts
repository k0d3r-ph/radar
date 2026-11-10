import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carrega o .env localizado na raiz da pasta server
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export const config = {
  port: parseInt(process.env.PORT || '5000', 10),
  /** Porta do processo leve (CSAT, ocorrências, sincronização, IA, Centrais), separado do bot do WhatsApp. */
  apiPort: parseInt(process.env.API_PORT || '5001', 10),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  /** URL do CSV publicado (Arquivo → Compartilhar → Publicar na web) da aba de controle do CS. */
  planilhaCentraisCsvUrl: process.env.PLANILHA_CENTRAIS_CSV_URL || '',
  /** Opcional: URL do CSV de uma segunda aba (ex.: clientes Ongoing), somada à anterior na resolução de ID Central. */
  planilhaCentraisOngoingCsvUrl: process.env.PLANILHA_CENTRAIS_ONGOING_CSV_URL || '',
  ssxDeskApiKey: process.env.SSX_DESK_API_KEY?.trim() || '',
  // Mínimo de um minuto; padrão: cinco minutos.
  ssxDeskSyncIntervalMs: Math.max(60_000, Number(process.env.SSX_DESK_SYNC_INTERVAL_MS) || 300_000),
  /** Chave de envio das etapas de treinamento ao SSX Desk (escopo training-stages:write,
   * separada da chave de leitura acima) — ver server/SSX_DESK_TRAINING_STAGES.md. */
  ssxDeskTrainingStagesApiKey: process.env.SSX_DESK_TRAINING_STAGES_API_KEY?.trim() || '',
  // Mínimo de um minuto; padrão: cinco minutos.
  ssxDeskTrainingStagesSyncIntervalMs: Math.max(60_000, Number(process.env.SSX_DESK_TRAINING_STAGES_SYNC_INTERVAL_MS) || 300_000),
  /** Uso único: força reconsiderar todas as empresas (ignora o cursor salvo) no primeiro
   * ciclo após o deploy — para o backfill da ativação inicial em produção. Desligar depois
   * de confirmar que o backfill rodou (senão força de novo a cada restart). */
  ssxDeskTrainingStagesForcarBackfill: process.env.SSX_DESK_TRAINING_STAGES_FORCAR_BACKFILL === 'true',
  profilePhotosDir: process.env.PROFILE_PHOTOS_DIR || path.resolve(process.cwd(), 'data/profile-photos'),
};
