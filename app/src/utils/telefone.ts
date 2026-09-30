/**
 * Utilitário único de normalização de telefones para o WhatsApp.
 *
 * O usuário cadastra o contato como preferir — "(11) 99999-9999", "11999999999"
 * ou já com o DDI — e o Radar se encarrega de acrescentar o "+55" antes do envio.
 *
 * Toda a aplicação (cadastro de clientes, notificações de gestão e disparo da
 * esteira) deve usar estas funções, para que a regra não divirja entre telas.
 */

import type { ContatoCliente, Empresa } from "../types";

const DDI_BRASIL = "55";

/** Recupera também números separados no antigo campo único, sem concatená-los. */
export function obterTelefonesContato(contato: ContatoCliente): string[] {
  const entradas = contato.telefones ?? [contato.telefone];
  return entradas.flatMap((telefone) =>
    telefone.split(/[,;|/\n\r]+|\s+e\s+/i).map((numero) => numero.trim()),
  ).filter(Boolean);
}

export function normalizarContatoCliente(contato: ContatoCliente): ContatoCliente {
  const telefones = [...new Set(obterTelefonesContato(contato).map((telefone) =>
    normalizarTelefoneWhatsApp(telefone) || telefone,
  ))];
  return { ...contato, nome: contato.nome.trim(), telefone: telefones[0] || "", telefones };
}

/** Um destinatário por número, inclusive no reenvio, sem duplicar mensagens. */
export function obterDestinatariosCliente(empresa: Pick<Empresa, "contatos" | "contato" | "telefone">) {
  const contatos = empresa.contatos?.length
    ? empresa.contatos
    : [{ nome: empresa.contato || "", telefone: empresa.telefone || "" }];
  const vistos = new Set<string>();
  return contatos.flatMap((contato) => obterTelefonesContato(contato).flatMap((numero) => {
    const telefone = normalizarTelefoneWhatsApp(numero);
    if (!telefone || vistos.has(telefone)) return [];
    vistos.add(telefone);
    return [{ nome: contato.nome.trim() || "Cliente", telefone }];
  }));
}

export type ResultadoTelefone = {
  /** Número pronto para o WhatsApp, apenas dígitos e com DDI (ex: 5511999999999). */
  normalizado: string;
  valido: boolean;
  /** Mensagem explicando por que o número não pôde ser normalizado. */
  erro?: string;
};

/**
 * Normaliza um telefone brasileiro para o formato aceito pelo WhatsApp, validando
 * o resultado. Aceita DDD + número (10 ou 11 dígitos), número já com DDI 55
 * (12 ou 13 dígitos) e DDD prefixado com zero (ex: "011 99999-9999").
 */
export function analisarTelefoneWhatsApp(telefone?: string | null): ResultadoTelefone {
  if (!telefone || !telefone.trim()) {
    return { normalizado: "", valido: false, erro: "Telefone não informado." };
  }

  if (!/^[+\d\s().-]+$/.test(telefone)) {
    return { normalizado: "", valido: false, erro: "Informe um número por campo. Use Adicionar número para incluir outro telefone." };
  }

  let digitos = telefone.replace(/\D/g, "");
  if (!digitos) {
    return { normalizado: "", valido: false, erro: "Telefone sem dígitos." };
  }

  // DDD escrito com zero à frente ("011 99999-9999"): o zero não faz parte do número.
  digitos = digitos.replace(/^0+/, "");

  // DDD + número, sem DDI. Verificado antes do prefixo 55 porque o DDD 55
  // (Santa Maria/RS) tornaria a checagem por prefixo ambígua.
  if (digitos.length === 10 || digitos.length === 11) {
    return { normalizado: DDI_BRASIL + digitos, valido: true };
  }

  // Número que já veio com o DDI brasileiro.
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith(DDI_BRASIL)) {
    return { normalizado: digitos, valido: true };
  }

  if (digitos.length < 10) {
    return {
      normalizado: "",
      valido: false,
      erro: "Número incompleto — informe o DDD seguido do número.",
    };
  }

  return {
    normalizado: "",
    valido: false,
    erro: "Número não reconhecido como um telefone brasileiro válido.",
  };
}

/**
 * Versão curta de {@link analisarTelefoneWhatsApp}: devolve o número pronto para
 * envio ou string vazia quando ele não é válido.
 */
export function normalizarTelefoneWhatsApp(telefone?: string | null): string {
  return analisarTelefoneWhatsApp(telefone).normalizado;
}

/**
 * Formata um número normalizado para leitura humana: "+55 (11) 99999-9999".
 * Recebe qualquer entrada e devolve string vazia se ela não for válida.
 */
export function formatarTelefoneExibicao(telefone?: string | null): string {
  const { normalizado, valido } = analisarTelefoneWhatsApp(telefone);
  if (!valido) return "";

  const semDdi = normalizado.slice(DDI_BRASIL.length);
  const ddd = semDdi.slice(0, 2);
  const numero = semDdi.slice(2);
  const prefixo = numero.length === 9 ? numero.slice(0, 5) : numero.slice(0, 4);
  const sufixo = numero.slice(prefixo.length);

  return `+${DDI_BRASIL} (${ddd}) ${prefixo}-${sufixo}`;
}
