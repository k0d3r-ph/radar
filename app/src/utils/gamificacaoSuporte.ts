import type { Ocorrencia } from "../types";

type EstadoDescontoSuporte = Pick<
  Ocorrencia,
  "tipo" | "gamificacaoDescontoPontoId"
>;

export function descontoSuporteJaProcessado(
  ocorrencia: EstadoDescontoSuporte | null | undefined,
): boolean {
  return (
    ocorrencia !== null &&
    ocorrencia !== undefined &&
    Object.prototype.hasOwnProperty.call(
      ocorrencia,
      "gamificacaoDescontoPontoId",
    )
  );
}

export function deveRemoverDescontoSuporte(
  ocorrencia: EstadoDescontoSuporte | null | undefined,
  tipoAtual: string,
  qualificaParaDesconto: boolean,
): boolean {
  return (
    !!ocorrencia?.gamificacaoDescontoPontoId &&
    (ocorrencia.tipo !== tipoAtual || !qualificaParaDesconto)
  );
}
