import type { BancoDocumentos } from '../../domain/interfaces/BancoDocumentos.js';
import { IndiceTelefonesClientes } from '../../domain/whatsappChat.js';
import type { ProvedorIndiceClientes } from '../../application/use-cases/ChatWhatsApp.js';

/** Quanto tempo o índice de telefones dos clientes é reaproveitado antes de reler o cadastro. */
const VALIDADE_INDICE_MS = 60_000;

/**
 * Índice telefone → cliente montado a partir da coleção `empresas`. Fica em memória por
 * {@link VALIDADE_INDICE_MS}; a tela força a releitura logo após vincular um telefone.
 */
export class IndiceClientesBanco implements ProvedorIndiceClientes {
  private cache: { indice: IndiceTelefonesClientes; lidoEm: number } | null = null;
  private carregando: Promise<IndiceTelefonesClientes> | null = null;

  constructor(private readonly banco: BancoDocumentos, private readonly agora: () => number = Date.now) {}

  async obter(opcoes: { recarregar?: boolean } = {}): Promise<IndiceTelefonesClientes> {
    if (!opcoes.recarregar && this.cache && this.agora() - this.cache.lidoEm < VALIDADE_INDICE_MS) {
      return this.cache.indice;
    }
    if (!this.carregando) {
      this.carregando = this.carregar().finally(() => { this.carregando = null; });
    }
    return this.carregando;
  }

  private async carregar(): Promise<IndiceTelefonesClientes> {
    const instantaneo = await this.banco.collection('empresas').get();
    const empresas = instantaneo.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const indice = new IndiceTelefonesClientes(empresas);
    this.cache = { indice, lidoEm: this.agora() };
    return indice;
  }
}
