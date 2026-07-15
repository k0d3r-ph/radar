import { db } from '../../infrastructure/firebase/firebase.js';
import { IWhatsAppService } from '../../domain/interfaces/IWhatsAppService.js';

export interface QueueItem {
  id?: string;
  to: string;
  message: string;
  imageBase64?: string;
  filename?: string;
  chatId: string;
  messageDocId: string;
}

export class MessageQueue {
  private queue: QueueItem[] = [];
  private processing = false;
  private dailyLimit = 80;
  private sentTodayCount = 0;
  private lastResetDate = new Date().toDateString();

  constructor(private whatsappService: IWhatsAppService) {
    this.checkDailyReset();
  }

  private checkDailyReset() {
    const today = new Date().toDateString();
    if (this.lastResetDate !== today) {
      this.lastResetDate = today;
      this.sentTodayCount = 0;
    }
  }

  public setDailyLimit(limit: number) {
    this.dailyLimit = limit;
  }

  public getDailyLimit(): number {
    return this.dailyLimit;
  }

  public getSentTodayCount(): number {
    this.checkDailyReset();
    return this.sentTodayCount;
  }

  /**
   * Enfileira uma mensagem para envio.
   * Se o WhatsApp estiver conectado, processa a fila.
   * Se não, a mensagem é persistida no Firestore como 'pending_connection'.
   */
  public async enqueue(item: QueueItem): Promise<void> {
    this.checkDailyReset();

    if (this.sentTodayCount >= this.dailyLimit) {
      console.warn(`[MessageQueue] Limite diário de ${this.dailyLimit} mensagens automáticas atingido.`);
      await db.collection('whatsapp_chats')
        .doc(item.chatId)
        .collection('messages')
        .doc(item.messageDocId)
        .update({
          status: 'failed_expired',
          error: 'Limite diário de mensagens excedido'
        });
      return;
    }

    this.queue.push(item);
    console.log(`[MessageQueue] Mensagem enfileirada para ${item.to}. Fila possui ${this.queue.length} itens.`);
    
    // Inicia processamento se não estiver ativo
    this.processNext();
  }

  private async processNext(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      this.checkDailyReset();
      if (this.sentTodayCount >= this.dailyLimit) {
        console.warn(`[MessageQueue] Limite diário atingido durante processamento.`);
        this.queue = [];
        break;
      }

      const status = this.whatsappService.getStatus();
      if (status.status !== 'connected') {
        console.log(`[MessageQueue] WhatsApp não conectado (${status.status}). Pausando fila.`);
        break;
      }

      const item = this.queue.shift();
      if (!item) continue;

      try {
        console.log(`[MessageQueue] Processando envio para ${item.to}...`);
        
        // 1. Simula digitação (se suportado pelo client)
        const typingDuration = Math.floor(Math.random() * 1500) + 1500; // 1.5s a 3.0s
        if ((this.whatsappService as any).sendTyping) {
          await (this.whatsappService as any).sendTyping(item.to, typingDuration);
        } else {
          await new Promise(resolve => setTimeout(resolve, typingDuration));
        }

        // 2. Envia mensagem
        await this.whatsappService.sendMessage(item.to, item.message, item.imageBase64, item.filename);
        
        // 3. Incrementa contador
        this.sentTodayCount++;

        // 4. Atualiza Firestore
        await db.collection('whatsapp_chats')
          .doc(item.chatId)
          .collection('messages')
          .doc(item.messageDocId)
          .update({
            status: 'sent',
            sentAt: Date.now()
          });

        console.log(`[MessageQueue] Mensagem enviada com sucesso para ${item.to}.`);

      } catch (err: any) {
        console.error(`[MessageQueue] Erro ao enviar mensagem para ${item.to}:`, err);
        
        await db.collection('whatsapp_chats')
          .doc(item.chatId)
          .collection('messages')
          .doc(item.messageDocId)
          .update({
            status: 'pending_connection',
            error: err.message || String(err)
          });
      }

      // 5. Atraso randômico entre mensagens (3 a 7 segundos)
      const delay = Math.floor(Math.random() * 4000) + 3000;
      console.log(`[MessageQueue] Aguardando ${delay}ms antes do próximo envio...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    this.processing = false;
  }
}
