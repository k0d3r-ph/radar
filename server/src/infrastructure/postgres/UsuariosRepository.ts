import type { BancoDocumentos } from '../../domain/interfaces/BancoDocumentos.js';
import type { IUsuariosRepository } from '../../domain/interfaces/IUsuariosRepository.js';

export class UsuariosRepository implements IUsuariosRepository {
  constructor(private readonly db: BancoDocumentos) {}

  async buscarPorUid(uid: string): Promise<Record<string, any> | undefined> {
    return (await this.db.collection('usuarios').doc(uid).get()).data();
  }
}
