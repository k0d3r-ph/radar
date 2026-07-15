import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageQueue } from './MessageQueue';
import { IWhatsAppService } from '../../domain/interfaces/IWhatsAppService';
import { WhatsAppSession } from '../../domain/entities/WhatsAppSession';

// Mock do Firebase Admin e helpers
vi.mock('../../infrastructure/firebase/firebase.js', () => {
  const mockUpdate = vi.fn().mockResolvedValue(true);
  const mockDoc = vi.fn().mockReturnValue({
    update: mockUpdate
  });
  const mockSubCollection = vi.fn().mockReturnValue({
    doc: mockDoc
  });
  const mockChatDoc = vi.fn().mockReturnValue({
    collection: mockSubCollection
  });
  const mockCollection = vi.fn().mockReturnValue({
    doc: mockChatDoc
  });
  
  return {
    db: {
      collection: mockCollection
    },
    cleanPhoneNumber: (num: string) => num.replace(/\D/g, '')
  };
});

describe('MessageQueue', () => {
  let mockService: IWhatsAppService;
  let queue: MessageQueue;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock do serviço de WhatsApp
    mockService = {
      initialize: vi.fn(),
      disconnect: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue(true),
      enqueueMessage: vi.fn(),
      sendTyping: vi.fn().mockResolvedValue(undefined),
      getProfilePicUrl: vi.fn(),
      onStatusChange: vi.fn(),
      getStatus: vi.fn().mockReturnValue(new WhatsAppSession('connected'))
    };

    queue = new MessageQueue(mockService);
  });

  it('deve respeitar o limite diário de mensagens automáticas', async () => {
    const item = {
      to: '5521999999999',
      message: 'Mensagem Limite',
      chatId: '5521999999999',
      messageDocId: 'doc456'
    };

    queue.setDailyLimit(0); // Limite zero!

    await queue.enqueue(item);

    // O serviço de envio não deve ser chamado
    expect(mockService.sendMessage).not.toHaveBeenCalled();
  });
});
