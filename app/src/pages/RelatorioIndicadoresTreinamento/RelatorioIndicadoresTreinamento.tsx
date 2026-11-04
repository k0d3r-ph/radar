import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { BolsaIndicadoresTreinamento } from "./BolsaIndicadoresTreinamento";
import { isEmpresaInterna } from "../../services/empresas";
import { obterColecaoCompleta } from "../../services/sincronizacaoIncremental";
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
  const [atualizadoEm, setAtualizadoEm] = useState(() => Date.now());

  useEffect(() => {
    let ativo = true;
    let sincronizando = false;
    let ultimaTentativa = 0;
    let falhaNotificada = false;

    const atualizar = async (inicial = false) => {
      if (sincronizando || (!inicial && Date.now() - ultimaTentativa < 60_000)) return;
      sincronizando = true;
      ultimaTentativa = Date.now();

      try {
        // Lê direto do índice em memória do backend (ver IndiceSincronizacao),
        // não do Firestore: evita que cada tela aberta do painel multiplique
        // as leituras a cada atualização (ver server/SINCRONIZACAO.md).
        const [empresasLista, ocorrenciasLista, lancamentosLista] = await Promise.all([
          obterColecaoCompleta<Empresa>("empresas"),
          obterColecaoCompleta<Ocorrencia>("ocorrencias"),
          obterColecaoCompleta<LancamentoPonto>("gamificacao_pontos"),
        ]);
        const usuariosLista = inicial ? await listarUsuarios(true) : null;
        if (!ativo) return;

        setEmpresas(empresasLista.filter((e) => !isEmpresaInterna(e)));
        setOcorrencias(ocorrenciasLista);
        setLancamentos(lancamentosLista);
        if (usuariosLista) {
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
        }
        setAtualizadoEm(Date.now());
        falhaNotificada = false;
      } catch (error) {
        console.error("Erro ao sincronizar os indicadores de treinamento:", error);
        if (!falhaNotificada) {
          toast.error(
            inicial
              ? "Erro ao carregar os indicadores de treinamento."
              : "Não foi possível atualizar os indicadores. Tentaremos novamente em breve.",
          );
          falhaNotificada = true;
        }
      } finally {
        sincronizando = false;
        if (ativo && inicial) setLoading(false);
      }
    };

    const atualizarSeVisivel = () => {
      if (document.visibilityState === "visible") void atualizar();
    };

    void atualizar(true);
    const intervalo = window.setInterval(atualizarSeVisivel, 60_000);
    window.addEventListener("focus", atualizarSeVisivel);
    document.addEventListener("visibilitychange", atualizarSeVisivel);
    return () => {
      ativo = false;
      window.clearInterval(intervalo);
      window.removeEventListener("focus", atualizarSeVisivel);
      document.removeEventListener("visibilitychange", atualizarSeVisivel);
    };
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
          atualizadoEm={atualizadoEm}
        />
      )}
    </div>
  );
};
