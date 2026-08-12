/**
 * Sincronização incremental de coleções do Firestore.
 *
 * O Radar relia coleções inteiras a cada carregamento de página — o que colocou
 * o projeto em ~46 mil leituras diárias contra pouco mais de uma centena de
 * gravações, encostando na cota gratuita de 50 mil leituras do plano Spark.
 *
 * A estratégia aqui troca a varredura completa por duas etapas baratas:
 *
 *   1. lê a base local do próprio SDK (`persistentLocalCache`, já habilitado em
 *      `firebase.ts`), que não consome cota nenhuma;
 *   2. pergunta ao servidor apenas o que mudou desde a última sincronização,
 *      via `where("updatedAt", ">", ...)`.
 *
 * Quando nada mudou, a consulta volta vazia e custa uma única leitura. Por isso
 * toda coleção sincronizada por aqui precisa gravar `updatedAt` em cada escrita
 * — um documento sem esse campo nunca aparece no delta (consultas de intervalo
 * ignoram documentos que não têm o campo) e só seria visto na carga completa.
 */

import {
  collection,
  getDocs,
  getDocsFromCache,
  query,
  where,
  type QuerySnapshot,
} from "firebase/firestore";

import { db } from "./firebase";

/**
 * `updatedAt` é gravado com o `Date.now()` da máquina de quem escreve, então
 * relógios dessincronizados entre os computadores do time poderiam produzir um
 * timestamp anterior ao nosso marcador e sumir do delta. Reconsultar sempre uma
 * janela extra de 5 minutos cobre a diferença por algumas poucas leituras.
 */
const MARGEM_RELOGIO_MS = 300000;

/**
 * O delta enxerga criações e edições, mas não exclusões: um documento apagado
 * por outro usuário permanece na base local até uma carga completa reconciliar
 * a coleção. Recarregar tudo a cada 6 horas mantém o custo baixo e limita a
 * defasagem a um turno de trabalho.
 */
const INTERVALO_CARGA_COMPLETA_MS = 21600000;

type MarcadorSincronizacao = {
  /** Maior `updatedAt` já visto na coleção. Ponto de partida do próximo delta. */
  ultimoUpdatedAt: number;
  /** Quando a coleção foi lida por completo pela última vez. */
  ultimaCargaCompleta: number;
};

type RegistroSincronizavel = {
  id?: string;
  updatedAt?: number;
};

function chaveMarcador(nomeColecao: string): string {
  return `radar:sync:${nomeColecao}`;
}

function lerMarcador(nomeColecao: string): MarcadorSincronizacao | null {
  try {
    const bruto = localStorage.getItem(chaveMarcador(nomeColecao));
    if (!bruto) return null;

    const dados = JSON.parse(bruto);
    if (
      typeof dados?.ultimoUpdatedAt !== "number" ||
      typeof dados?.ultimaCargaCompleta !== "number"
    ) {
      return null;
    }

    return dados as MarcadorSincronizacao;
  } catch {
    // localStorage indisponível (modo privativo, cota cheia) ou JSON corrompido:
    // sem marcador, a sincronização simplesmente recai na carga completa.
    return null;
  }
}

function gravarMarcador(nomeColecao: string, marcador: MarcadorSincronizacao): void {
  try {
    localStorage.setItem(chaveMarcador(nomeColecao), JSON.stringify(marcador));
  } catch {
    // Falhar aqui só custa uma carga completa na próxima vez — não é motivo
    // para derrubar o carregamento da tela.
  }
}

/**
 * Descarta o marcador da coleção, forçando uma carga completa na próxima
 * chamada. Útil após operações em lote que mexem em muitos documentos.
 */
export function invalidarSincronizacao(nomeColecao: string): void {
  try {
    localStorage.removeItem(chaveMarcador(nomeColecao));
  } catch {
    // Ver comentário em gravarMarcador.
  }
}

function mapearDocumentos<T>(snapshot: QuerySnapshot): T[] {
  return snapshot.docs.map((documento) => ({
    id: documento.id,
    ...(documento.data() as object),
  })) as T[];
}

function maiorUpdatedAt(registros: RegistroSincronizavel[], inicial = 0): number {
  return registros.reduce(
    (maior, registro) =>
      typeof registro.updatedAt === "number" && registro.updatedAt > maior
        ? registro.updatedAt
        : maior,
    inicial
  );
}

/**
 * Devolve todos os documentos da coleção, buscando no servidor apenas o que
 * mudou desde a última chamada.
 *
 * @param nomeColecao Coleção do Firestore. Todos os seus documentos devem ter `updatedAt`.
 * @param forceRefresh Ignora o incremental e relê a coleção inteira do servidor.
 */
export async function sincronizarColecao<T extends RegistroSincronizavel>(
  nomeColecao: string,
  forceRefresh = false
): Promise<T[]> {
  const referencia = collection(db, nomeColecao);
  const agora = Date.now();
  const marcador = lerMarcador(nomeColecao);

  const podeUsarDelta =
    !forceRefresh &&
    marcador !== null &&
    agora - marcador.ultimaCargaCompleta < INTERVALO_CARGA_COMPLETA_MS;

  if (podeUsarDelta && marcador) {
    try {
      const base = await getDocsFromCache(referencia);

      // Base local vazia (primeiro acesso neste navegador, ou cache limpo pelo
      // usuário) não tem o que ser incrementado: cai para a carga completa.
      if (!base.empty) {
        const registros = mapearDocumentos<T>(base);

        const desde = Math.max(0, marcador.ultimoUpdatedAt - MARGEM_RELOGIO_MS);
        const alterados = mapearDocumentos<T>(
          await getDocs(query(referencia, where("updatedAt", ">", desde)))
        );

        if (alterados.length === 0) {
          return registros;
        }

        const porId = new Map(registros.map((registro) => [registro.id, registro]));
        alterados.forEach((registro) => porId.set(registro.id, registro));
        const mesclados = Array.from(porId.values());

        gravarMarcador(nomeColecao, {
          ultimoUpdatedAt: maiorUpdatedAt(mesclados, marcador.ultimoUpdatedAt),
          ultimaCargaCompleta: marcador.ultimaCargaCompleta,
        });

        return mesclados;
      }
    } catch (erro) {
      console.warn(
        `[sincronizacao] Falha no incremental de "${nomeColecao}". Recorrendo à carga completa.`,
        erro
      );
    }
  }

  const completo = mapearDocumentos<T>(await getDocs(referencia));

  gravarMarcador(nomeColecao, {
    ultimoUpdatedAt: maiorUpdatedAt(completo),
    ultimaCargaCompleta: agora,
  });

  return completo;
}
