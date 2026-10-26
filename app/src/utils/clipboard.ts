/** Falhas de permissão ou indisponibilidade não invalidam a operação que gerou o texto. */
export async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}
