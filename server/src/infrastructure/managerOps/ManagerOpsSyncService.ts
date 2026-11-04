import type { Firestore } from 'firebase-admin/firestore';
import {
  atualizarCombinado, criarCombinado, excluirCombinado, listarTodosCombinados,
  type ManagerOpsAgreement, type ManagerOpsPriority,
} from './ManagerOpsClient.js';

const COLECAO = 'checklist_tarefas';
const PRAZO_HORA_BRASILIA = 'T18:00:00-03:00';
// Reconsulta um pouco antes do cursor para não perder itens salvos no meio do ciclo
// anterior — reprocessar um item por engano é inofensivo aqui (tudo é idempotente).
const MARGEM_SEGURANCA_MS = 2 * 60_000;

interface UsuarioRadar { uid: string; nome: string; email: string }

interface TarefaRadar {
  id: string;
  treinadorId: string;
  treinadorNome: string;
  descricao: string;
  concluida: boolean;
  concluidaEm?: number;
  excluida?: boolean;
  excluidaEm?: number;
  automatica?: boolean;
  pausada?: boolean;
  prioridade?: 'baixa' | 'normal' | 'alta' | 'urgente';
  slaEm?: number;
  createdAt: number;
  updatedAt?: number;
  idTarefaDaily?: string;
  managerOpsSyncedAt?: number;
  criadoPorId: string;
  criadoPorNome: string;
}

export const PRIORIDADE_PARA_DAILY: Record<NonNullable<TarefaRadar['prioridade']>, ManagerOpsPriority> = {
  baixa: 'LOW', normal: 'NORMAL', alta: 'HIGH', urgente: 'HIGH',
};
export const PRIORIDADE_DA_DAILY: Record<ManagerOpsPriority, NonNullable<TarefaRadar['prioridade']>> = {
  LOW: 'baixa', NORMAL: 'normal', HIGH: 'alta',
};

/** Mesma regra de app/src/utils/tarefasDaily.ts — vencimento às 18h de Brasília do dia
 * informado pela Daily. Duplicada aqui porque o servidor não compila o código do app. */
