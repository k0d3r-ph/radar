import "./Esteira.css";
import base from "../../assets/base.png";
import { useState, useRef, useEffect } from "react";
import type { Empresa } from "../../types";
import {
  salvarEmpresas,
  listarEmpresas,
  removerEmpresa,
} from "../../services/empresas";
import FakeSelect from "../../components/FakeSelect";
import { toast } from "sonner";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import {
  obterDestinatariosGestao,
  montarMensagemConclusaoEsteiraGestao,
} from "../../services/notificacoes";
import type { DestinatarioGestao } from "../../services/notificacoes";
import { GestaoNotificacaoModal } from "../../components/GestaoNotificacaoModal";

function normalizarNome(nome: string) {
  return nome
    .trim()
    .toLowerCase()
    .normalize("NFD") // decompõe acentos
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/\s+/g, ""); // remove todos os espaços
}

type TemplateEsteira = {
  id: string;
  nome: string;
  descricao: string;
  temas: string;
};

const TEMPLATES_ESTEIRA: TemplateEsteira[] = [
  {
    id: "basico",
    nome: "Template Básico",
    descricao: "Fluxo padrão de implantação",
    temas:
      "Início\nCadastro de Gateway\nDebug\nCadastro de Rastreador\nCadastro de Veículo\nCadastro de Cliente\nTela Operacional\nPessoas\nSSX Mobile\nRegras\nRelatório\nConclusão",
  },
  {
    id: "template1",
    nome: "Template 1",
    descricao: "Central que já precisa atender seus clientes",
    temas:
      "Início\nFunções da Tela Operacional\nHistórico de Posições\nReset de Senha\nFunções do Aplicativo\nCadastrar Novo Cliente\nCadastrar Novo Veículo\nCadastro de Pessoas\nApontar Novo Rastreador\nDesassociar Rastreador\nCriar Templates\nCriar Regras, Áreas e Rotas\nApresentar Relatórios\nConclusão",
  },
  {
    id: "template2",
    nome: "Template 2",
    descricao: "Central que utilizará apenas Videotelemetria",
    temas:
      "Início\nCadastrar Câmeras\nCadastrar Veículos\nDesassociar Rastreador\nFunções da Tela Operacional\nCadastro de cliente e Calculadora\nApresentar Videotelemetria\nCriar Templates\nCriar Regras, Áreas e Rotas\nApresentar Relatórios\nConclusão",
  },
  {
    id: "template3",
    nome: "Template 3",
    descricao: "Central que utiliza ERP integrado ao SSX",
    temas:
      "Início\nFunções da Tela Operacional\nEntender o Debug\nCadastro de Pessoas\nDesassociar Rastreador\nCriar Templates\nCriar Regras, Áreas e Rotas\nApresentar Relatórios\nConclusão",
  },
  {
    id: "template4",
    nome: "Template 4",
    descricao: "Central sem experiência em rastreamento",
    temas:
      "Início\nVisão Geral de Rastreamento\nCadastrar Gateway\nEntender o Debug\nChecar Cadastro de Rastreador\nCadastrar Cliente\nCadastrar Veículo\nCadastro de Pessoas\nFunções da Tela Operacional\nCriar Templates\nCriar Regras, Áreas e Rotas\nApresentar Relatórios\nConclusão",
  },
  {
    id: "template5",
    nome: "Template 5",
    descricao: "Central com experiência em rastreamento",
    temas:
      "Início\nCadastrar Gateway\nEntender o Debug\nChecar Cadastro de Rastreador\nCadastrar Cliente\nCadastrar Veículo\nCadastro de Pessoas\nFunções da Tela Operacional\nCriar Templates\nCriar Regras, Áreas e Rotas\nApresentar Relatórios\nConclusão",
  },
];

