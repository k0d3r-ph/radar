import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';

export class GestaoUsuariosError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

/** Perfis que podem ser atribuídos no cadastro (o legado `crc` não é mais criado). */
export const PERFIS_CADASTRAVEIS: readonly string[] = ['suporte', 'hardware', 'comercial', 'financeiro', 'treinador', 'cs', 'painel', 'master'];

const TAMANHO_MINIMO_SENHA = 6;

export interface SolicitanteGestao {
  uid: string;
  role: string;
}

export interface DadosNovoUsuario {
  email?: unknown;
  senhaTemporaria?: unknown;
  role?: unknown;
  nome?: unknown;
}

function codigoErro(erro: unknown): string | undefined {
  return typeof erro === 'object' && erro !== null && 'code' in erro ? String((erro as { code: unknown }).code) : undefined;
}

function validarUid(uid: unknown): string {
  if (typeof uid !== 'string' || !uid || uid.length > 128 || uid.includes('/')) {
    throw new GestaoUsuariosError(400, 'Informe um usuário válido.');
  }
  return uid;
}

function validarSenha(senha: unknown): string {
  if (typeof senha !== 'string' || senha.length < TAMANHO_MINIMO_SENHA) {
    throw new GestaoUsuariosError(400, `A senha deve ter pelo menos ${TAMANHO_MINIMO_SENHA} caracteres.`);
  }
  return senha;
}

export class GerenciarUsuarios {
  constructor(
    private readonly auth: Auth,
    private readonly db: Firestore,
    private readonly agora: () => number = Date.now,
  ) {}

  /** Cria a conta no Firebase Auth e o cadastro no Radar com troca de senha obrigatória no primeiro acesso. */
  async criar(solicitante: SolicitanteGestao, dados: DadosNovoUsuario): Promise<{ uid: string }> {
    const email = typeof dados.email === 'string' ? dados.email.trim() : '';
    const nome = typeof dados.nome === 'string' ? dados.nome.trim() : '';
    const role = typeof dados.role === 'string' ? dados.role : '';
    if (!nome || nome.length > 120) throw new GestaoUsuariosError(400, 'Informe o nome do usuário.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new GestaoUsuariosError(400, 'O formato do e-mail é inválido.');
    if (!PERFIS_CADASTRAVEIS.includes(role)) throw new GestaoUsuariosError(400, 'Selecione um perfil de acesso válido.');
    if (role === 'master' && solicitante.role !== 'master') {
      throw new GestaoUsuariosError(403, 'Somente um Master pode cadastrar outro Master.');
    }
    const senha = validarSenha(dados.senhaTemporaria);

    let uid: string;
    try {
      uid = (await this.auth.createUser({ email, password: senha })).uid;
    } catch (erro) {
      const codigo = codigoErro(erro);
      if (codigo === 'auth/email-already-exists') throw new GestaoUsuariosError(409, 'Este e-mail já está sendo utilizado por outro usuário.');
      if (codigo === 'auth/invalid-email') throw new GestaoUsuariosError(400, 'O formato do e-mail é inválido.');
      if (codigo === 'auth/invalid-password') throw new GestaoUsuariosError(400, `A senha deve ter pelo menos ${TAMANHO_MINIMO_SENHA} caracteres.`);
      throw erro;
    }

    const agora = this.agora();
    try {
      await this.db.collection('usuarios').doc(uid).set({
        email, role, nome, needsPasswordChange: true, createdAt: agora, updatedAt: agora,
      });
    } catch (erro) {
      // Sem o cadastro a conta não entra no Radar; desfaz para o e-mail poder ser usado de novo.
      await this.auth.deleteUser(uid).catch(() => {
        console.error(`[Usuários] A conta ${uid} ficou sem cadastro no Radar; remova-a em Firebase Authentication.`);
      });
      throw erro;
    }
    return { uid };
  }

  async redefinirSenha(solicitante: SolicitanteGestao, uidAlvo: unknown, novaSenha: unknown): Promise<void> {
    const uid = validarUid(uidAlvo);
    const senha = validarSenha(novaSenha);
    const ref = this.db.collection('usuarios').doc(uid);
    const alvo = (await ref.get()).data();
    if (!alvo) throw new GestaoUsuariosError(404, 'Usuário não encontrado. Atualize a lista.');
    this.conferirHierarquia(solicitante, alvo);
    try {
      await this.auth.updateUser(uid, { password: senha });
    } catch (erro) {
      const codigo = codigoErro(erro);
      if (codigo === 'auth/user-not-found') throw new GestaoUsuariosError(404, 'A conta de acesso deste usuário não existe mais.');
      if (codigo === 'auth/invalid-password') throw new GestaoUsuariosError(400, `A senha deve ter pelo menos ${TAMANHO_MINIMO_SENHA} caracteres.`);
      throw erro;
    }
    await ref.update({ needsPasswordChange: true, updatedAt: this.agora() });
  }

  /** Remove a conta de acesso e o cadastro. Registros antigos vinculados ao UID são preservados. */
  async excluir(solicitante: SolicitanteGestao, uidAlvo: unknown): Promise<void> {
    const uid = validarUid(uidAlvo);
    const ref = this.db.collection('usuarios').doc(uid);
    const alvo = (await ref.get()).data();
    if (alvo) this.conferirHierarquia(solicitante, alvo);
    try {
      await this.auth.deleteUser(uid);
    } catch (erro) {
      if (codigoErro(erro) !== 'auth/user-not-found') throw erro;
    }
    await ref.delete();
  }

  private conferirHierarquia(solicitante: SolicitanteGestao, alvo: Record<string, any>): void {
    if (alvo.role === 'master' && solicitante.role !== 'master') {
      throw new GestaoUsuariosError(403, 'Somente um Master pode alterar outro Master.');
    }
  }
}
