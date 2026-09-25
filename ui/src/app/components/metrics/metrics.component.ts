import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, ServerMetric } from '../../services/api.service';

@Component({
  selector: 'app-metrics',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="page-header">
      <h1>📈 Database Metrics</h1>
      <div class="toolbar">
        <button (click)="refresh()" [disabled]="loading" class="btn btn-primary">
          {{ loading ? '⏳ Cargando...' : '🔄 Actualizar' }}
        </button>
        <button (click)="toggleAutoRefresh()" class="btn" [class.btn-success]="!autoRefresh" [class.btn-danger]="autoRefresh">
          {{ autoRefresh ? '⏸ Detener Auto-Refresh' : '▶ Auto-Refresh (10s)' }}
        </button>
      </div>
    </div>

    <div *ngIf="error" class="error-banner">⚠️ {{ error }}</div>

    <div *ngIf="metrics && metrics.length > 0" class="metrics-container">
      <div *ngFor="let server of metrics" class="db-section">
        <div class="db-header" [ngClass]="server.type">
          <span class="db-icon">
            <ng-container [ngSwitch]="server.type">
              <span *ngSwitchCase="'postgres'">🐘</span>
              <span *ngSwitchCase="'mssql'">🔷</span>
              <span *ngSwitchCase="'mongodb'">🍃</span>
              <span *ngSwitchCase="'redis'">⚡</span>
              <span *ngSwitchCase="'dynamodb'">☁️</span>
            </ng-container>
          </span>
          <h2>{{ server.name }} <small>({{ server.type }})</small></h2>
          
          <div class="db-actions">
            <ng-container *ngIf="server.type === 'mssql'">
              <div style="display: inline-block; position: relative;">
                <button class="btn btn-action" (click)="toggleBlitzMenu(server)">⚡ First Responder Kit ▼</button>
                <div *ngIf="showBlitzMenu[server.serverId || server.name]" style="position: absolute; top: 100%; right: 0; background: white; border: 1px solid #ccc; border-radius: 4px; box-shadow: 0 2px 5px rgba(0,0,0,0.2); z-index: 10; min-width: 200px; display: flex; flex-direction: column;">
                  <button class="btn btn-action" style="border: none; border-bottom: 1px solid #eee; text-align: left; width: 100%;" (click)="runBlitzAction(server, 'blitz')">⚡ sp_Blitz</button>
                  <button class="btn btn-action" style="border: none; border-bottom: 1px solid #eee; text-align: left; width: 100%;" (click)="runBlitzAction(server, 'cache')">⚡ sp_BlitzCache</button>
                  <button class="btn btn-action" style="border: none; border-bottom: 1px solid #eee; text-align: left; width: 100%;" (click)="runBlitzAction(server, 'index')">⚡ sp_BlitzIndex</button>
                  <button class="btn btn-action" style="border: none; border-bottom: 1px solid #eee; text-align: left; width: 100%;" (click)="runBlitzAction(server, 'lock')">⚡ sp_BlitzLock</button>
                  <button class="btn btn-action" style="border: none; border-bottom: 1px solid #eee; text-align: left; width: 100%;" (click)="runBlitzAction(server, 'querystore')">⚡ sp_BlitzQueryStore</button>
                  <button class="btn btn-action" style="border: none; text-align: left; width: 100%;" (click)="installBlitz(server)">⚙️ Install First Responder Kit</button>
                </div>
              </div>
            </ng-container>
            <button class="btn btn-action" (click)="downloadPdf(server)">📄 Exportar PDF</button>
            <button class="btn btn-action" (click)="toggleEmailForm(server.serverId || server.name)">✉️ Enviar por Correo</button>
          </div>
        </div>

        <div *ngIf="blitzResults[server.serverId || server.name]" class="blitz-results">
          <h4>⚡ Resultados de sp_Blitz</h4>
          <div class="blitz-table-wrapper">
            <table class="blitz-table">
              <thead>
                <tr>
                  <th *ngFor="let col of getBlitzKeys(server)">{{ col }}</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let item of blitzResults[server.serverId || server.name]">
                  <td *ngFor="let col of getBlitzKeys(server)">
                    <ng-container *ngIf="isXml(item[col]); else textNode">
                      <pre><code class="xml-format">{{ item[col] }}</code></pre>
                    </ng-container>
                    <ng-template #textNode>{{ item[col] }}</ng-template>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        
        <div class="email-form-card" *ngIf="showEmailForm[server.serverId || server.name]">
          <h4>Enviar reporte de {{ server.name }}</h4>
          <div class="form-group">
            <label>Destinatario</label>
            <input type="email" [(ngModel)]="emailData[server.serverId || server.name].to" class="input-field" placeholder="destinatario@correo.com">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>SMTP Host</label>
              <input type="text" [(ngModel)]="emailData[server.serverId || server.name].host" class="input-field">
            </div>
            <div class="form-group">
              <label>SMTP Port</label>
              <input type="number" [(ngModel)]="emailData[server.serverId || server.name].port" class="input-field">
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Tu Correo</label>
              <input type="email" [(ngModel)]="emailData[server.serverId || server.name].user" class="input-field" placeholder="tu-correo@gmail.com">
            </div>
            <div class="form-group">
              <label>App Password</label>
              <input type="password" [(ngModel)]="emailData[server.serverId || server.name].password" class="input-field" placeholder="****">
            </div>
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" (click)="sendEmail(server)" [disabled]="isSending[server.serverId || server.name]">
              {{ isSending[server.serverId || server.name] ? '⏳ Enviando...' : '📤 Enviar' }}
            </button>
            <button class="btn btn-danger" (click)="toggleEmailForm(server.serverId || server.name)">Cancelar</button>
          </div>
          <div class="inline-alert success" *ngIf="emailSuccess[server.serverId || server.name]">✅ Correo enviado con éxito.</div>
          <div class="inline-alert error" *ngIf="emailError[server.serverId || server.name]">⚠️ {{ emailError[server.serverId || server.name] }}</div>
        </div>
        
        <div class="gauge-grid">
          <!-- PostgreSQL -->
          <ng-container *ngIf="server.type === 'postgres'">
            <div class="gauge-card">
              <div class="gauge-value">{{ server.metrics.totalSessions ?? '—' }}</div>
              <div class="gauge-label">Sesiones Totales</div>
              <div class="gauge-bar"><div class="gauge-fill postgres" [style.width.%]="getPercent(server.metrics.activeSessions, server.metrics.totalSessions)"></div></div>
              <div class="gauge-detail">{{ server.metrics.activeSessions ?? 0 }} activas</div>
            </div>
            <div class="gauge-card">
              <div class="gauge-value">{{ server.metrics.cacheHitRatio !== undefined ? (server.metrics.cacheHitRatio | number:'1.1-2') + '%' : '—' }}</div>
              <div class="gauge-label">Cache Hit Ratio</div>
              <div class="gauge-bar"><div class="gauge-fill postgres" [style.width.%]="server.metrics.cacheHitRatio ?? 0"></div></div>
            </div>
            <div class="gauge-card">
              <div class="gauge-value">{{ server.metrics.dbSizeGb !== undefined ? (server.metrics.dbSizeGb | number:'1.1-2') + ' GB' : '—' }}</div>
              <div class="gauge-label">DB Size</div>
            </div>
          </ng-container>

          <!-- MSSQL -->
          <ng-container *ngIf="server.type === 'mssql'">
            <div class="gauge-card">
              <div class="gauge-value">{{ server.metrics.totalSessions ?? '—' }}</div>
              <div class="gauge-label">Sesiones Totales</div>
            </div>
            <div class="gauge-card">
              <div class="gauge-value">{{ (server.metrics.cpuUsagePercent ?? 0) | number:'1.1-1' }}%</div>
              <div class="gauge-label">CPU Usage</div>
              <div class="gauge-bar"><div class="gauge-fill mssql" [style.width.%]="server.metrics.cpuUsagePercent ?? 0"></div></div>
            </div>
            <div class="gauge-card">
              <div class="gauge-value">{{ server.metrics.memoryGb !== undefined ? (server.metrics.memoryGb | number:'1.1-1') + ' GB' : '—' }}</div>
              <div class="gauge-label">Memory Usage</div>
            </div>
            <div class="gauge-card">
              <div class="gauge-value">{{ server.metrics.topWait ?? 'None' }}</div>
              <div class="gauge-label">Top Wait State</div>
            </div>
          </ng-container>

          <!-- MongoDB -->
          <ng-container *ngIf="server.type === 'mongodb'">
            <div class="gauge-card">
              <div class="gauge-value">{{ server.metrics.activeConnections ?? '—' }}</div>
              <div class="gauge-label">Active Connections</div>
            </div>
            <div class="gauge-card">
              <div class="gauge-value">{{ server.metrics.queriesPerSec ?? '—' }}</div>
              <div class="gauge-label">Queries / Sec</div>
            </div>
            <div class="gauge-card">
              <div class="gauge-value">{{ server.metrics.dbSizeGb !== undefined ? (server.metrics.dbSizeGb | number:'1.1-2') + ' GB' : '—' }}</div>
              <div class="gauge-label">DB Size</div>
            </div>
          </ng-container>

          <!-- Redis -->
          <ng-container *ngIf="server.type === 'redis'">
            <div class="gauge-card">
              <div class="gauge-value">{{ server.metrics.connectedClients ?? '—' }}</div>
              <div class="gauge-label">Connected Clients</div>
            </div>
            <div class="gauge-card">
              <div class="gauge-value">{{ server.metrics.hitRate !== undefined ? (server.metrics.hitRate | number:'1.1-2') + '%' : '—' }}</div>
              <div class="gauge-label">Hit Rate</div>
              <div class="gauge-bar"><div class="gauge-fill redis" [style.width.%]="server.metrics.hitRate ?? 0"></div></div>
            </div>
            <div class="gauge-card">
              <div class="gauge-value">{{ server.metrics.usedMemoryGb !== undefined ? (server.metrics.usedMemoryGb | number:'1.1-2') + ' GB' : '—' }}</div>
              <div class="gauge-label">Used Memory</div>
            </div>
          </ng-container>

          <!-- DynamoDB -->
          <ng-container *ngIf="server.type === 'dynamodb'">
            <div class="gauge-card">
              <div class="gauge-value">{{ server.metrics.activeTables ?? '—' }}</div>
              <div class="gauge-label">Active Tables</div>
            </div>
            <div class="gauge-card">
              <div class="gauge-value">{{ server.metrics.provisionedRcu ?? '—' }}</div>
              <div class="gauge-label">Provisioned RCU</div>
            </div>
            <div class="gauge-card">
              <div class="gauge-value">{{ server.metrics.provisionedWcu ?? '—' }}</div>
              <div class="gauge-label">Provisioned WCU</div>
            </div>
          </ng-container>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 12px; }
    .page-header h1 { color: #1a1a2e; margin: 0; }
    .toolbar { display: flex; gap: 10px; }

    .btn { padding: 10px 20px; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; transition: all 0.2s; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary { background: #0f3460; color: #fff; }
    .btn-primary:hover:not(:disabled) { background: #1a4a7a; }
    .btn-success { background: #28a745; color: #fff; }
    .btn-success:hover { background: #218838; }
    .btn-danger { background: #e94560; color: #fff; }
    .btn-danger:hover { background: #c73e54; }

    .error-banner { color: #e94560; padding: 14px 20px; background: #ffe0e6; border-radius: 10px; border-left: 4px solid #e94560; margin-bottom: 20px; }

    .metrics-container { display: grid; grid-template-columns: 1fr; gap: 24px; }

    .db-section { background: #fff; border-radius: 14px; padding: 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
    .db-header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 2px solid #eee; flex-wrap: wrap; }
    .db-actions { margin-left: auto; display: flex; gap: 8px; }
    .btn-action { background: #f0f2f5; color: #333; border: 1px solid #ddd; padding: 6px 12px; font-size: 13px; }
    .btn-action:hover { background: #e4e6e9; }

    .email-form-card { background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 16px; margin-bottom: 20px; }
    .email-form-card h4 { margin-top: 0; margin-bottom: 12px; color: #333; }
    .form-group { margin-bottom: 12px; display: flex; flex-direction: column; flex: 1; }
    .form-group label { font-size: 12px; font-weight: bold; color: #555; margin-bottom: 4px; }
    .input-field { padding: 8px 12px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; width: 100%; box-sizing: border-box; }
    .form-row { display: flex; gap: 12px; flex-wrap: wrap; }
    .form-actions { display: flex; gap: 8px; margin-top: 8px; }
    .inline-alert { padding: 8px 12px; border-radius: 4px; margin-top: 12px; font-size: 13px; }
    .inline-alert.success { background: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
    .inline-alert.error { background: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }

    .db-header.postgres { border-bottom-color: #336791; }
    .db-header.mssql { border-bottom-color: #cc2927; }
    .db-header.mongodb { border-bottom-color: #4db33d; }
    .db-header.redis { border-bottom-color: #d82c20; }
    .db-header.dynamodb { border-bottom-color: #f58536; }
    .db-icon { font-size: 2rem; }
    .db-header h2 { margin: 0; color: #1a1a2e; display: flex; align-items: center; gap: 8px; }
    .db-header h2 small { font-size: 14px; color: #888; font-weight: normal; }

    .gauge-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
    .gauge-card { background: #f8f9ff; padding: 20px; border-radius: 12px; text-align: center; }
    .gauge-value { font-size: 2.4rem; font-weight: bold; color: #0f3460; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .gauge-label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin: 4px 0 12px; }
    .gauge-bar { height: 8px; background: #e8ecf4; border-radius: 4px; overflow: hidden; }
    .gauge-fill { height: 100%; border-radius: 4px; background: #28a745; transition: width 0.5s; }
    .gauge-fill.postgres { background: #336791; }
    .gauge-fill.mssql { background: #cc2927; }
    .gauge-fill.mongodb { background: #4db33d; }
    .gauge-fill.redis { background: #d82c20; }
    .gauge-detail { margin-top: 8px; font-size: 13px; color: #666; }
    .blitz-results { margin-bottom: 20px; background: #fff8f8; border: 1px solid #f5c6cb; border-radius: 8px; padding: 16px; }
    .blitz-results h4 { margin-top: 0; color: #cc2927; }
    .blitz-table-wrapper { overflow-x: auto; max-height: 300px; }
    .blitz-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .blitz-table th, .blitz-table td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    .blitz-table th { background: #ffebee; color: #cc2927; position: sticky; top: 0; }
    .xml-format { white-space: pre-wrap; word-break: break-all; font-family: monospace; background: #f4f4f4; padding: 4px; display: block; max-height: 200px; overflow-y: auto; }
  `]
})
export class MetricsComponent implements OnInit, OnDestroy {
  metrics: ServerMetric[] = [];
  loading = false;
  error: string | null = null;
  autoRefresh = false;
  private intervalId: any = null;

  showEmailForm: Record<string, boolean> = {};
  emailData: Record<string, any> = {};
  isSending: Record<string, boolean> = {};
  emailSuccess: Record<string, boolean> = {};
  emailError: Record<string, string> = {};

  blitzResults: Record<string, any[]> = {};

  constructor(private api: ApiService) {}

  ngOnInit() { this.refresh(); }
  ngOnDestroy() { this.stopAutoRefresh(); }

  refresh() {
    this.loading = true;
    this.api.getMetrics().subscribe({
      next: (data) => { this.metrics = data; this.loading = false; this.error = null; },
      error: (err) => { this.error = 'Error cargando métricas: ' + (err.message || err.statusText); this.loading = false; },
    });
  }

  getPercent(active: number | undefined, total: number | undefined): number {
    if (!total || total === 0) return 0;
    return Math.min(((active ?? 0) / total) * 100, 100);
  }

  toggleAutoRefresh() {
    this.autoRefresh = !this.autoRefresh;
    if (this.autoRefresh) {
      this.intervalId = setInterval(() => this.refresh(), 10000);
    } else {
      this.stopAutoRefresh();
    }
  }

  private stopAutoRefresh() {
    if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = null; }
    this.autoRefresh = false;
  }

  downloadPdf(server: ServerMetric) {
    this.api.downloadPdf(server).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `report_${server.name}.pdf`;
        a.click();
        window.URL.revokeObjectURL(url);
      },
      error: (err) => console.error('Error downloading PDF', err)
    });
  }

  toggleEmailForm(id: string) {
    this.showEmailForm[id] = !this.showEmailForm[id];
    if (this.showEmailForm[id] && !this.emailData[id]) {
      this.emailData[id] = {
        to: '',
        host: 'smtp.gmail.com',
        port: 465,
        user: '',
        password: ''
      };
    }
    this.emailSuccess[id] = false;
    this.emailError[id] = '';
  }

  sendEmail(server: ServerMetric) {
    const id = server.serverId || server.name;
    this.isSending[id] = true;
    this.emailSuccess[id] = false;
    this.emailError[id] = '';

    const payload = {
      server,
      emailSettings: this.emailData[id]
    };

    this.api.sendEmail(payload).subscribe({
      next: () => {
        this.isSending[id] = false;
        this.emailSuccess[id] = true;
        setTimeout(() => this.showEmailForm[id] = false, 3000);
      },
      error: (err) => {
        this.isSending[id] = false;
        this.emailError[id] = err.message || 'Error al enviar correo';
      }
    });
  }

  showBlitzMenu: Record<string, boolean> = {};

  toggleBlitzMenu(server: ServerMetric) {
    const id = server.serverId || server.name;
    this.showBlitzMenu[id] = !this.showBlitzMenu[id];
  }

  async runBlitzAction(server: ServerMetric, action: string) {
    const id = server.serverId || server.name;
    this.showBlitzMenu[id] = false;
    this.blitzResults[id] = null as any; 
    try {
      const endpoint = action === 'blitz' ? `/api/servers/blitz` : `/api/servers/blitz/${action}`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId: id })
      });
      if (!res.ok) throw new Error('Error running ' + action);
      const data = await res.json();
      this.blitzResults[id] = data.results || [];
    } catch (err: any) {
      console.error(`Error running sp_Blitz${action}:`, err);
      alert(`Error running sp_Blitz${action}: ` + (err.message || err.statusText));
    }
  }

  async installBlitz(server: ServerMetric) {
    const id = server.serverId || server.name;
    this.showBlitzMenu[id] = false;
    try {
      const res = await fetch(`/api/servers/blitz/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId: id })
      });
      if (!res.ok) throw new Error('Error installing Blitz suite');
      const data = await res.json();
      alert(data.message || 'Installed successfully');
    } catch (err: any) {
      console.error('Error installing suite:', err);
      alert('Error installing suite: ' + (err.message || err.statusText));
    }
  }

  getBlitzKeys(server: ServerMetric): string[] {
    const id = server.serverId || server.name;
    const results = this.blitzResults[id];
    if (results && results.length > 0) {
      return Object.keys(results[0]);
    }
    return [];
  }

  isXml(value: any): boolean {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    return trimmed.startsWith('<') && trimmed.endsWith('>') && trimmed.includes('</');
  }
}
