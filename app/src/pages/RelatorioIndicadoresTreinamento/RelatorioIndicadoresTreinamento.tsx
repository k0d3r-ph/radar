import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { BolsaIndicadoresTreinamento } from "./BolsaIndicadoresTreinamento";
import { listarEmpresas, isEmpresaInterna } from "../../services/empresas";
import { listarOcorrencias } from "../../services/ocorrencias";
import { listarLancamentosPontos } from "../../services/gamificacao";
import { listarUsuarios } from "../../services/auth";
import { atuaComoTreinador } from "../../utils/perfis";
import {
  construirEventosIndicadoresTreinamento,
  listarTreinadoresIndicadoresTreinamento,
} from "../../utils/indicadoresTreinamento";
import type { Empresa, Ocorrencia, LancamentoPonto } from "../../types";
import "./RelatorioIndicadoresTreinamento.css";

export const RelatorioIndicadoresTreinamento: React.FC = () => {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [ocorrencias, setOcorrencias] = useState<Ocorrencia[]>([]);
  const [lancamentos, setLancamentos] = useState<LancamentoPonto[]>([]);
  const [treinadoresEquipe, setTreinadoresEquipe] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // forceRefresh: este é o painel "ao vivo" — não deve herdar o cache de até 5 minutos
    // que outras telas do app possam ter deixado em memória.
    Promise.all([
      listarEmpresas(true),
      listarOcorrencias(true),
      listarLancamentosPontos(true),
      listarUsuarios(true),
    ])
      .then(
        ([
          empresasLista,
          ocorrenciasLista,
          lancamentosLista,
          usuariosLista,
        ]) => {
          setEmpresas(empresasLista.filter((e) => !isEmpresaInterna(e)));
          setOcorrencias(ocorrenciasLista);
          setLancamentos(lancamentosLista);
          setTreinadoresEquipe(
            listarTreinadoresIndicadoresTreinamento(
              usuariosLista
                .filter(
                  (u) =>
                    atuaComoTreinador(u.role) &&
                    !u.inativo &&
                    u.nome?.trim() &&
                    u.nome.trim().toLowerCase() !== "painel" &&
                    !u.email?.toLowerCase().includes("painel"),
                )
                .map((u) => u.nome.trim()),
              lancamentosLista,
              ocorrenciasLista,
            ),
          );
        },
      )
      .catch((error) => {
        console.error(
          "Erro ao carregar dados dos indicadores de treinamento:",
          error,
        );
        toast.error("Erro ao carregar os indicadores de treinamento.");
      })
      .finally(() => setLoading(false));
  }, []);

  const eventos = useMemo(
    () =>
      construirEventosIndicadoresTreinamento(
        empresas,
        ocorrencias,
        lancamentos,
        treinadoresEquipe.map((nome) => ({ nome })),
      ),
    [empresas, ocorrencias, lancamentos, treinadoresEquipe],
  );

  return (
    <div className="indicadores-treinamento-container">
      <div className="indicadores-bolsa-pagina-header">
        <h1>Indicadores de Treinamento</h1>
        <p>Painel ao vivo — atualiza sozinho, sem consumir leituras do Firebase.</p>
      </div>

      {loading ? (
        <div className="relatorio-loader">
          <div className="spinner"></div>
          <p>Carregando indicadores de treinamento...</p>
        </div>
      ) : (
        <BolsaIndicadoresTreinamento
          eventos={eventos}
          empresas={empresas}
          ocorrencias={ocorrencias}
          treinador={null}
        />
      )}
    </div>
  );
};
