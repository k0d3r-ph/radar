import { auth } from "./firebase";
import { RADAR_API_URL } from "./apiConfig";

const TAMANHO_MAXIMO = 2 * 1024 * 1024;
const TIPOS_PERMITIDOS = new Set(["image/jpeg", "image/png", "image/webp"]);
const CACHE_MS = 5 * 60 * 1000;

let cacheFotos: Record<string, string> | null = null;
let cacheAtualizadoEm = 0;
let carregamentoFotos: Promise<Record<string, string>> | null = null;

function validarFoto(file: File): void {
  if (!TIPOS_PERMITIDOS.has(file.type)) {
    throw new Error("Escolha uma imagem JPEG, PNG ou WebP.");
  }
  if (file.size === 0 || file.size > TAMANHO_MAXIMO) {
    throw new Error("A imagem deve ter até 2 MB.");
  }
}

function invalidarCacheFotos(): void {
  cacheFotos = null;
  cacheAtualizadoEm = 0;
  carregamentoFotos = null;
}

async function requisitarFoto(path: string, init: RequestInit = {}): Promise<Response> {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error("Entre no Radar para acessar as fotos de perfil.");

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${await usuario.getIdToken()}`);
  return fetch(`${RADAR_API_URL}/api/profile-photos${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
}

async function lerErro(resposta: Response, operacao: string): Promise<never> {
  const dados = await resposta.json() as { error?: unknown };
  const mensagem = typeof dados.error === "string" ? dados.error : `HTTP ${resposta.status}`;
  throw new Error(`Não foi possível ${operacao}: ${mensagem}`);
}

async function obterFoto(uid: string): Promise<string | null> {
  const resposta = await requisitarFoto(`/${encodeURIComponent(uid)}`);
  if (resposta.status === 404) return null;
  if (!resposta.ok) return lerErro(resposta, "carregar a foto de perfil");
  return URL.createObjectURL(await resposta.blob());
}

export async function listarFotosPerfil(forceRefresh = false): Promise<Record<string, string>> {
  if (cacheFotos && !forceRefresh && Date.now() - cacheAtualizadoEm < CACHE_MS) {
    return cacheFotos;
  }
  if (carregamentoFotos && !forceRefresh) return carregamentoFotos;

  carregamentoFotos = (async () => {
    const resultado: Record<string, string> = {};
    const resposta = await requisitarFoto("");
    if (!resposta.ok) return lerErro(resposta, "listar as fotos de perfil");
    const dados = await resposta.json() as { uids?: unknown };
    if (!Array.isArray(dados.uids) || !dados.uids.every((uid) => typeof uid === "string")) {
      throw new Error("A API retornou uma lista inválida de fotos de perfil.");
    }
    for (let inicio = 0; inicio < dados.uids.length; inicio += 6) {
      await Promise.all(dados.uids.slice(inicio, inicio + 6).map(async (uid) => {
        const url = await obterFoto(uid);
        if (url) resultado[uid] = url;
      }));
    }
    cacheFotos = resultado;
    cacheAtualizadoEm = Date.now();
    return resultado;
  })();

  try {
    return await carregamentoFotos;
  } finally {
    carregamentoFotos = null;
  }
}

export async function obterFotoPerfil(uid: string): Promise<string | null> {
  return obterFoto(uid);
}

export async function enviarFotoPerfil(uid: string, file: File): Promise<string> {
  validarFoto(file);
  const resposta = await requisitarFoto(`/${encodeURIComponent(uid)}`, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!resposta.ok) return lerErro(resposta, "enviar a foto de perfil");
  invalidarCacheFotos();
  const url = await obterFoto(uid);
  if (!url) throw new Error("A foto foi enviada, mas não foi possível recuperá-la.");
  return url;
}

export async function removerFotoPerfil(uid: string): Promise<void> {
  const resposta = await requisitarFoto(`/${encodeURIComponent(uid)}`, { method: "DELETE" });
  if (!resposta.ok && resposta.status !== 404) return lerErro(resposta, "remover a foto de perfil");
  invalidarCacheFotos();
}