export function prazoApartirDoDueDate(dueDate: string): number | undefined {
  const timestamp = Date.parse(`${dueDate}${PRAZO_HORA_BRASILIA}`);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

export function dueDateApartirDoPrazo(slaEm: number): string {
  // AAAA-MM-DD no fuso de Brasília, como a Daily espera.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(slaEm);
}

/** Título (3–160 caracteres, exigido pela Daily) a partir da descrição livre do Radar. */
export function tituloApartirDaDescricao(descricao: string): string {
  const texto = descricao.trim() || 'Tarefa do Radar';
  if (texto.length <= 160) return texto.length >= 3 ? texto : texto.padEnd(3, '.');
  return `${texto.slice(0, 157)}...`;
}

export function textoApartirDoCombinado(agreement: ManagerOpsAgreement): string {
  return agreement.description?.trim()
    ? `${agreement.title}\n\n${agreement.description.trim()}`
    : agreement.title;
}

/** Funções do ManagerOpsClient injetáveis, para testar a lógica de sincronização sem
 * bater na API real — mesmo papel do `consultar` do SsxDeskSyncService. */
export interface ManagerOpsClienteFns {
  listarTodosCombinados: typeof listarTodosCombinados;
  criarCombinado: typeof criarCombinado;
  atualizarCombinado: typeof atualizarCombinado;
  excluirCombinado: typeof excluirCombinado;
}

const CLIENTE_PADRAO: ManagerOpsClienteFns = {
  listarTodosCombinados, criarCombinado, atualizarCombinado, excluirCombinado,
};

export class ManagerOpsSyncService {
  private executando = false;
  private usuarios: UsuarioRadar[] | undefined;
  private usuariosLidosEm = 0;

  constructor(
    private readonly db: Firestore,
    private readonly apiKey: string,
    private readonly cliente: ManagerOpsClienteFns = CLIENTE_PADRAO,
  ) {}

  async sincronizar() {
    if (this.executando) return undefined;
    this.executando = true;
    try {
      // O cursor da próxima vez é o início DESTE ciclo (não o maior updatedAt visto nos
      // itens processados): uma tarefa salva no meio do ciclo, depois da consulta já ter
      // rodado, teria updatedAt menor que itens processados depois dela e seria pulada
      // para sempre se o cursor avançasse pelo maior valor do lote. Reprocessar um item
      // por engano é inofensivo aqui (tudo é idempotente); perder um não é.
      const inicioDoCiclo = Date.now();
      const usuarios = await this.carregarUsuarios();
      const estado = await this.carregarEstado();
      const stats = {
        puxadas: { criadas: 0, atualizadas: 0, semResponsavel: 0, ignoradas: 0 },
        empurradas: { criadas: 0, atualizadas: 0, excluidas: 0, semEmailNaDaily: 0, ignoradas: 0 },
      };

      const desdeDaily = estado.lastPulledUpdatedSince
        ? new Date(Date.parse(estado.lastPulledUpdatedSince) - MARGEM_SEGURANCA_MS).toISOString()
        : undefined;
      const agreements = await this.cliente.listarTodosCombinados(this.apiKey, desdeDaily);
      for (const agreement of agreements) {
        const resultado = await this.aplicarCombinado(agreement, usuarios);
        stats.puxadas[resultado]++;
      }

      const desdeRadar = Math.max(0, estado.lastPushedAt - MARGEM_SEGURANCA_MS);
      const tarefas = await this.carregarTarefasParaEmpurrar(desdeRadar);
      let falhaAoEmpurrar = false;
      for (const tarefa of tarefas) {
        try {
          const resultado = await this.empurrarTarefa(tarefa, usuarios);
          stats.empurradas[resultado]++;
        } catch (erro) {
          falhaAoEmpurrar = true;
          // Uma tarefa com problema (ex.: e-mail que a Daily não reconhece) não pode
          // travar o envio das demais — ela é tentada de novo no próximo ciclo.
          const mensagem = erro instanceof Error ? erro.message : 'erro desconhecido';
          console.error(`[Manager Ops] Falha ao empurrar a tarefa ${tarefa.id}:`, mensagem);
        }
      }
      await this.db.doc('integracoes/managerOps').set({
        lastSuccessAt: Date.now(),
        lastError: falhaAoEmpurrar ? 'Uma ou mais tarefas não foram sincronizadas com a Manager Ops.' : null,
        lastPulledUpdatedSince: new Date(inicioDoCiclo).toISOString(),
        // Não avance o cursor do Radar enquanto houver falhas: a tarefa pode ter um
        // updatedAt antigo demais para entrar na janela de leitura do próximo ciclo.
        lastPushedAt: falhaAoEmpurrar ? estado.lastPushedAt : inicioDoCiclo,
        ...stats,
      }, { merge: true });
      return stats;
    } finally {
      this.executando = false;
    }
  }

  private async carregarEstado(): Promise<{ lastPulledUpdatedSince?: string; lastPushedAt: number }> {
    const doc = await this.db.doc('integracoes/managerOps').get();
    const dados = doc.data() || {};
    return {
      lastPulledUpdatedSince: typeof dados.lastPulledUpdatedSince === 'string' ? dados.lastPulledUpdatedSince : undefined,
      lastPushedAt: typeof dados.lastPushedAt === 'number' ? dados.lastPushedAt : 0,
    };
  }

  private async carregarUsuarios(): Promise<UsuarioRadar[]> {
    // Usuários mudam raramente — mesma estratégia de cache do SSX Desk.
    const agora = Date.now();
    if (this.usuarios && agora - this.usuariosLidosEm < 60 * 60 * 1000) return this.usuarios;
    const snapshot = await this.db.collection('usuarios').get();
    this.usuarios = snapshot.docs
      .map(d => ({ uid: d.id, nome: (d.data().nome as string) || '', email: (d.data().email as string) || '' }))
      .filter(u => u.email);
    this.usuariosLidosEm = agora;
    return this.usuarios;
  }

  private encontrarUsuarioPorEmail(usuarios: UsuarioRadar[], email: string): UsuarioRadar | undefined {
    const alvo = email.trim().toLowerCase();
    return usuarios.find(u => u.email.trim().toLowerCase() === alvo);
  }

  /** Busca a tarefa já vinculada a este combinado, se existir. */
  private async buscarTarefaVinculada(agreementId: string) {
    const snapshot = await this.db.collection(COLECAO).where('idTarefaDaily', '==', agreementId).limit(1).get();
    return snapshot.empty ? null : snapshot.docs[0];
  }

  private async aplicarCombinado(agreement: ManagerOpsAgreement, usuarios: UsuarioRadar[]) {
    const vinculada = await this.buscarTarefaVinculada(agreement.id);
    const agora = Date.now();
    const concluida = agreement.status === 'DONE';
    const excluida = agreement.status === 'CANCELLED';

    if (vinculada) {
      const atual = vinculada.data() as TarefaRadar;
      // Regra de conflito ("quem editou por último vence"): só aplica a versão da Daily
      // se ela for mais recente que a última edição local — senão uma mudança feita no
      // Radar entre dois ciclos seria apagada pela versão mais antiga vinda da Daily.
      const atualizadaEmMs = Date.parse(agreement.updatedAt);
      const ultimaEdicaoLocal = atual.updatedAt ?? atual.createdAt;
      if (atualizadaEmMs <= ultimaEdicaoLocal) return 'ignoradas' as const;
      const prazoConclusao = concluida
        ? (agreement.completedAt ? Date.parse(agreement.completedAt) : agora)
        : undefined;
      const prazoExclusao = excluida && !atual.excluida ? agora : atual.excluidaEm;
      await vinculada.ref.update({
        descricao: textoApartirDoCombinado(agreement),
        prioridade: PRIORIDADE_DA_DAILY[agreement.priority],
        concluida,
        ...(prazoConclusao !== undefined ? { concluidaEm: prazoConclusao } : {}),
        excluida: excluida || Boolean(atual.excluida),
        ...(prazoExclusao !== undefined ? { excluidaEm: prazoExclusao } : {}),
        updatedAt: agora,
        managerOpsSyncedAt: agora,
      });
      return 'atualizadas' as const;
    }

    // Combinado novo na Daily — só cria tarefa no Radar se der pra achar o dono.
    if (excluida) return 'ignoradas' as const; // cancelado antes mesmo de chegar ao Radar.
    const usuario = this.encontrarUsuarioPorEmail(usuarios, agreement.member.email);
    if (!usuario) return 'semResponsavel' as const;
    const prazo = agreement.dueDate ? prazoApartirDoDueDate(agreement.dueDate) : undefined;
    const dados: Omit<TarefaRadar, 'id'> = {
      treinadorId: usuario.uid,
      treinadorNome: usuario.nome,
      descricao: textoApartirDoCombinado(agreement),
      concluida,
      ...(concluida ? { concluidaEm: agreement.completedAt ? Date.parse(agreement.completedAt) : agora } : {}),
      criadoPorId: '',
      criadoPorNome: 'Daily (sincronização automática)',
      createdAt: Date.parse(agreement.createdAt) || agora,
      updatedAt: agora,
      prioridade: PRIORIDADE_DA_DAILY[agreement.priority],
      ...(prazo !== undefined ? { slaEm: prazo } : {}),
      idTarefaDaily: agreement.id,
      managerOpsSyncedAt: agora,
    };
    await this.db.collection(COLECAO).add(dados);
    return 'criadas' as const;
  }

  private async carregarTarefasParaEmpurrar(desde: number) {
    // Duas consultas porque a criação de uma tarefa (ver app/src/services/checklist.ts)
    // não grava `updatedAt` — só a primeira edição grava. Sem a consulta por `createdAt`,
    // uma tarefa nova nunca editada jamais seria selecionada para o primeiro envio.
    const [porCriacao, porAtualizacao] = await Promise.all([
      this.db.collection(COLECAO).where('createdAt', '>', desde).get(),
      this.db.collection(COLECAO).where('updatedAt', '>', desde).get(),
    ]);
    const porId = new Map<string, TarefaRadar>();
    for (const d of [...porCriacao.docs, ...porAtualizacao.docs]) {
      porId.set(d.id, { id: d.id, ...(d.data() as Omit<TarefaRadar, 'id'>) });
    }
    return [...porId.values()].filter(t =>
      !t.automatica &&
      // Sem isso, uma tarefa que acabou de ser PUXADA da Daily (que grava updatedAt local
      // igual a managerOpsSyncedAt) pareceria "mudada" pra esta consulta e seria empurrada
      // de volta sem necessidade — indo e voltando pra sempre a cada ciclo.
      (t.managerOpsSyncedAt ?? 0) < (t.updatedAt ?? t.createdAt),
    );
  }

  private async empurrarTarefa(tarefa: TarefaRadar, usuarios: UsuarioRadar[]) {
    const agora = Date.now();
    const ref = this.db.collection(COLECAO).doc(tarefa.id);

    if (!tarefa.idTarefaDaily) {
      // Tarefa concluída/excluída antes do primeiro envio não precisa mais ir pra Daily.
      if (tarefa.concluida || tarefa.excluida) { await ref.update({ managerOpsSyncedAt: agora }); return 'ignoradas' as const; }
      const usuario = usuarios.find(u => u.uid === tarefa.treinadorId);
      if (!usuario) { await ref.update({ managerOpsSyncedAt: agora }); return 'semEmailNaDaily' as const; }
      const criado = await this.cliente.criarCombinado(this.apiKey, {
        memberEmail: usuario.email,
        title: tituloApartirDaDescricao(tarefa.descricao),
        description: tarefa.descricao,
        priority: PRIORIDADE_PARA_DAILY[tarefa.prioridade || 'normal'],
        ...(tarefa.slaEm ? { dueDate: dueDateApartirDoPrazo(tarefa.slaEm) } : {}),
      });
      await ref.update({ idTarefaDaily: criado.id, managerOpsSyncedAt: agora });
      return 'criadas' as const;
    }

    if (tarefa.excluida) {
      await this.cliente.excluirCombinado(this.apiKey, tarefa.idTarefaDaily);
      await ref.update({ managerOpsSyncedAt: agora });
      return 'excluidas' as const;
    }

    if (tarefa.concluida) {
      await this.cliente.atualizarCombinado(this.apiKey, tarefa.idTarefaDaily, { status: 'DONE' });
      await ref.update({ managerOpsSyncedAt: agora });
      return 'atualizadas' as const;
    }

    // Reabrir uma tarefa (concluida: false de novo) depois de enviada como DONE não é
    // suportado pela API da Daily — ela não documenta como reverter o status. Só o texto
    // e a prioridade continuam sincronizáveis nesse caso.
    await this.cliente.atualizarCombinado(this.apiKey, tarefa.idTarefaDaily, {
      title: tituloApartirDaDescricao(tarefa.descricao),
      description: tarefa.descricao,
      priority: PRIORIDADE_PARA_DAILY[tarefa.prioridade || 'normal'],
    });
    await ref.update({ managerOpsSyncedAt: agora });
    return 'atualizadas' as const;
  }
}

export function iniciarSincronizacaoManagerOps(db: Firestore | null, apiKey: string, intervaloMs: number) {
  if (!apiKey) { console.log('[Manager Ops] Sincronização desativada: configure MANAGER_OPS_API_KEY.'); return; }
  if (!db) { console.error('[Manager Ops] Sincronização indisponível: Firebase Admin não inicializado.'); return; }
  const service = new ManagerOpsSyncService(db, apiKey);
  const executar = async () => {
    try {
      const stats = await service.sincronizar();
      if (stats) console.log('[Manager Ops] Sincronização concluída:', JSON.stringify(stats));
    } catch (error) {
      // Nunca registrar headers, chave ou corpo bruto da resposta.
      const mensagem = error instanceof Error ? error.message : 'Falha na sincronização';
      console.error('[Manager Ops]', mensagem);
      await db.doc('integracoes/managerOps').set({ lastErrorAt: Date.now(), lastError: mensagem }, { merge: true })
        .catch(() => console.error('[Manager Ops] Não foi possível registrar o erro no Firebase.'));
    }
  };
  void executar();
  const timer = setInterval(() => { void executar(); }, intervaloMs);
  timer.unref();
  return () => clearInterval(timer);
}
