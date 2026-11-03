/**
 * Gera dados sintéticos extras, só no Firebase Emulator Suite local, para popular o painel
 * "ao vivo" (bolsa de valores) de Relatórios > Indicadores de Treinamento: Gol no prazo,
 * Clientes suspensos, Tempo até o 1º treinamento, Contatos com Suporte (treinamento) e CSAT
 * do treinamento. Não apaga nada existente — só adiciona registros com prefixo
 * `demo-bolsa-`, espalhados nos últimos ~6 meses para preencher as visões de dia, semana
 * e mês do ticker.
 *
 * Pré-requisito: emulador rodando (`npm run emulators`) e `npm run seed:emulador` já
 * executado pelo menos uma vez (para existirem treinadores cadastrados).
 *
 * Uso (a partir de server/):
 *   npx tsx scripts/seedBolsaIndicadores.ts
 */

import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.METADATA_SERVER_DETECTION = 'none';

const app = initializeApp({ projectId: 'automatiza-esteira' });
const db = getFirestore(app);

const DIA_MS = 24 * 60 * 60 * 1000;
const hoje = new Date();
hoje.setHours(9, 0, 0, 0);

function diasAtras(dias: number): Date {
  return new Date(hoje.getTime() - dias * DIA_MS);
}

function dataISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dia}`;
}

function dataBR(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${dia}/${m}/${y}`;
}

// Mesma lista de temas da esteira usada por seedEmulador.ts — obrigatória para o cálculo
// de fases em Relatórios (calcularTotalFases lê `temaText`, e o Relatórios quebra sem ele).
const TEMAS_ESTEIRA = [
  'Introdução ao sistema',
  'Cadastro de produtos',
  'Emissão de notas fiscais',
  'Relatórios gerenciais',
  'Integração com PDV',
];

// Deslocamentos (dias atrás) do evento principal de cada cliente sintético: mistura de
// pontos recentes (janela "dia"), de algumas semanas atrás (janela "semana") e de vários
// meses atrás (janela "mês"), para o ticker ter o que mostrar nas três granularidades.
const OFFSETS_DIAS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, // dia a dia
  25, 32, 39, 46, 53, 60, 67, // semana a semana
  95, 125, 155, 185, // mês a mês
];

function escolherAleatorio<T>(lista: T[], indice: number): T {
  return lista[indice % lista.length];
}

