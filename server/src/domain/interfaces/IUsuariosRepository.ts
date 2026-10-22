export interface IUsuariosRepository {
  buscarPorUid(uid: string): Promise<Record<string, any> | undefined>;
}
