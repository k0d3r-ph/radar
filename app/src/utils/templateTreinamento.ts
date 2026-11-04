export function montarTemplateTreinamento(participantes?: string): string {
  return `Participantes: ${participantes ?? ""}\n\nNOTA: \n\nRelatório de treinamento:\n\n• Cliente se manteve atento? \n• Cliente absorveu o conteúdo aplicado?\n• Cliente foi participativo?\n• Houve alguma interrupção?\n• Ambiente favorável (Som)?\n• Manifestou alguma insatisfação?\n• Treinamento foi gravado?\n\nRelatório do atendimento:`;
}

export const TEMPLATE_TREINAMENTO = montarTemplateTreinamento();
