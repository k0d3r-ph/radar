import type { Firestore } from 'firebase-admin/firestore';
import {
  atualizarEtapaTreinamento, criarEtapaTreinamento, excluirEtapaTreinamento, listarEmpresasDesk,
  type CompanyDesk, type StatusEtapaDesk,
} from './trainingStages.js';

const COLECAO = 'empresas';
// Reconsulta um pouco antes do cursor para não perder itens salvos no meio do ciclo
// anterior — reprocessar uma empresa por engano é inofensivo aqui (tudo é idempotente),
// mesmo motivo do ManagerOpsSyncService.
const MARGEM_SEGURANCA_MS = 2 * 60_000;
const PAUSA_ENTRE_CHAMADAS_MS = 600; // Até 100 chamadas/minuto, abaixo das 120 req/min permitidas.
// As chamadas HTTP ao Desk já têm AbortSignal.timeout próprio; as chamadas ao Firestore
// não tinham nenhum limite — uma travada (rede, índice faltando, etc.) bloqueava
// `executando` para sempre e o ciclo nunca chegava a logar nada (nem sucesso, nem erro).
const TIMEOUT_FIRESTORE_MS = 20_000;

function comTimeout<T>(promise: Promise<T>, rotulo: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(
      () => reject(new Error(`[SSX Desk Training Stages] Tempo esgotado (${TIMEOUT_FIRESTORE_MS}ms) em: ${rotulo}`)),
      TIMEOUT_FIRESTORE_MS,
    )),
  ]);
}

interface EmpresaRadar {
  id: string;
  nomeEmpresa: string;
  idCentral?: string;
  temaText?: string;
  currentPhase: number;
  updatedAt: number;
  ssxDeskTrainingStageIds?: string[];
  ssxDeskTrainingStagesSyncedAt?: number;
}

interface LinhaEtapa {
  indice: number;
  tema: string;
  status: StatusEtapaDesk;
  idDesk: string;
}

/** Uma linha por fase de `temaText` (mesmo formato de app/src/utils/temasEsteira.ts —
 * duplicado aqui porque o servidor não compila o código do app, mesmo motivo documentado
 * em ManagerOpsSyncService.prazoApartirDoDueDate). Linhas em branco são mantidas na
 * posição (índice) para não desalinhar `ssxDeskTrainingStageIds`, mas não são enviadas. */
export function linhasEtapaTreinamento(empresa: EmpresaRadar): LinhaEtapa[] {
  const temas = (empresa.temaText || '').split('\n');
  const idsAntigos = empresa.ssxDeskTrainingStageIds || [];
  return temas.map((temaBruto, indice) => {
    const tema = temaBruto.trim();
    const status: StatusEtapaDesk = indice < empresa.currentPhase ? 'Concluído'
      : indice === empresa.currentPhase ? 'Em andamento' : 'Não concluído';
    return { indice, tema, status, idDesk: idsAntigos[indice] || '' };
  });
}

/**
 * Só aceita `idCentral` que identifica uma única empresa do lado do Desk. Não verifica
 * duplicidade de `idCentral` entre empresas do próprio Radar (exigiria carregar a
 * coleção inteira a cada ciclo) — um cadastro duplicado no Radar já quebraria a
 * sincronização de entrada do SSX Desk (trainingConversations.resolverEmpresa) antes de
 * chegar aqui, então não é um risco novo introduzido por este serviço.
 */
export function resolverCompanyIdDesk(empresa: EmpresaRadar, companiesDesk: CompanyDesk[]): string | undefined {
  const central = empresa.idCentral?.trim();
  if (!central) return undefined;
  const candidatas = companiesDesk.filter(c => c.idCentral?.trim() === central);
  return candidatas.length === 1 ? candidatas[0].id : undefined;
}

/** Funções do cliente injetáveis, para testar a lógica de sincronização sem bater na
 * API real — mesmo papel do `cliente` do ManagerOpsSyncService. */
export interface TrainingStagesClienteFns {
  listarEmpresasDesk: typeof listarEmpresasDesk;
  criarEtapaTreinamento: typeof criarEtapaTreinamento;
  atualizarEtapaTreinamento: typeof atualizarEtapaTreinamento;
  excluirEtapaTreinamento: typeof excluirEtapaTreinamento;
}

const CLIENTE_PADRAO: TrainingStagesClienteFns = {
  listarEmpresasDesk, criarEtapaTreinamento, atualizarEtapaTreinamento, excluirEtapaTreinamento,
};

export class TrainingStagesSyncService {
  private executando = false;
  private executandoDesde = 0;
  private companiesDesk: CompanyDesk[] | undefined;
  private companiesDeskLidasEm = 0;

