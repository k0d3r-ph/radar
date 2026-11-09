import type { Firestore } from 'firebase-admin/firestore';
import {
  atualizarEtapaTreinamento, criarEtapaTreinamento, excluirEtapaTreinamento, listarEmpresasDesk,
  SsxDeskHttpError, type CompanyDesk, type EtapaTreinamentoDesk, type StatusEtapaDesk,
} from './trainingStages.js';
import { normalizarNome } from './trainingConversations.js';

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
    // `currentPhase` só avança quando um tema é efetivamente ensinado (ver
    // reordenarTemasEnsinados em app/src/utils/reordenarTemasEnsinados.ts e o fluxo manual
    // em Esteira.tsx) — nunca aponta pra um tema "em andamento, ainda não dado". O Radar não
    // guarda uma fase intermediária entre "não ensinado" e "ensinado": por isso a fase atual
    // também conta como Concluído, igual às anteriores, nunca como "Em andamento".
    const status: StatusEtapaDesk = indice <= empresa.currentPhase ? 'Concluído' : 'Não concluído';
    return { indice, tema, status, idDesk: idsAntigos[indice] || '' };
  });
}

/**
 * Prioriza `idCentral` quando ele identifica uma única empresa do lado do Desk. Sem
 * `idCentral` no Radar (empresas antigas sem esse campo preenchido — ver vincularIdCentral.ts)
 * ou com `idCentral` compartilhado por mais de uma empresa do Desk, cai para nome exato e
 * único (ignorando acentos, caixa e espaços), mesma regra já usada pela sincronização de
 * entrada do SSX Desk (`trainingConversations.resolverEmpresa`) — sem esse fallback, uma
 * empresa sem `idCentral` cadastrado nunca teria a trilha publicada no Desk, mesmo com o
 * nome existindo lá sem ambiguidade. Não verifica duplicidade de `idCentral`/nome entre
 * empresas do próprio Radar (exigiria carregar a coleção inteira a cada ciclo) — um
 * cadastro duplicado no Radar já quebraria a sincronização de entrada antes de chegar
 * aqui, então não é um risco novo introduzido por este serviço.
 */
export function resolverCompanyDesk(empresa: EmpresaRadar, companiesDesk: CompanyDesk[]): CompanyDesk | undefined {
  const central = empresa.idCentral?.trim();
  const porCentral = central ? companiesDesk.filter(c => c.idCentral?.trim() === central) : [];
  if (porCentral.length === 1) return porCentral[0];

  const nomeEmpresa = empresa.nomeEmpresa?.trim();
  if (!nomeEmpresa) return undefined;
  // Com idCentral compartilhado, desambigua só entre as candidatas do mesmo idCentral —
  // nunca aceita por nome uma empresa de idCentral totalmente diferente nesse caso.
  const candidatas = porCentral.length > 1 ? porCentral : companiesDesk;
  const porNome = candidatas.filter(c => normalizarNome(c.name) === normalizarNome(nomeEmpresa));
  if (porNome.length !== 1) return undefined;
  const encontrada = porNome[0];
  // A empresa já tem um idCentral próprio que não é o desta — não aceita o nome por cima
  // de um idCentral explícito e divergente (cadastro provavelmente errado de um dos lados,
  // não um caso de "sem idCentral" que o nome deveria resolver).
  if (central && encontrada.idCentral?.trim() && encontrada.idCentral.trim() !== central) return undefined;
  return encontrada;
}

export function resolverCompanyIdDesk(empresa: EmpresaRadar, companiesDesk: CompanyDesk[]): string | undefined {
  return resolverCompanyDesk(empresa, companiesDesk)?.id;
}

export interface ReconciliacaoEtapas {
  /** Um id por linha de `linhas` (vazio quando a linha não tem tema ou não há etapa correspondente ainda). */
  ids: string[];
  /** Etapas do Desk que sobraram sem corresponder a nenhuma linha atual, com o mesmo nome
   * de uma que já foi reivindicada — duplicatas a excluir. */
  idsDuplicados: string[];
  /** Uma etapa já existente no Desk tem `status` diferente do que o Radar calcula agora
   * pra essa linha — sinal de que um envio passado mandou o valor errado (ou o Desk
   * divergiu por outro motivo) e, sem isso, nunca seria corrigido: a sincronização só
   * reenvia quando `updatedAt` muda no Radar, então um erro de uma vez travaria pra
   * sempre sem essa verificação (ver caso real: etapa "Conclusão" ficou presa em "Em
   * andamento" no Desk desde o primeiro envio, mesmo com o Radar já calculando
   * "Concluído" há semanas, porque nada mudou no cadastro depois pra disparar um reenvio). */
  statusDivergente: boolean;
}

