import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Clock, CheckCircle2, Users2, GraduationCap } from "lucide-react";
import { listarEmpresas, isEmpresaInterna } from "../../services/empresas";
import { listarOcorrencias } from "../../services/ocorrencias";
import type { Empresa, Ocorrencia } from "../../types";
import { calcularDiasNaEsteira } from "../../utils/monitoramento/calcularDiasNaEsteira";
import { calcularDiasCongeladosPorCheckpoint } from "../../utils/monitoramento/calcularDiasCongeladosPorCheckpoint";
import { formatarNome } from "../../utils/formatarNome";
import "./RelatorioAging.css";

type FaixaAging = "0-15" | "16-30" | "31-45" | "mais45";

const FAIXAS: { chave: FaixaAging; label: string }[] = [
  { chave: "0-15", label: "0 – 15 dias" },
  { chave: "16-30", label: "16 – 30 dias" },
  { chave: "31-45", label: "31 – 45 dias" },
  { chave: "mais45", label: "> 45 dias" },
];

function faixaDosDias(dias: number): FaixaAging {
  if (dias <= 15) return "0-15";
  if (dias <= 30) return "16-30";
  if (dias <= 45) return "31-45";
  return "mais45";
}

function contagemVazia(): Record<FaixaAging, number> {
  return { "0-15": 0, "16-30": 0, "31-45": 0, mais45: 0 };
}

function normalizarNomeEmpresa(nome: string): string {
  return nome.trim().toLowerCase();
}

/** Primeira ocorrência marcada como Gol para o cliente, a mais antiga. */
function encontrarOcorrenciaGol(
  ocorrencias: Ocorrencia[],
  nomeEmpresa: string,
): Ocorrencia | undefined {
  return ocorrencias
    .filter(
      (o) =>
        o.tipo === "Gol" &&
        o.dataOcorrencia > 0 &&
        normalizarNomeEmpresa(o.empresa) === normalizarNomeEmpresa(nomeEmpresa),
    )
    .sort((a, b) => a.dataOcorrencia - b.dataOcorrencia)[0];
}

// Controle de Gol: só entram clientes que iniciaram a esteira a partir desta data.
const DATA_CORTE_GOL = "2026-09-10";

function calcularDiasAteGol(dataEntrada: string, dataGol: number): number {
  const [year, month, day] = dataEntrada.split("-").map(Number);
  const entrada = new Date(year, month - 1, day);
  if (isNaN(entrada.getTime()) || !dataGol) return 0;

  const dias = Math.floor(
    (dataGol - entrada.getTime()) / (1000 * 60 * 60 * 24),
  );

  return Math.max(0, dias);
}

function formatarPct(valor: number, total: number): string {
  if (total === 0) return "0%";
  return `${((valor / total) * 100).toFixed(2).replace(".", ",")}%`;
}

