import { Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import { config } from '../../infrastructure/config/env.js';

const GEMINI_MODEL = 'gemini-3.6-flash';
const STREAM_ERROR_MARKER = '[[ERRO_IA]]';

function formatarOcorrenciasParaPrompt(ocorrencias: any[]): string {
  if (!ocorrencias || ocorrencias.length === 0) return 'Nenhuma ocorrência encontrada.';

  return ocorrencias
    .map((o, idx) => {
      const data = o.dataOcorrencia
        ? new Date(o.dataOcorrencia).toLocaleDateString('pt-BR')
        : 'data desconhecida';
      const linhas = [
        `[${idx + 1}] Data: ${data} | Tipo: ${o.tipo || '—'} | Departamento: ${o.departamento || '—'}`,
        `    Responsável: ${o.responsavel || '—'}`,
        `    Descrição: ${(o.descricao || '').slice(0, 300)}`,
      ];
      if (o.alerta) linhas.push('    ⚠️ MARCADA COMO ALERTA');
      if (o.retirarAlerta) linhas.push('    ✅ ALERTA RESOLVIDO');
      if (o.temaOcorrencia?.length) linhas.push(`    Temas: ${o.temaOcorrencia.join(', ')}`);
      if (o.treinamentoNotaMedia) linhas.push(`    Nota média do treinamento: ${o.treinamentoNotaMedia}`);
      if (o.atualizacoes?.length) {
        linhas.push(`    Atualizações (${o.atualizacoes.length}):`);
        o.atualizacoes.slice(0, 3).forEach((a: any) => {
          linhas.push(`      - ${(a.descricao || '').slice(0, 150)}`);
        });
      }
      return linhas.join('\n');
    })
    .join('\n\n');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function* gerarStreamComRetry(ai: GoogleGenAI, prompt: string, tentativas = 3): AsyncGenerator<string> {
  let ultimoErro: any;
  for (let i = 0; i < tentativas; i++) {
    let algumTrechoEmitido = false;
    try {
      const stream = await ai.models.generateContentStream({
        model: GEMINI_MODEL,
        contents: prompt,
      });
      for await (const chunk of stream) {
        algumTrechoEmitido = true;
        yield chunk.text ?? '';
      }
      return;
    } catch (error: any) {
      ultimoErro = error;
      const status = error?.status || error?.httpStatusCode;
      const isOverload = status === 503 || status === 429;
      // Já enviamos parte do texto ao cliente: não dá para reiniciar sem duplicar conteúdo.
      if (algumTrechoEmitido || !isOverload || i === tentativas - 1) throw error;
      await delay(1000 * (i + 1));
    }
  }
  throw ultimoErro;
}

export class IaController {
  async resumir(req: Request, res: Response): Promise<void> {
    try {
      const { ocorrencias, nomeCliente } = req.body as {
        ocorrencias: any[];
        nomeCliente: string;
      };

      if (!nomeCliente || !Array.isArray(ocorrencias)) {
        res.status(400).json({ error: 'Parâmetros inválidos: nomeCliente e ocorrencias são obrigatórios.' });
        return;
      }

      if (!config.geminiApiKey) {
        res.status(500).json({ error: 'Chave da API Gemini não configurada no servidor. Adicione GEMINI_API_KEY ao .env' });
        return;
      }

      const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

      // Ordenar por data decrescente (mais recente primeiro) e pegar as últimas 15
      const ocorrenciasRecentes = [...ocorrencias]
        .sort((a, b) => {
          const timeA = a.dataOcorrencia || a.createdAt || 0;
          const timeB = b.dataOcorrencia || b.createdAt || 0;
          return timeB - timeA;
        })
        .slice(0, 15)
        .reverse(); // Coloca em ordem cronológica (mais antiga para mais recente)

      const ocorrenciasFormatadas = formatarOcorrenciasParaPrompt(ocorrenciasRecentes);

      const prompt = `Você é um analista que apoia a gestão multidisciplinar de clientes de um software de gestão de frota, analisando o cliente "${nomeCliente}" para gestores de várias áreas que têm pouco tempo de leitura.

As áreas envolvidas na operação são: CS, Treinamento, Suporte, Comercial e Hardware. Cada uma pode precisar agir de forma diferente sobre o mesmo cliente.

Gere um resumo curto, direto e "escaneável" em até 30 segundos de leitura. Use SOMENTE bullets de 1 linha (sem parágrafos longos, sem introduções). Priorize o que exige decisão ou ação de alguma área.

Estrutura obrigatória (use "###" para os títulos, nesta ordem, omitindo seções sem conteúdo relevante):

### 📊 Panorama
2 a 3 bullets: status geral do relacionamento (Saudável / Atenção / Crítico), total de ocorrências, período coberto, tipo predominante.

### 🚨 Riscos e Problemas
Só inclua se houver algo relevante. 1 bullet por risco: alertas ativos, cancelamentos/ausências recorrentes, reclamações, chamados de suporte recorrentes, SLA estourado.

### 🎓 Treinamento
1 a 2 bullets: temas cobertos, notas/CSAT (se houver), evolução.

### ✅ Ações Recomendadas por Área
2 a 6 bullets no total, cobrindo TODAS as áreas relevantes para este cliente (não apenas CS). Cada bullet segue o formato "[Área] Verbo de ação + ação concreta e executável", por exemplo:
- "[CS] Agendar retorno esta semana para resolver X"
- "[Treinamento] Reforçar o tema Y, que teve nota baixa/foi cancelado repetidamente"
- "[Suporte] Investigar causa raiz dos chamados recorrentes sobre Z"
- "[Comercial] Avaliar risco de churn e acionar retenção"
- "[Hardware] Verificar rastreador/equipamento reportado com falha"
Só sugira ação para uma área se houver evidência nas ocorrências que a justifique. Se nenhuma área precisar agir, escreva um único bullet: "Nenhuma ação necessária, manter cadência atual".

### 🎯 Veredito
1 frase final com o diagnóstico geral e o nível de urgência.

Regras:
- Português, tom profissional e direto
- Nunca repita a mesma informação em duas seções
- Se faltar dado para algum ponto, omita-o silenciosamente (não diga "não há dados")
- Máximo de 16 bullets no total

TOTAL DE OCORRÊNCIAS DO CLIENTE: ${ocorrencias.length} (analisando as ${ocorrenciasRecentes.length} mais recentes)

OCORRÊNCIAS ANALISADAS:
${ocorrenciasFormatadas}`;

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      // Sem efeito hoje (não há proxy na frente), mas evita buffering se um dia entrar um Nginx/Cloudflare.
      res.setHeader('X-Accel-Buffering', 'no');
      res.status(200);

      try {
        for await (const trecho of gerarStreamComRetry(ai, prompt)) {
          res.write(trecho);
        }
        res.end();
      } catch (error: any) {
        console.error('[IaController] Erro ao gerar resumo (stream):', error?.message || error);
        res.write(`\n\n${STREAM_ERROR_MARKER}`);
        res.end();
      }
    } catch (error: any) {
      const detalhe = error?.message || String(error);
      console.error('[IaController] Erro ao gerar resumo:', detalhe);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Erro ao gerar resumo com IA.', details: detalhe });
      } else {
        res.end();
      }
    }
  }
}
