import { auth } from './firebase';
import { RADAR_API_URL } from './apiConfig';
import { invalidarCacheEmpresas } from './empresas';
import { invalidarCacheOcorrencias } from './ocorrencias';
import { invalidarCacheGamificacao } from './gamificacao';
import { isSolicitanteTreinamento } from '../../../server/src/domain/validacaoConhecimento';
import type { IndicadoresValidacao, PerguntaConhecimento, Secao, TentativaValidacao } from '../../../server/src/domain/validacaoConhecimento';

async function requisicao<T>(path: string, body?: unknown): Promise<T> {
  if (!auth.currentUser) throw new Error('Entre novamente no Radar.');
  const token = await auth.currentUser.getIdToken();
  let response: Response;
  try {
    response = await fetch(`${RADAR_API_URL}/api/validacao/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
    });
  } catch { throw new Error('Não foi possível conectar à API da validação. Confira sua conexão e tente novamente; as respostas desta tela foram preservadas.'); }
  const dados = await response.json().catch(() => { throw new Error('A API retornou uma resposta inválida. Confira se o backend está atualizado.'); });
  if (!response.ok) throw new Error(dados.error || 'Não foi possível realizar a operação.');
  return dados as T;
}
export const listarPerguntasConhecimento = () => requisicao<PerguntaConhecimento[]>('perguntas');
export const cadastrarPerguntaConhecimento = (secao: Secao, texto: string, preferida: boolean) => requisicao<PerguntaConhecimento>('perguntas', { secao, texto, preferida });
export const atualizarPerguntaConhecimento = (id: string, dados: { texto?: string; preferida?: boolean; ativa?: boolean }) =>
  requisicao<PerguntaConhecimento>(`perguntas/${encodeURIComponent(id)}/atualizar`, dados);
export const indicadoresConhecimento = (inicio: string, fim: string) =>
  requisicao<IndicadoresValidacao & { inicio: string; fim: string }>(`indicadores?inicio=${encodeURIComponent(inicio)}&fim=${encodeURIComponent(fim)}`);
export const listarTentativasConhecimento = (empresaId: string) => requisicao<TentativaValidacao[]>(`tentativas?empresaId=${encodeURIComponent(empresaId)}`);
export const iniciarTentativaConhecimento = (empresaId: string, manutencao: 'basica' | 'avancada', anteriorId?: string) => requisicao<TentativaValidacao>('tentativas', { empresaId, manutencao, anteriorId });
export const cancelarTentativaConhecimento = (t: TentativaValidacao) => requisicao<{ id: string }>(`tentativas/${t.id}/cancelar`, { revisao: t.revisao });
export const salvarTentativaConhecimento = (t: TentativaValidacao, status: 'andamento' | 'pausada') => requisicao<TentativaValidacao>(`tentativas/${t.id}/salvar`, {
  revisao: t.revisao, status, questoes: t.questoes, treinamentoDataSolicitacao: t.treinamentoDataSolicitacao, treinamentoTempoAgenda: t.treinamentoTempoAgenda, // Rascunhos antigos guardavam texto livre; só as opções padrão são aceitas.
  treinamentoSolicitante: isSolicitanteTreinamento(t.treinamentoSolicitante) ? t.treinamentoSolicitante : '',
});
export async function concluirTentativaConhecimento(t: TentativaValidacao, impressoesAgenda = ''): Promise<TentativaValidacao> {
  const concluida = await requisicao<TentativaValidacao>(`tentativas/${t.id}/concluir`, { revisao: t.revisao, impressoesAgenda });
  invalidarCacheEmpresas(); invalidarCacheOcorrencias(); invalidarCacheGamificacao();
  return concluida;
}
