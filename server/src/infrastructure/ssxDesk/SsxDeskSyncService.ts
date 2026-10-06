import type { Firestore } from 'firebase-admin/firestore';
import {
  agruparConversas, chaveSessao, conversaElegivel, criarOcorrencia, idOcorrencia, listarConversas, resolverEmpresa,
  RESUMO_PENDENTE, tipoDaConversa, type RadarEmpresa, type TrainingConversation,
} from './trainingConversations.js';
import {
  criarAjusteTemporarioScore, encontrarTreinadorPorResponsavel, pontosDeducaoTreinador,
  DIAS_REDUCAO_SCORE_SUPORTE, MOTIVO_REDUCAO_SCORE_SUPORTE, VALOR_REDUCAO_SCORE_SUPORTE,
} from './gamificacaoDesconto.js';

export class SsxDeskSyncService {
  private executando = false;
  private empresas = new Map<string, RadarEmpresa>();
  private empresasLidasEm = 0;
  private empresasCargaCompletaEm = 0;
  private importacoes: Map<string, { empresaId: string; descricaoImportada: string; tipoProcessado?: string }> | undefined;
  private sessoes = new Map<string, string>();
  private sessoesRegistradas = new Set<string>();
  private usuarios: { uid: string; nome: string }[] | undefined;
  private usuariosLidosEm = 0;

  constructor(
    private readonly db: Firestore,
    private readonly apiKey: string,
    private readonly consultar = listarConversas,
  ) {}

  async sincronizar(dryRun = false) {
    if (this.executando) return undefined;
    this.executando = true;
    try {
      const recebidas = await this.consultar(this.apiKey);
      const empresas = await this.carregarEmpresas();
      const usuarios = await this.carregarUsuarios();
      if (!this.importacoes) {
        const registros = await this.db.collection('ssxDeskImportacoes').get();
        this.importacoes = new Map(registros.docs.map(d => [d.id, d.data() as { empresaId: string; descricaoImportada: string; tipoProcessado?: string }]));
        // Localizar a primeira ocorrência da sessão antes de criar novos registros.
        // Duplicatas legadas permanecem intactas para preservar edições e referências.
        const antigas = await this.db.collection('ocorrencias').where('origem', '==', 'ssx-desk').get();
        const ordenadas = antigas.docs.map(d => d.data()).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        for (const o of ordenadas) {
          const s = o.ssxDesk;
          if (!s?.companyId || !s.sessionId || !s.conversationId) continue;
          const chave = JSON.stringify([s.companyId, s.sessionId]);
          if (!this.sessoes.has(chave)) this.sessoes.set(chave, s.conversationId);
        }
        const sessoes = await this.db.collection('ssxDeskSessoes').get();
        for (const d of sessoes.docs) {
          const s = d.data();
          const chave = JSON.stringify([s.companyId, s.sessionId]);
          this.sessoesRegistradas.add(chave);
          const controle = registros.docs.find(r => r.id === s.ocorrenciaId)?.data();
          if (controle?.conversationId) this.sessoes.set(chave, controle.conversationId);
        }
      }
      // Controles também preservam exclusões: não recriar sessões excluídas.
      for (const c of recebidas) {
        if (this.importacoes.has(idOcorrencia(c.id)) && !this.sessoes.has(chaveSessao(c))) this.sessoes.set(chaveSessao(c), c.id);
      }
      const conversas = agruparConversas(recebidas, this.sessoes);
      const companies = recebidas.map(c => c.company);
      const stats = { consultadas: recebidas.length, sessoes: conversas.length, agrupadas: recebidas.length - conversas.length, criadas: 0, atualizadas: 0, existentes: 0, ignoradas: 0,
        foraTreinamentoOuPeriodo: 0, semVinculo: [] as string[],
        ...(dryRun ? { previstas: [] as { empresa: string; startedAt: string; conversationId: string }[] } : {}),
      };
      for (const conversa of conversas) {
        if (!conversa.company.isInTraining) { stats.ignoradas++; continue; }
        const id = idOcorrencia(conversa.id);
        const importada = this.importacoes.get(id);
        const tipo = tipoDaConversa(conversa);
        if (importada && this.sessoesRegistradas.has(chaveSessao(conversa)) && importada.tipoProcessado === tipo
          && (!conversa.summary?.trim() || conversa.summary.trim() === importada.descricaoImportada)) {
          stats.existentes++;
          continue;
        }
        const empresa = importada
          ? empresas.find(e => e.id === importada.empresaId)
          : resolverEmpresa(conversa.company, empresas, companies);
        if (!empresa) {
          stats.ignoradas++;
          const identificacao = `${conversa.company.name} (Central: ${conversa.company.idCentral ?? 'sem ID'})`;
          if (!stats.semVinculo.includes(identificacao)) stats.semVinculo.push(identificacao);
          continue;
        }
        if (!importada && !conversaElegivel(conversa, empresa)) {
          stats.ignoradas++;
          stats.foraTreinamentoOuPeriodo++;
          continue;
        }
        const resultado = await this.importar(conversa, empresa, dryRun, usuarios);
        stats[resultado]++;
        if (resultado === 'criadas' && stats.previstas) stats.previstas.push({
          empresa: empresa.nomeEmpresa, startedAt: conversa.startedAt, conversationId: conversa.id,
        });
        if (!dryRun && resultado !== 'ignoradas') {
          this.sessoes.set(chaveSessao(conversa), conversa.id);
          this.sessoesRegistradas.add(chaveSessao(conversa));
          this.importacoes.set(id, {
          empresaId: empresa.id, descricaoImportada: conversa.summary?.trim() || RESUMO_PENDENTE, tipoProcessado: tipo,
          });
        }
      }
      if (!dryRun) await this.db.doc('integracoes/ssxDesk').set({
        lastSuccessAt: Date.now(), lastError: null, ...stats,
      }, { merge: true });
      return stats;
    } finally {
      this.executando = false;
    }
  }

