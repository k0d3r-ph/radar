import type { Request, Response } from 'express';
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { buscarDadosCentral, buscarIdCentralPorNome } from '../../infrastructure/planilha/PlanilhaCentraisService.js';

export class CentraisController {
  private readonly usuarios = new Map<string, { permitido: boolean; expiraEm: number }>();

  constructor(
    private readonly db: Firestore | null,
    private readonly auth: Auth | null,
    private readonly consultarDados = buscarDadosCentral,
  ) {}

  async buscarDados(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'no-store');
    if (!this.db || !this.auth) { res.status(503).json({ error: 'Consulta à planilha indisponível.' }); return; }
    const token = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) { res.status(401).json({ error: 'Entre no Radar para consultar a planilha.' }); return; }
    let uid: string;
    try { uid = (await this.auth.verifyIdToken(token, true)).uid; }
    catch { res.status(401).json({ error: 'Sessão expirada. Entre novamente no Radar.' }); return; }

    try {
      let usuario = this.usuarios.get(uid);
      if (!usuario || usuario.expiraEm <= Date.now()) {
        const cadastro = (await this.db.collection('usuarios').doc(uid).get()).data();
        usuario = { permitido: !!cadastro && !cadastro.inativo && !cadastro.needsPasswordChange
          && ['master', 'treinador'].includes(cadastro.role), expiraEm: Date.now() + 60_000 };
        this.usuarios.set(uid, usuario);
      }
      if (!usuario.permitido) { res.status(403).json({ error: 'Apenas treinadores e masters podem consultar os dados de contrato da planilha.' }); return; }
      const nomeEmpresa = typeof req.query.nome === 'string' ? req.query.nome.trim() : '';
      const idCentral = typeof req.query.idCentral === 'string' ? req.query.idCentral.trim() : '';
      if (!nomeEmpresa || nomeEmpresa.length > 300 || idCentral.length > 100) {
        res.status(400).json({ error: 'Informe um nome de cliente válido.' }); return;
      }
      const central = await this.consultarDados({ nomeEmpresa, idCentral });
      res.status(200).json({ central });
    } catch {
      console.error('[Centrais] Falha ao consultar dados de contrato na planilha.');
      res.status(502).json({ error: 'Não foi possível consultar a planilha do CS. Tente novamente ou preencha os dados manualmente.' });
    }
  }

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
