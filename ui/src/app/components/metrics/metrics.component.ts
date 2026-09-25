import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService, ServerMetric } from '../../services/api.service';

@Component({
  selector: 'app-metrics',
  standalone: true,
  imports: [CommonModule],
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
    .db-header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 2px solid #eee; }
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
  `]
})
export class MetricsComponent implements OnInit, OnDestroy {
  metrics: ServerMetric[] = [];
  loading = false;
  error: string | null = null;
  autoRefresh = false;
  private intervalId: any = null;

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
}
