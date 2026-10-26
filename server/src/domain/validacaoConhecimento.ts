export const TEMA_VALIDACAO = 'Validação do conhecimento';
export const SECOES = ['Temas iniciais', 'Performance', 'Manutenção básica', 'Manutenção avançada', 'Logistics', 'Jornada de Trabalho', 'Fretamento', 'Gestão de Multas', 'Videotelemetria', 'Onboard', 'Abastecimento'] as const;
export type Secao = typeof SECOES[number];
/** Mesmas opções de "Quem solicitou" das ocorrências de Treinamento (Histórico e Gamificação). */
export const SOLICITANTES_TREINAMENTO = ['CS', 'Cliente', 'Suporte', 'Comercial', 'Hardware', 'Aplicações'] as const;
export const isSolicitanteTreinamento = (valor: unknown): valor is typeof SOLICITANTES_TREINAMENTO[number] =>
  (SOLICITANTES_TREINAMENTO as readonly unknown[]).includes(valor);
export type RespostaValidacao = 'correto' | 'parcial' | 'incorreto';
/** `ativa: false` tira a pergunta de novas avaliações; tentativas antigas guardam o próprio texto. */
export interface PerguntaConhecimento { id: string; secao: Secao; texto: string; preferida: boolean; ativa?: boolean }
export interface QuestaoValidacao extends PerguntaConhecimento { resposta: RespostaValidacao | null; origem: 'banco' | 'mantida' | 'manual' }
export interface TentativaValidacao {
  id: string; empresaId: string; empresa: string; treinadorId: string; treinadorNome: string;
  status: 'andamento' | 'pausada' | 'concluida' | 'cancelada'; numero: number; anteriorId: string | null;
  questoes: QuestaoValidacao[]; secoes: Secao[]; avisos: string[]; revisao: number;
  createdAt: number; updatedAt: number; concluidaEm?: number;
  canceladaEm?: number; canceladaPorId?: string; canceladaPorNome?: string;
  nota?: number; percentual?: number; aprovada?: boolean; ocorrenciaId?: string; csatToken?: string;
  concluiuEsteira?: boolean;
  treinamentoDataSolicitacao: string; treinamentoTempoAgenda: string; treinamentoSolicitante: string;
  csatRespostas?: { nome: string; experiencia: 'Bom' | 'Ruim'; opiniao: string; respondidoEm: number }[];
}
export const normalizarConhecimento = (texto: string) => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
export function indiceTemaFinal(temas: string[]): number {
  const validacao = temas.findIndex(t => normalizarConhecimento(t) === normalizarConhecimento(TEMA_VALIDACAO));
  return validacao >= 0 ? validacao : temas.findIndex(t => normalizarConhecimento(t) === 'conclusao');
}
export function calcularResultadoValidacao(questoes: Pick<QuestaoValidacao, 'resposta'>[]) {
  if (!questoes.length || questoes.some(q => !q.resposta)) throw new Error('Responda todas as perguntas antes de concluir.');
  const unidades = questoes.reduce((soma, q) => soma + (q.resposta === 'correto' ? 2 : q.resposta === 'parcial' ? 1 : 0), 0);
  // Compara inteiros: evita que arredondamentos mudem a aprovação no limite de 80%.
  return { nota: 10 * unidades / (2 * questoes.length), percentual: 100 * unidades / (2 * questoes.length), aprovada: unidades * 5 >= 8 * questoes.length };
}
/**
 * Termos alternativos usados nas esteiras para cada módulo. A busca ignora caixa e
 * acentos e procura o termo dentro do nome do tema (ex.: "Apresentar Videotelemetria").
 */
