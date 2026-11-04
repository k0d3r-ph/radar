import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Request, Response } from 'express';
import type { Auth } from 'firebase-admin/auth';

const TAMANHO_MAXIMO = 2 * 1024 * 1024;
const TIPOS_PERMITIDOS = new Set(['image/jpeg', 'image/png', 'image/webp']);

function identificarTipoImagem(conteudo: Buffer): string | null {
  if (conteudo.length >= 3 && conteudo[0] === 0xff && conteudo[1] === 0xd8 && conteudo[2] === 0xff) {
    return 'image/jpeg';
  }
  if (conteudo.length >= 8 && conteudo.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return 'image/png';
  }
  if (
    conteudo.length >= 12
    && conteudo.toString('ascii', 0, 4) === 'RIFF'
    && conteudo.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function uidValido(uid: string): boolean {
  return uid.length > 0
    && Buffer.byteLength(uid, 'utf8') <= 128
    && !uid.includes('/')
    && !uid.includes('\\')
    && !uid.includes('\0');
}

export class ProfilePhotosController {
  constructor(
    private readonly auth: Auth | null,
    private readonly diretorio: string,
  ) {}

  private async autenticar(req: Request, res: Response): Promise<string | null> {
    if (!this.auth) {
      res.status(503).json({ error: 'Serviço de fotos de perfil indisponível.' });
      return null;
    }

    const token = req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      res.status(401).json({ error: 'Entre no Radar para acessar as fotos de perfil.' });
      return null;
    }

    try {
      return (await this.auth.verifyIdToken(token, true)).uid;
    } catch {
      res.status(401).json({ error: 'Sessão expirada. Entre novamente no Radar.' });
      return null;
    }
  }

  private caminhoFoto(uid: string): string {
    const nomeSeguro = Buffer.from(uid, 'utf8').toString('base64url');
    return path.join(this.diretorio, `${nomeSeguro}.photo`);
  }

  async listar(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'private, no-store');
    if (!await this.autenticar(req, res)) return;

    try {
      let arquivos: string[];
      try {
        arquivos = await readdir(this.diretorio);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          res.status(200).json({ uids: [] });
          return;
        }
        throw error;
      }

      const uids = arquivos.flatMap((arquivo) => {
        if (!arquivo.endsWith('.photo')) return [];
        const codificado = arquivo.slice(0, -'.photo'.length);
        const uid = Buffer.from(codificado, 'base64url').toString('utf8');
        if (!uidValido(uid) || Buffer.from(uid, 'utf8').toString('base64url') !== codificado) return [];
        return [uid];
      });
      res.status(200).json({ uids });
    } catch {
      console.error('[Fotos de perfil] Falha ao listar fotos.');
      res.status(500).json({ error: 'Não foi possível carregar as fotos de perfil.' });
    }
  }

  async obter(req: Request, res: Response): Promise<void> {
    res.set('Cache-Control', 'private, no-store');
    if (!await this.autenticar(req, res)) return;

    const uid = req.params.uid;
    if (!uidValido(uid)) {
      res.status(400).json({ error: 'Identificador de usuário inválido.' });
      return;
    }

    try {
      const conteudo = await readFile(this.caminhoFoto(uid));
      const contentType = identificarTipoImagem(conteudo);
      if (!contentType) {
        console.error('[Fotos de perfil] Arquivo salvo com conteúdo inválido.');
        res.status(500).json({ error: 'A foto armazenada está inválida.' });
        return;
      }
      res.set('Content-Type', contentType);
      res.set('X-Content-Type-Options', 'nosniff');
      res.status(200).send(conteudo);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        res.status(404).json({ error: 'Foto de perfil não encontrada.' });
        return;
      }
      console.error('[Fotos de perfil] Falha ao ler foto.');
      res.status(500).json({ error: 'Não foi possível carregar a foto de perfil.' });
    }
  }

  async enviar(req: Request, res: Response): Promise<void> {
    const uidAutenticado = await this.autenticar(req, res);
    if (!uidAutenticado) return;

    const uid = req.params.uid;
    if (!uidValido(uid) || uid !== uidAutenticado) {
      res.status(403).json({ error: 'Você só pode alterar a própria foto de perfil.' });
      return;
    }

    const contentType = req.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
    const conteudo = req.body;
    if (
      !Buffer.isBuffer(conteudo)
      || conteudo.length === 0
      || conteudo.length > TAMANHO_MAXIMO
      || !contentType
      || !TIPOS_PERMITIDOS.has(contentType)
      || identificarTipoImagem(conteudo) !== contentType
    ) {
      res.status(400).json({ error: 'Envie uma imagem JPEG, PNG ou WebP válida, com até 2 MB.' });
      return;
    }

    const destino = this.caminhoFoto(uid);
    const temporario = `${destino}.${randomUUID()}.tmp`;
    try {
      await mkdir(this.diretorio, { recursive: true });
      await writeFile(temporario, conteudo, { flag: 'wx', mode: 0o600 });
      await rename(temporario, destino);
      res.status(204).end();
    } catch {
      try {
        await rm(temporario, { force: true });
      } catch {
        console.error('[Fotos de perfil] Falha ao limpar arquivo temporário.');
      }
      console.error('[Fotos de perfil] Falha ao salvar foto.');
      res.status(500).json({ error: 'Não foi possível salvar a foto de perfil.' });
    }
  }

  async remover(req: Request, res: Response): Promise<void> {
    const uidAutenticado = await this.autenticar(req, res);
    if (!uidAutenticado) return;

    const uid = req.params.uid;
    if (!uidValido(uid) || uid !== uidAutenticado) {
      res.status(403).json({ error: 'Você só pode remover a própria foto de perfil.' });
      return;
    }

    try {
      await rm(this.caminhoFoto(uid), { force: true });
      res.status(204).end();
    } catch {
      console.error('[Fotos de perfil] Falha ao remover foto.');
      res.status(500).json({ error: 'Não foi possível remover a foto de perfil.' });
    }
  }
}
