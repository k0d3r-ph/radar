import { useState } from "react";
import "./AvatarUsuario.css";

interface Props {
  nome: string;
  fotoUrl?: string | null;
  className?: string;
}

function iniciais(nome: string): string {
  return nome.trim().split(/\s+/)
    .filter((parte) => !/^(de|da|do|das|dos|e)$/i.test(parte))
    .slice(0, 2)
    .map((parte) => parte[0])
    .join("")
    .toLocaleUpperCase("pt-BR") || "?";
}

export function AvatarUsuario({ nome, fotoUrl, className = "" }: Props) {
  return (
    <span className={`avatar-usuario ${className}`.trim()} aria-hidden="true">
      {fotoUrl
        ? <AvatarFoto key={fotoUrl} nome={nome} url={fotoUrl} />
        : iniciais(nome)}
    </span>
  );
}

function AvatarFoto({ nome, url }: { nome: string; url: string }) {
  const [erroImagem, setErroImagem] = useState(false);
  return erroImagem
    ? iniciais(nome)
    : <img src={url} alt="" onError={() => setErroImagem(true)} />;
}
