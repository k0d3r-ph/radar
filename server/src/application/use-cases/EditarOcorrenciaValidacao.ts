import type { Firestore } from 'firebase-admin/firestore';
import { duracaoAgendaValida } from '../../domain/duracaoAgenda.js';
import { isSolicitanteTreinamento } from '../../domain/validacaoConhecimento.js';
import { AtualizacaoValidacaoError } from './AdicionarAtualizacaoValidacao.js';

type MotivoEspera = 'cliente' | 'agenda_treinador';
type ResultadoCsat = 'Bom' | 'Ruim';

/** Campos que o Master pode editar numa ocorrência da Validação do conhecimento. */
export interface EdicaoOcorrenciaValidacao {
  descricao: string;
  departamento: string;
  responsavel: string;
  dataOcorrencia: number;
  createdAt: number;
  treinamentoDataSolicitacao: string;
  treinamentoTempoAgenda: string;
  treinamentoSolicitante: string;
  treinamentoMotivoEspera: MotivoEspera | null;
  treinamentoResultados: ResultadoCsat[];
}

export interface PedidoEdicaoOcorrenciaValidacao {
  dados: EdicaoOcorrenciaValidacao;
  /** Treinador que passa a receber o ponto da gamificação (resolvido pelo responsável). */
  treinadorId?: string;
  /** `updatedAt` lido ao abrir a edição; diferente do atual indica alteração concorrente. */
  updatedAtEsperado?: number;
}

const ROTULOS: Record<keyof EdicaoOcorrenciaValidacao, string> = {
  descricao: 'descrição',
  departamento: 'departamento',
  responsavel: 'responsável',
  dataOcorrencia: 'data da ocorrência',
  createdAt: 'data de criação',
  treinamentoDataSolicitacao: 'data de solicitação',
  treinamentoTempoAgenda: 'tempo de agenda',
  treinamentoSolicitante: 'quem solicitou',
  treinamentoMotivoEspera: 'motivo da espera',
  treinamentoResultados: 'resultados do CSAT',
};
/** Campos curtos: o registro mostra o valor anterior e o novo. */
const COM_VALORES = new Set<keyof EdicaoOcorrenciaValidacao>([
  'departamento', 'responsavel', 'treinamentoDataSolicitacao', 'treinamentoTempoAgenda', 'treinamentoSolicitante',
]);

const diaBrasilia = (instante: number) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(instante);
const dataValida = (valor: unknown): valor is string =>
  typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor) && !Number.isNaN(Date.parse(`${valor}T12:00:00Z`));
const instanteValido = (valor: unknown, minimo: number): valor is number =>
  typeof valor === 'number' && Number.isFinite(valor) && valor >= minimo;
const idValido = (valor: unknown): valor is string => typeof valor === 'string' && /^[a-zA-Z0-9_-]+$/.test(valor);
const texto = (valor: unknown, limite: number) =>
  typeof valor === 'string' && valor.trim() && valor.trim().length <= limite ? valor.trim() : null;

function falha(mensagem: string): never {
  throw new AtualizacaoValidacaoError(400, mensagem);
}

/** Valida o corpo da requisição; dados externos nunca chegam ao Firestore sem passar por aqui. */
export function lerPedidoEdicaoOcorrenciaValidacao(corpo: unknown): PedidoEdicaoOcorrenciaValidacao {
  const c = (corpo && typeof corpo === 'object' ? corpo : {}) as Record<string, unknown>;
  const descricao = texto(c.descricao, 50_000) ?? falha('Preencha a descrição (até 50.000 caracteres).');
  const departamento = texto(c.departamento, 60) ?? falha('Selecione o departamento.');
  const responsavel = texto(c.responsavel, 120) ?? falha('Informe o responsável.');
  if (!instanteValido(c.dataOcorrencia, 0)) falha('Informe uma data de ocorrência válida.');
  if (!instanteValido(c.createdAt, 1)) falha('Informe uma data de criação válida.');
  if (!dataValida(c.treinamentoDataSolicitacao)) falha('Preencha a data de solicitação.');
  if (!duracaoAgendaValida(c.treinamentoTempoAgenda) || c.treinamentoTempoAgenda === '00:00') {
    falha('Informe o tempo de agenda em HH:MM, com minutos entre 00 e 59. Ex.: 00:57.');
  }
  if (!isSolicitanteTreinamento(c.treinamentoSolicitante)) falha('Selecione quem solicitou o treinamento.');
  const motivo = c.treinamentoMotivoEspera ?? null;
  if (motivo !== null && motivo !== 'cliente' && motivo !== 'agenda_treinador') falha('Motivo da espera inválido.');
  const resultados = c.treinamentoResultados ?? [];
  if (!Array.isArray(resultados) || resultados.length > 50 || !resultados.every(r => r === 'Bom' || r === 'Ruim')) {
    falha("Selecione 'Bom' ou 'Ruim' para cada resultado de CSAT.");
  }
  if (c.treinamentoDataSolicitacao > diaBrasilia(c.createdAt)) {
    falha('A data de solicitação não pode ser posterior à realização do treinamento.');
  }
  if (c.treinadorId !== undefined && !idValido(c.treinadorId)) falha('Treinador responsável inválido.');
  if (c.updatedAtEsperado !== undefined && !instanteValido(c.updatedAtEsperado, 0)) falha('Versão da ocorrência inválida.');
  return {
    dados: {
      descricao, departamento, responsavel,
      dataOcorrencia: c.dataOcorrencia, createdAt: c.createdAt,
      treinamentoDataSolicitacao: c.treinamentoDataSolicitacao,
      treinamentoTempoAgenda: c.treinamentoTempoAgenda,
      treinamentoSolicitante: c.treinamentoSolicitante,
      treinamentoMotivoEspera: motivo,
      treinamentoResultados: resultados as ResultadoCsat[],
    },
    treinadorId: c.treinadorId as string | undefined,
    updatedAtEsperado: c.updatedAtEsperado as number | undefined,
  };
}

