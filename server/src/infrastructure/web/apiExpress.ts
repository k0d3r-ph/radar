import express from 'express';
import { criarAppBase } from './expressBase.js';
import { registrarCsat } from './csat.js';
import { IaController } from '../../adapters/controllers/IaController.js';
import { CentraisController } from '../../adapters/controllers/CentraisController.js';
import { OcorrenciasController } from '../../adapters/controllers/OcorrenciasController.js';
import { GamificacaoController } from '../../adapters/controllers/GamificacaoController.js';
import { ChecklistController } from '../../adapters/controllers/ChecklistController.js';
import { SincronizacaoController } from '../../adapters/controllers/SincronizacaoController.js';
import { FirestoreUsuariosRepository } from '../firebase/UsuariosRepository.js';
import { adminAuth, adminDb } from '../firebase/firebaseAdmin.js';
import { ValidacaoConhecimentoController } from '../../adapters/controllers/ValidacaoConhecimentoController.js';
import { IndiceSincronizacao } from '../firebase/IndiceSincronizacao.js';
import { SincronizarTarefasAutomaticas } from '../../application/use-cases/SincronizarTarefasAutomaticas.js';
import { LimparTarefasConcluidas } from '../../application/use-cases/LimparTarefasConcluidas.js';
import { ProfilePhotosController } from '../../adapters/controllers/ProfilePhotosController.js';
import { config } from '../config/env.js';

const profilePhotoParser = express.raw({
  type: ['image/jpeg', 'image/png', 'image/webp'],
  limit: '2mb',
});

const parseProfilePhoto: express.RequestHandler = (req, res, next) => {
  profilePhotoParser(req, res, (error) => {
    if (!error) {
      next();
      return;
    }
    const tipo = typeof error === 'object' && error !== null && 'type' in error ? error.type : undefined;
    if (tipo === 'entity.too.large') {
      res.status(413).json({ error: 'A imagem deve ter até 2 MB.' });
      return;
    }
    console.error('[Fotos de perfil] Requisição de imagem inválida.');
    res.status(400).json({ error: 'Não foi possível ler a imagem enviada.' });
  });
};

/** Dia da semana (abreviado em inglês, ex.: "Fri") e hora cheia (0–23) no horário de Brasília. */
function diaEHoraBrasilia(agora: number): { dia: string; hora: number } {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', hour12: false,
  }).formatToParts(agora);
  const dia = partes.find(p => p.type === 'weekday')?.value || '';
  const hora = Number(partes.find(p => p.type === 'hour')?.value || '0') % 24;
  return { dia, hora };
}

function diaBrasiliaISO(agora: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(agora);
}

/**
 * Processo leve: CSAT, ocorrências, sincronização, IA e Centrais. Não inicializa
 * o cliente do WhatsApp (Puppeteer/Chromium) — fica isolado no processo do bot
 * (ver index.ts) para não disputar CPU/memória com estas rotas.
 */
