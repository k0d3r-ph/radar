import type { Ocorrencia } from "../../types";

const DIA_MS = 1000 * 60 * 60 * 24;

/** Total de dias suspenso: dias da suspensão em andamento (se houver) somados ao acumulado de suspensões anteriores. */
export function calcularDiasSuspenso(
  isSuspended?: boolean,
  dataSuspensao?: string,
  diasSuspensoAcumulado?: number,
) {
  let diasSuspensaoAtual = 0;

  if (isSuspended && dataSuspensao) {
    // ← interpreta no fuso local em vez de UTC
    const [year, month, day] = dataSuspensao.split("-").map(Number);
    const inicio = new Date(year, month - 1, day);

    if (!isNaN(inicio.getTime())) {
      diasSuspensaoAtual = Math.max(
        0,
        Math.floor((Date.now() - inicio.getTime()) / (1000 * 60 * 60 * 24)),
      );
    }
  }

  return diasSuspensaoAtual + (diasSuspensoAcumulado || 0);
}

const formatoDiaBrasilia = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Número do dia de calendário em Brasília, para contar dias sem depender do fuso do navegador. */
function diaBrasilia(timestamp: number) {
  const [ano, mes, dia] = formatoDiaBrasilia.format(timestamp).split("-").map(Number);
  return Date.UTC(ano, mes - 1, dia) / DIA_MS;
}

function momentoOcorrencia(o: Ocorrencia) {
  return o.dataOcorrencia || o.createdAt || 0;
}

/**
 * Ocorrência que registrou a suspensão em andamento: a mais recente marcada com
 * `suspenderCliente`, desde que nenhum retorno à esteira tenha sido registrado
 * depois dela (nesse caso ela pertence a uma suspensão anterior já encerrada).
 */
export function obterOcorrenciaSuspensaoAtual(historicoEmpresa: Ocorrencia[]) {
  const porRegistro = (a: Ocorrencia, b: Ocorrencia) => (b.createdAt || 0) - (a.createdAt || 0);
  const suspensao = historicoEmpresa.filter((o) => o.suspenderCliente === true).sort(porRegistro)[0];
  if (!suspensao) return undefined;

  const retorno = historicoEmpresa.filter((o) => o.retornarEsteira === true).sort(porRegistro)[0];
  if (retorno && (retorno.createdAt || 0) > (suspensao.createdAt || 0)) return undefined;

  return suspensao;
}

/** Dias corridos (calendário de Brasília) desde a data da ocorrência que registrou a suspensão. */
export function calcularDiasSuspensoPelaOcorrencia(ocorrencia: Ocorrencia, agora = Date.now()) {
  const inicio = momentoOcorrencia(ocorrencia);
  if (!inicio) return 0;
  return Math.max(0, diaBrasilia(agora) - diaBrasilia(inicio));
}

/**
 * Dias da suspensão em andamento (sem o acumulado de suspensões anteriores).
 * Conta a partir da ocorrência de suspensão quando ela existe; sem ela
 * (registros antigos), usa a `dataSuspensao` gravada na empresa.
 */
export function calcularDiasSuspensaoAtual(
  empresa: { isSuspended?: boolean; dataSuspensao?: string },
  historicoEmpresa: Ocorrencia[],
  agora = Date.now(),
) {
  const ocorrencia = empresa.isSuspended ? obterOcorrenciaSuspensaoAtual(historicoEmpresa) : undefined;
  if (ocorrencia) return calcularDiasSuspensoPelaOcorrencia(ocorrencia, agora);
  return calcularDiasSuspenso(true, empresa.dataSuspensao, 0);
}