/**
 * Resolve o id de cada linha pelo estado ATUAL das etapas no Desk (`etapasDesk`, vindo do
 * `trainingStages` embutido em cada empresa de `GET /companies`), não só pelo array local
 * `idsAntigos` — que é alinhado por POSIÇÃO e se desalinha quando `temaText` é reordenado
 * (ex.: tema ensinado fora de sequência, ver `reordenarTemasEnsinados` em
 * app/src/utils/reordenarTemasEnsinados.ts). Nesse caso o id salvo localmente para uma
 * posição passa a apontar para a etapa de um tema diferente no Desk — sem reconciliar por
 * nome, o PUT subsequente renomearia a etapa errada e, pior, uma posição sem id reconhecido
 * dispararia um POST, criando uma etapa duplicada para um tema que já existia no Desk (ver
 * "Limitações conhecidas" em server/SSX_DESK_TRAINING_STAGES.md).
 *
 * Preferência, por linha: (1) o id salvo localmente, se a etapa do Desk com esse id ainda
 * tiver o MESMO nome da linha; (2) uma etapa do Desk com nome igual à linha, ainda não
 * reivindicada por outra linha — recupera o vínculo perdido na reordenação; (3) nenhum id —
 * a linha vira POST (etapa nova de verdade). Etapas do Desk com o nome de uma linha atual
 * mas não reivindicadas por nenhuma (sobra da própria reordenação) voltam em `idsDuplicados`.
 *
 * Quando `etapasDesk` vem vazio, não há como confirmar nem contradizer o array local —
 * mantém o comportamento anterior (confia cegamente no id salvo), em vez de tratar a
 * ausência de dados como "nada existe no Desk" e recriar tudo. Isso preserva o
 * funcionamento de hoje caso esse campo venha ausente/incompleto em alguma resposta real
 * (ver a cautela já documentada em `CompanyDesk.trainingStages` em trainingStages.ts).
 */
