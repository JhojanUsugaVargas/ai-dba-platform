import { Component, ElementRef, ViewChild, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

export interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  timestamp: Date;
  isError?: boolean;
}

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="chat-page">
      <div class="page-header">
        <div>
          <h1>💬 SQL Assistant</h1>
          <p class="subtitle">Asistente inteligente con IA para optimización de queries, resolución de errores y diagnóstico DBA</p>
        </div>
        <button (click)="clearChat()" class="btn btn-outline" title="Limpiar conversación">
          🗑️ Limpiar Chat
        </button>
      </div>

      <!-- Quick Suggestion Chips -->
      <div class="chips-container">
        <span class="chips-label">Sugerencias rápidas:</span>
        <button class="chip" (click)="askQuick('¿Cómo optimizar una consulta con INNER JOIN lenta en PostgreSQL?')">
          ⚡ Optimizar JOIN lento
        </button>
        <button class="chip" (click)="askQuick('Error: Deadlock found when trying to get lock; try restarting transaction. ¿Cómo solucionarlo?')">
          ⚠️ Resolver Deadlock
        </button>
        <button class="chip" (click)="askQuick('¿Cómo mejorar el Cache Hit Ratio en PostgreSQL si está por debajo del 90%?')">
          🐘 Mejorar Cache Hit Ratio
        </button>
        <button class="chip" (click)="askQuick('En MSSQL, ¿qué significa el wait type PAGEIOLATCH_SH y cómo reducirlo?')">
          🔷 Diagnóstico PAGEIOLATCH
        </button>
      </div>

      <!-- Chat Box -->
      <div class="chat-box">
        <!-- Messages Area -->
        <div class="messages-container" #scrollContainer>
          <div *ngFor="let msg of messages" 
               class="message-wrapper" 
               [class.user-wrapper]="msg.sender === 'user'" 
               [class.ai-wrapper]="msg.sender === 'ai'">
            
            <div class="avatar" [class.ai-avatar]="msg.sender === 'ai'" [class.user-avatar]="msg.sender === 'user'">
              {{ msg.sender === 'user' ? '🧑' : '🤖' }}
            </div>

            <div class="message-bubble" 
                 [class.user-bubble]="msg.sender === 'user'" 
                 [class.ai-bubble]="msg.sender === 'ai'"
                 [class.error-bubble]="msg.isError">
              <div class="message-sender">
                {{ msg.sender === 'user' ? 'Tú' : 'SQL Assistant AI' }}
                <span class="message-time">{{ msg.timestamp | date:'HH:mm:ss' }}</span>
              </div>
              <div class="message-text">{{ msg.text }}</div>
            </div>
          </div>

          <!-- Loading Bubble -->
          <div *ngIf="loading" class="message-wrapper ai-wrapper">
            <div class="avatar ai-avatar">🤖</div>
            <div class="message-bubble ai-bubble loading-bubble">
              <div class="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
              <span class="loading-text">Analizando consulta SQL...</span>
            </div>
          </div>

          <div #messagesEnd></div>
        </div>

        <!-- Input Area -->
        <div class="input-area">
          <textarea
            [(ngModel)]="userInput"
            (keydown)="onKeyDown($event)"
            [disabled]="loading"
            placeholder="Escribe tu pregunta sobre SQL o pega un mensaje de error aquí... (Presiona Enter para enviar, Shift+Enter para salto de línea)"
            rows="3"
            class="chat-input"
          ></textarea>

          <div class="input-actions">
            <span class="input-tip">💡 Presiona <strong>Enter</strong> para enviar, <strong>Shift+Enter</strong> para nueva línea</span>
            <button 
              (click)="send()" 
              [disabled]="loading || !userInput.trim()" 
              class="btn btn-send"
            >
              {{ loading ? '⏳ Enviando...' : '🚀 Enviar' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .chat-page {
      display: flex;
      flex-direction: column;
      height: calc(100vh - 120px);
      max-width: 1200px;
      margin: 0 auto;
    }

    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      flex-wrap: wrap;
      gap: 12px;
    }
    .page-header h1 {
      color: #1a1a2e;
      margin: 0;
      font-size: 1.8rem;
    }
    .subtitle {
      color: #666;
      margin: 4px 0 0;
      font-size: 14px;
    }

    .btn {
      padding: 9px 18px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      transition: all 0.2s;
    }
    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .btn-outline {
      background: #fff;
      color: #e94560;
      border: 1px solid #e94560;
    }
    .btn-outline:hover {
      background: #ffe0e6;
    }
    .btn-send {
      background: linear-gradient(135deg, #0f3460, #16213e);
      color: #fff;
      padding: 10px 24px;
      border-radius: 8px;
    }
    .btn-send:hover:not(:disabled) {
      background: linear-gradient(135deg, #1a4a7a, #0f3460);
      transform: translateY(-1px);
    }

    /* Quick Chips */
    .chips-container {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
      overflow-x: auto;
      padding-bottom: 4px;
      flex-wrap: wrap;
    }
    .chips-label {
      font-size: 12px;
      font-weight: 600;
      color: #777;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .chip {
      background: #fff;
      border: 1px solid #d0d7de;
      border-radius: 16px;
      padding: 6px 14px;
      font-size: 13px;
      color: #0f3460;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.2s;
    }
    .chip:hover {
      background: #eef2ff;
      border-color: #0f3460;
      transform: translateY(-1px);
    }

    /* Chat Box */
    .chat-box {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: #fff;
      border-radius: 14px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.08);
      overflow: hidden;
      min-height: 0;
    }

    /* Messages */
    .messages-container {
      flex: 1;
      overflow-y: auto;
      padding: 24px;
      display: flex;
      flex-direction: column;
      gap: 18px;
    }

    .message-wrapper {
      display: flex;
      gap: 12px;
      max-width: 80%;
      align-items: flex-start;
    }
    .user-wrapper {
      align-self: flex-end;
      flex-direction: row-reverse;
    }
    .ai-wrapper {
      align-self: flex-start;
    }

    .avatar {
      width: 38px;
      height: 38px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.2rem;
      flex-shrink: 0;
      box-shadow: 0 2px 6px rgba(0,0,0,0.1);
    }
    .user-avatar {
      background: #0f3460;
    }
    .ai-avatar {
      background: #ede9fe;
      border: 1px solid #c4b5fd;
    }

    .message-bubble {
      padding: 14px 18px;
      border-radius: 14px;
      line-height: 1.55;
      font-size: 14px;
      word-break: break-word;
    }
    .user-bubble {
      background: #0f3460;
      color: #fff;
      border-bottom-right-radius: 2px;
      box-shadow: 0 2px 8px rgba(15, 52, 96, 0.25);
    }
    .user-bubble .message-sender {
      color: #b0c4de;
    }
    .user-bubble .message-time {
      color: #8da4c4;
    }
    .ai-bubble {
      background: #f8f9ff;
      color: #222;
      border: 1px solid #e0e7ff;
      border-bottom-left-radius: 2px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
    }
    .ai-bubble .message-sender {
      color: #4f46e5;
    }
    .ai-bubble .message-time {
      color: #999;
    }
    .error-bubble {
      background: #ffe0e6;
      border-color: #fca5a5;
      color: #991b1b;
    }

    .message-sender {
      font-size: 12px;
      font-weight: 700;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .message-time {
      font-size: 11px;
      font-weight: normal;
    }
    .message-text {
      white-space: pre-wrap;
      font-family: inherit;
    }

    /* Typing Indicator */
    .loading-bubble {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 18px;
    }
    .typing-indicator {
      display: flex;
      gap: 4px;
    }
    .typing-indicator span {
      width: 8px;
      height: 8px;
      background: #7c3aed;
      border-radius: 50%;
      animation: bounce 1.4s infinite ease-in-out both;
    }
    .typing-indicator span:nth-child(1) { animation-delay: -0.32s; }
    .typing-indicator span:nth-child(2) { animation-delay: -0.16s; }
    @keyframes bounce {
      0%, 80%, 100% { transform: scale(0); }
      40% { transform: scale(1); }
    }
    .loading-text {
      font-size: 13px;
      color: #666;
      font-style: italic;
    }

    /* Input Area */
    .input-area {
      border-top: 1px solid #e5e7eb;
      padding: 16px 20px;
      background: #fafafa;
    }
    .chat-input {
      width: 100%;
      box-sizing: border-box;
      padding: 12px 16px;
      border: 1px solid #d1d5db;
      border-radius: 10px;
      font-family: inherit;
      font-size: 14px;
      resize: none;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
      background: #fff;
    }
    .chat-input:focus {
      border-color: #0f3460;
      box-shadow: 0 0 0 3px rgba(15, 52, 96, 0.12);
    }
    .chat-input:disabled {
      background: #f3f4f6;
      cursor: not-allowed;
    }

    .input-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 10px;
    }
    .input-tip {
      font-size: 12px;
      color: #888;
    }

    @media (max-width: 768px) {
      .message-wrapper { max-width: 95%; }
      .input-tip { display: none; }
    }
  `],
})
export class ChatComponent implements AfterViewChecked {
  @ViewChild('scrollContainer') private scrollContainer!: ElementRef;

  userInput = '';
  loading = false;
  private shouldScroll = false;

  messages: ChatMessage[] = [
    {
      id: 'welcome',
      sender: 'ai',
      text: '👋 ¡Hola! Soy tu **SQL Assistant** impulsado por IA.\n\nPuedes hacerme preguntas técnicas sobre optimización de queries, análisis de planes de ejecución, tuning de parámetros, o simplemente pegar cualquier mensaje de error SQL que desees diagnosticar.',
      timestamp: new Date(),
    },
  ];

  constructor(private api: ApiService) {}

  ngAfterViewChecked() {
    if (this.shouldScroll) {
      this.scrollToBottom();
      this.shouldScroll = false;
    }
  }

  onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  askQuick(question: string) {
    this.userInput = question;
    this.send();
  }

  send() {
    const question = this.userInput.trim();
    if (!question || this.loading) return;

    // Add user message
    this.messages.push({
      id: Date.now().toString(),
      sender: 'user',
      text: question,
      timestamp: new Date(),
    });

    this.userInput = '';
    this.loading = true;
    this.shouldScroll = true;

    this.api.postChat(question).subscribe({
      next: (res) => {
        this.messages.push({
          id: (Date.now() + 1).toString(),
          sender: 'ai',
          text: res?.answer || 'Sin respuesta del asistente.',
          timestamp: new Date(),
        });
        this.loading = false;
        this.shouldScroll = true;
      },
      error: (err) => {
        const errorMsg = err?.error?.error || err?.message || 'Error al conectar con el asistente AI.';
        this.messages.push({
          id: (Date.now() + 1).toString(),
          sender: 'ai',
          text: `❌ Error: ${errorMsg}`,
          timestamp: new Date(),
          isError: true,
        });
        this.loading = false;
        this.shouldScroll = true;
      },
    });
  }

  clearChat() {
    this.messages = [
      {
        id: Date.now().toString(),
        sender: 'ai',
        text: '🧹 Conversación reiniciada. ¿En qué consulta o error SQL te puedo ayudar ahora?',
        timestamp: new Date(),
      },
    ];
    this.shouldScroll = true;
  }

  private scrollToBottom(): void {
    try {
      if (this.scrollContainer?.nativeElement) {
        this.scrollContainer.nativeElement.scrollTop = this.scrollContainer.nativeElement.scrollHeight;
      }
    } catch (_) {}
  }
}
