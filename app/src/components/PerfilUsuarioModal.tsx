import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { ImagePlus, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { enviarFotoPerfil, removerFotoPerfil } from "../services/profilePhotos";
import { AvatarUsuario } from "./AvatarUsuario";
import "./PerfilUsuarioModal.css";

interface Props {
  uid: string;
  nome: string;
  fotoAtual?: string | null;
  onFotoAlterada: (url: string | null) => void;
  onFechar: () => void;
}

const TAMANHO_AREA_RECORTE = 256;
const TAMANHO_FOTO = 512;
const TAMANHO_MAXIMO_ORIGINAL = 10 * 1024 * 1024;
const TIPOS_PERMITIDOS = new Set(["image/jpeg", "image/png", "image/webp"]);

export function PerfilUsuarioModal({ uid, nome, fotoAtual, onFotoAlterada, onFechar }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const areaRecorteRef = useRef<HTMLDivElement>(null);
  const arrastoRef = useRef<{ x: number; y: number; deslocamentoX: number; deslocamentoY: number } | null>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [arquivoOriginal, setArquivoOriginal] = useState<File | null>(null);
  const [urlOriginal, setUrlOriginal] = useState<string | null>(null);
  const [dimensoesImagem, setDimensoesImagem] = useState<{ largura: number; altura: number } | null>(null);
  const [recorteAberto, setRecorteAberto] = useState(false);
  const [tamanhoAreaRecorte, setTamanhoAreaRecorte] = useState(TAMANHO_AREA_RECORTE);
  const [zoom, setZoom] = useState(1);
  const [deslocamento, setDeslocamento] = useState({ x: 0, y: 0 });
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  useEffect(() => {
    if (!previa) return;
    return () => URL.revokeObjectURL(previa);
  }, [previa]);

  useEffect(() => {
    if (!urlOriginal) return;
    return () => URL.revokeObjectURL(urlOriginal);
  }, [urlOriginal]);

  useEffect(() => {
    if (!recorteAberto || !areaRecorteRef.current) return;
    const observador = new ResizeObserver(([entrada]) => {
      if (entrada.target instanceof HTMLElement) {
        setTamanhoAreaRecorte(entrada.target.clientWidth);
      }
    });
    observador.observe(areaRecorteRef.current);
    return () => observador.disconnect();
  }, [recorteAberto]);

  const escalaImagem = dimensoesImagem
    ? Math.max(
        tamanhoAreaRecorte / dimensoesImagem.largura,
        tamanhoAreaRecorte / dimensoesImagem.altura,
      ) * zoom
    : 1;
  const larguraImagem = dimensoesImagem
    ? dimensoesImagem.largura * escalaImagem
    : tamanhoAreaRecorte;
  const alturaImagem = dimensoesImagem
    ? dimensoesImagem.altura * escalaImagem
    : tamanhoAreaRecorte;

  function limitarDeslocamento(x: number, y: number, escala = escalaImagem) {
    if (!dimensoesImagem) return { x: 0, y: 0 };
    const largura = dimensoesImagem.largura * escala;
    const altura = dimensoesImagem.altura * escala;
    return {
      x: Math.max(-(largura - tamanhoAreaRecorte) / 2, Math.min((largura - tamanhoAreaRecorte) / 2, x)),
      y: Math.max(-(altura - tamanhoAreaRecorte) / 2, Math.min((altura - tamanhoAreaRecorte) / 2, y)),
    };
  }

  function abrirRecorte() {
    if (!arquivoOriginal || !urlOriginal) return;
    setArquivo(null);
    setPrevia(null);
    setZoom(1);
    setDeslocamento({ x: 0, y: 0 });
    setRecorteAberto(true);
  }

  function selecionarImagem(file: File | null) {
    setErro("");
    setArquivo(null);
    setPrevia(null);
    setArquivoOriginal(null);
    setUrlOriginal(null);
    setDimensoesImagem(null);
    setRecorteAberto(false);
    setZoom(1);
    setDeslocamento({ x: 0, y: 0 });
    if (!file) return;
    if (!TIPOS_PERMITIDOS.has(file.type)) {
      setErro("Escolha uma imagem JPEG, PNG ou WebP.");
      return;
    }
    if (file.size === 0 || file.size > TAMANHO_MAXIMO_ORIGINAL) {
      setErro("A imagem original deve ter até 10 MB.");
      return;
    }
    setArquivoOriginal(file);
    setUrlOriginal(URL.createObjectURL(file));
    setRecorteAberto(true);
  }

  function iniciarArrasto(event: PointerEvent<HTMLDivElement>) {
    if (!dimensoesImagem) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    arrastoRef.current = {
      x: event.clientX,
      y: event.clientY,
      deslocamentoX: deslocamento.x,
      deslocamentoY: deslocamento.y,
    };
  }

  function moverRecorte(event: PointerEvent<HTMLDivElement>) {
    const arrasto = arrastoRef.current;
    if (!arrasto) return;
    setDeslocamento(
      limitarDeslocamento(
        arrasto.deslocamentoX + event.clientX - arrasto.x,
        arrasto.deslocamentoY + event.clientY - arrasto.y,
      ),
    );
  }

  function encerrarArrasto() {
    arrastoRef.current = null;
  }

  function moverRecorteTeclado(event: KeyboardEvent<HTMLDivElement>) {
    const passo = event.shiftKey ? 20 : 5;
    const deslocamentoTeclado = {
      ArrowLeft: { x: -passo, y: 0 },
      ArrowRight: { x: passo, y: 0 },
      ArrowUp: { x: 0, y: -passo },
      ArrowDown: { x: 0, y: passo },
    }[event.key];
    if (!deslocamentoTeclado) return;
    event.preventDefault();
    setDeslocamento((atual) =>
      limitarDeslocamento(
        atual.x + deslocamentoTeclado.x,
        atual.y + deslocamentoTeclado.y,
      ),
    );
  }

  async function aplicarRecorte() {
    if (!arquivoOriginal || !urlOriginal || !dimensoesImagem) return;
    setErro("");
    try {
      const esquerdaImagem = (tamanhoAreaRecorte - larguraImagem) / 2 + deslocamento.x;
      const topoImagem = (tamanhoAreaRecorte - alturaImagem) / 2 + deslocamento.y;
      const xOrigem = Math.max(0, -esquerdaImagem / escalaImagem);
      const yOrigem = Math.max(0, -topoImagem / escalaImagem);
      const tamanhoOrigem = tamanhoAreaRecorte / escalaImagem;
      const imagem = new Image();
      imagem.src = urlOriginal;
      await imagem.decode();
      const canvas = document.createElement("canvas");
      canvas.width = TAMANHO_FOTO;
      canvas.height = TAMANHO_FOTO;
      const contexto = canvas.getContext("2d");
      if (!contexto) throw new Error("Não foi possível preparar o recorte da imagem.");
      contexto.drawImage(
        imagem,
        xOrigem,
        yOrigem,
        tamanhoOrigem,
        tamanhoOrigem,
        0,
        0,
        TAMANHO_FOTO,
        TAMANHO_FOTO,
      );
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/webp", 0.9),
      );
      if (!blob) throw new Error("Não foi possível gerar a imagem recortada.");
      const extensao = blob.type === "image/webp" ? "webp" : blob.type.split("/")[1];
      const fotoRecortada = new File([blob], `foto-perfil.${extensao}`, { type: blob.type });
      if (fotoRecortada.size > 2 * 1024 * 1024) {
        throw new Error("A imagem recortada deve ter até 2 MB. Reduza o zoom e tente novamente.");
      }
      setArquivo(fotoRecortada);
      setPrevia(URL.createObjectURL(fotoRecortada));
      setRecorteAberto(false);
    } catch (error) {
      const mensagem = error instanceof Error ? error.message : "Não foi possível recortar a imagem.";
      setErro(mensagem);
    }
  }

  async function salvarFoto() {
    if (!arquivo) return;
    setOcupado(true);
    setErro("");
    try {
      const url = await enviarFotoPerfil(uid, arquivo);
      onFotoAlterada(url);
      setArquivo(null);
      setPrevia(null);
      setArquivoOriginal(null);
      setUrlOriginal(null);
      toast.success("Sua foto de perfil foi atualizada.");
    } catch (error) {
      const mensagem = error instanceof Error ? error.message : "Não foi possível atualizar sua foto.";
      setErro(mensagem);
      toast.error(mensagem);
    } finally {
      setOcupado(false);
    }
  }

  async function excluirFoto() {
    setOcupado(true);
    setErro("");
    try {
      await removerFotoPerfil(uid);
      onFotoAlterada(null);
      setArquivo(null);
      toast.success("Foto removida. As iniciais serão exibidas no lugar.");
    } catch (error) {
      const mensagem = error instanceof Error ? error.message : "Não foi possível remover sua foto.";
      setErro(mensagem);
      toast.error(mensagem);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="perfil-usuario-dialog"
      aria-labelledby="perfil-usuario-titulo"
      onCancel={(event) => { event.preventDefault(); if (!ocupado) onFechar(); }}
    >
      <header className="perfil-usuario-header">
        <div><h2 id="perfil-usuario-titulo">Minha foto de perfil</h2><p>A foto aparecerá no pódio e no ranking da equipe.</p></div>
        <button type="button" className="perfil-usuario-fechar" aria-label="Fechar" disabled={ocupado} onClick={onFechar}><X size={20} /></button>
      </header>
      <div className="perfil-usuario-previa">
        <AvatarUsuario nome={nome} fotoUrl={previa || fotoAtual} className="perfil-usuario-avatar" />
        <div><strong>{nome}</strong><span>JPEG, PNG ou WebP · original até 10 MB, foto final até 2 MB</span></div>
      </div>
      {erro && <p className="perfil-usuario-erro" role="alert">{erro}</p>}
      <input
        ref={inputRef}
        className="perfil-usuario-arquivo"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label="Escolher imagem de perfil"
        disabled={ocupado}
        tabIndex={-1}
        onChange={(event) => {
          const selecionado = event.target.files?.[0] || null;
          event.currentTarget.value = "";
          selecionarImagem(selecionado);
        }}
      />
      {recorteAberto && urlOriginal && (
        <section className="perfil-usuario-recorte" aria-label="Recortar foto de perfil">
          <p>Arraste a imagem ou use as setas do teclado para posicioná-la; ajuste o zoom.</p>
          <div
            ref={areaRecorteRef}
            className="perfil-usuario-recorte-area"
            role="group"
            tabIndex={0}
            aria-label="Posicionar imagem no recorte. Use as setas do teclado."
            onKeyDown={moverRecorteTeclado}
            onPointerDown={iniciarArrasto}
            onPointerMove={moverRecorte}
            onPointerUp={encerrarArrasto}
            onPointerCancel={encerrarArrasto}
            onLostPointerCapture={encerrarArrasto}
          >
            <img
              src={urlOriginal}
              alt="Prévia para recorte"
              draggable={false}
              onLoad={(event) => setDimensoesImagem({
                largura: event.currentTarget.naturalWidth,
                altura: event.currentTarget.naturalHeight,
              })}
              onError={() => setErro("Não foi possível abrir esta imagem. Escolha outro arquivo.")}
              style={{
                position: "absolute",
                width: larguraImagem,
                height: alturaImagem,
                maxWidth: "none",
                left: (tamanhoAreaRecorte - larguraImagem) / 2 + deslocamento.x,
                top: (tamanhoAreaRecorte - alturaImagem) / 2 + deslocamento.y,
                pointerEvents: "none",
                userSelect: "none",
              }}
            />
          </div>
          <label className="perfil-usuario-zoom">
            Zoom
            <input
              type="range"
              min="1"
              max="3"
              step="0.01"
              value={zoom}
              onChange={(event) => {
                const novoZoom = Number(event.target.value);
                const novaEscala = dimensoesImagem
                  ? Math.max(
                      tamanhoAreaRecorte / dimensoesImagem.largura,
                      tamanhoAreaRecorte / dimensoesImagem.altura,
                    ) * novoZoom
                  : 1;
                setZoom(novoZoom);
                setDeslocamento((atual) => limitarDeslocamento(atual.x, atual.y, novaEscala));
              }}
            />
          </label>
        </section>
      )}
      <div className="perfil-usuario-acoes">
        <button type="button" disabled={ocupado} onClick={() => inputRef.current?.click()}><ImagePlus size={16} />{arquivoOriginal ? "Trocar imagem" : "Escolher imagem"}</button>
        {recorteAberto && <button type="button" className="perfil-usuario-primario" disabled={ocupado || !dimensoesImagem} onClick={() => void aplicarRecorte()}><ImagePlus size={16} />Aplicar recorte</button>}
        {!recorteAberto && arquivoOriginal && <button type="button" disabled={ocupado} onClick={abrirRecorte}><ImagePlus size={16} />Ajustar recorte</button>}
        {arquivo && <button type="button" className="perfil-usuario-primario" disabled={ocupado} onClick={() => void salvarFoto()}><Upload size={16} />{ocupado ? "Enviando…" : "Salvar foto"}</button>}
        {fotoAtual && !arquivo && !arquivoOriginal && <button type="button" className="perfil-usuario-remover" disabled={ocupado} onClick={() => void excluirFoto()}><Trash2 size={16} />Remover foto</button>}
      </div>
    </dialog>
  );
}
