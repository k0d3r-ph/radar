import type { Ocorrencia } from "../types";

const DEPARTAMENTO_POR_PERFIL: Record<string, string> = {
  cs: "CS",
  suporte: "Suporte",
  hardware: "Hardware",
  comercial: "Comercial",
};

function normalizar(valor: string | undefined): string {
  return (valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

export function podeEditarOcorrencia(
  role: string,
  cargo: string,
  ocorrencia: Pick<Ocorrencia, "departamento">,
): boolean {
  const perfil = normalizar(role);
  if (perfil === "master" || perfil === "treinador") return true;
  if (normalizar(cargo) !== "supervisor") return false;

  const departamento = DEPARTAMENTO_POR_PERFIL[perfil];
  return (
    !!departamento &&
    normalizar(ocorrencia.departamento) === normalizar(departamento)
  );
}