  private async carregarEmpresas() {
    const agora = Date.now();
    const completa = !this.empresasLidasEm || agora - this.empresasCargaCompletaEm >= 6 * 60 * 60 * 1000;
    const colecao = this.db.collection('empresas');
    const snapshot = await (completa ? colecao : colecao.where('updatedAt', '>', this.empresasLidasEm - 300_000)).get();
    if (completa) { this.empresas.clear(); this.empresasCargaCompletaEm = agora; }
    for (const d of snapshot.docs) this.empresas.set(d.id, { ...d.data(), id: d.id } as RadarEmpresa);
    this.empresasLidasEm = agora;
    return [...this.empresas.values()];
  }

  private async carregarUsuarios() {
    // Usuários mudam raramente; reler a coleção a cada ciclo custava uma leitura
    // por usuário a cada 5 minutos, o dia todo.
    const agora = Date.now();
    if (this.usuarios && agora - this.usuariosLidosEm < 60 * 60 * 1000) return this.usuarios;
    const snapshot = await this.db.collection('usuarios').get();
    this.usuarios = snapshot.docs.map((d) => ({ uid: d.id, nome: (d.data().nome as string) || '' }));
    this.usuariosLidosEm = agora;
    return this.usuarios;
  }

  private async importar(
    conversa: TrainingConversation, empresa: RadarEmpresa, dryRun: boolean,
    usuarios: { uid: string; nome: string }[],
  ) {
    const id = idOcorrencia(conversa.id);
    const sessao = this.db.doc(`ssxDeskSessoes/${idOcorrencia(chaveSessao(conversa))}`);
    // Registro separado preserva a decisão de excluir uma ocorrência no Radar.
    return this.db.runTransaction(async tx => {
      const vinculo = await tx.get(sessao);
      const destino = vinculo.exists ? vinculo.data()!.ocorrenciaId as string : id;
      const ref = this.db.doc(`ocorrencias/${destino}`);
      const controle = this.db.doc(`ssxDeskImportacoes/${destino}`);
      const [registro, ocorrencia, empresaAtual] = await Promise.all([
        tx.get(controle), tx.get(ref), tx.get(this.db.doc(`empresas/${empresa.id}`)),
      ]);
      const agora = Date.now();
      if (registro.exists) {
        if (!vinculo.exists && !dryRun) tx.create(sessao, { ocorrenciaId: destino, companyId: conversa.company.id, sessionId: conversa.sessionId });
        if (!ocorrencia.exists) return 'existentes' as const;
        const anterior = registro.data()!;
        const novaDescricao = conversa.summary?.trim();
        const tipo = tipoDaConversa(conversa);
        const resumoMudou = !!novaDescricao && novaDescricao !== anterior.descricaoImportada;
        if (!resumoMudou && anterior.tipoProcessado === tipo) return 'existentes' as const;
        // Resumo assíncrono/reprocessado: atualizar só se a descrição não foi editada pelo usuário.
        if (!dryRun) {
          const dados = ocorrencia.data()!;
          const ajustes: Record<string, unknown> = {};
          if (resumoMudou && dados.descricao === anterior.descricaoImportada) {
            ajustes.descricao = novaDescricao;
            ajustes['ssxDesk.summaryGeneratedAt'] = conversa.summaryGeneratedAt;
          }
          // Preencher apenas tipos pendentes, preservando a classificação manual.
          const tipoRecemPreenchido = !dados.tipo && !!tipo;
          if (tipoRecemPreenchido) ajustes.tipo = tipo;
          if (Object.keys(ajustes).length) tx.update(ref, { ...ajustes, updatedAt: agora });
          tx.update(controle, { ...(resumoMudou ? { descricaoImportada: novaDescricao } : {}), tipoProcessado: tipo, updatedAt: agora });

          // O Desk só manda as tags (e portanto o tipo) depois da criação inicial —
          // o desconto de Suporte/Dúvida precisa rodar aqui também, senão contatos
          // sem tag no momento da importação nunca levam desconto nenhum.
          if (tipoRecemPreenchido && dados.departamento === 'Suporte' && !dados.gamificacaoDescontoPontoId && empresaAtual.exists) {
            const timestampContato = dados.dataOcorrencia || agora;
            const emp = { ...empresaAtual.data(), id: empresaAtual.id } as RadarEmpresa;
            if (tipo === 'Dúvida') {
              const ajustesAtivos = (emp.scoreAjustesTemporarios || []).filter((a) => a.expiraEm > agora);
              // `updatedAt` precisa ser gravado aqui: a sincronização incremental do app
              // (ver sincronizacaoIncremental.ts) só busca de novo documentos cujo
              // `updatedAt` avançou — sem isso, o navegador nunca vê esta redução de score.
              tx.update(this.db.doc(`empresas/${emp.id}`), {
                scoreAjustesTemporarios: [
                  ...ajustesAtivos,
                  criarAjusteTemporarioScore(MOTIVO_REDUCAO_SCORE_SUPORTE, VALOR_REDUCAO_SCORE_SUPORTE, DIAS_REDUCAO_SCORE_SUPORTE, destino, timestampContato),
                ],
                updatedAt: agora,
              });
            }
            const deducao = pontosDeducaoTreinador(emp.gamificacaoDeducaoSuporte, tipo, timestampContato);
            if (deducao && emp.responsavel) {
              const treinador = encontrarTreinadorPorResponsavel(emp.responsavel, usuarios);
              if (treinador) {
                const lancamentoRef = this.db.collection('gamificacao_pontos').doc();
                tx.update(ref, { gamificacaoDescontoPontoId: lancamentoRef.id });
                tx.create(lancamentoRef, {
                  treinadorId: treinador.uid,
                  treinadorNome: treinador.nome,
                  tipoAcao: 'desconto_suporte',
                  pontos: -Math.abs(deducao.pontos),
                  descricao: `Contato de ${emp.nomeEmpresa} com o Suporte (${tipo}, ${deducao.dentroDoExpediente ? 'dentro' : 'fora'} do expediente)`,
                  dataLancamento: timestampContato,
                  criadoPorId: '',
                  criadoPorNome: 'SSX Desk (sincronização automática)',
                  ocorrenciaId: destino,
                  updatedAt: agora,
                });
              }
            }
          }
        }
        return 'atualizadas' as const;
      }
      if (ocorrencia.exists) return 'existentes' as const;
      if (!empresaAtual.exists) return 'ignoradas' as const;
      const atual = { ...empresaAtual.data(), id: empresaAtual.id } as RadarEmpresa;
      if (atual.nomeEmpresa !== empresa.nomeEmpresa || atual.idCentral !== empresa.idCentral
        || !conversaElegivel(conversa, atual)) return 'ignoradas' as const;
      const nova = criarOcorrencia(conversa, atual, agora);

      // Contato de Suporte/Dúvida reduz temporariamente o score do cliente — mesma
      // regra de app/src/utils/score.ts, aplicada aqui porque esta ocorrência nunca
      // passa pelo formulário manual de Historico.tsx que normalmente dispara isso.
      let ajusteScore: ReturnType<typeof criarAjusteTemporarioScore> | undefined;
      if (nova.tipo === 'Dúvida') {
        ajusteScore = criarAjusteTemporarioScore(
          MOTIVO_REDUCAO_SCORE_SUPORTE, VALOR_REDUCAO_SCORE_SUPORTE, DIAS_REDUCAO_SCORE_SUPORTE,
          destino, nova.dataOcorrencia,
        );
      }

      // Cliente marcado (Master-only) como elegível para dedução de pontos do
      // treinador responsável por contato de Suporte — mesma regra do bloco
      // "gamificacaoDeducaoSuporte" de Historico.tsx.
      let descontoPontoId: string | undefined;
      let lancamentoRef: FirebaseFirestore.DocumentReference | undefined;
      let lancamentoPonto: Record<string, unknown> | undefined;
      const deducao = pontosDeducaoTreinador(atual.gamificacaoDeducaoSuporte, nova.tipo, nova.dataOcorrencia);
      if (deducao && atual.responsavel) {
        const treinador = encontrarTreinadorPorResponsavel(atual.responsavel, usuarios);
        if (treinador) {
          lancamentoRef = this.db.collection('gamificacao_pontos').doc();
          descontoPontoId = lancamentoRef.id;
          lancamentoPonto = {
            treinadorId: treinador.uid,
            treinadorNome: treinador.nome,
            tipoAcao: 'desconto_suporte',
            pontos: -Math.abs(deducao.pontos),
            descricao: `Contato de ${atual.nomeEmpresa} com o Suporte (${nova.tipo}, ${deducao.dentroDoExpediente ? 'dentro' : 'fora'} do expediente)`,
            dataLancamento: nova.dataOcorrencia,
            criadoPorId: '',
            criadoPorNome: 'SSX Desk (sincronização automática)',
            ocorrenciaId: destino,
            updatedAt: agora,
          };
        }
      }

      if (!dryRun) {
        tx.create(ref, { ...nova, ...(descontoPontoId ? { gamificacaoDescontoPontoId: descontoPontoId } : {}) });
        tx.create(controle, { conversationId: conversa.id, ocorrenciaId: destino, empresaId: atual.id, descricaoImportada: nova.descricao, tipoProcessado: nova.tipo, importedAt: agora });
        if (!vinculo.exists) tx.create(sessao, { ocorrenciaId: destino, companyId: conversa.company.id, sessionId: conversa.sessionId });
        if (ajusteScore) {
          const ajustesAtivos = (atual.scoreAjustesTemporarios || []).filter((a) => a.expiraEm > agora);
          // `updatedAt` precisa ser gravado aqui: a sincronização incremental do app
          // (ver sincronizacaoIncremental.ts) só busca de novo documentos cujo
          // `updatedAt` avançou — sem isso, o navegador nunca vê esta redução de score.
          tx.update(this.db.doc(`empresas/${atual.id}`), { scoreAjustesTemporarios: [...ajustesAtivos, ajusteScore], updatedAt: agora });
        }
        if (lancamentoRef && lancamentoPonto) tx.create(lancamentoRef, lancamentoPonto);
      }
      return 'criadas' as const;
    });
  }
}

export function iniciarSincronizacaoSsxDesk(db: Firestore | null, apiKey: string, intervaloMs: number) {
  if (!apiKey) { console.log('[SSX Desk] Sincronização desativada: configure SSX_DESK_API_KEY.'); return; }
  if (!db) { console.error('[SSX Desk] Sincronização indisponível: Firebase Admin não inicializado.'); return; }
  const service = new SsxDeskSyncService(db, apiKey);
  const executar = async () => {
    try {
      const stats = await service.sincronizar();
      if (stats) console.log('[SSX Desk] Sincronização concluída:', JSON.stringify(stats));
    } catch (error) {
      // Nunca registrar headers, chave ou corpo bruto da resposta.
      const mensagem = error instanceof Error ? error.message : 'Falha na sincronização';
      console.error('[SSX Desk]', mensagem);
      await db.doc('integracoes/ssxDesk').set({ lastErrorAt: Date.now(), lastError: mensagem }, { merge: true })
        .catch(() => console.error('[SSX Desk] Não foi possível registrar o erro no Firebase.'));
    }
  };
  void executar();
  const timer = setInterval(() => { void executar(); }, intervaloMs);
  timer.unref();
  return () => clearInterval(timer);
}
