import type { Firestore } from 'firebase-admin/firestore';
import { createHash, randomBytes } from 'node:crypto';
import { PERGUNTAS_INICIAIS } from '../../domain/perguntasConhecimento.js';
import { calcularIndicadoresValidacao, calcularResultadoValidacao, identificarConteudoAvaliacao, isSolicitanteTreinamento, montarQuestoes, normalizarConhecimento, SECOES, TEMA_VALIDACAO } from '../../domain/validacaoConhecimento.js';
import type { PerguntaConhecimento, QuestaoValidacao, Secao, TentativaValidacao } from '../../domain/validacaoConhecimento.js';
import { CsatError, prepararReservaCsat } from '../../infrastructure/web/csat.js';
import { timestampBrasilia } from '../../domain/acompanhamentoEsteira.js';
import { duracaoAgendaValida } from '../../domain/duracaoAgenda.js';

export interface UsuarioValidacao { uid: string; nome: string; role: string }
const idValido = (id: string) => /^[a-zA-Z0-9_-]{1,160}$/.test(id);
export function validarIdConhecimento(id: unknown): string {
  if (typeof id !== 'string' || !idValido(id)) throw new CsatError(400, 'Identificador inválido.');
  return id;
}
const diaBrasilia = (agora: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
export function validarQuestoes(dados: unknown, secoes: Secao[]): QuestaoValidacao[] {
  if (!Array.isArray(dados) || dados.length > 100) throw new CsatError(400, 'Use uma lista de até 100 perguntas.');
  const ids = new Set<string>(), textos = new Set<string>();
  return dados.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new CsatError(400, 'Pergunta inválida.');
    const q = item as Record<string, unknown>;
    const id = validarIdConhecimento(q.id);
    if (typeof q.texto !== 'string' || !q.texto.trim() || q.texto.length > 2000 || !secoes.includes(q.secao as Secao)
      || ![null, 'correto', 'parcial', 'incorreto'].includes(q.resposta as string | null) || !['banco', 'mantida', 'manual'].includes(String(q.origem))) throw new CsatError(400, 'Preencha a pergunta, a seção elegível e uma resposta válida.');
    const texto = q.texto.trim(), normalizado = normalizarConhecimento(texto);
    if (ids.has(id) || textos.has(normalizado)) throw new CsatError(400, 'A avaliação não pode repetir perguntas.');
    ids.add(id); textos.add(normalizado);
    return { id, texto, secao: q.secao as Secao, preferida: q.preferida === true, resposta: q.resposta as QuestaoValidacao['resposta'], origem: q.origem as QuestaoValidacao['origem'] };
  });
}

