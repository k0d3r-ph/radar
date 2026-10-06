import type { Express, Request } from 'express';
import type { Firestore } from 'firebase-admin/firestore';
import type { Auth } from 'firebase-admin/auth';
import { randomBytes, createHash } from 'crypto';

class CsatError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function validarResposta(body: any) {
  const nome = typeof body?.nome === 'string' ? body.nome.trim() : '';
  const opiniao = typeof body?.opiniao === 'string' ? body.opiniao.trim() : '';
  if (!nome || nome.length > 120 || !['Bom', 'Ruim'].includes(body?.experiencia)
    || opiniao.length > 100 || typeof body?.responseId !== 'string'
    || !/^[a-zA-Z0-9-]{16,64}$/.test(body.responseId)) {
    throw new CsatError(400, 'Informe nome, experiência (Bom ou Ruim) e opinião com até 100 caracteres.');
  }
  return { nome, experiencia: body.experiencia as 'Bom' | 'Ruim', opiniao };
}

export function registrarCsat(app: Express, db: Firestore | null, auth: Auth | null) {
  const wrap = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: any) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (!db || !auth) throw new CsatError(503, 'CSAT indisponível.');
      res.json(await fn(req));
    } catch (error) {
      res.status(error instanceof CsatError ? error.status : 500).json({
        error: error instanceof CsatError ? error.message : 'Não foi possível processar o CSAT. Tente novamente.',
      });
    }
  };
  const usuario = async (req: Request) => {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    let uid: string;
    try { uid = (await auth!.verifyIdToken(token || '', true)).uid; }
    catch { throw new CsatError(401, 'Entre novamente no Radar.'); }
    const user = (await db!.collection('usuarios').doc(uid).get()).data();
    if (!user || !['master', 'treinador'].includes(user.role) || user.needsPasswordChange) {
      throw new CsatError(403, 'Apenas usuários de treinamento podem gerar CSAT.');
    }
    return { uid, nome: user.nome || 'Treinamento' };
  };
  const tokenRef = (token: string) => {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new CsatError(404, 'Link de CSAT inválido.');
    return db!.collection('csatLinks').doc(createHash('sha256').update(token).digest('hex'));
  };
  app.post('/api/csat/reservas', wrap(async req => {
    const user = await usuario(req);
    if (typeof req.body?.empresaId !== 'string' || req.body.empresaId.includes('/')) throw new CsatError(400, 'Selecione o cliente.');
    const empresa = await db!.collection('empresas').doc(req.body.empresaId).get();
    if (!empresa.exists) throw new CsatError(404, 'Cliente não encontrado.');
    const token = randomBytes(32).toString('hex');
    const ref = db!.collection('csatReservas').doc();
    const counter = db!.doc('csatControle/sequencia');
    return db!.runTransaction(async tx => {
      // O contador compartilhado serializa criações concorrentes, inclusive entre abas.
      const seq = Number((await tx.get(counter)).data()?.ultimo || 0) + 1;
      const anteriores = await tx.get(db!.collection('csatReservas').where('criadoPor', '==', user.uid));
      const pendente = anteriores.docs.filter(d => d.data().status === 'reservada')
        .sort((a, b) => b.data().createdAt - a.data().createdAt)[0];
      if (pendente) throw new CsatError(409, `Registre a ocorrência ${pendente.data().idSeqFormatted} do cliente ${pendente.data().empresa} antes de gerar outro link do CSAT.`);
      const cadastro = (await tx.get(empresa.ref)).data()!;
      const ocorrencias = await tx.get(db!.collection('ocorrencias').where('empresa', '==', cadastro.nomeEmpresa));
      const prefixo = typeof cadastro.idNumeric === 'number' ? String(cadastro.idNumeric)
        : (cadastro.nomeEmpresa.match(/#(\d+)/)?.[1] || cadastro.nomeEmpresa.match(/\((\d+)\)/)?.[1] || cadastro.nomeEmpresa.match(/\d+/)?.[0] || '0');
      const reservados = new Set<number>(cadastro.ocorrenciasSequenciasReservadas || []);
      const registros = ocorrencias.docs.map(d => d.data());
      registros.forEach(o => {
        if (typeof o.idSeqFormatted === 'string' && o.idSeqFormatted.startsWith(`#${prefixo}`)) {
          const numero = Number(o.idSeqFormatted.slice(prefixo.length + 1));
          if (Number.isInteger(numero) && numero > 0) reservados.add(numero);
        }
      });
      let ultimo = 0;
      registros.filter(o => !o.csatReservaId && !o.idSeqFormatted).forEach(() => {
        do { ultimo += 1; } while (reservados.has(ultimo));
      });
      const numeroOcorrencia = Math.max(ultimo, 0, ...reservados) + 1;
      const now = Date.now();
      const reserva = { id: ref.id, idSeqFormatted: `#${prefixo}${String(numeroOcorrencia).padStart(2, '0')}`,
        empresa: empresa.data()!.nomeEmpresa, empresaId: empresa.id, tipo: 'Treinamento',
        departamento: 'Treinamento', responsavel: user.nome, descricao: '',
        createdAt: now, updatedAt: now, dataOcorrencia: now,
        criadoPor: user.uid, token, status: 'reservada', respostas: [] };
      tx.set(counter, { ultimo: seq });
      tx.update(empresa.ref, { ocorrenciasSequenciasReservadas: [...reservados, numeroOcorrencia], updatedAt: now });
      tx.set(ref, reserva);
      tx.set(tokenRef(token), { reservaId: ref.id });
      return reserva;
    });
  }));
  app.get('/api/csat/reservas', wrap(async req => {
    const user = await usuario(req);
    const docs = await db!.collection('csatReservas').where('criadoPor', '==', user.uid).get();
    return docs.docs.filter(d => d.data().status === 'reservada').map(d => d.data());
  }));
  app.post('/api/csat/reservas/:id/concluir', wrap(async req => {
    const user = await usuario(req);
    if (!/^[a-zA-Z0-9]+$/.test(req.params.id)) throw new CsatError(400, 'Reserva inválida.');
    const ref = db!.collection('csatReservas').doc(req.params.id);
    return db!.runTransaction(async tx => {
      const reserva = (await tx.get(ref)).data();
      if (!reserva || reserva.criadoPor !== user.uid) throw new CsatError(404, 'Reserva não encontrada.');
      if (reserva.status === 'concluida') return { id: ref.id };
      const dados = req.body;
      if (dados.empresa !== reserva.empresa || dados.tipo !== 'Treinamento' || dados.departamento !== 'Treinamento'
        || typeof dados.descricao !== 'string' || !dados.descricao.trim() || !Number.isFinite(dados.dataOcorrencia)) {
        throw new CsatError(400, 'Preencha uma ocorrência de treinamento do cliente reservado.');
      }
      const { id, token, criadoPor, respostas, status, ...ocorrencia } = dados;
      const resultados = reserva.respostas.map((r: any) => r.experiencia);
      tx.set(db!.collection('ocorrencias').doc(ref.id), { ...ocorrencia,
        idSeqFormatted: reserva.idSeqFormatted, createdAt: reserva.createdAt, updatedAt: Date.now(),
        csatReservaId: ref.id, csatRespostas: reserva.respostas, treinamentoResultados: resultados });
      if (typeof dados.gamificacaoPontoId === 'string' && /^[a-zA-Z0-9]+$/.test(dados.gamificacaoPontoId)) {
        tx.update(db!.collection('gamificacao_pontos').doc(dados.gamificacaoPontoId), { treinamentoResultados: resultados, updatedAt: Date.now() });
      }
      tx.update(ref, { status: 'concluida', gamificacaoPontoId: dados.gamificacaoPontoId || '', updatedAt: Date.now() });
      return { id: ref.id };
    });
  }));
  app.get('/api/csat/publico/:token', wrap(async req => {
    const link = (await tokenRef(req.params.token).get()).data();
    if (!link || !(await db!.collection('csatReservas').doc(link.reservaId).get()).exists) throw new CsatError(404, 'Link de CSAT inválido.');
    return { disponivel: true };
  }));
  app.post('/api/csat/publico/:token', wrap(async req => {
    const resposta = validarResposta(req.body);
    const link = (await tokenRef(req.params.token).get()).data();
    if (!link) throw new CsatError(404, 'Link de CSAT inválido.');
    const ref = db!.collection('csatReservas').doc(link.reservaId);
    const responseRef = ref.collection('respostas').doc(req.body.responseId);
    return db!.runTransaction(async tx => {
      const [doc, anterior] = await Promise.all([tx.get(ref), tx.get(responseRef)]);
      const reserva = doc.data();
      if (!reserva) throw new CsatError(404, 'Link de CSAT inválido.');
      if (anterior.exists) return { sucesso: true };
      if (reserva.respostas.length >= 100) throw new CsatError(409, 'Este formulário já encerrou a coleta.');
      const ocorrenciaRef = db!.collection('ocorrencias').doc(ref.id);
      const ocorrencia = reserva.status === 'concluida' ? await tx.get(ocorrenciaRef) : undefined;
      if (reserva.status === 'concluida' && !ocorrencia?.exists) throw new CsatError(410, 'Este treinamento não está mais disponível.');
      const pontoId = ocorrencia?.data()?.gamificacaoPontoId;
      const pontoRef = typeof pontoId === 'string' && /^[a-zA-Z0-9]+$/.test(pontoId)
        ? db!.collection('gamificacao_pontos').doc(pontoId) : undefined;
      const ponto = pontoRef ? await tx.get(pontoRef) : undefined;
      const respostas = [...reserva.respostas, { ...resposta, respondidoEm: Date.now() }];
      tx.set(responseRef, resposta);
      tx.update(ref, { respostas, updatedAt: Date.now() });
      if (reserva.status === 'concluida') {
        tx.update(db!.collection('ocorrencias').doc(ref.id), {
          csatRespostas: respostas, treinamentoResultados: respostas.map(r => r.experiencia), updatedAt: Date.now(),
        });
        if (pontoRef && ponto?.exists) tx.update(pontoRef, {
          treinamentoResultados: respostas.map(r => r.experiencia), updatedAt: Date.now(),
        });
      }
      return { sucesso: true };
    });
  }));
}