export const SINONIMOS_SECOES: Partial<Record<Secao, string[]>> = {
  Logistics: ['Logística', 'Logistica'],
  'Jornada de Trabalho': ['Jornada'],
  'Gestão de Multas': ['Multas', 'Multa'],
  Videotelemetria: ['Vídeo telemetria', 'Câmera', 'Câmeras', 'DVR'],
  Onboard: ['On board', 'On-board'],
  Abastecimento: ['Combustível'],
  Fretamento: ['Fretado'],
};
export function identificarConteudoAvaliacao(empresa: { temaText?: string }, ocorrencias: { tipo?: string; temaOcorrencia?: string[]; temasRevisados?: string[] }[], manutencao: 'basica' | 'avancada') {
  // A avaliação cobre todos os módulos cadastrados na esteira, inclusive os ainda pendentes.
  const temas = (empresa.temaText || '').split('\n').map(t => t.trim()).filter(Boolean);
  for (const o of ocorrencias) if (normalizarConhecimento(o.tipo || '') === 'treinamento') temas.push(...(o.temaOcorrencia || []), ...(o.temasRevisados || []));
  const normalizados = temas.map(normalizarConhecimento);
  const contem = (secao: Secao) => [secao, ...(SINONIMOS_SECOES[secao] || [])]
    .some(termo => normalizados.some(t => t.includes(normalizarConhecimento(termo))));
  const avancados = SECOES.filter(s => s !== 'Temas iniciais' && !s.startsWith('Manutenção') && contem(s));
  const niveisManutencao = SECOES.filter(s => s.startsWith('Manutenção') && contem(s));
  const manutencaoIndefinida = !niveisManutencao.length && normalizados.some(t => t.includes('manutencao'));
  if (manutencaoIndefinida) niveisManutencao.push(manutencao === 'basica' ? 'Manutenção básica' : 'Manutenção avançada');
  const secoes: Secao[] = ['Temas iniciais', ...avancados, ...niveisManutencao];
  return { secoes, manutencaoIndefinida };
}
export function montarQuestoes(banco: PerguntaConhecimento[], secoes: Secao[], anteriores: TentativaValidacao[] = [], aleatorio = Math.random) {
  const corretas = new Set(anteriores.flatMap(t => t.questoes.filter(q => q.resposta === 'correto').map(q => q.id)));
  const textosCorretos = new Set(anteriores.flatMap(t => t.questoes.filter(q => q.resposta === 'correto').map(q => normalizarConhecimento(q.texto))));
  const ultima = anteriores[0];
  const selecionadas: QuestaoValidacao[] = (ultima?.questoes || []).filter(q => q.resposta !== 'correto' && !corretas.has(q.id)).map(q => ({ ...q, resposta: null, origem: 'mantida' }));
  const avisos: string[] = [];
  const disponiveis = banco.filter(q => q.ativa !== false && secoes.includes(q.secao) && !corretas.has(q.id) && !textosCorretos.has(normalizarConhecimento(q.texto)));
  // Sorteia dentro de cada prioridade; no conteúdo básico, usa as preferidas primeiro.
  for (let i = disponiveis.length - 1; i > 0; i--) { const j = Math.floor(aleatorio() * (i + 1)); [disponiveis[i], disponiveis[j]] = [disponiveis[j], disponiveis[i]]; }
  const prioridade = (q: PerguntaConhecimento) => q.secao === 'Temas iniciais' && q.preferida ? 1 : 0;
  disponiveis.sort((a, b) => prioridade(b) - prioridade(a));
  const adicionar = (secao: Secao, quantidade: number, avisar = true) => {
    for (const q of disponiveis) {
      if (selecionadas.filter(item => item.secao === secao).length >= quantidade) break;
      if (q.secao === secao && !selecionadas.some(item => item.id === q.id || normalizarConhecimento(item.texto) === normalizarConhecimento(q.texto))) selecionadas.push({ ...q, resposta: null, origem: 'banco' });
    }
    if (avisar && selecionadas.filter(q => q.secao === secao).length < quantidade) avisos.push(`${secao}: perguntas elegíveis insuficientes para atingir ${quantidade}. Solicite ao Master mais perguntas para esta seção no banco.`);
  };
  const avancadas = secoes.filter(s => s !== 'Temas iniciais');
  const total = Math.max(10, 4 + 2 * avancadas.length);
  adicionar('Temas iniciais', Math.max(4, total - 2 * avancadas.length));
  avancadas.forEach(s => adicionar(s, 2));
  const iniciais = selecionadas.filter(q => q.secao === 'Temas iniciais').length;
  adicionar('Temas iniciais', iniciais + Math.max(0, total - selecionadas.length), false);
  const complementares = selecionadas.filter(q => q.secao === 'Temas iniciais').length - iniciais;
  if (complementares) avisos.push(`${complementares === 1 ? 'Incluída 1 pergunta' : `Incluídas ${complementares} perguntas`} de temas iniciais para completar a avaliação.`);
  if (ultima) {
    for (const q of disponiveis) {
      if (selecionadas.length >= total) break;
      if (!selecionadas.some(item => item.id === q.id || normalizarConhecimento(item.texto) === normalizarConhecimento(q.texto))) selecionadas.push({ ...q, resposta: null, origem: 'banco' });
    }
  }
  if (selecionadas.length < total) avisos.push(`A avaliação contém ${selecionadas.length} de ${total} perguntas previstas. Não há perguntas elegíveis suficientes no banco para completar a quantidade.`);
  return { questoes: selecionadas, avisos };
}

