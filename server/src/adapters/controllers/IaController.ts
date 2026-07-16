import { Request, Response } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../../infrastructure/config/env.js';

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

      const genAI = new GoogleGenerativeAI(config.geminiApiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

      const ocorrenciasFormatadas = formatarOcorrenciasParaPrompt(ocorrencias);

      const prompt = `Você é um analista de Customer Success especialista em relacionamento com clientes de software de gestão de frota.

Analise o histórico de ocorrências abaixo do cliente "${nomeCliente}" e gere um resumo executivo em português contendo:

**1. Visão Geral** – quantidade total de ocorrências, período coberto e tipos predominantes
**2. Alertas e Problemas** – alertas ativos ou resolvidos e padrões de problema identificados
**3. Progresso de Treinamento** – temas treinados, evolução e notas médias quando disponíveis
**4. Pontos de Atenção** – riscos ou padrões negativos que merecem acompanhamento
**5. Resumo Final** – diagnóstico geral do relacionamento com o cliente em 2 a 3 frases

Regras:
- Seja objetivo e use linguagem profissional
- Foque em insights acionáveis para o time de CS
- Se não houver dados suficientes para algum ponto, indique isso brevemente
- Use marcadores e listas para facilitar a leitura

TOTAL DE OCORRÊNCIAS: ${ocorrencias.length}

OCORRÊNCIAS:
${ocorrenciasFormatadas}`;

      const result = await model.generateContent(prompt);
      const resumo = result.response.text();

      res.status(200).json({ resumo });
    } catch (error: any) {
      const detalhe = error?.message || String(error);
      const status = error?.status || error?.httpStatusCode || 500;
      console.error('[IaController] Erro ao gerar resumo:', detalhe);
      res.status(500).json({
        error: 'Erro ao gerar resumo com IA.',
        details: detalhe,
        geminiStatus: status,
      });
    }
  }
}
