import { useEffect, useRef } from "react";

const ZONA_PX = 90; // distância da borda da tela que já aciona o scroll automático
const VELOCIDADE_MAX = 18; // px rolados por frame quando o cursor está bem na borda

/**
 * Rola a janela automaticamente enquanto `ativo` for true e o cursor (arrastando um item)
 * estiver perto do topo ou do rodapé da tela — para listas de arrastar-e-soltar (reordenar
 * temas da Esteira, perguntas da Validação do conhecimento) maiores que a área visível.
 */
export function useAutoScrollDuringDrag(ativo: boolean) {
  const ponteiroYRef = useRef<number | null>(null);

  useEffect(() => {
    if (!ativo) return;
    ponteiroYRef.current = null;

    function aoArrastarNaPagina(e: DragEvent) {
      // Alguns navegadores disparam um último "dragover" com clientX/Y zerados ao soltar;
      // ignora esse valor para não puxar o scroll pro topo no instante de largar o item.
      if (e.clientX === 0 && e.clientY === 0) return;
      ponteiroYRef.current = e.clientY;
    }
    document.addEventListener("dragover", aoArrastarNaPagina);

    let frame = requestAnimationFrame(function passo() {
      const y = ponteiroYRef.current;
      if (y !== null) {
        const alturaJanela = window.innerHeight;
        let delta = 0;
        if (y < ZONA_PX) delta = -VELOCIDADE_MAX * (1 - y / ZONA_PX);
        else if (y > alturaJanela - ZONA_PX) delta = VELOCIDADE_MAX * (1 - (alturaJanela - y) / ZONA_PX);
        if (delta !== 0) window.scrollBy(0, delta);
      }
      frame = requestAnimationFrame(passo);
    });

    return () => {
      document.removeEventListener("dragover", aoArrastarNaPagina);
      cancelAnimationFrame(frame);
    };
  }, [ativo]);
}