  constructor(
    private readonly db: Firestore,
    private readonly apiKey: string,
    private readonly cliente: TrainingStagesClienteFns = CLIENTE_PADRAO,
    private readonly esperar: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
    /** Ignora o cursor salvo e reconsidera todas as empresas — uso único para o backfill
     * inicial (ativar em produção pela primeira vez). Ver SSX_DESK_TRAINING_STAGES_FORCAR_BACKFILL
     * em env.ts; desligar a variável depois de confirmar o backfill. */
    private readonly forcarBackfill: boolean = false,
  ) {}

  async sincronizar() {
    if (this.executando) {
      // Com os timeouts acima, isso não deveria mais ficar preso para sempre — mas,
      // se acontecer de qualquer forma, ao menos fica visível no log em vez de silencioso.
      console.error(`[SSX Desk Training Stages] Ciclo anterior ainda em andamento (iniciado há ${Date.now() - this.executandoDesde}ms) — pulando este ciclo.`);
      return undefined;
    }
    this.executando = true;
    this.executandoDesde = Date.now();
    try {
      // Mesmo cuidado do Manager Ops: o cursor da próxima vez é o início DESTE ciclo, não
      // o maior updatedAt visto — e sempre avança, mesmo quando uma empresa falha. Uma
      // falha permanente não pode travar o cursor e fazer a consulta por tempo reler
      // quase a coleção inteira a cada ciclo (era exatamente o bug do Manager Ops).
      const inicioDoCiclo = Date.now();
      console.log('[SSX Desk Training Stages] Ciclo iniciado.');
      const estado = await this.carregarEstado();
      console.log('[SSX Desk Training Stages] Estado carregado.');
      const companiesDesk = await this.carregarEmpresasDesk();
      console.log(`[SSX Desk Training Stages] ${companiesDesk.length} empresa(s) do Desk carregadas.`);

      const desde = this.forcarBackfill ? 0 : Math.max(0, estado.lastPushedAt - MARGEM_SEGURANCA_MS);
      if (this.forcarBackfill) console.log('[SSX Desk Training Stages] Backfill forçado: ignorando o cursor salvo, reconsiderando todas as empresas.');
      const empresas = await this.carregarEmpresasParaEnviar(desde, estado.empresasComFalha);
      console.log(`[SSX Desk Training Stages] ${empresas.length} empresa(s) do Radar para processar.`);

      const stats = { processadas: 0, semVinculo: 0, semTemas: 0, ignoradas: 0 };
      const falhasRestantes = new Set<string>();
      for (const empresa of empresas) {
        try {
          const resultado = await this.sincronizarEmpresa(empresa, companiesDesk);
          stats[resultado]++;
        } catch (erro) {
          falhasRestantes.add(empresa.id);
          const mensagem = erro instanceof Error ? erro.message : 'erro desconhecido';
          console.error(`[SSX Desk Training Stages] Falha ao sincronizar a empresa ${empresa.id}:`, mensagem);
        }
      }

      await comTimeout(this.db.doc('integracoes/ssxDeskTrainingStages').set({
        lastSuccessAt: Date.now(),
        lastError: falhasRestantes.size ? `${falhasRestantes.size} empresa(s) não foram sincronizadas com o SSX Desk.` : null,
        lastPushedAt: inicioDoCiclo,
        empresasComFalha: [...falhasRestantes],
        ...stats,
      }, { merge: true }), 'gravar estado final');
      return stats;
    } finally {
      this.executando = false;
    }
  }

  private async carregarEstado(): Promise<{ lastPushedAt: number; empresasComFalha: string[] }> {
    const doc = await comTimeout(this.db.doc('integracoes/ssxDeskTrainingStages').get(), 'carregar estado');
    const dados = doc.data() || {};
    return {
      lastPushedAt: typeof dados.lastPushedAt === 'number' ? dados.lastPushedAt : 0,
      empresasComFalha: Array.isArray(dados.empresasComFalha)
        ? dados.empresasComFalha.filter((id: unknown): id is string => typeof id === 'string')
        : [],
    };
  }

  private async carregarEmpresasDesk(): Promise<CompanyDesk[]> {
    // Lista de empresas do Desk muda raramente — mesma estratégia de cache de uma hora
    // já usada para `usuarios` no Manager Ops e no SSX Desk de entrada.
    const agora = Date.now();
    if (this.companiesDesk && agora - this.companiesDeskLidasEm < 60 * 60 * 1000) return this.companiesDesk;
    this.companiesDesk = await this.cliente.listarEmpresasDesk(this.apiKey);
    this.companiesDeskLidasEm = agora;
    return this.companiesDesk;
  }