export const RelatorioAging: React.FC = () => {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [ocorrencias, setOcorrencias] = useState<Ocorrencia[]>([]);
  const [loading, setLoading] = useState(true);
  const [treinadorFiltro, setTreinadorFiltro] = useState("");

  useEffect(() => {
    Promise.all([listarEmpresas(), listarOcorrencias()])
      .then(([lista, historico]) => {
        setEmpresas(
          lista.filter(
            (e) =>
              e.id &&
              !isEmpresaInterna(e) &&
              !e.isCancelled &&
              !e.isOngoing &&
              !e.isSuspended,
          ),
        );
        setOcorrencias(historico);
      })
      .catch((error) => {
        console.error("Erro ao carregar dados do relatório de Aging:", error);
        toast.error("Erro ao carregar dados do relatório de Aging.");
      })
      .finally(() => setLoading(false));
  }, []);

  const treinadores = useMemo(() => {
    const nomes = new Set<string>();
    empresas.forEach((e) => {
      if (e.responsavel) nomes.add(e.responsavel);
    });
    return Array.from(nomes).sort((a, b) =>
      formatarNome(a).localeCompare(formatarNome(b), "pt-BR"),
    );
  }, [empresas]);

  const empresasFiltradas = useMemo(() => {
    if (!treinadorFiltro) return empresas;
    return empresas.filter((e) => e.responsavel === treinadorFiltro);
  }, [empresas, treinadorFiltro]);

  const dados = useMemo(() => {
    const emAndamento = contagemVazia();
    const concluido = contagemVazia();

    empresasFiltradas.forEach((e) => {
      const dias = calcularDiasNaEsteira(
        e.dataEntrada,
        0,
        undefined,
        e.dataFinalizacao,
        e.isSuspended,
        e.dataSuspensao,
        e.diasSuspensoAcumulado,
        calcularDiasCongeladosPorCheckpoint(ocorrencias, e.nomeEmpresa),
      );
      const faixa = faixaDosDias(dias);
      if (e.dataFinalizacao) {
        concluido[faixa] += 1;
      } else {
        emAndamento[faixa] += 1;
      }
    });

    const totais = contagemVazia();
    FAIXAS.forEach((f) => {
      totais[f.chave] = emAndamento[f.chave] + concluido[f.chave];
    });

    const totalEmAndamento = FAIXAS.reduce(
      (acc, f) => acc + emAndamento[f.chave],
      0,
    );
    const totalConcluido = FAIXAS.reduce(
      (acc, f) => acc + concluido[f.chave],
      0,
    );
    const totalGeral = totalEmAndamento + totalConcluido;

    return {
      emAndamento,
      concluido,
      totais,
      totalEmAndamento,
      totalConcluido,
      totalGeral,
    };
  }, [empresasFiltradas, ocorrencias]);

  // Controle de Gol: só entram clientes que iniciaram a esteira a partir de
  // DATA_CORTE_GOL. "Em andamento" ainda não bateu o Gol (dias contados até
  // hoje); "Concluído" já bateu (dias contados até a ocorrência de Gol).
  const dadosGol = useMemo(() => {
    const emAndamento = contagemVazia();
    const concluido = contagemVazia();

    empresasFiltradas
      .filter((e) => e.dataEntrada && e.dataEntrada >= DATA_CORTE_GOL)
      .forEach((e) => {
        const ocorrenciaGol = encontrarOcorrenciaGol(
          ocorrencias,
          e.nomeEmpresa,
        );

        if (ocorrenciaGol) {
          const dias = calcularDiasAteGol(
            e.dataEntrada,
            ocorrenciaGol.dataOcorrencia,
          );
          concluido[faixaDosDias(dias)] += 1;
        } else {
          const dias = calcularDiasAteGol(e.dataEntrada, Date.now());
          emAndamento[faixaDosDias(dias)] += 1;
        }
      });

    const totais = contagemVazia();
    FAIXAS.forEach((f) => {
      totais[f.chave] = emAndamento[f.chave] + concluido[f.chave];
    });

    const totalEmAndamento = FAIXAS.reduce(
      (acc, f) => acc + emAndamento[f.chave],
      0,
    );
    const totalConcluido = FAIXAS.reduce(
      (acc, f) => acc + concluido[f.chave],
      0,
    );
    const totalGeral = totalEmAndamento + totalConcluido;

    return {
      emAndamento,
      concluido,
      totais,
      totalEmAndamento,
      totalConcluido,
      totalGeral,
    };
  }, [empresasFiltradas, ocorrencias]);

  return (
    <div className="relatorio-aging-container">
      <div className="relatorio-aging-filtros">
        <label htmlFor="aging-treinador">Treinador:</label>
        <select
          id="aging-treinador"
          value={treinadorFiltro}
          onChange={(e) => setTreinadorFiltro(e.target.value)}
        >
          <option value="">Todos</option>
          {treinadores.map((t) => (
            <option key={t} value={t}>
              {formatarNome(t)}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="relatorio-loader">
          <div className="spinner"></div>
          <p>Carregando dados do relatório de Aging...</p>
        </div>
      ) : (
        <div className="aging-tabela-wrapper">
          <table className="aging-tabela">
            <thead>
              <tr>
                <th className="aging-col-status">Status da Jornada</th>
                {FAIXAS.map((f) => (
                  <th key={f.chave}>{f.label}</th>
                ))}
                <th className="aging-col-total">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="aging-col-status">
                  <div className="aging-status-label">
                    <Clock
                      size={18}
                      className="aging-status-icon aging-status-icon--andamento"
                    />
                    <div>
                      <strong>Em andamento</strong>
                      <span>
                        Clientes que ainda estão em processo de capacitação.
                      </span>
                    </div>
                  </div>
                </td>
                {FAIXAS.map((f) => (
                  <td key={f.chave}>
                    <div className="aging-cell">
                      <span className="aging-cell-valor">
                        {dados.emAndamento[f.chave]}
                      </span>
                      <span className="aging-cell-pct">
                        {formatarPct(
                          dados.emAndamento[f.chave],
                          dados.totalGeral,
                        )}
                      </span>
                    </div>
                  </td>
                ))}
                <td className="aging-col-total">
                  <div className="aging-cell">
                    <span className="aging-cell-valor">
                      {dados.totalEmAndamento}
                    </span>
                    <span className="aging-cell-pct">
                      {formatarPct(dados.totalEmAndamento, dados.totalGeral)}
                    </span>
                  </div>
                </td>
              </tr>

              <tr>
                <td className="aging-col-status">
                  <div className="aging-status-label">
                    <CheckCircle2
                      size={18}
                      className="aging-status-icon aging-status-icon--concluido"
                    />
                    <div>
                      <strong>Concluído</strong>
                      <span>Clientes que finalizaram a capacitação.</span>
                    </div>
                  </div>
                </td>
                {FAIXAS.map((f) => (
                  <td key={f.chave}>
                    <div className="aging-cell">
                      <span className="aging-cell-valor">
                        {dados.concluido[f.chave]}
                      </span>
                      <span className="aging-cell-pct">
                        {formatarPct(
                          dados.concluido[f.chave],
                          dados.totalGeral,
                        )}
                      </span>
                    </div>
                  </td>
                ))}
                <td className="aging-col-total">
                  <div className="aging-cell">
                    <span className="aging-cell-valor">
                      {dados.totalConcluido}
                    </span>
                    <span className="aging-cell-pct">
                      {formatarPct(dados.totalConcluido, dados.totalGeral)}
                    </span>
                  </div>
                </td>
              </tr>

              <tr className="aging-linha-totais">
                <td className="aging-col-status">
                  <div className="aging-status-label">
                    <Users2
                      size={18}
                      className="aging-status-icon aging-status-icon--totais"
                    />
                    <div>
                      <strong>Totais</strong>
                      <span>
                        Quantidade total de clientes na esteira de capacitação.
                      </span>
                    </div>
                  </div>
                </td>
                {FAIXAS.map((f) => (
                  <td key={f.chave}>
                    <div className="aging-cell">
                      <span className="aging-cell-valor">
                        {dados.totais[f.chave]}
                      </span>
                      <span className="aging-cell-pct">
                        {formatarPct(dados.totais[f.chave], dados.totalGeral)}
                      </span>
                    </div>
                  </td>
                ))}
                <td className="aging-col-total">
                  <div className="aging-cell">
                    <span className="aging-cell-valor">{dados.totalGeral}</span>
                    <span className="aging-cell-pct">100%</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          {dados.totalGeral === 0 && (
            <div className="relatorio-empty">
              <span className="relatorio-empty-icon">
                <GraduationCap size={28} />
              </span>
              <p>Nenhum cliente encontrado para este filtro.</p>
            </div>
          )}
        </div>
      )}

      <p className="aging-legenda">
        O Aging da esteira de capacitação permite identificar gargalos,
        antecipar ações e garantir que mais clientes concluam a capacitação no
        menor tempo possível. Os dias são contados da data de entrada até a data
        de finalização (ou até hoje, para quem ainda está em andamento).
      </p>

      {!loading && (
        <div className="aging-tabela-wrapper">
          <h2 className="aging-secao-titulo">
            <span aria-hidden="true">⚽</span> Controle de Gol
          </h2>
          <table className="aging-tabela">
            <thead>
              <tr>
                <th className="aging-col-status">Status do Gol</th>
                {FAIXAS.map((f) => (
                  <th key={f.chave}>{f.label}</th>
                ))}
                <th className="aging-col-total">Total</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="aging-col-status">
                  <div className="aging-status-label">
                    <Clock
                      size={18}
                      className="aging-status-icon aging-status-icon--andamento"
                    />
                    <div>
                      <strong>Em andamento</strong>
                      <span>Clientes que ainda não bateram o Gol.</span>
                    </div>
                  </div>
                </td>
                {FAIXAS.map((f) => (
                  <td key={f.chave}>
                    <div className="aging-cell">
                      <span className="aging-cell-valor">
                        {dadosGol.emAndamento[f.chave]}
                      </span>
                      <span className="aging-cell-pct">
                        {formatarPct(
                          dadosGol.emAndamento[f.chave],
                          dadosGol.totalGeral,
                        )}
                      </span>
                    </div>
                  </td>
                ))}
                <td className="aging-col-total">
                  <div className="aging-cell">
                    <span className="aging-cell-valor">
                      {dadosGol.totalEmAndamento}
                    </span>
                    <span className="aging-cell-pct">
                      {formatarPct(
                        dadosGol.totalEmAndamento,
                        dadosGol.totalGeral,
                      )}
                    </span>
                  </div>
                </td>
              </tr>

              <tr>
                <td className="aging-col-status">
                  <div className="aging-status-label">
                    <span
                      className="aging-status-icon aging-status-icon--gol"
                      aria-hidden="true"
                    >
                      ⚽
                    </span>
                    <div>
                      <strong>Concluído</strong>
                      <span>Clientes que já bateram o Gol.</span>
                    </div>
                  </div>
                </td>
                {FAIXAS.map((f) => (
                  <td key={f.chave}>
                    <div className="aging-cell">
                      <span className="aging-cell-valor">
                        {dadosGol.concluido[f.chave]}
                      </span>
                      <span className="aging-cell-pct">
                        {formatarPct(
                          dadosGol.concluido[f.chave],
                          dadosGol.totalGeral,
                        )}
                      </span>
                    </div>
                  </td>
                ))}
                <td className="aging-col-total">
                  <div className="aging-cell">
                    <span className="aging-cell-valor">
                      {dadosGol.totalConcluido}
                    </span>
                    <span className="aging-cell-pct">
                      {formatarPct(
                        dadosGol.totalConcluido,
                        dadosGol.totalGeral,
                      )}
                    </span>
                  </div>
                </td>
              </tr>

              <tr className="aging-linha-totais">
                <td className="aging-col-status">
                  <div className="aging-status-label">
                    <Users2
                      size={18}
                      className="aging-status-icon aging-status-icon--totais"
                    />
                    <div>
                      <strong>Totais</strong>
                      <span>
                        Quantidade total de clientes no controle de Gol.
                      </span>
                    </div>
                  </div>
                </td>
                {FAIXAS.map((f) => (
                  <td key={f.chave}>
                    <div className="aging-cell">
                      <span className="aging-cell-valor">
                        {dadosGol.totais[f.chave]}
                      </span>
                      <span className="aging-cell-pct">
                        {formatarPct(
                          dadosGol.totais[f.chave],
                          dadosGol.totalGeral,
                        )}
                      </span>
                    </div>
                  </td>
                ))}
                <td className="aging-col-total">
                  <div className="aging-cell">
                    <span className="aging-cell-valor">
                      {dadosGol.totalGeral}
                    </span>
                    <span className="aging-cell-pct">100%</span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          {dadosGol.totalGeral === 0 && (
            <div className="relatorio-empty">
              <span className="relatorio-empty-icon">
                <GraduationCap size={28} />
              </span>
              <p>Nenhum cliente encontrado para este filtro.</p>
            </div>
          )}
        </div>
      )}

      <p className="aging-legenda">
        O controle de Gol considera apenas clientes que iniciaram a esteira a
        partir de {DATA_CORTE_GOL.split("-").reverse().join("/")}. Os dias são
        contados da data de entrada até a ocorrência marcada como Gol (marco
        definido pelo treinador na Esteira), ou até hoje para quem ainda não
        bateu o Gol.
      </p>
    </div>
  );
};
