export type LinhaCentral = {
  nomeCentral: string;
  idCentral: string;
  valorContrato?: number;
};

export type IdentificacaoCentral = { nomeEmpresa: string; idCentral?: string };

export function normalizarNomeCentral(nome: string): string {
  return nome.trim().toUpperCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^SSX[_\s-]*/, '')
    .replace(/[^A-Z0-9]/g, '');
}

/** ID único tem prioridade; IDs compartilhados precisam também do nome. */
export function resolverCentral(linhas: LinhaCentral[], cliente: IdentificacaoCentral): LinhaCentral | null {
  const nome = normalizarNomeCentral(cliente.nomeEmpresa);
  const id = cliente.idCentral?.trim();
  let candidatas = id
    ? linhas.filter(linha => linha.idCentral === id)
    : linhas.filter(linha => nome && normalizarNomeCentral(linha.nomeCentral) === nome);
  if (id && candidatas.length > 1) {
    candidatas = candidatas.filter(linha => nome && normalizarNomeCentral(linha.nomeCentral) === nome);
  }
  const primeira = candidatas[0];
  // Duplicatas idênticas são aceitáveis; valores/IDs divergentes exigem revisão.
  if (!primeira || candidatas.some(linha => linha.idCentral !== primeira.idCentral
    || linha.valorContrato !== primeira.valorContrato)) return null;
  return primeira;
}
