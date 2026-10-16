/**
 * Lê a planilha de controle do CS (publicada como CSV) e resolve o `idCentral`
 * (SSX) de cada cliente a partir do nome da central.
 *
 * O casamento não pode ser feito por igualdade exata de string: o mesmo cliente
 * aparece com grafias diferentes no Radar e na planilha (acentos, caixa, espaços,
 * prefixo "SSX_" etc.). `normalizarNomeCentral` reduz os dois lados a uma forma
 * canônica só com letras e números antes de comparar.
 */

import { config } from '../config/env.js';
import { resolverCentral, type LinhaCentral, type IdentificacaoCentral } from '../../domain/entities/CentralPlanilha.js';
export { normalizarNomeCentral, resolverCentral, type LinhaCentral } from '../../domain/entities/CentralPlanilha.js';

type Cache = {
  linhas: LinhaCentral[];
  buscadoEm: number;
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos — evita reler a planilha a cada cadastro

let cache: Cache | null = null;
let emAndamento: Promise<LinhaCentral[]> | null = null;

/** Célula vazia/inválida não vira zero nem apaga um valor existente. */
export function parsearValorContrato(celula: string): number | undefined {
  const valor = celula.trim().replace(/^R\$\s*/i, '').replace(/[\s\u00a0]/g, '');
  if (!valor) return undefined;
  let normalizado: string;
  if (/^(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}$/.test(valor)) {
    normalizado = valor.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(valor)) {
    normalizado = valor.replace(/\./g, '');
  } else if (/^\d+(?:\.\d{1,2})?$/.test(valor)) {
    normalizado = valor;
  } else return undefined;
  const numero = Number(normalizado);
  return Number.isFinite(numero) && numero <= Number.MAX_SAFE_INTEGER / 100 ? numero : undefined;
}

/**
 * Faz o parse do CSV inteiro em linhas de campos, respeitando aspas — inclusive
 * quando um campo entre aspas contém vírgula ou quebra de linha literal (comum em
 * células de observação/comentário desta planilha). Dividir o texto por `\n`
 * antes de tratar as aspas, como uma linha-CSV-por-vez faria, quebraria essas
 * células no meio e desalinharia todas as colunas seguintes da linha.
 */
function parsearCsv(csv: string): string[][] {
  const linhas: string[][] = [];
  let campos: string[] = [];
  let atual = '';
  let dentroDeAspas = false;

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];

    if (dentroDeAspas) {
      if (char === '"') {
        if (csv[i + 1] === '"') {
          atual += '"';
          i++;
        } else {
          dentroDeAspas = false;
        }
      } else {
        atual += char;
      }
      continue;
    }

    if (char === '"') {
      dentroDeAspas = true;
    } else if (char === ',') {
      campos.push(atual);
      atual = '';
    } else if (char === '\r') {
      // ignorado — o \n (ou o fim do arquivo) logo em seguida fecha a linha
    } else if (char === '\n') {
      campos.push(atual);
      linhas.push(campos);
      campos = [];
      atual = '';
    } else {
      atual += char;
    }
  }
  // Última linha, se o arquivo não terminar com quebra de linha.
  if (atual.length > 0 || campos.length > 0) {
    campos.push(atual);
    linhas.push(campos);
  }

  return linhas.filter((l) => l.some((campo) => campo.trim().length > 0));
}

/** Remove o prefixo numérico que a planilha usa nos cabeçalhos (ex.: "2 - Cliente" → "cliente"). */
function normalizarCabecalho(cabecalho: string): string {
  return cabecalho
    .trim()
    .toLowerCase()
    .replace(/^\d+\s*-\s*/, '')
    .trim();
}

function acharIndiceColuna(cabecalhos: string[], candidatosExatos: string[]): number {
  const normalizados = cabecalhos.map(normalizarCabecalho);
  for (const candidato of candidatosExatos) {
    const idx = normalizados.indexOf(candidato);
    if (idx !== -1) return idx;
  }
  return -1;
}

