import { deleteObject, getDownloadURL, listAll, ref, uploadBytes } from "firebase/storage";
import { storage } from "./firebase";

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

export async function listarFotosPerfil(forceRefresh = false): Promise<Record<string, string>> {
  if (cacheFotos && !forceRefresh && Date.now() - cacheAtualizadoEm < CACHE_MS) {
    return cacheFotos;
  }
  if (carregamentoFotos && !forceRefresh) return carregamentoFotos;

  carregamentoFotos = (async () => {
    const resultado: Record<string, string> = {};
    const lista = await listAll(ref(storage, "profilePhotos"));
    await Promise.all(lista.items.map(async (item) => {
      resultado[item.name] = await getDownloadURL(item);
    }));
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
  try {
    return await getDownloadURL(ref(storage, `profilePhotos/${uid}`));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "storage/object-not-found") {
      return null;
    }
    throw error;
  }
}

export async function enviarFotoPerfil(uid: string, file: File): Promise<string> {
  validarFoto(file);
  const fotoRef = ref(storage, `profilePhotos/${uid}`);
  await uploadBytes(fotoRef, file, { contentType: file.type });
  invalidarCacheFotos();
  return getDownloadURL(fotoRef);
}

export async function removerFotoPerfil(uid: string): Promise<void> {
  try {
    await deleteObject(ref(storage, `profilePhotos/${uid}`));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "storage/object-not-found") {
      return;
    }
    throw error;
  } finally {
    invalidarCacheFotos();
  }
}
