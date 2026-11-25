/**
 * Permissões de leitura e gravação dos dados acessados pelo navegador (/api/dados).
 *
 * Tradução direta do antigo firestore.rules.producao. As demais coleções (CSAT, validação do
 * conhecimento, SSX Desk, integrações) continuam acessíveis só pelas rotas específicas da API.
 */
import { isDeepStrictEqual } from 'node:util';
import type { DadosDocumento } from './interfaces/BancoDocumentos.js';

export const COLECOES_NAVEGADOR = [
  'usuarios', 'empresas', 'ocorrencias', 'gamificacao_pontos', 'checklist_tarefas', 'configuracoes', 'temasOcorrencia',
] as const;
export type ColecaoNavegador = typeof COLECOES_NAVEGADOR[number];

export const ehColecaoNavegador = (nome: string): nome is ColecaoNavegador => (COLECOES_NAVEGADOR as readonly string[]).includes(nome);

export interface ContextoAcesso {
  uid: string;
  /** E-mail do token do Firebase Auth. */
  email?: string;
  /** Cadastro em usuarios/{uid}, lido a cada requisição (inativação vale na hora). */
  cadastro?: DadosDocumento;
}

export type OperacaoGravacao = 'create' | 'update' | 'delete';

/** Como `data.get(campo, padrao)` das regras: o padrão só vale quando o campo não existe. */
const campo = (dados: DadosDocumento | undefined, nome: string, padrao: unknown): unknown =>
  dados && Object.prototype.hasOwnProperty.call(dados, nome) ? dados[nome] : padrao;

/** Cadastro existe e não está inativo. */
export const ehUsuarioRadar = (ctx: ContextoAcesso) => !!ctx.cadastro && campo(ctx.cadastro, 'inativo', false) !== true;
const temPerfil = (ctx: ContextoAcesso, perfis: string[]) => ehUsuarioRadar(ctx) && perfis.includes(String(campo(ctx.cadastro, 'role', '')));
const ehMaster = (ctx: ContextoAcesso) => temPerfil(ctx, ['master']);
const ehTreinadorOuMaster = (ctx: ContextoAcesso) => temPerfil(ctx, ['treinador', 'master']);

/** Campos incluídos, removidos ou com valor diferente (`diff().affectedKeys()`). */
export function camposAlterados(antes: DadosDocumento | undefined, depois: DadosDocumento | undefined): string[] {
  const chaves = new Set([...Object.keys(antes ?? {}), ...Object.keys(depois ?? {})]);
  return [...chaves].filter(chave => !isDeepStrictEqual(antes?.[chave], depois?.[chave]));
}

/** Leitura de um documento pelo id. */
export function podeLer(ctx: ContextoAcesso, colecao: ColecaoNavegador, id: string): boolean {
  // O próprio cadastro é legível mesmo inativado: o login usa isso para avisar que a conta foi desativada.
  if (colecao === 'usuarios') return ctx.uid === id || ehTreinadorOuMaster(ctx);
  return ehUsuarioRadar(ctx);
}

/** Consulta (lista) da coleção. Como no Firestore, a permissão vale para a consulta inteira. */
export function podeConsultar(ctx: ContextoAcesso, colecao: ColecaoNavegador): boolean {
  if (colecao === 'usuarios') return ehTreinadorOuMaster(ctx);
  return ehUsuarioRadar(ctx);
}

export function podeGravar(
  ctx: ContextoAcesso, colecao: ColecaoNavegador, id: string, operacao: OperacaoGravacao,
  antes: DadosDocumento | undefined, depois: DadosDocumento | undefined,
): boolean {
  switch (colecao) {
    case 'usuarios': {
      // Criação só pela API de usuários (POST /api/usuarios).
      if (operacao === 'create') return false;
      const papelAntes = campo(antes, 'role', '');
      if (operacao === 'delete') return ehMaster(ctx) || (ehTreinadorOuMaster(ctx) && papelAntes !== 'master');
      // Próprio cadastro: só os campos gravados ao definir a senha e a migração crc → cs.
      const proprio = ctx.uid === id
        && camposAlterados(antes, depois).every(c => ['nome', 'email', 'needsPasswordChange', 'updatedAt', 'role'].includes(c))
        && campo(depois, 'email', campo(antes, 'email', '')) === campo(antes, 'email', ctx.email)
        && (campo(depois, 'role', 'suporte') === campo(antes, 'role', 'suporte')
          || (papelAntes === 'crc' && campo(depois, 'role', '') === 'cs'));
      // Treinador gerencia os demais; só Master mexe em um Master ou promove alguém a Master.
      const gestor = ehMaster(ctx) || (ehTreinadorOuMaster(ctx) && papelAntes !== 'master' && campo(depois, 'role', '') !== 'master');
      return proprio || gestor;
    }
    case 'gamificacao_pontos':
      if (operacao !== 'delete') return ehTreinadorOuMaster(ctx);
      // Descontos por contato de Suporte e registros de chamado/falha só o Master remove.
      return ehTreinadorOuMaster(ctx)
        && (!['desconto_suporte', 'chamado_falha'].includes(String(campo(antes, 'tipoAcao', ''))) || ehMaster(ctx));
    case 'ocorrencias':
      if (operacao === 'delete') return ehMaster(ctx);
      // Ocorrências da Validação do conhecimento (validacaoTentativaId) só a API grava.
      if (operacao === 'create') return ehUsuarioRadar(ctx) && !('validacaoTentativaId' in (depois ?? {}));
      return ehUsuarioRadar(ctx) && !('validacaoTentativaId' in (antes ?? {})) && !('validacaoTentativaId' in (depois ?? {}));
    case 'empresas':
      if (operacao === 'delete') return ehUsuarioRadar(ctx);
      // Só o Master retira um cliente do indicador de Gol (excluidoIndicadorGol).
      if (operacao === 'create') return ehUsuarioRadar(ctx) && (ehMaster(ctx) || campo(depois, 'excluidoIndicadorGol', false) === false);
      // Cancelamento é definitivo: nenhuma gravação tira um cliente dos Cancelados.
      return ehUsuarioRadar(ctx)
        && (campo(antes, 'isCancelled', false) !== true || campo(depois, 'isCancelled', false) === true)
        && (ehMaster(ctx) || campo(depois, 'excluidoIndicadorGol', false) === campo(antes, 'excluidoIndicadorGol', false));
    case 'checklist_tarefas':
      return ehUsuarioRadar(ctx);
    case 'configuracoes':
      return ehMaster(ctx);
    case 'temasOcorrencia':
      // O Firestore proibia update, mas a tela grava os perfis do tema com merge (atualizarPerfisTema);
      // como o Master já cria e exclui temas, permitir que ele atualize não amplia o acesso.
      return ehMaster(ctx);
  }
}
