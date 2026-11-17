import { calcularResultadoValidacao } from '../../domain/validacaoConhecimento.js';
import type { QuestaoValidacao, RespostaValidacao, Secao } from '../../domain/validacaoConhecimento.js';

const ROTULO: Record<RespostaValidacao, string> = { correto: 'Correto', parcial: 'Parcial', incorreto: 'Incorreto' };
const NIVEL: Record<RespostaValidacao, number> = { incorreto: 0, parcial: 1, correto: 2 };
const formatar = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

export interface DadosAnaliseValidacao { empresa: string; numero: number; questoes: QuestaoValidacao[] }

/**
 * Indicadores calculados no servidor (não pela IA), para que contagens e percentuais
 * do texto sejam sempre exatos.
 */
export function resumirDesempenhoValidacao(questoes: QuestaoValidacao[]) {
  const resultado = calcularResultadoValidacao(questoes);
  const comParcial = questoes.filter(q => q.respostaParcial && q.resposta);
  const evolucao = (sinal: number) => comParcial.filter(q => Math.sign(NIVEL[q.resposta!] - NIVEL[q.respostaParcial!]) === sinal).length;
  const secoes = new Map<Secao, { final: number; parcial: number; nParcial: number; n: number }>();
  for (const q of questoes) {
    const s = secoes.get(q.secao) || { final: 0, parcial: 0, nParcial: 0, n: 0 };
    s.final += NIVEL[q.resposta!]; s.n++;
    if (q.respostaParcial) { s.parcial += NIVEL[q.respostaParcial]; s.nParcial++; }
    secoes.set(q.secao, s);
  }
  return {
    ...resultado,
    totalPerguntas: questoes.length,
    comParcial: comParcial.length,
    evoluiram: evolucao(1), mantiveram: evolucao(0), regrediram: evolucao(-1),
    porSecao: [...secoes].map(([secao, s]) => ({
      secao, perguntas: s.n,
      aproveitamentoFinal: 100 * s.final / (2 * s.n),
      aproveitamentoParcial: s.nParcial ? 100 * s.parcial / (2 * s.nParcial) : null,
      perguntasComParcial: s.nParcial,
    })),
  };
}

export function montarPromptAnaliseValidacao({ empresa, numero, questoes }: DadosAnaliseValidacao): string {
  const r = resumirDesempenhoValidacao(questoes);
  const linhasPerguntas = questoes.map((q, i) => `${i + 1}. [${q.secao}] ${q.texto.slice(0, 400)}\n   Parcial: ${q.respostaParcial ? ROTULO[q.respostaParcial] : 'não marcada'} | Final: ${ROTULO[q.resposta!]}`).join('\n');
  const linhasSecoes = r.porSecao.map(s => `- ${s.secao}: ${s.perguntas} pergunta(s); aproveitamento final ${formatar(s.aproveitamentoFinal)}%`
    + (s.aproveitamentoParcial === null ? '; sem validação parcial' : `; aproveitamento na validação parcial ${formatar(s.aproveitamentoParcial)}% (${s.perguntasComParcial} pergunta(s) marcada(s))`)).join('\n');
  const parcial = r.comParcial
    ? `Validação parcial feita em ${r.comParcial} de ${r.totalPerguntas} perguntas: ${r.evoluiram} evoluíram, ${r.mantiveram} mantiveram e ${r.regrediram} regrediram na validação final.`
    : 'A validação parcial não foi feita nesta tentativa; analise apenas a validação final.';

  return `Você é um especialista em treinamento de clientes de um software de gestão de frota. Escreva a análise de desempenho do cliente "${empresa}" na validação do conhecimento (tentativa ${numero}). O texto será gravado na ocorrência de treinamento e lido pelo treinador, pelo CS e pela gestão.

Contexto: a validação parcial é marcada no início de uma agenda, sobre os temas do último treinamento, e não entra na nota. A validação final é a que define a nota. Comparar as duas mostra o que o cliente reteve, o que aprendeu durante o treinamento e o que ainda precisa de reforço.

DADOS CALCULADOS (use exatamente estes números, não recalcule):
- Pontuação final: ${formatar(r.nota)}/10 | Aproveitamento: ${formatar(r.percentual)}% | ${r.aprovada ? 'Aprovado (mínimo de 80%)' : 'Não aprovado (mínimo de 80%)'}
- ${parcial}
Por seção:
${linhasSecoes}

PERGUNTAS:
${linhasPerguntas}

Formato obrigatório (texto simples, SEM markdown: não use #, *, ** nem negrito; use "- " no início dos itens):
Desempenho geral: 1 ou 2 frases com o resultado e o nível de domínio.
${r.comParcial ? 'Evolução entre a validação parcial e a final: 1 a 3 itens, citando os temas que evoluíram e os que regrediram ou permaneceram com dificuldade.\n' : ''}Pontos fortes: 1 a 3 itens, por tema/seção.
Pontos de atenção: 1 a 3 itens, por tema/seção, citando o assunto das perguntas com Parcial ou Incorreto. Omita esta seção se tudo estiver Correto.
${r.aprovada ? '' : 'Recomendação: 1 frase com o próximo passo do treinamento.\n'}
Regras:
${r.aprovada ? '- O cliente atingiu o mínimo de 80% e foi aprovado: não escreva recomendação, próximo passo nem sugestão de novo treinamento\n' : ''}- Português do Brasil, tom profissional, objetivo e respeitoso com o cliente
- No máximo 1.200 caracteres no total
- Não invente fatos além dos dados acima e não repita a lista de perguntas na íntegra`;
}

/** Remove marcações de markdown que a IA eventualmente devolva e limita o tamanho. */
export function limparTextoAnalise(texto: string, limite: number): string {
  const limpo = texto
    .replace(/\r\n/g, '\n')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^\s*[*•]\s+/gm, '- ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (limpo.length <= limite) return limpo;
  const cortado = limpo.slice(0, limite);
  const fimLinha = cortado.lastIndexOf('\n');
  return (fimLinha > limite / 2 ? cortado.slice(0, fimLinha) : cortado).trim();
}