export interface IndicadoresValidacao {
  tentativasConcluidas: number; clientesAvaliados: number; aprovadas: number;
  taxaAprovacao: number | null; aprovacaoPrimeiraTentativa: number | null;
  mediaAproveitamento: number | null; mediaTentativasAteAprovar: number | null;
  porSecao: { secao: Secao; respostas: number; aproveitamento: number }[];
  perguntasComMaisErros: { texto: string; secao: Secao; respostas: number; aproveitamento: number }[];
  porTreinador: { treinadorNome: string; tentativas: number; aprovadas: number; mediaAproveitamento: number }[];
}
const media = (valores: number[]) => valores.length ? valores.reduce((a, b) => a + b, 0) / valores.length : null;
const peso = (resposta: RespostaValidacao | null) => resposta === 'correto' ? 1 : resposta === 'parcial' ? .5 : 0;

/** Indicadores das tentativas concluídas; aproveitamento em % (correto = 1, parcial = 0,5). */
export function calcularIndicadoresValidacao(tentativas: TentativaValidacao[]): IndicadoresValidacao {
  const concluidas = tentativas.filter(t => t.status === 'concluida');
  const aprovadas = concluidas.filter(t => t.aprovada);
  const primeiras = concluidas.filter(t => t.numero === 1);
  const secoes = new Map<Secao, { soma: number; n: number }>();
  const perguntas = new Map<string, { texto: string; secao: Secao; soma: number; n: number }>();
  const treinadores = new Map<string, { treinadorNome: string; percentuais: number[]; aprovadas: number }>();
  for (const t of concluidas) {
    for (const q of t.questoes) {
      const s = secoes.get(q.secao) || { soma: 0, n: 0 };
      s.soma += peso(q.resposta); s.n++; secoes.set(q.secao, s);
      const chave = `${q.secao}:${normalizarConhecimento(q.texto)}`;
      const p = perguntas.get(chave) || { texto: q.texto, secao: q.secao, soma: 0, n: 0 };
      p.soma += peso(q.resposta); p.n++; perguntas.set(chave, p);
    }
    const tr = treinadores.get(t.treinadorId) || { treinadorNome: t.treinadorNome, percentuais: [], aprovadas: 0 };
    tr.percentuais.push(t.percentual ?? 0); if (t.aprovada) tr.aprovadas++; treinadores.set(t.treinadorId, tr);
  }
  const pct = (parte: number, total: number) => total ? 100 * parte / total : null;
  return {
    tentativasConcluidas: concluidas.length,
    clientesAvaliados: new Set(concluidas.map(t => t.empresaId)).size,
    aprovadas: aprovadas.length,
    taxaAprovacao: pct(aprovadas.length, concluidas.length),
    aprovacaoPrimeiraTentativa: pct(primeiras.filter(t => t.aprovada).length, primeiras.length),
    mediaAproveitamento: media(concluidas.map(t => t.percentual ?? 0)),
    mediaTentativasAteAprovar: media(aprovadas.map(t => t.numero)),
    porSecao: [...secoes].map(([secao, s]) => ({ secao, respostas: s.n, aproveitamento: 100 * s.soma / s.n }))
      .sort((a, b) => a.aproveitamento - b.aproveitamento || b.respostas - a.respostas),
    // Exige ao menos duas respostas para não destacar uma pergunta por um único erro.
    perguntasComMaisErros: [...perguntas.values()].filter(p => p.n >= 2 && p.soma < p.n)
      .map(p => ({ texto: p.texto, secao: p.secao, respostas: p.n, aproveitamento: 100 * p.soma / p.n }))
      .sort((a, b) => a.aproveitamento - b.aproveitamento || b.respostas - a.respostas).slice(0, 5),
    porTreinador: [...treinadores.values()].map(t => ({ treinadorNome: t.treinadorNome, tentativas: t.percentuais.length, aprovadas: t.aprovadas, mediaAproveitamento: media(t.percentuais) ?? 0 }))
      .sort((a, b) => b.tentativas - a.tentativas || a.treinadorNome.localeCompare(b.treinadorNome, 'pt-BR')),
  };
}
