import type { Request, Response } from 'express';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { COLECOES_SINCRONIZADAS, IndiceSincronizacao, type ColecaoSincronizada } from '../../infrastructure/firebase/IndiceSincronizacao.js';
import type { IUsuariosRepository } from '../../domain/interfaces/IUsuariosRepository.js';

// Cadastro do usuário por UID: evita uma leitura do Firestore a cada consulta de
// índice (o painel dispara várias por minuto). Revogações valem em até este prazo.
const CACHE_USUARIO_MS = 60_000;

export class SincronizacaoController {
  private readonly indice: IndiceSincronizacao | null;
  private readonly usuarios = new Map<string, { dados: Record<string, any> | undefined; expiraEm: number }>();

  constructor(
    db: Firestore | null,
    private readonly auth: Auth | null,
    private readonly usuariosRepo: IUsuariosRepository | null,
    indice?: IndiceSincronizacao | null,
  ) {
    this.indice = indice ?? (db ? new IndiceSincronizacao(db) : null);
  }

  private async lerUsuario(uid: string): Promise<Record<string, any> | undefined> {
    const agora = Date.now();
    const emCache = this.usuarios.get(uid);
    if (emCache && emCache.expiraEm > agora) return emCache.dados;
    const dados = await this.usuariosRepo!.buscarPorUid(uid);
    this.usuarios.set(uid, { dados, expiraEm: agora + CACHE_USUARIO_MS });
    return dados;
  }

  /** Token válido, usuário cadastrado e com acesso à coleção. Já responde o erro e retorna null quando bloqueia. */
  private async autorizar(req: Request, res: Response, colecao: ColecaoSincronizada): Promise<string | null> {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) { res.status(401).json({ error: 'Entre novamente no Radar.' }); return null; }
    let uid: string;
    try { uid = (await this.auth!.verifyIdToken(token, true)).uid; }
    catch { res.status(401).json({ error: 'Entre novamente no Radar.' }); return null; }
    const usuario = await this.lerUsuario(uid);
    if (!usuario || usuario.needsPasswordChange
      || !['master', 'treinador', 'suporte', 'hardware', 'comercial', 'financeiro', 'cs', 'crc', 'painel'].includes(usuario.role)) {
      res.status(403).json({ error: 'Usuário sem acesso ao Radar.' }); return null;
    }
    if (colecao === 'gamificacao_pontos' && !['master', 'treinador'].includes(usuario.role)) {
      res.status(403).json({ error: 'Usuário sem acesso à gamificação.' }); return null;
    }
    return uid;
  }

  private validarColecao(req: Request, res: Response): ColecaoSincronizada | null {
    if (!this.auth || !this.indice || !this.usuariosRepo) {
      res.status(503).json({ error: 'Sincronização indisponível.' }); return null;
    }
    const colecao = req.params.colecao as ColecaoSincronizada;
    if (!COLECOES_SINCRONIZADAS.includes(colecao)) {
      res.status(400).json({ error: 'Coleção inválida.' }); return null;
    }
    return colecao;
  }

  async listar(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'no-store');
    const colecao = this.validarColecao(req, res);
    if (!colecao) return;
    if (!(await this.autorizar(req, res, colecao))) return;
    try {
      // Somente IDs/versões: os dados seguem sendo lidos pelo SDK do navegador
      // sob as regras do Firestore e permissões de cada usuário.
      res.json({ documentos: await this.indice!.listar(colecao) });
    } catch {
      res.status(503).json({ error: 'Não foi possível sincronizar os dados. Tente novamente.' });
    }
  }

  /**
   * Serve o conteúdo dos documentos a partir do índice já mantido em memória
   * (ver IndiceSincronizacao) — sem nenhuma leitura adicional do Firestore.
   * Pensado para consumidores que pedem a coleção inteira com frequência (ex.:
   * painel ao vivo): hoje cada navegador lê os documentos diretamente do
   * Firestore, então N telas abertas multiplicam as leituras por N; aqui o
   * custo fica fixo, pago uma vez pelo listener do backend.
   */
  async documentos(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'no-store');
    const colecao = this.validarColecao(req, res);
    if (!colecao) return;
    if (!(await this.autorizar(req, res, colecao))) return;
    const idsBrutos = (req.body as { ids?: unknown } | undefined)?.ids;
    if (idsBrutos !== undefined && (!Array.isArray(idsBrutos) || !idsBrutos.every(id => typeof id === 'string'))) {
      res.status(400).json({ error: 'Lista de IDs inválida.' }); return;
    }
    try {
      const documentos = await this.indice!.dados(colecao);
      const filtro = idsBrutos ? new Set(idsBrutos as string[]) : null;
      res.json({ documentos: filtro ? documentos.filter(d => filtro.has(d.id as string)) : documentos });
    } catch {
      res.status(503).json({ error: 'Não foi possível sincronizar os dados. Tente novamente.' });
    }
  }
}
