import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { IWhatsAppService } from '../../domain/interfaces/IWhatsAppService.js';
import { config } from '../config/env.js';

export function createSocketServer(httpServer: HttpServer, whatsappService: IWhatsAppService): SocketServer {
  const allowedOrigins = config.corsOrigin
    ? config.corsOrigin.split(',').map(o => o.trim())
    : ['*'];

  const io = new SocketServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
          callback(null, true);
        } else {
          callback(null, false);
        }
      },
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  io.on('connection', (socket) => {
    console.log(`Cliente frontend conectado ao WebSocket (ID: ${socket.id})`);

    // Envia o status atual imediatamente para o cliente que acabou de se conectar
    const currentStatus = whatsappService.getStatus();
    socket.emit('whatsapp-status', currentStatus);

    // Permite que o frontend force a inicialização se solicitado (caso o backend esteja em standby)
    socket.on('initialize-whatsapp', async () => {
      try {
        console.log('Cliente solicitou inicialização manual do WhatsApp...');
        await whatsappService.initialize();
      } catch (err: any) {
        console.error('Erro na inicialização solicitada:', err);
        socket.emit('whatsapp-error', { message: err.message || 'Falha ao inicializar o WhatsApp' });
      }
    });

    socket.on('disconnect', () => {
      console.log(`Cliente frontend desconectado do WebSocket (ID: ${socket.id})`);
    });
  });

  // Ouve atualizações de status do WhatsApp e propaga para todos os clientes conectados
  whatsappService.onStatusChange((session) => {
    console.log(`Propagando mudança de status do WhatsApp para os clientes conectados: ${session.status}`);
    io.emit('whatsapp-status', session);
  });

  return io;
}
