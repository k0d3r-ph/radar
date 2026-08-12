import { useEffect, useRef } from "react";
import { toast } from "sonner";

declare const __BUILD_ID__: string;

// Intervalo entre as checagens de versão nova (5 minutos).
const INTERVALO_MS = 5 * 60 * 1000;

async function buscarVersaoPublicada(): Promise<string | null> {
  try {
    const resposta = await fetch(`/version.json?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!resposta.ok) return null;
    const dados = (await resposta.json()) as { buildId?: string };
    return dados.buildId ?? null;
  } catch {
    // Sem internet ou deploy em andamento: tenta de novo no próximo ciclo.
    return null;
  }
}

/**
 * Avisa o usuário quando uma nova versão do app foi publicada,
 * oferecendo um toast fixo com o botão de recarregar.
 */
export function useVerificaVersao() {
  const jaAvisou = useRef(false);

  useEffect(() => {
    let ativo = true;

    const verificar = async () => {
      if (!ativo || jaAvisou.current || document.hidden) return;

      const versaoPublicada = await buscarVersaoPublicada();
      if (!ativo || !versaoPublicada || versaoPublicada === __BUILD_ID__) return;

      jaAvisou.current = true;
      toast.info("Nova versão disponível", {
        description: "Recarregue a página para usar a versão mais recente.",
        duration: Infinity,
        action: {
          label: "Atualizar agora",
          onClick: () => window.location.reload(),
        },
      });
    };

    const intervalo = setInterval(verificar, INTERVALO_MS);
    document.addEventListener("visibilitychange", verificar);
    verificar();

    return () => {
      ativo = false;
      clearInterval(intervalo);
      document.removeEventListener("visibilitychange", verificar);
    };
  }, []);
}
