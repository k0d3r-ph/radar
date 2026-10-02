import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Correção upstream: https://github.com/wwebjs/whatsapp-web.js/pull/201923
// A versão fixada no lockfile ainda espalha o __x_id da mídia sobre o Msg.
export function patchWhatsAppMedia(source) {
  const marker = '// Radar: preservar o MsgKey ao enviar mídia.';
  if (source.includes(marker)) return source;
  const anchor = "        // Bot's won't reply if canonicalUrl is set (linking)";
  if (source.split(anchor).length !== 2 || !source.includes('...mediaOptions,')) {
    throw new Error('whatsapp-web.js mudou: revise a correção de mídia antes de publicar.');
  }
  return source.replace(anchor, `        ${marker}\n        delete message.__x_id;\n\n${anchor}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const require = createRequire(import.meta.url);
  const target = path.join(path.dirname(require.resolve('whatsapp-web.js')), 'src/util/Injected/Utils.js');
  const source = fs.readFileSync(target, 'utf8');
  const patched = patchWhatsAppMedia(source);
  if (source !== patched) fs.writeFileSync(target, patched);
  console.log('[WhatsApp] Correção do identificador de mídia aplicada.');
}
