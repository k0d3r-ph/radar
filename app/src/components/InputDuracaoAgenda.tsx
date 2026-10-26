import { useLayoutEffect, useRef } from 'react';
import { formatarDuracaoAgenda } from '../../../server/src/domain/duracaoAgenda';

interface Props {
  value: string;
  onChange: (valor: string) => void;
  disabled?: boolean;
  erroId?: string;
}

export function InputDuracaoAgenda({ value, onChange, disabled, erroId }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cursorRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (input && input === document.activeElement && cursorRef.current !== null) input.setSelectionRange(cursorRef.current, cursorRef.current);
    cursorRef.current = null;
  });

  return <input ref={inputRef} type="text" inputMode="numeric" autoComplete="off" placeholder="HH:MM"
    value={value} disabled={disabled} aria-invalid={!!erroId} aria-describedby={erroId}
    onChange={event => {
      const input = event.target, texto = input.value;
      const digitosAntes = texto.slice(0, input.selectionStart ?? texto.length).replace(/\D/g, '').length;
      const formatado = formatarDuracaoAgenda(texto);
      cursorRef.current = Math.min(digitosAntes + (digitosAntes > 2 ? 1 : 0), formatado.length);
      onChange(formatado);
    }}
    onKeyDown={event => {
      const input = event.currentTarget;
      if (input.selectionStart !== input.selectionEnd || input.selectionStart === null) return;
      const posicao = input.selectionStart;
      if (event.key === 'Backspace' && value[posicao - 1] === ':') {
        event.preventDefault();
        cursorRef.current = posicao - 2;
        onChange(formatarDuracaoAgenda(value.slice(0, posicao - 2) + value.slice(posicao)));
      } else if (event.key === 'Delete' && value[posicao] === ':') {
        event.preventDefault();
        cursorRef.current = posicao;
        onChange(formatarDuracaoAgenda(value.slice(0, posicao) + value.slice(posicao + 2)));
      }
    }} />;
}