export function reconciliarEtapasEmpresa(
  linhas: LinhaEtapa[], idsAntigos: string[], etapasDesk: EtapaTreinamentoDesk[],
): ReconciliacaoEtapas {
  if (etapasDesk.length === 0) {
    return { ids: linhas.map((l, i) => (l.tema ? idsAntigos[i] || '' : '')), idsDuplicados: [], statusDivergente: false };
  }

  const porId = new Map(etapasDesk.map(e => [e.id, e]));
  const disponiveisPorNome = new Map<string, EtapaTreinamentoDesk[]>();
  for (const etapa of etapasDesk) {
    const lista = disponiveisPorNome.get(etapa.name) || [];
    lista.push(etapa);
    disponiveisPorNome.set(etapa.name, lista);
  }
  const reivindicadas = new Set<string>();
  let statusDivergente = false;

  function reivindicar(etapa: EtapaTreinamentoDesk) {
    reivindicadas.add(etapa.id);
    const lista = disponiveisPorNome.get(etapa.name);
    if (!lista) return;
    const indice = lista.indexOf(etapa);
    if (indice !== -1) lista.splice(indice, 1);
  }

  const ids = linhas.map((linha, indice) => {
    if (!linha.tema) return '';
    const etapaPeloIdSalvo = idsAntigos[indice] ? porId.get(idsAntigos[indice]) : undefined;
    if (etapaPeloIdSalvo && etapaPeloIdSalvo.name === linha.tema && !reivindicadas.has(etapaPeloIdSalvo.id)) {
      reivindicar(etapaPeloIdSalvo);
      if (etapaPeloIdSalvo.status !== linha.status) statusDivergente = true;
      return etapaPeloIdSalvo.id;
    }
    const recuperada = disponiveisPorNome.get(linha.tema)?.[0];
    if (recuperada) {
      reivindicar(recuperada);
      // Recuperada por nome (não pelo id salvo) — já é por si só um sinal de
      // desalinhamento; força reenvio pra garantir que o sortOrder/status fiquem certos.
      statusDivergente = true;
      return recuperada.id;
    }
    return '';
  });

  const nomesAtuais = new Set(linhas.filter(l => l.tema).map(l => l.tema));
  const idsDuplicados = etapasDesk
    .filter(e => !reivindicadas.has(e.id) && nomesAtuais.has(e.name))
    .map(e => e.id);

  return { ids, idsDuplicados, statusDivergente };
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
      // Nomes, não só a contagem — "semVinculo" sem saber QUAL empresa não ajuda a agir
      // (ver caso relatado do cliente sem idCentral resolvível: a contagem por si só não
      // diz quem revisar no cadastro). Limitado pra não crescer sem controle num ciclo ruim.
      const nomesSemVinculo: string[] = [];
      for (const empresa of empresas) {
        try {
          const resultado = await this.sincronizarEmpresa(empresa, companiesDesk);
          stats[resultado]++;
          if (resultado === 'semVinculo' && nomesSemVinculo.length < 50) nomesSemVinculo.push(empresa.nomeEmpresa);
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
        nomesSemVinculo,
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
    const companyDesk = resolverCompanyDesk(empresa, companiesDesk);
    if (!companyDesk) return 'semVinculo' as const;
    const companyId = companyDesk.id;

    const linhas = linhasEtapaTreinamento(empresa);
    if (!linhas.some(l => l.tema)) return 'semTemas' as const;

    // Sempre uma string em cada posição (nunca undefined) — Firestore recusa undefined
    // dentro de arrays, e uma linha em branco nunca antes enviada não tem id salvo.
    const idsAntigos = empresa.ssxDeskTrainingStageIds || [];
    // Reconcilia pelo estado ATUAL das etapas no Desk (por nome), não só pelo array local —
    // corrige o id de uma linha que foi reordenada desde o último envio e evita recriar uma
    // etapa que já existe, só deslocada de posição (ver reconciliarEtapasEmpresa acima).
    const { ids: idsDesk, idsDuplicados, statusDivergente } = reconciliarEtapasEmpresa(
      linhas, idsAntigos, companyDesk.trainingStages?.items ?? [],
    );

    // Só reenvia quando a empresa mudou desde o último envio — senão toda empresa na
    // janela do ciclo levaria PUT em todas as linhas de novo, sem necessidade (mesmo
    // cuidado do `managerOpsSyncedAt` no Manager Ops). Duplicatas recuperadas do Desk e
    // uma etapa com status desatualizado lá sempre precisam de correção, então também
    // contam como "precisa reenviar" — sem isso, um envio que saiu errado uma vez (ver
    // caso real do Altotrak: "Conclusão" ficou presa em "Em andamento" desde o primeiro
    // envio) nunca seria corrigido, porque nada muda `updatedAt` depois disso.
    const precisaReenviar = (empresa.ssxDeskTrainingStagesSyncedAt ?? 0) < empresa.updatedAt
      || idsDuplicados.length > 0 || statusDivergente;
    if (!precisaReenviar && linhas.every((l, i) => !l.tema || idsDesk[i])) return 'ignoradas' as const;

    const ids = [...idsDesk];
    for (const linha of linhas) {
      if (!linha.tema) {
        // Linha ficou em branco (tema removido/reordenado): some o excedente salvo
        // localmente antes, se houver — a reconciliação por nome não cobre linhas em
        // branco (não têm nome pra casar), por isso usa o array local aqui, não `idsDesk`.
        const idOrfao = idsAntigos[linha.indice];
        if (idOrfao) {
          await this.esperar(PAUSA_ENTRE_CHAMADAS_MS);
          await this.cliente.excluirEtapaTreinamento(this.apiKey, idOrfao);
        }
        ids[linha.indice] = '';
        continue;
      }
      const idDesk = idsDesk[linha.indice];
      await this.esperar(PAUSA_ENTRE_CHAMADAS_MS);
      if (!idDesk) {
        const criada = await this.cliente.criarEtapaTreinamento(this.apiKey, {
          companyId, name: linha.tema, status: linha.status, sortOrder: linha.indice,
        });
        ids[linha.indice] = criada.id;
      } else if (precisaReenviar) {
        try {
          await this.cliente.atualizarEtapaTreinamento(this.apiKey, idDesk, {
            name: linha.tema, status: linha.status, sortOrder: linha.indice,
          });
        } catch (erro) {
          // O id salvo não existe mais do lado do Desk (apagado por lá, por exemplo) —
          // recria em vez de ficar tentando atualizar algo que já não existe para sempre.
          if (!(erro instanceof SsxDeskHttpError) || erro.status !== 404) throw erro;
          const recriada = await this.cliente.criarEtapaTreinamento(this.apiKey, {
            companyId, name: linha.tema, status: linha.status, sortOrder: linha.indice,
          });
          ids[linha.indice] = recriada.id;
        }
      }
    }
    // A trilha encolheu (menos linhas do que ids salvos antes): exclui os excedentes.
    for (let i = linhas.length; i < idsAntigos.length; i++) {
      if (!idsAntigos[i] || idsDuplicados.includes(idsAntigos[i])) continue;
      await this.esperar(PAUSA_ENTRE_CHAMADAS_MS);
      await this.cliente.excluirEtapaTreinamento(this.apiKey, idsAntigos[i]);
    }
    // Duplicatas sobrando no Desk (mesmo nome de uma linha atual, sem corresponder a
    // nenhuma) — sobra de uma reordenação que desalinhou o array local no passado.
    for (const idDuplicado of idsDuplicados) {
      await this.esperar(PAUSA_ENTRE_CHAMADAS_MS);
      await this.cliente.excluirEtapaTreinamento(this.apiKey, idDuplicado);
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
