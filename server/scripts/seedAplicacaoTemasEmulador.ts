import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

/**
 * Cliente de exemplo para a tabela e o gráfico "Aplicação dos temas na base" da
 * Esteira: treinamentos realizados em dias passados (alguns com mais de um tema no
 * mesmo dia), D-N já marcados com variação entre os temas, um treinamento recente
 * ainda sem marcação, um agendamento futuro e temas ainda não ensinados.
 * Repetir o comando regrava só estes registros, com datas relativas ao dia atual.
 */

// Hosts literais locais: este script não carrega .env nem credenciais de produção.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.METADATA_SERVER_DETECTION = 'none';

const PREFIXO = 'demo-aplicacao-';
const NOME = '[Demo Aplicação] Central Exemplo';

/** Dias atrás (negativo = passado), com o dia D-N em que o cliente aplicou (ou null). */
const TREINAMENTOS: { dias: number; temas: string[]; aplicouEm: number | null }[] = [
  { dias: -40, temas: ['Início', 'Cadastro de Gateway', 'Debug'], aplicouEm: 2 },
  { dias: -37, temas: ['Cadastro de Rastreador'], aplicouEm: 5 },
  { dias: -34, temas: ['Cadastro de Veículo', 'Cadastro de Cliente'], aplicouEm: 1 },
  { dias: -30, temas: ['Tela Operacional'], aplicouEm: 9 },
  // Sem marcação entre dias marcados: aparece em vermelho no eixo X do gráfico.
  { dias: -26, temas: ['Pessoas'], aplicouEm: null },
  { dias: -21, temas: ['SSX Mobile'], aplicouEm: 14 },
  { dias: -16, temas: ['Regras'], aplicouEm: 6 },
  { dias: -3, temas: ['Relatório'], aplicouEm: null },
];
const AGENDADO = { dias: 4, temas: ['Validação do conhecimento'] };
const ESTEIRA = [
  'Início', 'Cadastro de Gateway', 'Debug', 'Cadastro de Rastreador', 'Cadastro de Veículo',
  'Cadastro de Cliente', 'Tela Operacional', 'Pessoas', 'SSX Mobile', 'Regras', 'Relatório',
  'Validação do conhecimento',
];

const app = initializeApp({ projectId: 'automatiza-esteira' });
const db = getFirestore(app);

function diaRelativo(dias: number): Date {
  const data = new Date();
  data.setHours(10, 0, 0, 0);
  data.setDate(data.getDate() + dias);
  return data;
}
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ddmm = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

try {
  await fetch('http://127.0.0.1:8080/', { signal: AbortSignal.timeout(3_000) });
  const usuarios = await db.collection('usuarios').where('role', '==', 'treinador').limit(1).get();
  const treinador = (usuarios.docs[0]?.data().nome as string | undefined) ?? 'Treinador Demo';
  const agora = Date.now();

  // Data planejada de cada tema da esteira = dia do treinamento que o cobre.
  const dataPorTema = new Map<string, string>();
  [...TREINAMENTOS, AGENDADO].forEach((t) => t.temas.forEach((tema) => dataPorTema.set(tema, ddmm(diaRelativo(t.dias)))));
  // Temas ensinados no mesmo treinamento formam um bloco ("1" = mesmo dia do próximo).
  const blocoText = ESTEIRA.map((tema, i) => {
    const proximo = ESTEIRA[i + 1];
    return proximo && [...TREINAMENTOS, AGENDADO].some((t) => t.temas.includes(tema) && t.temas.includes(proximo)) ? '1' : '';
  }).join('\n');

  const aplicacaoTemasDias = Object.fromEntries(
    TREINAMENTOS.filter((t) => t.aplicouEm !== null).map((t) => [iso(diaRelativo(t.dias)), t.aplicouEm]),
  );

  const batch = db.batch();
  batch.set(db.collection('empresas').doc(`${PREFIXO}central`), {
    nomeEmpresa: NOME,
    responsavel: treinador,
    tipo: '',
    dataEntrada: iso(diaRelativo(-42)),
    temaText: ESTEIRA.join('\n'),
    dataText: ESTEIRA.map((tema) => dataPorTema.get(tema) ?? '').join('\n'),
    blocoText,
    reagendamentosText: ESTEIRA.map(() => '0').join('\n'),
    currentPhase: ESTEIRA.indexOf('Relatório'),
    cadenciaDiasTreinamento: 2,
    aplicacaoTemasDias,
    updatedAt: agora,
  });

  const ocorrencia = (chave: string, dias: number, temas: string[], descricao: string, extras: Record<string, unknown> = {}) => {
    const id = `${PREFIXO}${chave}`;
    if (!id.startsWith(PREFIXO)) throw new Error('ID fora do conjunto de exemplos.');
    batch.set(db.collection('ocorrencias').doc(id), {
      empresa: NOME, tipo: 'Treinamento', departamento: 'Treinamento', responsavel: treinador,
      descricao, temaOcorrencia: temas, createdAt: diaRelativo(dias).getTime(), dataOcorrencia: 0,
      updatedAt: agora, ...extras,
    });
  };
  TREINAMENTOS.forEach((t, i) =>
    ocorrencia(`treino-${i + 1}`, t.dias, t.temas, `Treinamento realizado: ${t.temas.join(', ')}.`, {
      treinamentoResultados: ['Bom'],
    }),
  );
  // Agendamento: data da ocorrência no futuro, como o fluxo de agendar treinamento grava.
  ocorrencia('agendado', -1, AGENDADO.temas, 'Treinamento agendado com o cliente.', {
    dataOcorrencia: diaRelativo(AGENDADO.dias).getTime(),
  });

  await batch.commit();
  console.log(`Exemplo gravado somente no emulador: 1 cliente e ${TREINAMENTOS.length + 1} ocorrências.`);
  console.log(`Na Esteira, selecione "${NOME}" em Empresas salvas e role até "Aplicação dos temas na base".`);
} catch (erro) {
  console.error('Não foi possível criar o exemplo local:', erro instanceof Error ? erro.message : 'Falha desconhecida');
  process.exitCode = 1;
} finally {
  await db.terminate();
  await deleteApp(app);
}
