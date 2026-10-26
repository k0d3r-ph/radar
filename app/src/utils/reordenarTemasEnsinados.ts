// Reordena a esteira de temas: qualquer tema recém-ensinado que esteja "fora
// de sequência" (mais à frente que o próximo tema pendente) é puxado para
// ficar logo após o último tema já ensinado — mantendo os temas ensinados
// sempre como um prefixo contíguo, mesmo quando são ensinados em ocorrências
// separadas (uma por vez), e não só quando vários são marcados de uma vez na
// mesma ocorrência.
// Ex.: temas ensinados hoje = [Videotelemetria], já ensinados antes = [0,1] →
// Videotelemetria (originalmente na posição 6) é movido para a posição 2.
//
// "Início" e o tema final são âncoras fixas: validação é o último tema quando
// presente; esteiras antigas continuam usando "Conclusão". As âncoras não
// entram no embaralhamento e nenhum tema é movido para fora desses limites.
import { indiceTemaFinal } from '../../../server/src/domain/validacaoConhecimento.ts';

const normalizarTema = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export function reordenarTemasEnsinados(
  linhasTema: string[],
  linhasData: string[],
  indicesEnsinados: number[],
  dataStr: string,
): { newTemas: string[]; newDatas: string[]; ultimoIndice: number } {
  // Filtra tema e data juntos: linhas vazias não são fases pendentes.
  const indicesValidos = linhasTema.flatMap((tema, indice) => tema.trim() ? [indice] : []);
  linhasData = indicesValidos.map((indice) => linhasData[indice] ?? "");
  linhasTema = indicesValidos.map((indice) => linhasTema[indice]);
  indicesEnsinados = indicesEnsinados.map((indice) => indicesValidos.indexOf(indice)).filter((indice) => indice !== -1);

  const idxInicio = linhasTema.findIndex((t) => normalizarTema(t) === "inicio");
  const idxConclusao = indiceTemaFinal(linhasTema);

  const inicioItem =
    idxInicio !== -1
      ? { tema: linhasTema[idxInicio], data: linhasData[idxInicio] ?? "" }
      : null;
  const conclusaoItem =
    idxConclusao !== -1
      ? { tema: linhasTema[idxConclusao], data: linhasData[idxConclusao] ?? "" }
      : null;

  // "Meio": todos os temas exceto as âncoras fixas — é nele que a reordenação por sequência ocorre
  const newTemas = linhasTema.filter(
    (_, idx) => idx !== idxInicio && idx !== idxConclusao,
  );
  const newDatas = linhasTema
    .map((_, idx) => idx)
    .filter((idx) => idx !== idxInicio && idx !== idxConclusao)
    .map((idx) => linhasData[idx] ?? "");

  // Fronteira atual: primeiro índice (dentro do meio) ainda sem data
  let frontIndex = 0;
  while (frontIndex < newDatas.length && newDatas[frontIndex].trim() !== "") {
    frontIndex++;
  }

  // Processa os temas ensinados nesta ocorrência em ordem crescente de índice original
  const indicesOrdenados = [...indicesEnsinados].sort((a, b) => a - b);

  for (const idxOriginal of indicesOrdenados) {
    const temaAlvo = linhasTema[idxOriginal];
    const normalizado = normalizarTema(temaAlvo);

    if (normalizado === "inicio") {
      if (inicioItem && inicioItem.data.trim() === "")
        inicioItem.data = dataStr;
      continue;
    }
    if (idxOriginal === idxConclusao) {
      if (conclusaoItem && conclusaoItem.data.trim() === "")
        conclusaoItem.data = dataStr;
      continue;
    }

    const posAtual = newTemas.findIndex(
      (t) => normalizarTema(t) === normalizado,
    );

    if (posAtual === -1 || posAtual < frontIndex) {
      // Já processado/ensinado antes (ou tema duplicado) — não retrocede a fronteira
      continue;
    }

    newDatas[posAtual] = dataStr;

    if (posAtual > frontIndex) {
      const [tRemovido] = newTemas.splice(posAtual, 1);
      const [dRemovido] = newDatas.splice(posAtual, 1);
      newTemas.splice(frontIndex, 0, tRemovido);
      newDatas.splice(frontIndex, 0, dRemovido);
    }

    frontIndex++;
  }

  const temasFinais = [
    ...(inicioItem ? [inicioItem.tema] : []),
    ...newTemas,
    ...(conclusaoItem ? [conclusaoItem.tema] : []),
  ];
  const datasFinais = [
    ...(inicioItem ? [inicioItem.data] : []),
    ...newDatas,
    ...(conclusaoItem ? [conclusaoItem.data] : []),
  ];

  // Última posição (no array final) que faz parte do progresso já concluído.
  // "Início" conta como concluída assim que ocupa a posição fixa (não trava o
  // progresso dos demais temas por falta da própria data — empresas antigas
  // podem nunca ter tido essa data preenchida). O tema final só conta quando
  // todos os temas do meio já estiverem preenchidos E ela própria tiver data.
  let ultimoIndice = (inicioItem ? 1 : 0) + frontIndex - 1;
  if (
    conclusaoItem &&
    conclusaoItem.data.trim() !== "" &&
    frontIndex === newTemas.length
  ) {
    ultimoIndice = temasFinais.length - 1;
  }

  return { newTemas: temasFinais, newDatas: datasFinais, ultimoIndice };
}

