/**
 * Espelha as regras de desconto de score/pontos de app/src/utils/score.ts e do bloco
 * de dedução de gamificação em app/src/pages/Historico/Historico.tsx (que só roda ao
 * salvar uma ocorrência pelo formulário manual). O importador do SSX Desk cria
 * ocorrências direto no Firestore, sem passar por aquele formulário, então precisa
 * de sua própria cópia dessas regras para não deixar contatos de Suporte sem desconto.
 */

/** Quantos dias uma redução de score por contato com o Suporte permanece ativa. */
export const DIAS_REDUCAO_SCORE_SUPORTE = 15;

/** Quanto o score cai por contato do cliente com o Suporte para tirar dúvidas. */
export const VALOR_REDUCAO_SCORE_SUPORTE = 1;

export const MOTIVO_REDUCAO_SCORE_SUPORTE = 'Contato com o Suporte (dúvida)';

export interface AjusteTemporarioScore {
  motivo: string;
  valor: number;
  criadoEm: number;
  expiraEm: number;
  ocorrenciaId?: string;
}

/**
 * Monta um ajuste temporário de score. `criadoEm` é o momento do contato (não o
 * momento da sincronização), para que os 15 dias de validade contem a partir de
 * quando o cliente de fato falou com o Suporte.
 */
export function criarAjusteTemporarioScore(
  motivo: string,
  valor: number,
  dias: number,
  ocorrenciaId: string,
  criadoEm: number,
): AjusteTemporarioScore {
  return {
    motivo,
    valor,
    criadoEm,
    expiraEm: criadoEm + dias * 24 * 60 * 60 * 1000,
    ocorrenciaId,
  };
}

/** Expediente fixo: 09h às 18h, dias úteis, no horário de Brasília — independente do fuso do servidor. */
export function estaDentroDoExpedienteBrasil(timestamp: number): boolean {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  const diaSemana = partes.find((p) => p.type === 'weekday')?.value;
  const hora = Number(partes.find((p) => p.type === 'hour')?.value);
  const isFimDeSemana = diaSemana === 'Sat' || diaSemana === 'Sun';
  return !isFimDeSemana && hora >= 9 && hora < 18;
}

type ChaveTipoSuporte = 'duvida' | 'problema' | 'solicitacao';

const CHAVE_POR_TIPO: Record<string, ChaveTipoSuporte | undefined> = {
  Dúvida: 'duvida',
  Problema: 'problema',
  Solicitação: 'solicitacao',
};

export interface GamificacaoDeducaoSuporte {
  ativo: boolean;
  duvida?: { dentroExpediente?: number; foraExpediente?: number };
  problema?: { dentroExpediente?: number; foraExpediente?: number };
  solicitacao?: { dentroExpediente?: number; foraExpediente?: number };
}

/** Pontos a descontar do treinador para um contato de Suporte, ou undefined se o tipo/config não desconta. */
export function pontosDeducaoTreinador(
  config: GamificacaoDeducaoSuporte | undefined,
  tipo: string,
  timestampContato: number,
): { pontos: number; dentroDoExpediente: boolean } | undefined {
  if (!config?.ativo) return undefined;
  const chave = CHAVE_POR_TIPO[tipo];
  if (!chave) return undefined;
  const dentroDoExpediente = estaDentroDoExpedienteBrasil(timestampContato);
  const pontos = dentroDoExpediente ? config[chave]?.dentroExpediente : config[chave]?.foraExpediente;
  if (!pontos) return undefined;
  return { pontos, dentroDoExpediente };
}

/**
 * Acha o treinador responsável pelo primeiro nome gravado em `Empresa.responsavel`
 * (ver Gamificacao.tsx). O cadastro deveria guardar só o primeiro nome, mas às
 * vezes salva o nome completo selecionado no seletor — por isso extraímos a
 * primeira palavra de `responsavel` também, em vez de comparar o valor bruto.
 */
export function encontrarTreinadorPorResponsavel(
  responsavel: string,
  usuarios: { uid: string; nome: string }[],
): { uid: string; nome: string } | undefined {
  const normalizar = (s: string) =>
    (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
  const alvo = normalizar((responsavel || '').trim().split(/\s+/)[0] || '');
  if (!alvo) return undefined;
  return usuarios.find((u) => normalizar(u.nome.trim().split(/\s+/)[0] || '') === alvo);
}
