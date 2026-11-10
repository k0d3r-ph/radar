import type { RequestHandler } from 'express';
import type { Auth } from 'firebase-admin/auth';
import type { IUsuariosRepository } from '../../domain/interfaces/IUsuariosRepository.js';

export const PERFIS_RADAR: readonly string[] = ['master', 'treinador', 'suporte', 'hardware', 'comercial', 'financeiro', 'cs', 'crc', 'painel'];
/** Mesmos perfis que acessam as telas de Usuários e de WhatsApp (ver app/src/App.tsx). */
export const PERFIS_GESTORES: readonly string[] = ['master', 'treinador'];

// Cadastro por UID: evita uma leitura do Firestore a cada requisição. Inativar ou
// trocar o perfil de um usuário vale em até este prazo.
const CACHE_USUARIO_MS = 60_000;

export interface UsuarioRadar {
  uid: string;
  role: string;
}

export class AcessoNegadoError extends Error {
  constructor(public readonly status: 401 | 403 | 503, message: string) { super(message); }
}

export function extrairToken(cabecalho: string | undefined): string | undefined {
  return cabecalho?.match(/^Bearer (.+)$/i)?.[1];
}

export class AutenticadorRadar {
  private readonly cache = new Map<string, { dados: Record<string, any> | undefined; expiraEm: number }>();

  constructor(
    private readonly auth: Auth | null,
    private readonly usuarios: IUsuariosRepository | null,
    private readonly agora: () => number = Date.now,
  ) {}

  /** Token válido, cadastro ativo no Radar, senha já definida e perfil na lista. */
  async autenticar(token: string | undefined, perfis: readonly string[]): Promise<UsuarioRadar> {
    if (!this.auth || !this.usuarios) throw new AcessoNegadoError(503, 'Autenticação indisponível no servidor.');
    if (!token) throw new AcessoNegadoError(401, 'Entre novamente no Radar.');
    let uid: string;
    try { uid = (await this.auth.verifyIdToken(token, true)).uid; }
    catch { throw new AcessoNegadoError(401, 'Entre novamente no Radar.'); }
    const usuario = await this.lerUsuario(uid);
    if (!usuario || usuario.inativo || usuario.needsPasswordChange || !PERFIS_RADAR.includes(usuario.role)) {
      throw new AcessoNegadoError(403, 'Usuário sem acesso ao Radar.');
    }
    if (!perfis.includes(usuario.role)) throw new AcessoNegadoError(403, 'Seu perfil não tem permissão para esta ação.');
    return { uid, role: usuario.role };
  }

  /** Deixa o usuário em `res.locals.usuarioRadar` ou responde 401/403/503. */
  exigir(perfis: readonly string[]): RequestHandler {
    return async (req, res, next) => {
      try {
        res.locals.usuarioRadar = await this.autenticar(extrairToken(req.headers.authorization), perfis);
      } catch (erro) {
        res.set('Cache-Control', 'no-store');
        if (erro instanceof AcessoNegadoError) {
          res.status(erro.status).json({ success: false, error: erro.message });
        } else {
          console.error('[Autenticação] Falha ao validar o acesso.');
          res.status(503).json({ success: false, error: 'Não foi possível validar seu acesso. Tente novamente.' });
        }
        return;
      }
      next();
    };
  }

  private async lerUsuario(uid: string): Promise<Record<string, any> | undefined> {
    const agora = this.agora();
    const emCache = this.cache.get(uid);
    if (emCache && emCache.expiraEm > agora) return emCache.dados;
    const dados = await this.usuarios!.buscarPorUid(uid);
    this.cache.set(uid, { dados, expiraEm: agora + CACHE_USUARIO_MS });
    return dados;
  }
}
