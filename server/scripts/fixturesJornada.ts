import type { Empresa, Ocorrencia } from '../../app/src/types.js';
import { calcularPontuacaoScore, obterTipoEfetivo, type ScoreFormAnswers } from '../../app/src/utils/score.js';

/** Exemplos sintéticos, com IDs reservados; nunca usam cadastros reais. */
export function criarExemplosJornada(agora = Date.now(), treinador = 'Clarice Pereira') {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(agora);
  const parte = (tipo: string) => partes.find((p) => p.type === tipo)!.value;
  const hoje = Date.parse(`${parte('year')}-${parte('month')}-${parte('day')}T09:00:00-03:00`);
  const dia = (n: number) => hoje + n * 86_400_000;
  const iso = (n: number) => new Date(dia(n)).toISOString().slice(0, 10);
  const boas: ScoreFormAnswers = { entraComputador: 'Sim', compartilhaTela: 'Sim', fazPerguntas: 'Sim', recordaTemas: 'Sim', faltouDoisDias: 'Não', estruturaNecessaria: 'Sim', clienteReclamante: 'Não', clienteSumido: 'Não' };
  const sete: ScoreFormAnswers = { ...boas, fazPerguntas: 'Não', estruturaNecessaria: 'Não' };
  const seis: ScoreFormAnswers = { ...sete, compartilhaTela: 'Não' };
  const cinco: ScoreFormAnswers = { ...sete, recordaTemas: 'Não' };
  const empresas: Empresa[] = [];
  const ocorrencias: Ocorrencia[] = [];
  const novo = (chave: string, nome: string, inicio = -35): Empresa => {
    const empresa: Empresa = { id: `demo-jornada-${chave}`, nomeEmpresa: `[Demo Jornada] ${nome}`, responsavel: treinador,
      csResponsavel: 'Ana CS', tipo: '', dataEntrada: iso(inicio), temaText: 'Introdução\nCadastros\nRelatórios',
      dataText: `${iso(-28)}\n${iso(-21)}\n${iso(-14)}`, currentPhase: 1, updatedAt: agora };
    empresas.push(empresa);
    return empresa;
  };
  const evento = (e: Empresa, chave: string, n: number, tipo: string, descricao: string, extras: Partial<Ocorrencia> = {}) => {
    const o: Ocorrencia = { id: `${e.id}-${chave}`, empresa: e.nomeEmpresa, tipo, departamento: 'Treinamento', responsavel: treinador,
      descricao, createdAt: dia(n), updatedAt: agora, dataOcorrencia: 0, ...extras };
    ocorrencias.push(o);
    return o;
  };
  const score = (e: Empresa, n: number, respostas: ScoreFormAnswers) => {
    const resultado = calcularPontuacaoScore(respostas);
    e.score = resultado.score; e.scoreAnswers = respostas; e.tipo = resultado.tipo;
    evento(e, `score-${n}`, n, 'Mudança de score', `Questionário preenchido: score ${resultado.score}.`, { scoreCalculado: resultado.score, scoreAnswers: respostas });
  };
  const treino = (e: Empresa, n: number) => {
    evento(e, `agenda-${n}`, n - 2, 'Informativa', 'Próximo treinamento agendado com o cliente.', { dataOcorrencia: dia(n) });
    evento(e, `treino-${n}`, n, 'Treinamento', 'Treinamento realizado: cadastros e relatórios. Cliente praticou os procedimentos.', {
      temaOcorrencia: ['Cadastros'], treinamentoResultados: ['Bom'], treinamentoDataSolicitacao: iso(n - 2),
    });
  };
  const duvida = (e: Empresa, n: number, departamento = 'Suporte') => {
    const o = evento(e, `duvida-${n}`, n, 'Dúvida', 'Cliente precisou de ajuda para refazer os cadastros abordados no treinamento.', { departamento });
    e.scoreAjustesTemporarios = [...(e.scoreAjustesTemporarios ?? []), {
      motivo: `Contato com o ${departamento} (dúvida)`, valor: 1, criadoEm: dia(n), expiraEm: dia(n + 15), ocorrenciaId: o.id,
    }];
  };

  const estavel = novo('fast', 'Fast estável'); score(estavel, -35, boas);
  [-31, -25, -19, -13, -7].forEach((n) => treino(estavel, n));
  evento(estavel, 'proxima-agenda', -1, 'Informativa', 'Próximo treinamento confirmado.', { dataOcorrencia: dia(2) });

  const suporte = novo('suporte', 'Virou Safety por suporte'); score(suporte, -35, seis);
  [-31, -27, -23, -19, -15, -11].forEach((n) => treino(suporte, n)); duvida(suporte, -7);

  const recuperado = novo('recuperacao', 'Voltou a Fast após 15 dias'); score(recuperado, -35, seis);
  [-31, -27, -23, -19, -15, -11, -7, -3].forEach((n) => treino(recuperado, n)); duvida(recuperado, -24);

  const respostas = novo('respostas', 'Safety pelas respostas do score'); score(respostas, -35, sete);
  [-31, -27, -23, -19, -15, -11].forEach((n) => treino(respostas, n)); score(respostas, -10, cinco);

  const combinado = novo('oscilacao', 'Respostas e suporte juntos'); score(combinado, -35, boas);
  [-31, -27, -23, -19, -15, -11, -7, -3].forEach((n) => treino(combinado, n));
  score(combinado, -18, seis); duvida(combinado, -16); duvida(combinado, -12, 'Treinamento'); score(combinado, -4, boas);

  const semScore = novo('sem-score', 'Sem questionário registrado', -12); treino(semScore, -8);
  const concluido = novo('concluido', 'Jornada concluída'); score(concluido, -35, boas);
  [-31, -25, -19, -13, -7].forEach((n) => treino(concluido, n)); concluido.dataFinalizacao = iso(-2); concluido.currentPhase = 3;
  const suspenso = novo('suspenso', 'Safety suspenso'); score(suspenso, -35, cinco); treino(suspenso, -28);
  suspenso.isSuspended = true; suspenso.dataSuspensao = iso(-20);
  empresas.forEach((e) => { e.tipo = obterTipoEfetivo(e, agora); });
  return { empresas, ocorrencias };
}
