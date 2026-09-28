import { Request, Response } from 'express';
import { buscarIdCentralPorNome } from '../../infrastructure/planilha/PlanilhaCentraisService.js';

export class CentraisController {
  async buscarIdCentral(req: Request, res: Response): Promise<void> {
    try {
      const nome = String(req.query.nome || '').trim();
      if (!nome) {
        res.status(400).json({ error: 'Parâmetro "nome" é obrigatório.' });
        return;
      }

      const idCentral = await buscarIdCentralPorNome(nome);
      res.status(200).json({ idCentral });
    } catch (error: any) {
      const detalhe = error?.message || String(error);
      console.error('[CentraisController] Erro ao buscar idCentral:', detalhe);
      res.status(500).json({ error: 'Erro ao consultar a planilha de centrais.', details: detalhe });
    }
  }
}
