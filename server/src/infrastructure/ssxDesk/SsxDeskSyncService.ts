import type { Firestore } from 'firebase-admin/firestore';
import {
  conversaElegivel, criarOcorrencia, idOcorrencia, listarConversas, resolverEmpresa,
  RESUMO_PENDENTE, type RadarEmpresa, type TrainingConversation,
} from './trainingConversations.js';

export class SsxDeskSyncService {
  private executando = false;
  private empresas = new Map<string, RadarEmpresa>();
  private empresasLidasEm = 0;
  private empresasCargaCompletaEm = 0;
  private importacoes: Map<string, { empresaId: string; descricaoImportada: string }> | undefined;

  constructor(
    private readonly db: Firestore,
    private readonly apiKey: string,
    private readonly consultar = listarConversas,
  ) {}

  async sincronizar(dryRun = false) {
    if (this.executando) return undefined;
    this.executando = true;
    try {
      const conversas = await this.consultar(this.apiKey);
      const empresas = await this.carregarEmpresas();
      if (!this.importacoes) {
        const registros = await this.db.collection('ssxDeskImportacoes').get();
        this.importacoes = new Map(registros.docs.map(d => [d.id, d.data() as { empresaId: string; descricaoImportada: string }]));
      }
      const companies = conversas.map(c => c.company);
      const stats = { consultadas: conversas.length, criadas: 0, atualizadas: 0, existentes: 0, ignoradas: 0,
        foraTreinamentoOuPeriodo: 0, semVinculo: [] as string[],
        ...(dryRun ? { previstas: [] as { empresa: string; startedAt: string; conversationId: string }[] } : {}),
      };
      for (const conversa of conversas) {
        if (!conversa.company.isInTraining) { stats.ignoradas++; continue; }
        const id = idOcorrencia(conversa.id);
        const importada = this.importacoes.get(id);
        if (importada && (!conversa.summary?.trim() || conversa.summary.trim() === importada.descricaoImportada)) {
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
        const resultado = await this.importar(conversa, empresa, dryRun);
        stats[resultado]++;
        if (resultado === 'criadas' && stats.previstas) stats.previstas.push({
          empresa: empresa.nomeEmpresa, startedAt: conversa.startedAt, conversationId: conversa.id,
        });
        if (!dryRun && resultado !== 'ignoradas') this.importacoes.set(id, {
          empresaId: empresa.id, descricaoImportada: conversa.summary?.trim() || RESUMO_PENDENTE,
        });
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

  private async importar(conversa: TrainingConversation, empresa: RadarEmpresa, dryRun: boolean) {
    const id = idOcorrencia(conversa.id);
    const ref = this.db.doc(`ocorrencias/${id}`);
    // Registro separado preserva a decisão de excluir uma ocorrência no Radar.
    const controle = this.db.doc(`ssxDeskImportacoes/${id}`);
    return this.db.runTransaction(async tx => {
      const [registro, ocorrencia, empresaAtual] = await Promise.all([
        tx.get(controle), tx.get(ref), tx.get(this.db.doc(`empresas/${empresa.id}`)),
      ]);
      const agora = Date.now();
      if (registro.exists) {
        if (!ocorrencia.exists) return 'existentes' as const;
        const anterior = registro.data()!;
        const novaDescricao = conversa.summary?.trim();
        if (!novaDescricao || novaDescricao === anterior.descricaoImportada) return 'existentes' as const;
        // Resumo assíncrono/reprocessado: atualizar só se a descrição não foi editada pelo usuário.
        if (!dryRun) {
          if (ocorrencia.data()!.descricao === anterior.descricaoImportada) {
            tx.update(ref, { descricao: novaDescricao, 'ssxDesk.summaryGeneratedAt': conversa.summaryGeneratedAt, updatedAt: agora });
          }
          tx.update(controle, { descricaoImportada: novaDescricao, updatedAt: agora });
        }
        return 'atualizadas' as const;
      }
      if (ocorrencia.exists) return 'existentes' as const;
      if (!empresaAtual.exists) return 'ignoradas' as const;
      const atual = { ...empresaAtual.data(), id: empresaAtual.id } as RadarEmpresa;
      if (atual.nomeEmpresa !== empresa.nomeEmpresa || atual.idCentral !== empresa.idCentral
        || !conversaElegivel(conversa, atual)) return 'ignoradas' as const;
      const nova = criarOcorrencia(conversa, atual, agora);
      if (!dryRun) {
        tx.create(ref, nova);
        tx.create(controle, { conversationId: conversa.id, ocorrenciaId: id, empresaId: atual.id, descricaoImportada: nova.descricao, importedAt: agora });
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