export class GerenciarValidacaoConhecimento {
  private bancoCache: { perguntas: PerguntaConhecimento[]; expiraEm: number } | null = null;
  private indicadoresCache = new Map<string, { dados: unknown; expiraEm: number }>();
  constructor(private readonly db: Firestore) {}
  async perguntas(): Promise<PerguntaConhecimento[]> {
    if (this.bancoCache && this.bancoCache.expiraEm > Date.now()) return this.bancoCache.perguntas;
    const controle = this.db.doc('validacao_controle/banco-v1');
    await this.db.runTransaction(async tx => {
      if ((await tx.get(controle)).exists) return;
      PERGUNTAS_INICIAIS.forEach(q => tx.set(this.db.collection('validacao_perguntas').doc(q.id), { ...q, createdAt: Date.now(), updatedAt: Date.now() }));
      tx.set(controle, { versao: 1, updatedAt: Date.now() });
    });
    const perguntas = (await this.db.collection('validacao_perguntas').get()).docs.map(d => ({ ...d.data(), id: d.id } as PerguntaConhecimento));
    this.bancoCache = { perguntas, expiraEm: Date.now() + 300_000 };
    return perguntas;
  }
  async adicionarPergunta(body: Record<string, unknown>, user: UsuarioValidacao) {
    if (user.role !== 'master') throw new CsatError(403, 'Somente Master pode cadastrar perguntas no banco.');
    if (!SECOES.includes(body.secao as Secao) || typeof body.texto !== 'string' || !body.texto.trim() || body.texto.length > 2000) throw new CsatError(400, 'Informe a seção e o texto da pergunta (até 2000 caracteres).');
    const texto = body.texto.trim(), secao = body.secao as Secao;
    const banco = await this.perguntas();
    if (banco.some(q => q.secao === secao && normalizarConhecimento(q.texto) === normalizarConhecimento(texto))) throw new CsatError(409, 'Esta pergunta já existe na seção.');
    const chave = createHash('sha256').update(`${secao}:${normalizarConhecimento(texto)}`).digest('hex');
    // Uma pergunta editada mantém o ID antigo; se ele coincidir com o hash deste texto, usa um sufixo.
    const id = banco.some(q => q.id === chave) ? `${chave.slice(0, 48)}-${randomBytes(6).toString('hex')}` : chave;
    const pergunta: PerguntaConhecimento = { id, secao, texto, preferida: body.preferida === true, ativa: true };
    await this.db.runTransaction(async tx => {
      const ref = this.db.collection('validacao_perguntas').doc(id);
      if ((await tx.get(ref)).exists) throw new CsatError(409, 'Esta pergunta já existe na seção.');
      tx.set(ref, { ...pergunta, criadoPor: user.uid, createdAt: Date.now(), updatedAt: Date.now() });
    });
    this.bancoCache = null;
    return pergunta;
  }
  /**
   * Edita texto/preferência ou ativa/desativa uma pergunta, mantendo o ID e a seção.
   * Tentativas já montadas guardam o próprio texto e não são alteradas.
   */
  async atualizarPergunta(id: string, body: Record<string, unknown>, user: UsuarioValidacao) {
    if (user.role !== 'master') throw new CsatError(403, 'Somente Master pode alterar perguntas do banco.');
    const ref = this.db.collection('validacao_perguntas').doc(validarIdConhecimento(id));
    if (body.texto !== undefined && (typeof body.texto !== 'string' || !body.texto.trim() || body.texto.length > 2000)) throw new CsatError(400, 'Informe o texto da pergunta (até 2000 caracteres).');
    if (body.preferida !== undefined && typeof body.preferida !== 'boolean') throw new CsatError(400, 'Preferida inválida.');
    if (body.ativa !== undefined && typeof body.ativa !== 'boolean') throw new CsatError(400, 'Situação inválida.');
    const banco = await this.perguntas();
    const atualizada = await this.db.runTransaction(async tx => {
      const atual = (await tx.get(ref)).data() as PerguntaConhecimento | undefined;
      if (!atual) throw new CsatError(404, 'Pergunta não encontrada.');
      const texto = typeof body.texto === 'string' ? body.texto.trim() : atual.texto;
      if (banco.some(q => q.id !== id && q.secao === atual.secao && normalizarConhecimento(q.texto) === normalizarConhecimento(texto))) throw new CsatError(409, 'Já existe outra pergunta com este texto na seção.');
      const dados = { texto, preferida: typeof body.preferida === 'boolean' ? body.preferida : atual.preferida,
        ativa: typeof body.ativa === 'boolean' ? body.ativa : atual.ativa !== false, atualizadoPor: user.uid, updatedAt: Date.now() };
      tx.update(ref, dados);
      return { id, secao: atual.secao, texto: dados.texto, preferida: dados.preferida, ativa: dados.ativa } as PerguntaConhecimento;
    });
    this.bancoCache = null;
    return atualizada;
  }
  /**
   * Indicadores das tentativas concluídas entre as datas (YYYY-MM-DD, Brasília, inclusivas).
   * Lê só as tentativas concluídas no período e guarda o resultado por 5 minutos.
   */
  async indicadores(inicio: unknown, fim: unknown) {
    const ini = typeof inicio === 'string' ? timestampBrasilia(inicio) : undefined;
    const fimDia = typeof fim === 'string' ? timestampBrasilia(fim) : undefined;
    if (ini === undefined || fimDia === undefined || ini > fimDia) throw new CsatError(400, 'Informe um período válido, com a data inicial anterior ou igual à final.');
    if (fimDia - ini > 366 * 86_400_000) throw new CsatError(400, 'Escolha um período de até um ano.');
    const chave = `${inicio}:${fim}`, agora = Date.now();
    const emCache = this.indicadoresCache.get(chave);
    if (emCache && emCache.expiraEm > agora) return emCache.dados;
    const docs = await this.db.collection('validacao_tentativas').where('concluidaEm', '>=', ini).where('concluidaEm', '<', fimDia + 86_400_000).get();
    const dados = { inicio, fim, ...calcularIndicadoresValidacao(docs.docs.map(d => ({ ...d.data(), id: d.id } as TentativaValidacao))) };
    if (this.indicadoresCache.size > 50) this.indicadoresCache.clear();
    this.indicadoresCache.set(chave, { dados, expiraEm: agora + 300_000 });
    return dados;
  }
  async listar(empresaId: string) {
    validarIdConhecimento(empresaId);
    const docs = await this.db.collection('validacao_tentativas').where('empresaId', '==', empresaId).get();
    return docs.docs.map(d => ({ ...d.data(), id: d.id } as TentativaValidacao)).filter(t => t.status !== 'cancelada').sort((a, b) => b.numero - a.numero);
  }
  async iniciar(body: Record<string, unknown>, user: UsuarioValidacao) {
    const empresaId = validarIdConhecimento(body.empresaId);
    if (!['basica', 'avancada'].includes(String(body.manutencao))) throw new CsatError(400, 'Escolha o conteúdo de Manutenção.');
    const banco = await this.perguntas();
    const ref = this.db.collection('validacao_tentativas').doc();
    return this.db.runTransaction(async tx => {
      const lockRef = this.db.collection('validacao_clientes').doc(empresaId);
      const [cliente, lock, anteriores] = await Promise.all([
        tx.get(this.db.collection('empresas').doc(empresaId)), tx.get(lockRef),
        tx.get(this.db.collection('validacao_tentativas').where('empresaId', '==', empresaId)),
      ]);
      const empresa = cliente.data();
      if (!empresa) throw new CsatError(404, 'Cliente não encontrado.');
      if (empresa.isSuspended || empresa.isCancelled) throw new CsatError(409, 'Retorne o cliente à esteira antes de iniciar a avaliação.');
      if (lock.data()?.ativaId) throw new CsatError(409, 'Este cliente já possui uma avaliação em andamento ou pausada. Retome a avaliação existente.');
      const historico = anteriores.docs.map(d => ({ ...d.data(), id: d.id } as TentativaValidacao)).sort((a, b) => b.numero - a.numero);
      if (historico.some(t => t.status === 'andamento' || t.status === 'pausada')) throw new CsatError(409, 'Este cliente já possui uma avaliação em andamento ou pausada. Retome a avaliação existente.');
      const concluidas = historico.filter(t => t.status === 'concluida');
      const ultima = concluidas[0];
      if (ultima && (ultima.aprovada || body.anteriorId !== ultima.id)) throw new CsatError(409, 'Uma nova tentativa exige a última avaliação concluída sem aprovação.');
      const ocorrencias = await tx.get(this.db.collection('ocorrencias').where('empresa', '==', empresa.nomeEmpresa));
      const manutencao = ultima?.secoes.includes('Manutenção avançada') ? 'avancada'
        : ultima?.secoes.includes('Manutenção básica') ? 'basica' : body.manutencao as 'basica' | 'avancada';
      const conteudo = identificarConteudoAvaliacao(empresa, ocorrencias.docs.map(d => d.data()), manutencao);
      const secoes = [...new Set([...conteudo.secoes, ...(ultima?.questoes.filter(q => q.resposta !== 'correto').map(q => q.secao) || [])])];
      const selecao = montarQuestoes(banco, secoes, concluidas);
      const agora = Date.now();
      const tentativa: TentativaValidacao = { id: ref.id, empresaId, empresa: empresa.nomeEmpresa, treinadorId: user.uid, treinadorNome: user.nome,
        status: 'andamento', numero: (ultima?.numero || 0) + 1, anteriorId: ultima?.id || null, ...selecao, secoes, revisao: 1, createdAt: agora, updatedAt: agora,
        treinamentoDataSolicitacao: diaBrasilia(agora), treinamentoTempoAgenda: '', treinamentoSolicitante: 'CS' };
      tx.set(ref, tentativa);
      tx.set(lockRef, { ativaId: ref.id, updatedAt: agora });
      return tentativa;
    });
  }
  private autorizar(t: TentativaValidacao | undefined, user: UsuarioValidacao) {
    if (!t) throw new CsatError(404, 'Avaliação não encontrada.');
    if (t.treinadorId !== user.uid && user.role !== 'master') throw new CsatError(403, 'Somente o treinador responsável ou Master pode alterar esta avaliação.');
  }
  async salvar(id: string, body: Record<string, unknown>, user: UsuarioValidacao) {
    const ref = this.db.collection('validacao_tentativas').doc(validarIdConhecimento(id));
    return this.db.runTransaction(async tx => {
      const t = (await tx.get(ref)).data() as TentativaValidacao | undefined;
      this.autorizar(t, user);
      if (t!.status === 'concluida' || t!.status === 'cancelada') throw new CsatError(409, 'Esta tentativa está concluída ou cancelada e não pode ser alterada.');
      if (body.revisao !== t!.revisao) throw new CsatError(409, 'A avaliação mudou em outra aba. Recarregue antes de salvar.');
      if (!['andamento', 'pausada'].includes(String(body.status))) throw new CsatError(400, 'Status inválido.');
      const questoes = validarQuestoes(body.questoes, t!.secoes);
      // IDs de perguntas do banco e perguntas mantidas não podem ser trocados para contornar o histórico.
      const historico = await tx.get(this.db.collection('validacao_tentativas').where('empresaId', '==', t!.empresaId));
      const corretas = new Set(historico.docs.filter(d => d.data().status === 'concluida').flatMap(d => (d.data() as TentativaValidacao).questoes.filter(q => q.resposta === 'correto').map(q => q.id)));
      const textosCorretos = new Set(historico.docs.filter(d => d.data().status === 'concluida').flatMap(d => (d.data() as TentativaValidacao).questoes.filter(q => q.resposta === 'correto').map(q => normalizarConhecimento(q.texto))));
      if (questoes.some(q => corretas.has(q.id) || textosCorretos.has(normalizarConhecimento(q.texto)))) throw new CsatError(400, 'Perguntas já respondidas corretamente não podem ser repetidas.');
      const metadados: Record<string, string> = {};
      for (const campo of ['treinamentoDataSolicitacao', 'treinamentoTempoAgenda', 'treinamentoSolicitante']) {
        if (typeof body[campo] !== 'string' || String(body[campo]).length > 200) throw new CsatError(400, 'Preencha os dados da agenda.');
        metadados[campo] = String(body[campo]).trim();
      }
      // Rascunho pode ficar sem solicitante; preenchido, precisa ser uma das opções padrão.
      if (metadados.treinamentoSolicitante && !isSolicitanteTreinamento(metadados.treinamentoSolicitante)) throw new CsatError(400, 'Selecione quem solicitou entre as opções disponíveis.');
      if (metadados.treinamentoTempoAgenda && !duracaoAgendaValida(metadados.treinamentoTempoAgenda)) throw new CsatError(400, 'Informe a duração da agenda em HH:MM, com minutos entre 00 e 59.');
      if (!timestampBrasilia(metadados.treinamentoDataSolicitacao)) throw new CsatError(400, 'Informe uma data de solicitação válida.');
      const atualizada = { ...t!, ...metadados, questoes, status: body.status as 'andamento' | 'pausada', revisao: t!.revisao + 1, updatedAt: Date.now() };
      tx.update(ref, atualizada);
      return atualizada;
    });
  }
  async cancelar(id: string, revisao: unknown, user: UsuarioValidacao) {
    const ref = this.db.collection('validacao_tentativas').doc(validarIdConhecimento(id));
    return this.db.runTransaction(async tx => {
      const t = (await tx.get(ref)).data() as TentativaValidacao | undefined;
      // Controle mínimo para repetir a requisição com segurança, sem guardar o formulário.
      const descarteRef = this.db.collection('validacao_controle').doc(`descarte-${id}`);
      if (!t) {
        const descarte = (await tx.get(descarteRef)).data();
        if (!descarte) throw new CsatError(404, 'Avaliação não encontrada.');
        if (descarte.treinadorId !== user.uid && user.role !== 'master') throw new CsatError(403, 'Somente o treinador responsável ou Master pode alterar esta avaliação.');
        return { id };
      }
      this.autorizar(t, user);
      if (t!.status === 'concluida') throw new CsatError(409, 'Uma avaliação concluída não pode ser cancelada.');
      if (revisao !== t!.revisao) throw new CsatError(409, 'A avaliação mudou em outra aba. Recarregue antes de cancelar.');
      const lockRef = this.db.collection('validacao_clientes').doc(t!.empresaId);
      const lock = (await tx.get(lockRef)).data();
      if (lock?.ativaId && lock.ativaId !== id) throw new CsatError(409, 'A avaliação ativa mudou. Recarregue antes de cancelar.');
      const agora = Date.now();
      tx.delete(ref);
      tx.set(descarteRef, { treinadorId: t!.treinadorId, canceladaPorId: user.uid, canceladaEm: agora });
      if (lock?.ativaId === id) tx.set(lockRef, { ativaId: null, updatedAt: agora });
      return { id };
    });
  }
  async concluir(id: string, revisao: unknown, user: UsuarioValidacao) {
    const ref = this.db.collection('validacao_tentativas').doc(validarIdConhecimento(id));
    const token = randomBytes(32).toString('hex');
    return this.db.runTransaction(async tx => {
      const t = (await tx.get(ref)).data() as TentativaValidacao | undefined;
      this.autorizar(t, user);
      if (t!.status === 'concluida') return t!; // Retry após falha de rede: devolve a mesma ocorrência e CSAT.
      if (t!.status === 'cancelada') throw new CsatError(409, 'Esta avaliação foi cancelada. Gere um novo formulário.');
      if (revisao !== t!.revisao) throw new CsatError(409, 'A avaliação mudou. Recarregue antes de concluir.');
      if (t!.status !== 'andamento') throw new CsatError(409, 'Retome a avaliação antes de concluir.');
      if (!duracaoAgendaValida(t!.treinamentoTempoAgenda) || !isSolicitanteTreinamento(t!.treinamentoSolicitante)) throw new CsatError(400, 'Informe a duração da agenda em HH:MM e selecione o solicitante.');
      let resultado: ReturnType<typeof calcularResultadoValidacao>;
      try { resultado = calcularResultadoValidacao(t!.questoes); } catch { throw new CsatError(400, 'Responda todas as perguntas antes de concluir.'); }
      const empresaRef = this.db.collection('empresas').doc(t!.empresaId);
      const empresa = (await tx.get(empresaRef)).data();
      if (!empresa || empresa.isCancelled) throw new CsatError(409, 'Cliente indisponível para treinamento.');
      let preparada: Awaited<ReturnType<typeof prepararReservaCsat>>;
      try {
        preparada = await prepararReservaCsat(this.db, tx, { uid: t!.treinadorId, nome: t!.treinadorNome }, t!.empresaId, this.db.collection('csatReservas').doc(id), token);
      } catch (error) {
        // A conclusão gera um link próprio; uma reserva comum pendente do treinador bloqueia como no Histórico.
        if (error instanceof CsatError && error.message.endsWith(' antes de gerar outro link do CSAT.')) {
          throw new CsatError(409, `${error.message.replace(' antes de gerar outro link do CSAT.', '')} no Histórico antes de concluir a validação. A conclusão gera um novo link do CSAT; as respostas desta avaliação já foram salvas.`);
        }
        throw error;
      }
      const agora = Date.now(), data = diaBrasilia(agora);
      const formatar = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
      const respostas = { correto: 'Correto', parcial: 'Parcial', incorreto: 'Incorreto' };
      const perguntas = t!.questoes.map((q, i) => [
        `${i + 1}. ${q.texto} (${q.secao})`,
        `Resposta: ${respostas[q.resposta!]}`,
        `Pontuação: ${formatar(calcularResultadoValidacao([q]).nota / t!.questoes.length)}/${formatar(10 / t!.questoes.length)}`,
      ].join('\n')).join('\n\n');
      const descricao = [
        `Validação do conhecimento — tentativa ${t!.numero}`,
        `Pontuação total: ${formatar(resultado.nota)}/10`,
        `Aproveitamento: ${formatar(resultado.percentual)}%`,
        `Resultado: ${resultado.aprovada ? 'Aprovado — atingiu o mínimo de 80%.' : 'Não aprovado — não atingiu o mínimo de 80%. Nova tentativa disponível.'}`,
        '', 'Perguntas e respostas:', perguntas,
      ].join('\n');
      const pontoId = id;
      const ocorrencia = { empresa: empresa.nomeEmpresa, empresaId: t!.empresaId, tipo: 'Treinamento', departamento: 'Treinamento', responsavel: t!.treinadorNome,
        descricao, temaOcorrencia: [TEMA_VALIDACAO], temasRevisados: [], dataOcorrencia: agora, createdAt: agora, updatedAt: agora,
        idSeqFormatted: preparada.reserva.idSeqFormatted, csatReservaId: id, csatRespostas: [], treinamentoResultados: [], gamificacaoPontoId: pontoId,
        treinamentoDataSolicitacao: t!.treinamentoDataSolicitacao, treinamentoTempoAgenda: t!.treinamentoTempoAgenda, treinamentoSolicitante: t!.treinamentoSolicitante,
        validacaoTentativaId: id, validacaoAprovada: resultado.aprovada, validacaoNota: resultado.nota, validacaoPercentual: resultado.percentual };
      const linhasTema = String(empresa.temaText || '').split('\n').map(l => l.trim());
      const indicesValidos = linhasTema.flatMap((tema, i) => tema ? [i] : []);
      const temas = indicesValidos.map(i => linhasTema[i]);
      const indice = temas.findIndex(tema => normalizarConhecimento(tema) === normalizarConhecimento(TEMA_VALIDACAO));
      const faseAtual = Number(empresa.currentPhase ?? -1);
      // A aprovação sempre registra a data do tema de validação. Com temas ainda pendentes
      // antes dele, a fase não avança agora: como âncora final da esteira, ele passa a contar
      // quando o último tema pendente for registrado no Histórico (reordenarTemasEnsinados).
      const registraTema = resultado.aprovada && !empresa.isOngoing && indice >= 0;
      const avanca = registraTema && faseAtual >= indice - 1 && faseAtual < indice;
      let alteracoesEsteira: Record<string, unknown> = {};
      if (registraTema) {
        const datasOriginais = String(empresa.dataText || '').split('\n');
        const datas = indicesValidos.map(i => datasOriginais[i] || '');
        if (!datas[indice]?.trim()) datas[indice] = `${data.slice(8, 10)}/${data.slice(5, 7)}`;
        alteracoesEsteira = { temaText: temas.join('\n'), dataText: datas.join('\n'), updatedAt: agora,
          ...(avanca ? { currentPhase: indice, ...(indice === temas.length - 1 && !empresa.dataFinalizacao ? { dataFinalizacao: data } : {}) } : {}) };
      }
      preparada.aplicar({ status: 'concluida', validacaoTentativaId: id, gamificacaoPontoId: pontoId }, alteracoesEsteira);
      tx.set(this.db.collection('ocorrencias').doc(id), ocorrencia);
      tx.set(this.db.collection('gamificacao_pontos').doc(pontoId), {
        treinadorId: t!.treinadorId, treinadorNome: t!.treinadorNome, tipoAcao: 'treinamento', pontos: 1, descricao,
        criadoPorId: user.uid, criadoPorNome: user.nome, dataLancamento: agora, updatedAt: agora,
        treinamentoEmpresa: empresa.nomeEmpresa, treinamentoTema: TEMA_VALIDACAO, treinamentoDataSolicitacao: t!.treinamentoDataSolicitacao,
        treinamentoDataRealizacao: data, treinamentoTempoAgenda: t!.treinamentoTempoAgenda, treinamentoSolicitante: t!.treinamentoSolicitante, treinamentoResultados: [],
      });
      const concluida: TentativaValidacao = { ...t!, ...resultado, status: 'concluida', concluidaEm: agora, updatedAt: agora, revisao: t!.revisao + 1, ocorrenciaId: id, csatToken: token, concluiuEsteira: avanca && indice === temas.length - 1 && !empresa.dataFinalizacao };
      tx.update(ref, concluida);
      tx.set(this.db.collection('validacao_clientes').doc(t!.empresaId), { ativaId: null, updatedAt: agora });
      return concluida;
    });
  }
}
