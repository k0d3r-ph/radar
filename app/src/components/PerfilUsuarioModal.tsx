import { useEffect, useRef, useState } from "react";
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

export function PerfilUsuarioModal({ uid, nome, fotoAtual, onFotoAlterada, onFechar }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
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

  async function salvarFoto() {
    if (!arquivo) return;
    setOcupado(true);
    setErro("");
    try {
      const url = await enviarFotoPerfil(uid, arquivo);
      onFotoAlterada(url);
      setArquivo(null);
      setPrevia(null);
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
        <div><strong>{nome}</strong><span>JPEG, PNG ou WebP · até 2 MB</span></div>
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
          setArquivo(selecionado);
          setPrevia(selecionado ? URL.createObjectURL(selecionado) : null);
          setErro("");
        }}
      />
      <div className="perfil-usuario-acoes">
        <button type="button" disabled={ocupado} onClick={() => inputRef.current?.click()}><ImagePlus size={16} />{arquivo ? "Trocar imagem" : "Escolher imagem"}</button>
        {arquivo && <button type="button" className="perfil-usuario-primario" disabled={ocupado} onClick={() => void salvarFoto()}><Upload size={16} />{ocupado ? "Enviando…" : "Salvar foto"}</button>}
        {fotoAtual && !arquivo && <button type="button" className="perfil-usuario-remover" disabled={ocupado} onClick={() => void excluirFoto()}><Trash2 size={16} />Remover foto</button>}
      </div>
    </dialog>
  );
}
