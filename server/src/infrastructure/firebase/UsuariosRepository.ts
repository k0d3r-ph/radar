import type { Firestore } from 'firebase-admin/firestore';
import type { IUsuariosRepository } from '../../domain/interfaces/IUsuariosRepository.js';

export class FirestoreUsuariosRepository implements IUsuariosRepository {
  constructor(private readonly db: Firestore) {}

  async buscarPorUid(uid: string): Promise<Record<string, any> | undefined> {
    return (await this.db.collection('usuarios').doc(uid).get()).data();
  }
}
