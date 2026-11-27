import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Versão principal do Chromium usado pelo bot, ou `null` se não for possível descobrir. */
export function versaoPrincipalChromium(env: NodeJS.ProcessEnv = process.env): string | null {
  // Produção (Docker): Chromium do sistema, cuja versão muda a cada build da imagem.
  const executavel = env.PUPPETEER_EXECUTABLE_PATH;
  if (executavel) {
    try {
      const saida = execFileSync(executavel, ['--version'], { timeout: 5000, encoding: 'utf8' });
      const versao = saida.match(/(\d+)\.\d+\.\d+/)?.[1];
      if (versao) return versao;
    } catch {
      // segue para a versão do Puppeteer
    }
  }
  // Local: Chromium baixado pelo Puppeteer.
  try {
    const { PUPPETEER_REVISIONS } = require('puppeteer-core/lib/cjs/puppeteer/revisions.js');
    return String(PUPPETEER_REVISIONS.chrome).split('.')[0] || null;
  } catch {
    return null;
  }
}

/** Versão usada se a do navegador não puder ser lida (a anterior, fixa, era 122 e impedia vincular aparelhos novos). */
const VERSAO_RESERVA = '146';

/**
 * User agent de Chrome de desktop com a mesma versão do Chromium em uso. O WhatsApp recusa
 * vincular aparelhos que se apresentam com um navegador desatualizado ou que não bate com o
 * real ("Não foi possível conectar o dispositivo"). `WHATSAPP_USER_AGENT` força um valor.
 */
export function userAgentWhatsApp(env: NodeJS.ProcessEnv = process.env): string {
  const forcado = env.WHATSAPP_USER_AGENT?.trim();
  if (forcado) return forcado;
  const versao = versaoPrincipalChromium(env) ?? VERSAO_RESERVA;
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${versao}.0.0.0 Safari/537.36`;
}