const formatarValor = (campo: keyof EdicaoOcorrenciaValidacao, valor: unknown) => {
  if (typeof valor !== 'string' || !valor) return 'não informado';
  if (campo === 'treinamentoDataSolicitacao' && dataValida(valor)) return valor.split('-').reverse().join('/');
  return valor;
};
const iguais = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Edição, pelo Master, de uma ocorrência gerada pela Validação do conhecimento. As regras do
 * Firestore impedem o SDK cliente de gravar nesses registros; aqui a gravação acontece em
 * transação e replica os campos compartilhados para a tentativa e o ponto de gamificação.
 * Empresa, tipo, temas e o resultado da avaliação não são editáveis: mudá-los desfaria o
 * vínculo com a esteira e com a tentativa.
 */
export class EditarOcorrenciaValidacao {
  constructor(private readonly db: Firestore) {}

  async execute(id: string, pedido: PedidoEdicaoOcorrenciaValidacao, editor: string) {
    const ref = this.db.collection('ocorrencias').doc(id);
    return this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new AtualizacaoValidacaoError(404, 'Ocorrência não encontrada.');
      const ocorrencia = snapshot.data()!;
      if (typeof ocorrencia.validacaoTentativaId !== 'string' || !ocorrencia.validacaoTentativaId) {
        throw new AtualizacaoValidacaoError(409, 'Esta ocorrência não pertence à Validação do conhecimento.');
      }
      if (pedido.updatedAtEsperado !== undefined && ocorrencia.updatedAt !== pedido.updatedAtEsperado) {
        throw new AtualizacaoValidacaoError(409, 'Esta ocorrência foi alterada por outra pessoa enquanto você editava. Recarregue a página e tente novamente.');
      }

      const { dados } = pedido;
      const alterados = (Object.keys(ROTULOS) as (keyof EdicaoOcorrenciaValidacao)[])
        .filter(campo => !iguais(ocorrencia[campo], dados[campo]));
      const atualizacoes = Array.isArray(ocorrencia.atualizacoes) ? ocorrencia.atualizacoes : [];
      if (!alterados.length) {
        return { ...dados, atualizacoes, updatedAt: typeof ocorrencia.updatedAt === 'number' ? ocorrencia.updatedAt : Date.now() };
      }

      const tentativaRef = idValido(ocorrencia.validacaoTentativaId)
        ? this.db.collection('validacao_tentativas').doc(ocorrencia.validacaoTentativaId) : null;
      const pontoRef = idValido(ocorrencia.gamificacaoPontoId)
        ? this.db.collection('gamificacao_pontos').doc(ocorrencia.gamificacaoPontoId) : null;
      const treinadorRef = pedido.treinadorId ? this.db.collection('usuarios').doc(pedido.treinadorId) : null;
      // Todas as leituras antes de qualquer escrita, como o Firestore exige em transações.
      const [tentativa, ponto, treinador] = await Promise.all([
        tentativaRef ? transaction.get(tentativaRef) : null,
        pontoRef ? transaction.get(pontoRef) : null,
        treinadorRef ? transaction.get(treinadorRef) : null,
      ]);
      const dadosTreinador = treinador?.exists ? treinador.data()! : null;
      if (treinadorRef && (!dadosTreinador || dadosTreinador.inativo || !['master', 'treinador'].includes(dadosTreinador.role))) {
        throw new AtualizacaoValidacaoError(400, 'O responsável precisa ser um treinador ou master ativo para receber o ponto da gamificação.');
      }

      const agora = Date.now();
      const resumo = alterados.map(campo => COM_VALORES.has(campo)
        ? `${ROTULOS[campo]} (${formatarValor(campo, ocorrencia[campo])} → ${formatarValor(campo, dados[campo])})`
        : ROTULOS[campo]).join('; ');
      const novasAtualizacoes = [...atualizacoes, { descricao: `Ocorrência editada pelo Master: ${resumo}.`, updatedAt: agora, responsavel: editor }];
      transaction.update(ref, { ...dados, atualizacoes: novasAtualizacoes, updatedAt: agora });

      const compartilhados = {
        treinamentoDataSolicitacao: dados.treinamentoDataSolicitacao,
        treinamentoTempoAgenda: dados.treinamentoTempoAgenda,
        treinamentoSolicitante: dados.treinamentoSolicitante,
      };
      if (tentativaRef && tentativa?.exists) transaction.update(tentativaRef, { ...compartilhados, updatedAt: agora });
      if (pontoRef && ponto?.exists) {
        const dadosPonto = ponto.data()!;
        transaction.update(pontoRef, {
          ...compartilhados,
          treinamentoMotivoEspera: dados.treinamentoMotivoEspera,
          treinamentoResultados: dados.treinamentoResultados,
          treinamentoDataRealizacao: diaBrasilia(dados.createdAt),
          dataLancamento: dados.createdAt,
          // O ponto da validação nasce com a mesma descrição da ocorrência; só acompanha se ainda for cópia.
          ...(dadosPonto.descricao === ocorrencia.descricao ? { descricao: dados.descricao } : {}),
          ...(dadosTreinador && pedido.treinadorId
            ? { treinadorId: pedido.treinadorId, treinadorNome: typeof dadosTreinador.nome === 'string' && dadosTreinador.nome.trim() ? dadosTreinador.nome.trim() : dados.responsavel }
            : {}),
          updatedAt: agora,
        });
      }
      return { ...dados, atualizacoes: novasAtualizacoes, updatedAt: agora };
    });
  }
}