  private async carregarEmpresasParaEnviar(desde: number, idsComFalhaConhecida: string[]): Promise<EmpresaRadar[]> {
    const [porTempo, porFalhaConhecida] = await comTimeout(Promise.all([
      this.db.collection(COLECAO).where('updatedAt', '>', desde).get(),
      // Empresas com falha permanente ficam fora da janela de tempo do cursor — buscadas
      // por id — senão uma falha que nunca se resolve travaria o cursor pra sempre e
      // faria a consulta acima reler quase a coleção inteira a cada ciclo.
      Promise.all(idsComFalhaConhecida.map(id => this.db.collection(COLECAO).doc(id).get())),
    ]), 'carregar empresas para enviar');
    const porId = new Map<string, EmpresaRadar>();
    for (const d of porTempo.docs) porId.set(d.id, { id: d.id, ...(d.data() as Omit<EmpresaRadar, 'id'>) });
    for (const d of porFalhaConhecida) {
      if (d.exists) porId.set(d.id, { id: d.id, ...(d.data() as Omit<EmpresaRadar, 'id'>) });
    }
    return [...porId.values()];
  }

  private async sincronizarEmpresa(empresa: EmpresaRadar, companiesDesk: CompanyDesk[]) {
    const companyId = resolverCompanyIdDesk(empresa, companiesDesk);
    if (!companyId) return 'semVinculo' as const;

    const linhas = linhasEtapaTreinamento(empresa);
    if (!linhas.some(l => l.tema)) return 'semTemas' as const;

    // Só reenvia quando a empresa mudou desde o último envio — senão toda empresa na
    // janela do ciclo levaria PUT em todas as linhas de novo, sem necessidade (mesmo
    // cuidado do `managerOpsSyncedAt` no Manager Ops).
    const precisaReenviar = (empresa.ssxDeskTrainingStagesSyncedAt ?? 0) < empresa.updatedAt;
    if (!precisaReenviar && linhas.every(l => !l.tema || l.idDesk)) return 'ignoradas' as const;

    // Sempre uma string em cada posição (nunca undefined) — Firestore recusa undefined
    // dentro de arrays, e uma linha em branco nunca antes enviada não tem id salvo.
    const idsAntigos = empresa.ssxDeskTrainingStageIds || [];
    const ids = linhas.map((l) => idsAntigos[l.indice] || '');
    for (const linha of linhas) {
      if (!linha.tema) {
        // Linha ficou em branco (tema removido/reordenado): some o excedente, se houver.
        if (ids[linha.indice]) {
          await this.esperar(PAUSA_ENTRE_CHAMADAS_MS);
          await this.cliente.excluirEtapaTreinamento(this.apiKey, ids[linha.indice]);
          ids[linha.indice] = '';
        }
        continue;
      }
      await this.esperar(PAUSA_ENTRE_CHAMADAS_MS);
      if (!linha.idDesk) {
        const criada = await this.cliente.criarEtapaTreinamento(this.apiKey, {
          companyId, name: linha.tema, status: linha.status, sortOrder: linha.indice,
        });
        ids[linha.indice] = criada.id;
      } else if (precisaReenviar) {
        await this.cliente.atualizarEtapaTreinamento(this.apiKey, linha.idDesk, {
          name: linha.tema, status: linha.status, sortOrder: linha.indice,
        });
      }
    }
    // A trilha encolheu (menos linhas do que ids salvos antes): exclui os excedentes.
    for (let i = linhas.length; i < idsAntigos.length; i++) {
      if (!idsAntigos[i]) continue;
      await this.esperar(PAUSA_ENTRE_CHAMADAS_MS);
      await this.cliente.excluirEtapaTreinamento(this.apiKey, idsAntigos[i]);
    }

    await comTimeout(this.db.collection(COLECAO).doc(empresa.id).update({
      ssxDeskTrainingStageIds: ids,
      ssxDeskTrainingStagesSyncedAt: Date.now(),
    }), `gravar ids da empresa ${empresa.id}`);
    return 'processadas' as const;
  }
}

export function iniciarSincronizacaoSsxDeskTrainingStages(
  db: Firestore | null, apiKey: string, intervaloMs: number, forcarBackfill = false,
) {
  if (!apiKey) { console.log('[SSX Desk Training Stages] Sincronização desativada: configure SSX_DESK_TRAINING_STAGES_API_KEY.'); return; }
  if (!db) { console.error('[SSX Desk Training Stages] Sincronização indisponível: Firebase Admin não inicializado.'); return; }
  const service = new TrainingStagesSyncService(db, apiKey, undefined, undefined, forcarBackfill);
  const executar = async () => {
    try {
      const stats = await service.sincronizar();
      if (stats) console.log('[SSX Desk Training Stages] Sincronização concluída:', JSON.stringify(stats));
    } catch (error) {
      // Nunca registrar headers, chave ou corpo bruto da resposta.
      const mensagem = error instanceof Error ? error.message : 'Falha na sincronização';
      console.error('[SSX Desk Training Stages]', mensagem);
      await db.doc('integracoes/ssxDeskTrainingStages').set({ lastErrorAt: Date.now(), lastError: mensagem }, { merge: true })
        .catch(() => console.error('[SSX Desk Training Stages] Não foi possível registrar o erro no Firebase.'));
    }
  };
  void executar();
  const timer = setInterval(() => { void executar(); }, intervaloMs);
  timer.unref();
  return () => clearInterval(timer);
}
