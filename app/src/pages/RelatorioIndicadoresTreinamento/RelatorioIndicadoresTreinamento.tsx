import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { BolsaIndicadoresTreinamento } from "./BolsaIndicadoresTreinamento";
import { isEmpresaInterna } from "../../services/empresas";
import { obterColecaoCompleta } from "../../services/sincronizacaoIncremental";
import { listarUsuarios } from "../../services/auth";
import {
  DOC_METAS_PAINEL_TREINAMENTO,
  listarMetasIndicadores,
  salvarMetasIndicadores,
  type MetasIndicadores,
} from "../../services/metasIndicadores";
import { useAuth } from "../../context/AuthContext";
import { atuaComoTreinador } from "../../utils/perfis";
import {
  construirEventosIndicadoresTreinamento,
  listarTreinadoresIndicadoresTreinamento,
} from "../../utils/indicadoresTreinamento";
import type { Empresa, Ocorrencia, LancamentoPonto } from "../../types";
import type { TentativaValidacao } from "../../../../server/src/domain/validacaoConhecimento";
import "./RelatorioIndicadoresTreinamento.css";

const INTERVALO_ATUALIZACAO_MS = 20 * 60_000;

interface Props {
  /** Tela dedicada de TV/monitor (/indicadores-treinamento-tv) — ver App.tsx. */
  modoTv?: boolean;
}

export const RelatorioIndicadoresTreinamento: React.FC<Props> = ({ modoTv = false }) => {
  const { role } = useAuth();
  const [metas, setMetas] = useState<MetasIndicadores>({});
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [ocorrencias, setOcorrencias] = useState<Ocorrencia[]>([]);
  const [lancamentos, setLancamentos] = useState<LancamentoPonto[]>([]);
  const [tentativasValidacao, setTentativasValidacao] = useState<TentativaValidacao[]>([]);
  const [treinadoresEquipe, setTreinadoresEquipe] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [atualizadoEm, setAtualizadoEm] = useState(() => Date.now());

  useEffect(() => {
    let ativo = true;
    let sincronizando = false;
    let ultimaTentativa = 0;
    let falhaNotificada = false;

    const atualizar = async (inicial = false) => {
      if (sincronizando || (!inicial && Date.now() - ultimaTentativa < INTERVALO_ATUALIZACAO_MS)) return;
      sincronizando = true;
      ultimaTentativa = Date.now();

      try {
        // Lê direto do índice em memória do backend (ver IndiceSincronizacao),
        // não do Firestore: evita que cada tela aberta do painel multiplique
        // as leituras a cada atualização (ver server/SINCRONIZACAO.md).
        const [empresasLista, ocorrenciasLista, lancamentosLista, tentativasLista] = await Promise.all([
          obterColecaoCompleta<Empresa>("empresas"),
          obterColecaoCompleta<Ocorrencia>("ocorrencias"),
          obterColecaoCompleta<LancamentoPonto>("gamificacao_pontos"),
          // Restrita a master/treinador (ver server/SINCRONIZACAO.md); outros perfis recebem 403
          // e o card de Validação do Conhecimento fica "sem dados", sem travar o resto do painel.
          obterColecaoCompleta<TentativaValidacao>("validacao_tentativas").catch(() => []),
        ]);
        const usuariosLista = inicial ? await listarUsuarios(true) : null;
        // Uma leitura por atualização (a cada 20 min), para as TVs receberem metas novas
        // sem recarregar. Se falhar, mantém as metas já exibidas em vez de travar o painel.
        const metasSalvas = await listarMetasIndicadores(DOC_METAS_PAINEL_TREINAMENTO).catch((error) => {
          console.error("Erro ao carregar as metas do painel de treinamento:", error);
          return null;
        });
        if (!ativo) return;

        if (metasSalvas) setMetas(metasSalvas);

        setEmpresas(empresasLista.filter((e) => !isEmpresaInterna(e)));
        setOcorrencias(ocorrenciasLista);
        setLancamentos(lancamentosLista);
        setTentativasValidacao(tentativasLista);
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
    const intervalo = window.setInterval(atualizarSeVisivel, INTERVALO_ATUALIZACAO_MS);
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

  async function salvarMetas(novas: MetasIndicadores) {
    await salvarMetasIndicadores(novas, DOC_METAS_PAINEL_TREINAMENTO);
    setMetas(novas);
    toast.success("Metas do painel salvas.");
  }

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
          tentativasValidacao={tentativasValidacao}
          treinador={null}
          atualizadoEm={atualizadoEm}
          modoTv={modoTv}
          metas={metas}
          onSalvarMetas={role === "master" ? salvarMetas : undefined}
        />
      )}
    </div>
  );
};
