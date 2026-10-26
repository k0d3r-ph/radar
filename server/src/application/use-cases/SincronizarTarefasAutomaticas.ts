import type { Firestore } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { calcularSituacaoAcompanhamento, encontrarResponsavel, normalizarCliente } from '../../domain/acompanhamentoEsteira.js';
import type { ClienteAcompanhamento, ContatoAcompanhamento } from '../../domain/acompanhamentoEsteira.js';
import type { IndiceSincronizacao } from '../../infrastructure/firebase/IndiceSincronizacao.js';

/** Usa o mesmo cache/listener do índice incremental. O relógio também pode abrir tarefas sem novas gravações. */
export class SincronizarTarefasAutomaticas {
  private executando = false;
  private usuarios: { uid: string; nome: string }[] = [];
  private usuariosExpiram = 0;
  /** Evita repetir o mesmo aviso a cada minuto; volta a avisar se o vínculo mudar. */
  private avisosVinculo = new Map<string, string>();
  constructor(private readonly db: Firestore, private readonly indice: IndiceSincronizacao) {}
  async execute(agora = Date.now()) {
    if (this.executando) return;
    this.executando = true;
    try {
      const [empresas, contatos, tarefas] = await Promise.all([this.indice.dados('empresas'), this.indice.dados('ocorrencias'), this.indice.dados('checklist_tarefas')]);
      if (agora >= this.usuariosExpiram) {
        this.usuarios = (await this.db.collection('usuarios').get()).docs.filter(d => !d.data().inativo && ['master', 'treinador'].includes(d.data().role)).map(d => ({ uid: d.id, nome: String(d.data().nome || '') }));
        this.usuariosExpiram = agora + 3_600_000;
      }
      const contatosPorEmpresa = new Map<string, ContatoAcompanhamento[]>();
      for (const dado of contatos) {
        const contato = dado as unknown as ContatoAcompanhamento;
        const nome = normalizarCliente(contato.empresa || '');
        const lista = contatosPorEmpresa.get(nome) || [];
        lista.push(contato); contatosPorEmpresa.set(nome, lista);
      }
      const porId = new Map(tarefas.map(t => [String(t.id), t]));
      const ativos = new Set<string>();
      for (const e of empresas) {
        const empresa = e as unknown as ClienteAcompanhamento;
        const situacao = calcularSituacaoAcompanhamento(empresa, contatosPorEmpresa.get(normalizarCliente(empresa.nomeEmpresa)) || [], agora);
        if (!situacao.tipo || !situacao.base) continue;
        const id = `auto-${createHash('sha256').update(`${e.id}:${situacao.tipo}:${situacao.base}`).digest('hex')}`;
        ativos.add(id);
        const anterior = porId.get(id);
        const vinculo = encontrarResponsavel(empresa.responsavel, this.usuarios);
        const treinador = vinculo.treinador;
        const chaveAviso = String(e.id);
        if (!treinador) {
          const motivo = vinculo.ambiguo ? 'ambiguo' : 'sem-treinador';
          if (this.avisosVinculo.get(chaveAviso) !== `${motivo}:${empresa.responsavel || ''}`) {
            this.avisosVinculo.set(chaveAviso, `${motivo}:${empresa.responsavel || ''}`);
            console.warn(`[Tarefas automáticas] Cliente ${e.id}: ${vinculo.ambiguo ? 'mais de um treinador com o mesmo primeiro nome do responsável; informe o nome completo no cadastro' : 'responsável não corresponde a um treinador ativo'}. Tarefa não criada.`);
          }
        } else this.avisosVinculo.delete(chaveAviso);
        if (!treinador || (!anterior && situacao.suspensa)) continue;
        if (anterior && (anterior.concluida || anterior.excluida || (anterior.pausada === situacao.suspensa && anterior.treinadorId === treinador.uid))) continue;
        await this.db.runTransaction(async tx => {
          const ref = this.db.collection('checklist_tarefas').doc(id);
          const [atual, cliente, historico] = await Promise.all([tx.get(ref), tx.get(this.db.collection('empresas').doc(String(e.id))), tx.get(this.db.collection('ocorrencias').where('empresa', '==', empresa.nomeEmpresa))]);
          if (!cliente.exists) return;
          const conferir = calcularSituacaoAcompanhamento(cliente.data() as ClienteAcompanhamento, historico.docs.map(d => d.data() as ContatoAcompanhamento), agora);
          if (conferir.tipo !== situacao.tipo || conferir.base !== situacao.base) return;
          if (atual.exists) {
            if (!atual.data()?.concluida && !atual.data()?.excluida) tx.update(ref, { pausada: conferir.suspensa, treinadorId: treinador.uid, treinadorNome: treinador.nome, updatedAt: agora });
          } else if (!conferir.suspensa) tx.set(ref, {
            empresaId: e.id, empresa: empresa.nomeEmpresa, automatica: true, origemAutomatica: situacao.tipo, baseAutomatica: situacao.base,
            treinadorId: treinador.uid, treinadorNome: treinador.nome, descricao: `${empresa.nomeEmpresa}: ${situacao.tipo === 'follow_up_final' ? 'Realizar e registrar o Follow-up final.' : 'Entrar em contato com o cliente e marcar a agenda de treinamento.'}`,
            concluida: false, pausada: false, prioridade: 'alta', criadoPorId: 'sistema', criadoPorNome: 'Radar', createdAt: agora, updatedAt: agora,
            historicoAutomatico: [{ evento: 'criada', em: agora }],
          });
        });
      }
      for (const t of tarefas) {
        if (!t.automatica || t.concluida || t.excluida || ativos.has(String(t.id))) continue;
        await this.db.runTransaction(async tx => {
          const ref = this.db.collection('checklist_tarefas').doc(String(t.id));
          const [atual, cliente] = await Promise.all([tx.get(ref), tx.get(this.db.collection('empresas').doc(String(t.empresaId)))]);
          if (!atual.exists || atual.data()?.concluida || atual.data()?.excluida) return;
          const empresa = cliente.data() as ClienteAcompanhamento | undefined;
          const historico = empresa ? await tx.get(this.db.collection('ocorrencias').where('empresa', '==', empresa.nomeEmpresa)) : null;
          const estado = empresa ? calcularSituacaoAcompanhamento(empresa, historico!.docs.map(d => d.data() as ContatoAcompanhamento), agora) : null;
          if (estado && estado.tipo === t.origemAutomatica && estado.base === t.baseAutomatica) return;
          tx.update(ref, { concluida: true, concluidaEm: agora, pausada: false, updatedAt: agora,
            historicoAutomatico: [...(Array.isArray(atual.data()?.historicoAutomatico) ? atual.data()!.historicoAutomatico : []), { evento: 'situacao_resolvida', em: agora }] });
        });
      }
    } finally { this.executando = false; }
  }
}
