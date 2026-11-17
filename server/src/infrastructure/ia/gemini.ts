import { GoogleGenAI } from '@google/genai';
import { config } from '../config/env.js';

export const GEMINI_MODEL = 'gemini-3.6-flash';

/** Erro de configuração: a chave da API Gemini não está definida no servidor. */
export class GeminiIndisponivelError extends Error {}

export function criarClienteGemini(): GoogleGenAI {
  if (!config.geminiApiKey) throw new GeminiIndisponivelError('Chave da API Gemini não configurada no servidor. Adicione GEMINI_API_KEY ao .env');
  return new GoogleGenAI({ apiKey: config.geminiApiKey });
}

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
/** 429/503: o Gemini está com alta demanda ou limite de uso; vale tentar de novo depois. */
export const sobrecargaGemini = (error: unknown) => {
  const status = (error as { status?: number; httpStatusCode?: number } | null)?.status ?? (error as { httpStatusCode?: number } | null)?.httpStatusCode;
  return status === 503 || status === 429;
};
const sobrecarga = sobrecargaGemini;

/** O Gemini não respondeu dentro do prazo total da operação. */
export class GeminiTempoEsgotadoError extends Error {}

/** Stream com novas tentativas em sobrecarga (429/503), só enquanto nenhum trecho foi emitido. */
export async function* gerarStreamComRetry(ai: GoogleGenAI, prompt: string, tentativas = 3): AsyncGenerator<string> {
  let ultimoErro: unknown;
  for (let i = 0; i < tentativas; i++) {
    let algumTrechoEmitido = false;
    try {
      const stream = await ai.models.generateContentStream({ model: GEMINI_MODEL, contents: prompt });
      for await (const chunk of stream) {
        algumTrechoEmitido = true;
        yield chunk.text ?? '';
      }
      return;
    } catch (error) {
      ultimoErro = error;
      // Já enviamos parte do texto ao cliente: não dá para reiniciar sem duplicar conteúdo.
      if (algumTrechoEmitido || !sobrecarga(error) || i === tentativas - 1) throw error;
      await delay(1000 * (i + 1));
    }
  }
  throw ultimoErro;
}

/** Modelos mais leves, acionados quando o principal demora (alta demanda costuma afetar só os "flash"). */
export const GEMINI_MODELOS_RESERVA = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];

/**
 * Gera o texto completo (sem stream) sem ultrapassar `prazoMs`. O modelo principal começa na
 * hora; se não responder em `esperaReservaMs` (ou falhar antes), os modelos reserva entram em
 * paralelo e vale a primeira resposta — as demais são canceladas. Esperar um modelo de cada vez
 * gastaria o prazo inteiro num modelo travado. O prazo deve ficar abaixo do limite de espera do
 * navegador, para que o usuário receba a mensagem do servidor em vez de um erro de conexão.
 */
export async function gerarTextoGemini(prompt: string, { prazoMs = 30_000, esperaReservaMs = 8_000 } = {}): Promise<string> {
  const ai = criarClienteGemini();
  const limite = Date.now() + prazoMs;
  const cancelamento = new AbortController();
  let liberarReservas = () => {};
  const reservasLiberadas = new Promise<void>(resolve => { liberarReservas = resolve; });
  const timerReserva = setTimeout(() => liberarReservas(), esperaReservaMs);
  const principal = gerarComModelo(ai, GEMINI_MODEL, prompt, limite, cancelamento.signal)
    .catch((error: unknown) => { liberarReservas(); throw error; });
  const reservas = GEMINI_MODELOS_RESERVA.map(async model => {
    await reservasLiberadas;
    if (cancelamento.signal.aborted) throw new GeminiTempoEsgotadoError('Chamada reserva dispensada.');
    return gerarComModelo(ai, model, prompt, limite, cancelamento.signal);
  });
  try {
    return await Promise.any([principal, ...reservas]);
  } catch (error) {
    const erros = error instanceof AggregateError ? error.errors : [error];
    // Prioriza o motivo mais útil para a mensagem ao usuário.
    throw erros.find(sobrecarga) ?? erros.find(e => e instanceof GeminiTempoEsgotadoError) ?? erros[0];
  } finally {
    clearTimeout(timerReserva);
    cancelamento.abort();
    liberarReservas();
  }
}

/** Chamada a um modelo, repetindo só em sobrecarga e enquanto houver tempo útil até `limite`. */
async function gerarComModelo(ai: GoogleGenAI, model: string, prompt: string, limite: number, signal: AbortSignal, tentativas = 2): Promise<string> {
  let ultimoErro: unknown;
  for (let i = 0; i < tentativas && !signal.aborted; i++) {
    const restante = limite - Date.now();
    if (restante <= 0) break;
    let timer: NodeJS.Timeout | undefined;
    try {
      const esgotado = new Promise<never>((_, rejeitar) => { timer = setTimeout(() => rejeitar(new GeminiTempoEsgotadoError('O Gemini não respondeu a tempo.')), restante); });
      const resposta = await Promise.race([ai.models.generateContent({ model, contents: prompt, config: { abortSignal: signal } }), esgotado]);
      const texto = resposta.text?.trim();
      if (!texto) throw new Error(`O modelo ${model} retornou uma resposta vazia.`);
      return texto;
    } catch (error) {
      ultimoErro = error;
      const espera = 1000 * (i + 1);
      if (!sobrecarga(error) || i === tentativas - 1 || limite - Date.now() < espera + 3000) throw error;
      await delay(espera);
    } finally {
      clearTimeout(timer);
    }
  }
  throw ultimoErro ?? new GeminiTempoEsgotadoError('O Gemini não respondeu a tempo.');
}
