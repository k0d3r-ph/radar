/**
 * Regras da fila de "Próximo cliente" (Gamificação).
 *
 * - `participaDistribuicao`: inclusão permanente, marcada no cadastro do usuário.
 * - `suspensoDistribuicao`: saída temporária (ex.: férias), sem perder a inclusão.
 *
 * Cadastros antigos não têm `participaDistribuicao`. Até essa opção existir, a fila
 * excluía no código quem tinha o primeiro nome Jean ou Jeff; esse comportamento
 * continua valendo só enquanto o campo não for gravado. Ao salvar o usuário na tela
 * de Usuários, a escolha passa a ser explícita e a exceção por nome deixa de valer.
 */
import { atuaComoTreinador } from "./perfis.ts";

type UsuarioFila = {
  nome?: string;
  role?: string;
  participaDistribuicao?: boolean;
  suspensoDistribuicao?: boolean;
  inativo?: boolean;
};

const PRIMEIROS_NOMES_FORA_DA_FILA_LEGADO = ["jean", "jeff"];

const primeiroNome = (nome?: string) =>
  (nome || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .split(/\s+/)[0]
    ?.toLowerCase() || "";

/** Se o usuário está incluído na fila (independente de férias). */
export function incluidoNaFilaDistribuicao(usuario: UsuarioFila): boolean {
  if (!atuaComoTreinador(usuario.role)) return false;
  if (typeof usuario.participaDistribuicao === "boolean") {
    return usuario.participaDistribuicao;
  }
  return !PRIMEIROS_NOMES_FORA_DA_FILA_LEGADO.includes(primeiroNome(usuario.nome));
}

/** Se o usuário recebe indicação de "Próximo cliente" agora. */
export function elegivelFilaDistribuicao(usuario: UsuarioFila): boolean {
  return (
    !usuario.inativo &&
    !usuario.suspensoDistribuicao &&
    incluidoNaFilaDistribuicao(usuario)
  );
}
