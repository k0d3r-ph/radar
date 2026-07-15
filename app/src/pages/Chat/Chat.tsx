import React, { useEffect, useState, useRef } from "react";
import { 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  doc, 
  updateDoc 
} from "firebase/firestore";
import { db } from "../../services/firebase";
import { 
  Send, 
  User, 
  Image as ImageIcon, 
  Paperclip, 
  Check, 
  CheckCheck, 
  Loader2, 
  Phone, 
  Clock, 
  AlertCircle,
  FileText,
  Video,
  ChevronLeft
} from "lucide-react";
import { toast } from "sonner";
import "./Chat.css";

interface MediaObj {
  url: string;
  type: "image" | "video" | "sticker" | "audio";
  mimeType: string;
  filename?: string;
  expiresAt: number;
}

interface Message {
  id: string;
  text: string;
  sender: "client" | "agent" | "system";
  timestamp: number;
  status: "pending" | "sent" | "delivered" | "read" | "pending_connection" | "failed_expired";
  media?: MediaObj;
  error?: string;
}

interface ChatSession {
  id: string;
  contactName: string;
  contactPhotoUrl?: string;
  lastMessageText: string;
  lastMessageTimestamp: number;
  unreadCount: number;
  updatedAt: number;
}

export const Chat: React.FC = () => {
  const [chats, setChats] = useState<ChatSession[]>([]);
  const [selectedChat, setSelectedChat] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [sending, setSending] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [whatsappStatus, setWhatsappStatus] = useState<string>("disconnected");

  // File Upload State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileBase64, setFileBase64] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const WHATSAPP_API_URL = import.meta.env.VITE_WHATSAPP_API_URL || "http://localhost:5000";

  // 1. Escuta o status global do WhatsApp para exibir banners
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "whatsapp_config", "whatsapp"), (docSnap) => {
      if (docSnap.exists()) {
        setWhatsappStatus(docSnap.data().status || "disconnected");
      }
    });
    return () => unsub();
  }, []);

  // 2. Escuta a lista de chats ativos no Firestore
  useEffect(() => {
    const q = query(collection(db, "whatsapp_chats"), orderBy("lastMessageTimestamp", "desc"));
    const unsub = onSnapshot(q, (snapshot) => {
      const chatList: ChatSession[] = [];
      snapshot.forEach((docSnap) => {
        chatList.push({
          id: docSnap.id,
          ...docSnap.data()
        } as ChatSession);
      });
      setChats(chatList);
    });
    return () => unsub();
  }, []);

  // 3. Escuta as mensagens da conversa ativa no Firestore
  useEffect(() => {
    if (!selectedChat) {
      setMessages([]);
      return;
    }

    // Zera o contador de não lidas ao abrir a conversa
    if (selectedChat.unreadCount > 0) {
      updateDoc(doc(db, "whatsapp_chats", selectedChat.id), {
        unreadCount: 0
      }).catch(err => console.error("Erro ao zerar unreadCount:", err));
    }

    const q = query(
      collection(db, "whatsapp_chats", selectedChat.id, "messages"),
      orderBy("timestamp", "asc")
    );
    const unsub = onSnapshot(q, (snapshot) => {
      const msgList: Message[] = [];
      snapshot.forEach((docSnap) => {
        msgList.push({
          id: docSnap.id,
          ...docSnap.data()
        } as Message);
      });
      setMessages(msgList);
      scrollToBottom();
    });

    // Tenta atualizar a foto de perfil do contato se ela não existir
    if (!selectedChat.contactPhotoUrl) {
      fetch(`${WHATSAPP_API_URL}/api/whatsapp/profile-pic?number=${selectedChat.id}`)
        .then(res => res.json())
        .then(data => {
          if (data.success && data.url) {
            updateDoc(doc(db, "whatsapp_chats", selectedChat.id), {
              contactPhotoUrl: data.url
            });
          }
        })
        .catch(err => console.warn("Erro ao buscar profile pic:", err));
    }

    return () => unsub();
  }, [selectedChat]);

  // Rola até o final das mensagens
  const scrollToBottom = () => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, 100);
  };

  // Trata seleção de arquivos para envio
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      toast.error("O arquivo deve ter no máximo 10MB.");
      return;
    }

    setSelectedFile(file);

    const reader = new FileReader();
    reader.onload = () => {
      setFileBase64(reader.result as string);
    };
    reader.onerror = () => {
      toast.error("Erro ao ler o arquivo.");
    };
    reader.readAsDataURL(file);
  };

  // Envia mensagem de texto/mídia
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() && !fileBase64) return;
    if (!selectedChat) return;

    setSending(true);
    const tempText = inputText;
    const tempFileBase64 = fileBase64;
    const tempFilename = selectedFile?.name;

    setInputText("");
    setSelectedFile(null);
    setFileBase64(null);

    try {
      const response = await fetch(`${WHATSAPP_API_URL}/api/whatsapp/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          to: selectedChat.id,
          message: tempText,
          imageBase64: tempFileBase64 || undefined,
          filename: tempFilename
        })
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || "Erro ao enfileirar mensagem.");
      }
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Falha ao enviar mensagem.");
      // Restaura o texto em caso de erro
      setInputText(tempText);
    } finally {
      setSending(false);
      scrollToBottom();
    }
  };

  const renderMessageStatus = (status: Message["status"]) => {
    switch (status) {
      case "pending":
      case "pending_connection":
        return <Clock size={12} className="status-icon pending" />;
      case "failed_expired":
        return <AlertCircle size={12} className="status-icon failed" title="Expirada sem envio" />;
      case "sent":
        return <Check size={12} className="status-icon sent" />;
      case "delivered":
      case "read":
        return <CheckCheck size={12} className="status-icon delivered" />;
      default:
        return null;
    }
  };

  const renderMedia = (media: MediaObj) => {
    // Verifica expiração da URL assinada
    const isExpired = Date.now() > media.expiresAt;

    if (isExpired) {
      return (
        <div className="media-expired">
          <AlertCircle size={16} />
          <span>Mídia expirada (Segurança)</span>
        </div>
      );
    }

    switch (media.type) {
      case "image":
      case "sticker":
        return (
          <img 
            src={media.url} 
            alt={media.filename || "Imagem"} 
            className={`message-media-img ${media.type === "sticker" ? "sticker" : ""}`} 
            onClick={() => setAvatarPreview(media.url)}
          />
        );
      case "video":
        return (
          <video src={media.url} controls className="message-media-video" />
        );
      case "audio":
        return (
          <audio src={media.url} controls className="message-media-audio" />
        );
      default:
        return (
          <a href={media.url} target="_blank" rel="noopener noreferrer" className="media-download-link">
            <FileText size={16} />
            <span>{media.filename || "Baixar arquivo"}</span>
          </a>
        );
    }
  };

  return (
    <div className="chat-container">
      {/* Banner de Status de Conexão do WhatsApp */}
      {whatsappStatus !== "connected" && (
        <div className="connection-warning-banner animate-slide-down">
          <AlertCircle size={16} />
          <span>
            {whatsappStatus === "qrcode" 
              ? "WhatsApp aguardando leitura de QR Code. Conecte nas Configurações de WhatsApp." 
              : "WhatsApp desconectado. As mensagens ficarão retidas na fila até a conexão."}
          </span>
        </div>
      )}

      <div className="chat-grid">
        {/* Sidebar com lista de contatos/chats */}
        <aside className="chat-sidebar">
          <div className="sidebar-header">
            <h2>Conversas</h2>
          </div>
          <div className="sidebar-list">
            {chats.length === 0 ? (
              <div className="empty-chats">
                <p>Nenhuma conversa ativa no momento.</p>
              </div>
            ) : (
              chats.map((chat) => (
                <div 
                  key={chat.id} 
                  className={`chat-item ${selectedChat?.id === chat.id ? "active" : ""}`}
                  onClick={() => setSelectedChat(chat)}
                >
                  <div className="chat-avatar" onClick={(e) => {
                    if (chat.contactPhotoUrl) {
                      e.stopPropagation();
                      setAvatarPreview(chat.contactPhotoUrl);
                    }
                  }}>
                    {chat.contactPhotoUrl ? (
                      <img src={chat.contactPhotoUrl} alt={chat.contactName} />
                    ) : (
                      <User size={20} />
                    )}
                  </div>
                  <div className="chat-details">
                    <div className="chat-meta">
                      <span className="contact-name">+{chat.contactName}</span>
                      <span className="last-msg-time">
                        {new Date(chat.lastMessageTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="chat-message-preview">
                      <p>{chat.lastMessageText}</p>
                      {chat.unreadCount > 0 && (
                        <span className="unread-badge">{chat.unreadCount}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Área de conversa ativa */}
        <main className="chat-main">
          {selectedChat ? (
            <>
              {/* Topbar da conversa */}
              <header className="chat-main-header">
                <button className="btn-back" onClick={() => setSelectedChat(null)}>
                  <ChevronLeft size={20} />
                </button>
                <div className="active-contact-avatar" onClick={() => selectedChat.contactPhotoUrl && setAvatarPreview(selectedChat.contactPhotoUrl)}>
                  {selectedChat.contactPhotoUrl ? (
                    <img src={selectedChat.contactPhotoUrl} alt={selectedChat.contactName} />
                  ) : (
                    <User size={20} />
                  )}
                </div>
                <div className="active-contact-info">
                  <h3>+{selectedChat.contactName}</h3>
                  <span className="status-indicator">Atendimento Ativo</span>
                </div>
              </header>

              {/* Lista de mensagens */}
              <div className="messages-viewport">
                {messages.map((msg) => {
                  const isAgent = msg.sender === "agent";
                  const isSystem = msg.sender === "system";
                  return (
                    <div 
                      key={msg.id} 
                      className={`message-row ${isAgent ? "outgoing" : isSystem ? "system" : "incoming"}`}
                    >
                      <div className="message-bubble">
                        {/* Renderização de Mídia */}
                        {msg.media && renderMedia(msg.media)}
                        
                        {/* Texto */}
                        {msg.text && <p className="message-text">{msg.text}</p>}
                        
                        <div className="message-meta">
                          <span className="message-time">
                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                          {isAgent && renderMessageStatus(msg.status)}
                        </div>

                        {msg.error && (
                          <div className="message-error-desc">
                            <AlertCircle size={10} />
                            <span>Erro: {msg.error}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>

              {/* Barra de Input de envio */}
              <footer className="chat-footer">
                {fileBase64 && (
                  <div className="file-preview-bar">
                    <span className="file-name">{selectedFile?.name}</span>
                    <button 
                      type="button" 
                      onClick={() => {
                        setSelectedFile(null);
                        setFileBase64(null);
                      }} 
                      className="btn-remove-file"
                    >
                      Cancelar
                    </button>
                  </div>
                )}
                
                <form onSubmit={handleSendMessage} className="chat-input-form">
                  <button 
                    type="button" 
                    className="btn-attach" 
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip size={20} />
                  </button>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleFileChange} 
                    style={{ display: "none" }}
                    accept="image/*,video/*,audio/*,application/pdf"
                  />
                  
                  <input 
                    type="text" 
                    placeholder="Digite uma mensagem..." 
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    className="chat-input"
                    disabled={sending}
                  />
                  <button 
                    type="submit" 
                    className="btn-send" 
                    disabled={(!inputText.trim() && !fileBase64) || sending}
                  >
                    {sending ? (
                      <Loader2 className="spinner" size={18} />
                    ) : (
                      <Send size={18} />
                    )}
                  </button>
                </form>
              </footer>
            </>
          ) : (
            <div className="no-chat-selected">
              <Phone size={48} className="placeholder-icon" />
              <h3>Selecione uma conversa</h3>
              <p>Escolha um contato na lista ao lado para iniciar ou visualizar o atendimento.</p>
            </div>
          )}
        </main>
      </div>

      {/* Modal de visualização de foto em tamanho grande */}
      {avatarPreview && (
        <div className="avatar-preview-overlay" onClick={() => setAvatarPreview(null)}>
          <div className="avatar-preview-modal" onClick={(e) => e.stopPropagation()}>
            <img src={avatarPreview} alt="Visualização" />
            <button className="btn-close-modal" onClick={() => setAvatarPreview(null)}>
              Fechar
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