export function extrairCentrais(csv: string): LinhaCentral[] {
  const semBom = csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv;
  if (/^\s*(?:<!doctype\s+html|<html\b|<head\b|<body\b|<script\b)/i.test(semBom)) {
    throw new Error('O Google retornou uma página HTML em vez do CSV. Confira a URL de exportação e o acesso à planilha sem login.');
  }
  const linhas = parsearCsv(semBom);
  if (!linhas.length) throw new Error('A planilha de centrais retornou um CSV vazio.');

  const cabecalhos = linhas[0];

  // Comparação por igualdade exata (após tirar o prefixo "N - ") em vez de
  // "contém", porque a planilha tem colunas como "34 - Situação atual do
  // clientee", que também contém a substring "cliente" e daria falso positivo.
  const idxNome = acharIndiceColuna(cabecalhos, ['cliente', 'nome da central', 'central/empresa', 'empresa']);
  const idxId = acharIndiceColuna(cabecalhos, ['id central', 'idcentral', 'id da central']);
  const idxValor = acharIndiceColuna(cabecalhos, ['valor de contrato', 'valor do contrato', 'valor contrato']);

  if (idxId === -1 || idxNome === -1) {
    throw new Error('O CSV não contém as colunas de cliente e/ou Id central. Confira se o gid aponta para a aba Controle de Implantação.');
  }

  const linhasCentrais: LinhaCentral[] = [];
  for (let i = 1; i < linhas.length; i++) {
    const campos = linhas[i];
    const nomeCentral = (campos[idxNome] || '').trim();
    const idCentral = (campos[idxId] || '').trim();
    if (!nomeCentral) continue;
    const valorContrato = idxValor === -1 ? undefined : parsearValorContrato(campos[idxValor] || '');
    linhasCentrais.push({ nomeCentral, idCentral, ...(valorContrato === undefined ? {} : { valorContrato }) });
  }
  return linhasCentrais;
}

export function urlExportacaoPlanilha(valor: string): string {
  const url = new URL(valor.trim());
  // Links de compartilhamento abrem a interface HTML, não os dados da aba.
  const planilha = url.hostname === 'docs.google.com'
    && url.pathname.match(/^\/spreadsheets\/d\/([^/]+)\/(?:edit|view|preview)\/?$/);
  if (planilha) {
    const gid = url.searchParams.get('gid') || new URLSearchParams(url.hash.slice(1)).get('gid') || '0';
    url.pathname = `/spreadsheets/d/${planilha[1]}/export`;
    url.search = '';
    url.hash = '';
    url.searchParams.set('format', 'csv');
    url.searchParams.set('gid', gid);
  }
  return url.toString();
}

export async function baixarCentrais(url: string, fetchCsv: typeof fetch = fetch): Promise<LinhaCentral[]> {
  const resposta = await fetchCsv(urlExportacaoPlanilha(url), { signal: AbortSignal.timeout(30_000) });
  if (!resposta.ok) {
    throw new Error(`Falha ao baixar a planilha de centrais (HTTP ${resposta.status}). Confira a URL e o acesso sem login.`);
  }
  if (resposta.headers.get('content-type')?.toLowerCase().includes('text/html')) {
    throw new Error('O Google retornou uma página HTML em vez do CSV. Confira a URL de exportação e o acesso à planilha sem login.');
  }
  return extrairCentrais(await resposta.text());
}

async function buscarLinhasDaPlanilha(forceRefresh = false): Promise<LinhaCentral[]> {
  const agora = Date.now();
  if (!forceRefresh && cache && agora - cache.buscadoEm < CACHE_TTL_MS) {
    return cache.linhas;
  }

  if (!config.planilhaCentraisCsvUrl) {
    throw new Error(
      'PLANILHA_CENTRAIS_CSV_URL não configurada no .env do server. Ver server/.env.example.',
    );
  }

  if (!emAndamento) {
    emAndamento = baixarCentrais(config.planilhaCentraisCsvUrl).then(linhas => {
      cache = { linhas, buscadoEm: Date.now() };
      return linhas;
    }).finally(() => { emAndamento = null; });
  }
  return emAndamento;
}

/**
 * Resolve o `idCentral` a partir do nome do cliente/central. Retorna `null`
 * quando a planilha não tem nenhuma linha cujo nome normalizado bata.
 */
export async function buscarIdCentralPorNome(nomeEmpresa: string): Promise<string | null> {
  return (await buscarDadosCentral({ nomeEmpresa }))?.idCentral || null;
}

export async function buscarDadosCentral(cliente: IdentificacaoCentral): Promise<LinhaCentral | null> {
  if (!cliente.nomeEmpresa.trim() && !cliente.idCentral?.trim()) return null;
  return resolverCentral(await buscarLinhasDaPlanilha(), cliente);
}

/** Usado pelo script de vinculação em lote — devolve a planilha inteira já normalizada. */
export async function listarCentraisDaPlanilha(forceRefresh = false): Promise<LinhaCentral[]> {
  return buscarLinhasDaPlanilha(forceRefresh);
}
