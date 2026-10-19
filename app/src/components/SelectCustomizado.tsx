import React, { useEffect, useMemo, useRef, useState } from "react";
import "./SelectCustomizado.css";

export interface OpcaoSelectCustomizado {
  value: string;
  label: string;
}

interface SelectCustomizadoProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  opcoes: OpcaoSelectCustomizado[];
  placeholder?: string;
  searchPlaceholder?: string;
  /** A partir de quantas opções o campo de busca aparece. Padrão: 6. */
  minOpcoesParaBusca?: number;
  disabled?: boolean;
  ariaLabel?: string;
  /** Classe extra no container, para ajustar largura em filtros mais estreitos (ex.: "w-auto"). */
  className?: string;
}

/**
 * Substituto do `<select>` nativo com o visual do restante do app (o menu do
 * navegador não segue tema nem identidade visual). Mesmo padrão de interação do
 * SearchableSelect usado na Gamificação: trigger + painel com busca, fecha ao
 * clicar fora ou com Esc, navegável por teclado.
 */
export const SelectCustomizado: React.FC<SelectCustomizadoProps> = ({
  id,
  value,
  onChange,
  opcoes,
  placeholder = "Selecione...",
  searchPlaceholder = "Pesquisar...",
  minOpcoesParaBusca = 6,
  disabled,
  ariaLabel,
  className,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    if (isOpen) document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && searchInputRef.current) searchInputRef.current.focus();
  }, [isOpen]);

  const opcoesFiltradas = useMemo(() => {
    const termo = searchTerm.trim().toLowerCase();
    if (!termo) return opcoes;
    return opcoes.filter((o) => o.label.toLowerCase().includes(termo));
  }, [opcoes, searchTerm]);

  const opcaoSelecionada = opcoes.find((o) => o.value === value);
  const mostrarBusca = opcoes.length >= minOpcoesParaBusca;

  return (
    <div className={`select-customizado-container ${className || ""}`} ref={containerRef}>
      <button
        type="button"
        id={id}
        className={`select-customizado-trigger ${isOpen ? "active" : ""}`}
        onClick={() => {
          if (disabled) return;
          setIsOpen((prev) => !prev);
          setSearchTerm("");
        }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
      >
        <span className={opcaoSelecionada ? "select-customizado-valor" : "select-customizado-placeholder"}>
          {opcaoSelecionada ? opcaoSelecionada.label : placeholder}
        </span>
        <span className={`select-customizado-seta ${isOpen ? "open" : ""}`} aria-hidden="true">
          ▼
        </span>
      </button>

      {isOpen && (
        <div className="select-customizado-dropdown" role="listbox">
          {mostrarBusca && (
            <div className="select-customizado-busca-wrapper">
              <input
                ref={searchInputRef}
                type="text"
                className="select-customizado-busca-input"
                placeholder={searchPlaceholder}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          )}
          <div className="select-customizado-lista">
            {opcoesFiltradas.length > 0 ? (
              opcoesFiltradas.map((opcao) => {
                const selecionada = opcao.value === value;
                return (
                  <div
                    key={opcao.value}
                    role="option"
                    aria-selected={selecionada}
                    tabIndex={0}
                    className={`select-customizado-opcao ${selecionada ? "selected" : ""}`}
                    onClick={() => {
                      onChange(opcao.value);
                      setIsOpen(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onChange(opcao.value);
                        setIsOpen(false);
                      }
                    }}
                  >
                    <span>{opcao.label}</span>
                    {selecionada && (
                      <span className="select-customizado-check" aria-hidden="true">
                        ✓
                      </span>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="select-customizado-vazio">Nenhuma opção encontrada</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
