/**
 * Feriados nacionais brasileiros (fixos e móveis, calculados pela data da Páscoa).
 * Não inclui feriados estaduais/municipais: o sistema não tem cidade/estado cadastrado
 * por cliente. Usado apenas pela estimativa de prazo da esteira (ver utils/prazoTreinamento.ts);
 * não altera o critério de "dia útil" (segunda a sexta) já usado nos indicadores existentes.
 */

function formatarISO(data: Date): string {
  const y = data.getFullYear();
  const m = String(data.getMonth() + 1).padStart(2, "0");
  const d = String(data.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Domingo de Páscoa do ano, pelo algoritmo de Gauss/Meeus. */
function calcularPascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}

function somarDias(data: Date, dias: number): Date {
  const resultado = new Date(data);
  resultado.setDate(resultado.getDate() + dias);
  return resultado;
}

const cacheFeriadosPorAno = new Map<number, Set<string>>();

function obterFeriadosNacionais(ano: number): Set<string> {
  const cache = cacheFeriadosPorAno.get(ano);
  if (cache) return cache;

  const pascoa = calcularPascoa(ano);
  const datas = [
    new Date(ano, 0, 1), // Confraternização Universal
    somarDias(pascoa, -48), // Carnaval (segunda)
    somarDias(pascoa, -47), // Carnaval (terça)
    somarDias(pascoa, -2), // Sexta-feira Santa
    new Date(ano, 3, 21), // Tiradentes
    new Date(ano, 4, 1), // Dia do Trabalho
    somarDias(pascoa, 60), // Corpus Christi
    new Date(ano, 8, 7), // Independência
    new Date(ano, 9, 12), // Nossa Senhora Aparecida
    new Date(ano, 10, 2), // Finados
    new Date(ano, 10, 15), // Proclamação da República
    new Date(ano, 10, 20), // Consciência Negra (feriado nacional desde 2024)
    new Date(ano, 11, 25), // Natal
  ];

  const feriados = new Set(datas.map(formatarISO));
  cacheFeriadosPorAno.set(ano, feriados);
  return feriados;
}

export function isFeriadoNacional(data: Date): boolean {
  return obterFeriadosNacionais(data.getFullYear()).has(formatarISO(data));
}

/** Dia útil considerando segunda a sexta e os feriados nacionais do ano. */
export function isDiaUtilComFeriados(data: Date): boolean {
  const diaDaSemana = data.getDay();
  if (diaDaSemana === 0 || diaDaSemana === 6) return false;
  return !isFeriadoNacional(data);
}