function Esteira() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { role } = useAuth();
  const isTreinador = role === "treinador" || role === "master";

  const [empresaId, setEmpresaId] = useState("");
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [templatesAbertos, setTemplatesAbertos] = useState(false);

  const [nomeEmpresa, setNomeEmpresa] = useState("");
  const [temaText, setTemaText] = useState(``);
  const [dataText, setDataText] = useState(``);
  const [currentPhase, setCurrentPhase] = useState(0);
  const empresasOrdenadas = [...empresas].sort((a, b) =>
    a.nomeEmpresa.localeCompare(b.nomeEmpresa, "pt-BR"),
  );

  // Notificação de Gestão (Conclusão da esteira -> Supervisor + CS Responsável) via WhatsApp
  const [gestaoConfirmModalOpen, setGestaoConfirmModalOpen] = useState(false);
  const [gestaoDestinatarios, setGestaoDestinatarios] = useState<
    DestinatarioGestao[]
  >([]);
  const [gestaoMensagem, setGestaoMensagem] = useState("");

  useEffect(() => {
    async function carregar() {
      const lista = await listarEmpresas();
      setEmpresas(lista);

      if (id) {
        const empresa = lista.find((x) => String(x.id) === id);

        if (!empresa) return;

        setEmpresaId(String(empresa.id));

        setNomeEmpresa(empresa.nomeEmpresa);

        setTemaText(empresa.temaText);

        setDataText(empresa.dataText);

        setCurrentPhase(empresa.currentPhase || 0);
      }
    }

    carregar();
  }, [id]);

  const aplicarTemplate = (template: TemplateEsteira) => {
    setTemaText(template.temas);
    setTemplatesAbertos(false);
    toast.success(`${template.nome} aplicado!`);
  };

  type TemaItem = {
    tema: string;
    data?: string;
  };

  const temasArray = temaText.split("\n").map((linha) => linha.trim());

  const datasArray = dataText.split("\n").map((linha) => linha.trim());

  const temas: TemaItem[] = temasArray
    .map((tema, index) => {
      if (!tema) return null;

      const item: TemaItem = {
        tema,
      };

      if (datasArray[index]) {
        item.data = datasArray[index];
      }

      return item;
    })
    .filter((x): x is TemaItem => x !== null);

  const svgRef = useRef<SVGSVGElement | null>(null);

  const maxPorLinha = 5;
  const espacamentoX = 200;
  const yTopo = 240;
  const gapY = 240;

  function quebrarTexto(texto: string, maxChars = 15) {
    const palavras = texto.split(" ");
    const linhas: string[] = [];

    let linhaAtual = "";

    for (const palavra of palavras) {
      const teste = linhaAtual ? `${linhaAtual} ${palavra}` : palavra;

      if (teste.length > maxChars) {
        linhas.push(linhaAtual);
        linhaAtual = palavra;
      } else {
        linhaAtual = teste;
      }
    }

    if (linhaAtual) {
      linhas.push(linhaAtual);
    }

    return linhas;
  }

  const pontos = temas.map((_, index) => {
    const linha = Math.floor(index / maxPorLinha);
    const coluna = index % maxPorLinha;

    const xBase =
      linha % 2 === 0
        ? 200 + coluna * espacamentoX
        : 200 + (maxPorLinha - 1 - coluna) * espacamentoX;

    const totalLinhas = Math.ceil(temas.length / maxPorLinha);

    const linhasExtras = Math.max(0, totalLinhas - 3);

    const compressao = linhasExtras * 100;

    const gapDinamico = Math.max(150, gapY - compressao);

    const y = linha === 0 ? yTopo : yTopo + linha * gapDinamico;

    return { x: xBase, y };
  });

  const pathD = pontos.reduce((acc, ponto, index, arr) => {
    if (index === 0) {
      return `M ${ponto.x} ${ponto.y}`;
    }

    const anterior = arr[index - 1];
    const linhaAnterior = Math.floor((index - 1) / maxPorLinha);
    const linhaAtual = Math.floor(index / maxPorLinha);

    if (linhaAtual === linhaAnterior) {
      return `${acc} L ${ponto.x} ${ponto.y}`;
    }

    const direcao = linhaAtual % 2 === 1 ? 1 : -1;

    const curvaOffset = 180;

    const c1x = anterior.x + direcao * curvaOffset;
    const c1y = anterior.y;

    const c2x = ponto.x + direcao * curvaOffset;
    const c2y = ponto.y;

    return `${acc} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${ponto.x} ${ponto.y}`;
  }, "");

  return (
    <div className="app-shell">
      <div className="controls">
        <div className="control-row">
          <label>Empresas salvas</label>

          <FakeSelect
            empresas={empresasOrdenadas}
            empresaId={empresaId}
            onSelect={(id) => {
              setEmpresaId(id);

              const empresa = empresas.find((x) => String(x.id) === id);

              if (!empresa) {
                setNomeEmpresa("");
                setTemaText("");
                setDataText("");
                return;
              }

              setNomeEmpresa(empresa.nomeEmpresa);
              setTemaText(empresa.temaText);
              setDataText(empresa.dataText);
              setCurrentPhase(empresa.currentPhase || 0);
            }}
          />
        </div>

        {nomeEmpresa && (
          <div
            className="control-row"
            style={{ marginTop: "-12px", marginBottom: "24px" }}
          >
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                navigate(
                  `/historico?empresa=${encodeURIComponent(nomeEmpresa)}`,
                );
              }}
              style={{
                width: "100%",
                padding: "10px 14px",
                fontSize: "0.85rem",
              }}
            >
              Ver Ocorrências de {nomeEmpresa}
            </button>
          </div>
        )}

        <div className="control-row">
          <label>Nome da empresa</label>
          <input
            value={nomeEmpresa}
            onChange={(e) => setNomeEmpresa(e.target.value)}
            placeholder="Digite o nome da empresa"
            disabled={!isTreinador}
          />
        </div>

        <div className="temas-wrapper">
          <div className="control-row temas-box">
            <label>Temas (um por linha)</label>

            <textarea
              value={temaText}
              onChange={(e) => setTemaText(e.target.value)}
              rows={12}
              disabled={!isTreinador}
            />
          </div>

          <div className="control-row datas-box">
            <label>Datas</label>

            <textarea
              value={dataText}
              onChange={(e) => setDataText(e.target.value)}
              rows={12}
              disabled={!isTreinador}
            />
          </div>
        </div>

        <div className="download-row">
          {isTreinador && (
            <button
              className="btn-primary"
              onClick={async () => {
                if (!nomeEmpresa.trim()) {
                  toast.error("Digite o nome da empresa.");
                  return;
                }

                const nomeDuplicado = empresas.some(
                  (e) =>
                    normalizarNome(e.nomeEmpresa) ===
                      normalizarNome(nomeEmpresa) && String(e.id) !== empresaId,
                );

                if (nomeDuplicado) {
                  toast.error("Já existe uma empresa com este nome.");
                  return;
                }

                const empresaExistente = empresas.find(
                  (e) => String(e.id) === empresaId,
                );
                const isFinished = currentPhase === temas.length - 1;

                const today = new Date();
                const year = today.getFullYear();
                const month = String(today.getMonth() + 1).padStart(2, "0");
                const day = String(today.getDate()).padStart(2, "0");
                const dataHoje = `${year}-${month}-${day}`;

                const dataFinalizacao = isFinished
                  ? empresaExistente?.dataFinalizacao || dataHoje
                  : "";

                const novoId = await salvarEmpresas({
                  ...(empresaId ? { id: empresaId } : {}),
                  nomeEmpresa,
                  temaText,
                  dataText,
                  currentPhase,
                  dataFinalizacao,
                  updatedAt: Date.now(),
                });

                if (novoId) {
                  setEmpresaId(String(novoId));
                }

                const lista = await listarEmpresas();
                setEmpresas(lista);

                toast.success("Empresa salva com sucesso!", {
                  duration: 2000,
                });

                // Esteira concluída agora (não estava finalizada antes e o cliente não é Ongoing): notifica Supervisor + CS Responsável
                if (
                  isFinished &&
                  !empresaExistente?.dataFinalizacao &&
                  !empresaExistente?.isOngoing
                ) {
                  const empresaConcluida: Empresa = {
                    ...(empresaExistente as Empresa),
                    id: String(novoId || empresaId),
                    nomeEmpresa,
                    temaText,
                    dataText,
                    currentPhase,
                    dataFinalizacao,
                  };
                  obterDestinatariosGestao(empresaConcluida)
                    .then((destinatarios) => {
                      if (destinatarios.length === 0) return;
                      setGestaoDestinatarios(destinatarios);
                      setGestaoMensagem(
                        montarMensagemConclusaoEsteiraGestao(empresaConcluida),
                      );
                      setGestaoConfirmModalOpen(true);
                    })
                    .catch((err) =>
                      console.error(
                        "[notificações] Falha ao montar destinatários de conclusão:",
                        err,
                      ),
                    );
                }

                setEmpresaId("");
                setNomeEmpresa("");
                setTemaText("");
                setDataText("");
                setCurrentPhase(0);
              }}
            >
              Salvar empresa
            </button>
          )}

          <button
            className="btn-primary"
            onClick={async () => {
              try {
                const svg = svgRef.current;
                if (!svg) return;

                try {
                  const css = await fetch(
                    "https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;800&display=swap",
                  ).then((r) => r.text());
                  const blocks = css.match(/@font-face\s*\{[^}]*\}/g) || [];
                  for (const block of blocks) {
                    const weightMatch = block.match(/font-weight:\s*(\d+)/);
                    const urlMatch = block.match(/url\((https:[^)]*)\)/);
                    if (urlMatch) {
                      const url = urlMatch[1];
                      const weight = weightMatch ? weightMatch[1] : "400";
                      try {
                        const ff = new FontFace("Roboto", `url(${url})`, {
                          weight: String(weight),
                        });
                        await ff.load();
                        document.fonts.add(ff);
                      } catch {
                        // ignore font load errors
                      }
                    }
                  }
                } catch {
                  // ignore font fetch errors
                }

                const dpr = window.devicePixelRatio || 1;

                const canvas = document.createElement("canvas");
                canvas.width = 1600 * dpr;
                canvas.height = 900 * dpr;
                canvas.style.width = "1600px";
                canvas.style.height = "900px";
                const ctx = canvas.getContext("2d");
                if (!ctx) return;
                ctx.scale(dpr, dpr);

                const bg = new Image();
                bg.crossOrigin = "anonymous";
                bg.src = base;
                await new Promise((res, rej) => {
                  bg.onload = res;
                  bg.onerror = rej;
                });
                ctx.drawImage(bg, 0, 0, 1600, 900);

                const clone = svg.cloneNode(true) as SVGSVGElement;
                clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

                const origEls = svg.querySelectorAll("*");
                const cloneEls = clone.querySelectorAll("*");
                origEls.forEach((origEl, i) => {
                  const cloneEl = cloneEls[i] as Element | null;
                  if (!cloneEl) return;
                  const cs = window.getComputedStyle(origEl as Element);
                  const props = [
                    "fill",
                    "stroke",
                    "stroke-width",
                    "stroke-linecap",
                    "stroke-linejoin",
                    "font-family",
                    "font-size",
                    "font-weight",
                    "text-anchor",
                    "letter-spacing",
                  ];
                  let styleText = "";
                  props.forEach((p) => {
                    const v = cs.getPropertyValue(p);
                    if (v) styleText += `${p}: ${v}; `;
                  });
                  if (styleText) cloneEl.setAttribute("style", styleText);
                });

                const serializer = new XMLSerializer();
                const svgString = serializer.serializeToString(clone);
                const svgUrl =
                  "data:image/svg+xml;charset=utf-8," +
                  encodeURIComponent(svgString);

                const img = new Image();
                img.crossOrigin = "anonymous";
                img.onload = () => {
                  try {
                    ctx.drawImage(img, 0, 0, 1600, 900);
                    canvas.toBlob((blob) => {
                      if (!blob) return;
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = `${nomeEmpresa || "esteira"}.png`;
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                      URL.revokeObjectURL(a.href);
                    }, "image/png");
                  } catch {
                    alert("Erro ao desenhar imagem no canvas");
                  }
                };
                img.onerror = () => alert("Erro ao converter SVG para imagem");
                img.src = svgUrl;
              } catch {
                toast.error("Erro ao gerar imagem");
              }
            }}
          >
            Baixar imagem
          </button>

          {isTreinador && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setTemplatesAbertos(true)}
            >
              Templates
            </button>
          )}
        </div>

        <div className="control-row">
          <label>Fase atual</label>
          <div className="phase-controls">
            <button
              onClick={() => setCurrentPhase((p) => Math.max(0, p - 1))}
              className="btn-small"
              disabled={!isTreinador}
            >
              ‹
            </button>

            <input
              type="range"
              min={0}
              max={Math.max(0, temas.length - 1)}
              value={currentPhase}
              onChange={(e) => setCurrentPhase(Number(e.target.value))}
              disabled={!isTreinador}
            />

            <button
              onClick={() =>
                setCurrentPhase((p) => Math.min(temas.length - 1, p + 1))
              }
              className="btn-small"
              disabled={!isTreinador}
            >
              ›
            </button>
          </div>

          <div className="phase-label">
            {currentPhase + 1} — {temas[currentPhase]?.tema || "-"}
          </div>
        </div>
      </div>

      <div className="preview">
        <img className="background" src={base} alt="Fundo" />

        <svg ref={svgRef} width="1600" height="900" viewBox="0 0 1600 900">
          <text
            className="empresa"
            x={750}
            y={70}
            textAnchor="middle"
            dominantBaseline="hanging"
          >
            {nomeEmpresa || "Nome da Empresa"}
          </text>
          <path d={pathD} fill="none" stroke="white" strokeWidth={4} />

          {pontos.map((ponto, i) => {
            const isActive = i === currentPhase;
            const item = temas[i];

            return (
              <g key={i}>
                {isActive && (
                  <g className="active-marker">
                    <text
                      x={ponto.x}
                      y={item.data ? ponto.y - 80 : ponto.y - 40}
                      textAnchor="middle"
                      className="active-badge"
                    >
                      Você está aqui
                    </text>
                    <circle
                      cx={ponto.x}
                      cy={ponto.y}
                      r={22}
                      className="active-ring"
                    />
                  </g>
                )}

                <circle
                  cx={ponto.x}
                  cy={ponto.y}
                  r={isActive ? 16 : 12}
                  className={isActive ? "active-circle" : ""}
                  strokeWidth={isActive ? 4 : 4}
                />

                {item?.data && (
                  <text
                    x={ponto.x}
                    y={ponto.y - 34}
                    textAnchor="middle"
                    className="tema-data"
                  >
                    {item.data}
                  </text>
                )}

                <text
                  x={ponto.x}
                  y={ponto.y + 50}
                  textAnchor="middle"
                  className="temas"
                >
                  {quebrarTexto(item?.tema || "").map((linha, idx) => (
                    <tspan key={idx} x={ponto.x} dy={idx === 0 ? 0 : 24}>
                      {linha}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <GestaoNotificacaoModal
        open={gestaoConfirmModalOpen}
        titulo="🎉 Notificar Supervisor e CS Responsável sobre a conclusão da esteira?"
        destinatarios={gestaoDestinatarios}
        mensagem={gestaoMensagem}
        onChangeMensagem={setGestaoMensagem}
        onClose={() => {
          setGestaoConfirmModalOpen(false);
          setGestaoDestinatarios([]);
          setGestaoMensagem("");
        }}
      />

      {templatesAbertos && (
        <div
          className="templates-modal-overlay"
          onClick={() => setTemplatesAbertos(false)}
        >
          <div className="templates-modal" onClick={(e) => e.stopPropagation()}>
            <div className="templates-modal-header">
              <h3>Escolha um template</h3>
              <button
                type="button"
                className="templates-modal-close"
                onClick={() => setTemplatesAbertos(false)}
              >
                ×
              </button>
            </div>

            <div className="templates-modal-list">
              {TEMPLATES_ESTEIRA.map((template) => (
                <div
                  key={template.id}
                  className="templates-modal-item"
                  onClick={() => aplicarTemplate(template)}
                >
                  <span className="templates-modal-item-nome">
                    {template.nome}
                  </span>
                  <span className="templates-modal-item-desc">
                    {template.descricao}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { Esteira };
