import type { Firestore } from 'firebase-admin/firestore';

export class FavoritoError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export function normalizarEmpresaFavorito(nome: string): string {
  return nome.trim().toLowerCase().replace(/&amp;/g, '&').replace(/\s+/g, ' ');
}

export function podeFavoritar(role: string): boolean {
  return role === 'master' || role === 'treinador';
}

export class SetOcorrenciaFavorita {
  constructor(private readonly db: Firestore) {}

  async execute(id: string, favorita: boolean, uid: string, role: string) {
    if (!podeFavoritar(role)) throw new FavoritoError(403, 'Apenas treinadores e masters podem alterar as estrelas.');
    const ref = this.db.collection('ocorrencias').doc(id);
    const original = await ref.get();
    if (!original.exists) throw new FavoritoError(404, 'Ocorrência não encontrada.');
    const nome = original.data()!.empresa as string;
    let empresas = await this.db.collection('empresas').where('nomeEmpresa', '==', nome).get();
    // O Histórico permite grafias de caixa/espaçamento diferentes do cadastro.
    if (empresas.empty) empresas = await this.db.collection('empresas').get();
    const correspondentes = empresas.docs.filter(e => normalizarEmpresaFavorito(e.data().nomeEmpresa || '') === normalizarEmpresaFavorito(nome));
    if (correspondentes.length !== 1) throw new FavoritoError(409, 'Não foi possível identificar um único cliente para esta ocorrência.');
    const empresaRef = correspondentes[0].ref;
    const controleRef = this.db.collection('favoritosOcorrencias').doc(empresaRef.id);

    return this.db.runTransaction(async tx => {
      const [ocorrencia, empresa, controle] = await Promise.all([tx.get(ref), tx.get(empresaRef), tx.get(controleRef)]);
      if (!ocorrencia.exists) throw new FavoritoError(404, 'Ocorrência não encontrada.');
      if (!empresa.exists || normalizarEmpresaFavorito(ocorrencia.data()!.empresa) !== normalizarEmpresaFavorito(empresa.data()!.nomeEmpresa)) {
        throw new FavoritoError(409, 'O cadastro do cliente mudou. Atualize a tela e tente novamente.');
      }
      const registrados = [...new Set<string>((controle.data()?.ocorrenciaIds || []) as string[])].filter(item => item !== id);
      // Descarta referências a registros excluídos ou movidos para outro cliente.
      const documentos = registrados.length ? await tx.getAll(...registrados.map(item => this.db.collection('ocorrencias').doc(item))) : [];
      const ativos = documentos.filter(d => d.exists && d.data()!.favorita === true
        && normalizarEmpresaFavorito(d.data()!.empresa) === normalizarEmpresaFavorito(empresa.data()!.nomeEmpresa)).map(d => d.id);
      if (favorita && ativos.length >= 3) throw new FavoritoError(409, 'Este cliente já possui 3 ocorrências com estrela. Remova uma para marcar outra.');
      const updatedAt = Date.now();
      const dados = { favorita, favoritaEmpresaId: favorita ? empresaRef.id : '',
        favoritadaPor: favorita ? uid : '', favoritadaEm: favorita ? updatedAt : null, updatedAt };
      // Controle compartilhado por cliente serializa marcações concorrentes entre usuários/instâncias.
      tx.set(controleRef, { ocorrenciaIds: favorita ? [...ativos, id] : ativos, updatedAt });
      tx.update(ref, dados);
      return dados;
    });
  }
}
