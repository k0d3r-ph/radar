import type { Empresa, Ocorrencia } from "../../types";
import { calcularTME } from "./calcularTME";
import { calcularFarol, type StatusFarolType } from "./calcularFarol";
import { calcularProgressoPorFases } from "./calcularProgresso";
import { calcularDiasNaEsteira } from "./calcularDiasNaEsteira";
import { calcularDiasCongeladosPorCheckpoint } from "./calcularDiasCongeladosPorCheckpoint";
import { obterUltimoTreinamento } from "./obterUltimoTreinamentoOuCheckpointOuInformativo";
import { calcularTotalFases } from "./calcularTotalFases";

export type StatusEsteiraCliente = {
  farol: StatusFarolType;
  dias: number;
  tme: number | null;
  progresso: number;
  alerta: boolean;
};

/**
 * Reaproveita a mesma composição de cálculo de farol/dias/alerta já usada na
 * Home e nos Relatórios, para que outras telas (ex.: Esteira) mostrem o
 * mesmo status sem reimplementar a lógica de resolução de alerta/checkpoint.
 */
export function calcularStatusEsteiraCliente(
  empresa: Empresa,
  ocorrencias: Ocorrencia[],
  agora: number = Date.now(),
): StatusEsteiraCliente {
  const historicoEmpresa = ocorrencias.filter(
    (o) =>
      o.empresa.trim().toLowerCase() ===
      empresa.nomeEmpresa.trim().toLowerCase(),
  );

  const ultimoTreinamento = obterUltimoTreinamento(
    ocorrencias,
    empresa.nomeEmpresa,
  );
  const dataBase =
    ultimoTreinamento?.dataOcorrencia || ultimoTreinamento?.createdAt;

  const tme = calcularTME(dataBase);
  const totalFases = calcularTotalFases(empresa.temaText);
  const progresso = calcularProgressoPorFases(
    empresa.currentPhase,
    totalFases,
  );

  // Mesma lógica de resolução de alerta usada na Home: a ocorrência de alerta
  // mais recente (por createdAt) só vale se não houver resolução posterior.
  const ocsAlertaEmpresa = historicoEmpresa.filter(
    (o) => o.alerta === true || o.retirarAlerta === true,
  );
  const ultimoAlerta = ocsAlertaEmpresa
    .filter((o) => o.alerta === true)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
  const ultimaResolucao = ocsAlertaEmpresa
    .filter((o) => o.retirarAlerta === true)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];

  let alerta = false;
  if (ultimoAlerta) {
    const tsAlerta = ultimoAlerta.createdAt || 0;
    const tsResolucao = ultimaResolucao?.createdAt || 0;
    alerta = !(tsResolucao > tsAlerta);
  } else if (ultimaResolucao) {
    alerta = false;
  } else {
    alerta = !!empresa.alerta;
  }

  const farol = calcularFarol({
    progresso,
    tme,
    alerta,
    dataFinalizacao: empresa.dataFinalizacao,
    dataFollowUpFinal: empresa.dataFollowUpFinal,
    pendencia: empresa.pendencia,
    agora,
  });

  const dias = calcularDiasNaEsteira(
    empresa.dataEntrada,
    progresso,
    dataBase,
    empresa.dataFinalizacao,
    empresa.isSuspended,
    empresa.dataSuspensao,
    empresa.diasSuspensoAcumulado,
    calcularDiasCongeladosPorCheckpoint(ocorrencias, empresa.nomeEmpresa),
  );

  return { farol, dias, tme, progresso, alerta };
}