export function createApiApp({ tarefasAutomaticas = false }: { tarefasAutomaticas?: boolean } = {}): express.Express {
  const app = criarAppBase();

  const usuariosRepo = adminDb ? new FirestoreUsuariosRepository(adminDb) : null;

  const profilePhotosController = new ProfilePhotosController(adminAuth, config.profilePhotosDir);
  app.get('/api/profile-photos', (req, res) => profilePhotosController.listar(req, res));
  app.get('/api/profile-photos/:uid', (req, res) => profilePhotosController.obter(req, res));
  app.put(
    '/api/profile-photos/:uid',
    parseProfilePhoto,
    (req, res) => profilePhotosController.enviar(req, res),
  );
  app.delete('/api/profile-photos/:uid', (req, res) => profilePhotosController.remover(req, res));

  registrarCsat(app, adminDb, adminAuth);
  const validacao = new ValidacaoConhecimentoController(adminDb, adminAuth);
  app.get('/api/validacao/perguntas', validacao.executar('perguntas'));
  app.post('/api/validacao/perguntas', validacao.executar('adicionar'));
  app.post('/api/validacao/perguntas/:id/atualizar', validacao.executar('atualizarPergunta'));
  app.get('/api/validacao/indicadores', validacao.executar('indicadores'));
  app.get('/api/validacao/tentativas', validacao.executar('listar'));
  app.post('/api/validacao/tentativas', validacao.executar('iniciar'));
  app.post('/api/validacao/tentativas/:id/salvar', validacao.executar('salvar'));
  app.post('/api/validacao/tentativas/:id/concluir', validacao.executar('concluir'));
  app.post('/api/validacao/tentativas/:id/cancelar', validacao.executar('cancelar'));
  const ocorrenciasController = new OcorrenciasController(adminDb, adminAuth, usuariosRepo);
  const gamificacaoController = new GamificacaoController(adminDb, adminAuth, usuariosRepo);
  const checklistController = new ChecklistController(adminDb, adminAuth, usuariosRepo);
  app.delete('/api/checklist/tarefas/:id/concluida', (req, res) => checklistController.excluirConcluida(req, res));
  app.delete('/api/gamificacao/pontos/:id/excedente', (req, res) => gamificacaoController.removerPontoExcedente(req, res));
  app.patch('/api/ocorrencias/:id/favorito', (req, res) => ocorrenciasController.definirFavorita(req, res));
  app.post('/api/ocorrencias/:id/atualizacoes', (req, res) => ocorrenciasController.adicionarAtualizacaoValidacao(req, res));
  const indice = adminDb ? new IndiceSincronizacao(adminDb) : null;
  if (tarefasAutomaticas && adminDb && indice) {
    const tarefas = new SincronizarTarefasAutomaticas(adminDb, indice);
    const atualizar = () => tarefas.execute().catch(() => console.error('[Tarefas automáticas] Não foi possível atualizar as tarefas. Nova tentativa em um minuto.'));
    const timer = setInterval(atualizar, 60_000);
    timer.unref();
    app.locals.encerrarTarefasAutomaticas = () => { clearInterval(timer); indice.encerrar(); };
    void atualizar();

    // Toda sexta-feira às 19h (horário de Brasília), limpa as tarefas concluídas em massa.
    // Marcador em `integracoes/limpezaTarefasConcluidas` evita repetir no mesmo dia após reinícios.
    const dbLimpeza = adminDb;
    const limpeza = new LimparTarefasConcluidas(dbLimpeza);
    const verificarLimpezaSemanal = async () => {
      const agora = Date.now();
      const { dia, hora } = diaEHoraBrasilia(agora);
      if (dia !== 'Fri' || hora !== 19) return;
      const ref = dbLimpeza.doc('integracoes/limpezaTarefasConcluidas');
      const hoje = diaBrasiliaISO(agora);
      try {
        const snapshot = await ref.get();
        if (snapshot.data()?.ultimaExecucao === hoje) return;
        const removidas = await limpeza.execute(agora);
        await ref.set({ ultimaExecucao: hoje, executadoEm: agora, removidas }, { merge: true });
        console.log(`[Limpeza de tarefas] ${removidas} tarefa(s) concluída(s) removida(s) automaticamente (sexta 19h).`);
      } catch (erro) {
        console.error('[Limpeza de tarefas] Falha ao limpar tarefas concluídas:', erro instanceof Error ? erro.message : 'erro desconhecido');
      }
    };
    const timerLimpeza = setInterval(() => void verificarLimpezaSemanal(), 60_000);
    timerLimpeza.unref();
  }
  const sincronizacaoController = new SincronizacaoController(adminDb, adminAuth, usuariosRepo, indice);
  app.get('/api/sincronizacao/:colecao', (req, res) => sincronizacaoController.listar(req, res));

  const iaController = new IaController();
  app.post('/api/ia/resumir', (req, res) => iaController.resumir(req, res));

  const centraisController = new CentraisController(usuariosRepo, adminAuth);
  app.get('/api/centrais/id-central', (req, res) => centraisController.buscarIdCentral(req, res));
  app.get('/api/centrais/dados', (req, res) => centraisController.buscarDados(req, res));

  return app;
}