try {
  await fetch('http://127.0.0.1:8080/', { signal: AbortSignal.timeout(3_000) });

  const usuariosSnap = await db.collection('usuarios').where('role', 'in', ['treinador', 'master']).get();
  const treinadores = usuariosSnap.docs
    .map((d) => d.data().nome as string | undefined)
    .filter((nome): nome is string => !!nome && !nome.toLowerCase().includes('painel'));
  if (treinadores.length === 0) {
    throw new Error('Nenhum treinador cadastrado. Rode "npm run seed:emulador" primeiro.');
  }

  const batch = db.batch();
  let empresasCriadas = 0;
  let ocorrenciasCriadas = 0;

  OFFSETS_DIAS.forEach((offset, i) => {
    const treinador = escolherAleatorio(treinadores, i);
    const idEmpresa = `demo-bolsa-emp-${i + 1}`;
    const nomeEmpresa = `Demo Bolsa Cliente ${i + 1}`;

    const diasAntesDaEntrada = 5 + (i % 5) * 6; // 5 a 29 dias de espera até o 1º treinamento
    const dataEntrada = diasAtras(offset + diasAntesDaEntrada);
    const dataTreinamento = diasAtras(offset);

    const suspenso = i % 4 === 0; // 1 a cada 4 clientes sintéticos
    const currentPhase = 2;
    const temaText = TEMAS_ESTEIRA.join('\n');
    const dataText = TEMAS_ESTEIRA.map((_, idx) =>
      idx <= currentPhase ? dataBR(diasAtras(offset + diasAntesDaEntrada - idx * 3)) : '',
    ).join('\n');
    const empresaDados: Record<string, unknown> = {
      nomeEmpresa,
      responsavel: treinador,
      tipo: 'Fast',
      dataEntrada: dataISO(dataEntrada),
      temaText,
      dataText,
      currentPhase,
      updatedAt: Date.now(),
    };
    if (suspenso) {
      empresaDados.isSuspended = true;
      empresaDados.dataSuspensao = dataISO(diasAtras(offset));
    }
    batch.set(db.collection('empresas').doc(idEmpresa), empresaDados);
    empresasCriadas++;

    // Treinamento realizado com avaliação em estrelas (CSAT do treinamento) — também conta
    // como 1º treinamento do cliente (tempo até o 1º treinamento).
    const nota = 1 + Math.floor(Math.random() * 5);
    const idTreinamento = `demo-bolsa-oc-treino-${i + 1}`;
    batch.set(db.collection('ocorrencias').doc(idTreinamento), {
      empresa: nomeEmpresa,
      tipo: 'Treinamento',
      descricao: 'Treinamento sintético gerado para o painel ao vivo.',
      departamento: 'Treinamento',
      responsavel: treinador,
      dataOcorrencia: dataTreinamento.getTime(),
      createdAt: dataTreinamento.getTime(),
      updatedAt: dataTreinamento.getTime(),
      idSeqFormatted: `#DB${1000 + i}`,
      csatRespostas: [{ experiencia: nota >= 3 ? 'Bom' : 'Ruim', nota }],
    });
    ocorrenciasCriadas++;

    // Contato de Suporte importado do SSX Desk, atribuível ao treinamento.
    const idSuporte = `demo-bolsa-oc-suporte-${i + 1}`;
    batch.set(db.collection('ocorrencias').doc(idSuporte), {
      empresa: nomeEmpresa,
      tipo: 'Problema',
      descricao: 'Contato de Suporte sintético (SSX Desk) para o painel ao vivo.',
      departamento: 'Suporte',
      responsavel: treinador,
      origem: 'ssx-desk',
      dataOcorrencia: diasAtras(offset).getTime(),
      createdAt: diasAtras(offset).getTime(),
      updatedAt: diasAtras(offset).getTime(),
      idSeqFormatted: `#DB${2000 + i}`,
    });
    ocorrenciasCriadas++;

    // Gol, para metade dos clientes sintéticos: metade bate dentro do prazo de 30 dias,
    // metade fora, para o indicador oscilar entre os pontos do gráfico.
    if (i % 2 === 0) {
      const noPrazo = i % 4 === 0;
      const dataGol = noPrazo
        ? diasAtras(offset + diasAntesDaEntrada - 10) // 10 dias após a entrada
        : diasAtras(offset + diasAntesDaEntrada - 40); // 40 dias após a entrada (fora do prazo)
      const idGol = `demo-bolsa-oc-gol-${i + 1}`;
      batch.set(db.collection('ocorrencias').doc(idGol), {
        empresa: nomeEmpresa,
        tipo: 'Gol',
        descricao: 'Gol sintético para o painel ao vivo.',
        departamento: 'CS',
        responsavel: treinador,
        dataOcorrencia: dataGol.getTime(),
        createdAt: dataGol.getTime(),
        updatedAt: dataGol.getTime(),
        idSeqFormatted: `#DB${3000 + i}`,
      });
      ocorrenciasCriadas++;
    }
  });

  await batch.commit();
  console.log(`Dados sintéticos do painel ao vivo gravados somente no emulador: ${empresasCriadas} clientes e ${ocorrenciasCriadas} ocorrências.`);
  console.log('Recarregue o Radar (Relatórios > Indicadores de Treinamento) para ver o painel populado.');
} catch (erro) {
  console.error('Não foi possível gerar os dados do painel ao vivo:', erro instanceof Error ? erro.message : 'Falha desconhecida');
  process.exitCode = 1;
} finally {
  await db.terminate();
  await deleteApp(app);
}
