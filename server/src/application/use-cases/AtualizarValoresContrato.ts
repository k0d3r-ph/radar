import type { Firestore } from 'firebase-admin/firestore';
import { normalizarNomeCentral, resolverCentral, type LinhaCentral } from '../../domain/entities/CentralPlanilha.js';

type ClienteContrato = {
  nomeEmpresa?: string;
  idCentral?: string;
  valorContrato?: number | null;
  isOngoing?: boolean;
  isSuspended?: boolean;
  isCancelled?: boolean;
};

type AlteracaoContrato = { id: string; nomeEmpresa: string; anterior: number | null; valorContrato: number };
type Resultado = {
  lidos: number;
  foraDaEsteira: number;
  preservados: number;
  semCorrespondencia: string[];
  semValorValido: string[];
  alteracoes: AlteracaoContrato[];
  conflitos: string[];
  falhas: string[];
};

const naEsteira = (cliente: ClienteContrato) => !cliente.isOngoing && !cliente.isSuspended && !cliente.isCancelled
  && normalizarNomeCentral(cliente.nomeEmpresa || '') !== 'SYSTEMSAT';

function valorParaAtualizar(cliente: ClienteContrato, linhas: LinhaCentral[], sobrescrever: boolean): number | undefined {
  if (!naEsteira(cliente) || (!sobrescrever && cliente.valorContrato != null)) return undefined;
  const central = resolverCentral(linhas, { nomeEmpresa: cliente.nomeEmpresa || '', idCentral: cliente.idCentral });
  const valor = central?.valorContrato;
  return typeof valor === 'number' && Number.isFinite(valor) && valor >= 0 && valor !== cliente.valorContrato ? valor : undefined;
}

/** Executado sob demanda pelo script administrativo; não roda na inicialização. */
export class AtualizarValoresContrato {
  constructor(private readonly db: Firestore) {}

  async execute(linhas: LinhaCentral[], opcoes: { aplicar?: boolean; sobrescrever?: boolean } = {}): Promise<Resultado> {
    if (!linhas.length || !linhas.some(linha => linha.valorContrato !== undefined)) {
      throw new Error('A planilha não possui valores de contrato válidos. Confira a coluna "Valor de contrato".');
    }
    const snapshot = await this.db.collection('empresas').get();
    const resultado: Resultado = { lidos: snapshot.size, foraDaEsteira: 0, preservados: 0,
      semCorrespondencia: [], semValorValido: [], alteracoes: [], conflitos: [], falhas: [] };
    for (const documento of snapshot.docs) {
      const cliente = documento.data() as ClienteContrato;
      const nome = cliente.nomeEmpresa || documento.id;
      if (!naEsteira(cliente)) { resultado.foraDaEsteira++; continue; }
      if (!opcoes.sobrescrever && cliente.valorContrato != null) { resultado.preservados++; continue; }
      const central = resolverCentral(linhas, { nomeEmpresa: nome, idCentral: cliente.idCentral });
      if (!central) { resultado.semCorrespondencia.push(nome); continue; }
      if (central.valorContrato === undefined) { resultado.semValorValido.push(nome); continue; }
      const valorContrato = valorParaAtualizar(cliente, linhas, !!opcoes.sobrescrever);
      if (valorContrato === undefined) { resultado.preservados++; continue; }
      if (opcoes.aplicar) {
        // Revalida dentro da transação: não altera um cliente suspenso, excluído,
        // renomeado ou editado entre a seleção e a gravação.
        let aplicado: boolean;
        try {
          aplicado = await this.db.runTransaction(async tx => {
            const atual = await tx.get(documento.ref);
            if (!atual.exists) return false;
            const dadosAtuais = atual.data() as ClienteContrato;
            if (dadosAtuais.nomeEmpresa !== cliente.nomeEmpresa || dadosAtuais.idCentral !== cliente.idCentral
              || dadosAtuais.valorContrato !== cliente.valorContrato
              || valorParaAtualizar(dadosAtuais, linhas, !!opcoes.sobrescrever) !== valorContrato) return false;
            tx.update(documento.ref, { valorContrato, updatedAt: Date.now() });
            return true;
          });
        } catch {
          resultado.falhas.push(nome);
          continue;
        }
        if (!aplicado) { resultado.conflitos.push(nome); continue; }
      }
      resultado.alteracoes.push({ id: documento.id, nomeEmpresa: nome, anterior: cliente.valorContrato ?? null, valorContrato });
    }
    return resultado;
  }
}
