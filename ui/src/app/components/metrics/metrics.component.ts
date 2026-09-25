import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService, Metrics } from '../../services/api.service';

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

    <div *ngIf="metrics" class="metrics-container">
      <!-- PostgreSQL Section -->
      <div class="db-section">
        <div class="db-header pg">
          <span class="db-icon">🐘</span>
          <h2>PostgreSQL</h2>
        </div>
        <div class="gauge-grid">
          <div class="gauge-card">
            <div class="gauge-value">{{ metrics.postgres?.totalSessions ?? '—' }}</div>
            <div class="gauge-label">Sesiones Totales</div>
            <div class="gauge-bar">
              <div class="gauge-fill pg" [style.width.%]="getPercent(metrics.postgres?.activeSessions, metrics.postgres?.totalSessions)"></div>
            </div>
            <div class="gauge-detail">{{ metrics.postgres?.activeSessions ?? 0 }} activas</div>
          </div>
          <div class="gauge-card">
            <div class="gauge-value">{{ (metrics.postgres?.avgQuerySeconds ?? 0) | number:'1.2-2' }}s</div>
            <div class="gauge-label">Avg Query Time</div>
            <div class="gauge-bar">
              <div class="gauge-fill" [class.warning]="(metrics.postgres?.avgQuerySeconds ?? 0) > 1" 
                   [style.width.%]="Math.min((metrics.postgres?.avgQuerySeconds ?? 0) * 20, 100)"></div>
            </div>
            <div class="gauge-detail" [class.text-warning]="(metrics.postgres?.avgQuerySeconds ?? 0) > 1">
              {{ (metrics.postgres?.avgQuerySeconds ?? 0) > 1 ? '⚠️ Lento' : '✅ Normal' }}
            </div>
          </div>
          <div class="gauge-card">
            <div class="gauge-value">{{ metrics.postgres?.cacheHitRatio !== undefined ? ((metrics.postgres?.cacheHitRatio ?? 0) | number:'1.1-2') + '%' : '—' }}</div>
            <div class="gauge-label">Cache Hit Ratio</div>
            <div class="gauge-bar">
              <div class="gauge-fill" 
                   [class.pg]="(metrics.postgres?.cacheHitRatio ?? 0) >= 95"
                   [class.warning]="(metrics.postgres?.cacheHitRatio ?? 0) < 95 && (metrics.postgres?.cacheHitRatio ?? 0) >= 90"
                   [class.danger]="(metrics.postgres?.cacheHitRatio ?? 0) < 90"
                   [style.width.%]="metrics.postgres?.cacheHitRatio ?? 0"></div>
            </div>
            <div class="gauge-detail" 
                 [class.text-warning]="(metrics.postgres?.cacheHitRatio ?? 0) < 95 && (metrics.postgres?.cacheHitRatio ?? 0) >= 90"
                 [class.text-danger]="(metrics.postgres?.cacheHitRatio ?? 0) < 90">
              {{ metrics.postgres?.cacheHitRatio !== undefined ? ((metrics.postgres?.cacheHitRatio ?? 0) >= 95 ? '⚡ Óptimo (>95%)' : ((metrics.postgres?.cacheHitRatio ?? 0) >= 90 ? '⚠️ Aceptable' : '🔥 Requiere atención')) : '—' }}
            </div>
          </div>
          <div class="gauge-card">
            <div class="gauge-value">{{ metrics.postgres?.dbSizeGb !== undefined ? ((metrics.postgres?.dbSizeGb ?? 0) | number:'1.1-2') + ' GB' : '—' }}</div>
            <div class="gauge-label">DB Size</div>
            <div class="gauge-bar">
              <div class="gauge-fill pg" [style.width.%]="Math.min(((metrics.postgres?.dbSizeGb ?? 0) / 100) * 100, 100)"></div>
            </div>
            <div class="gauge-detail">Espacio en disco utilizado</div>
          </div>
        </div>
        <div class="raw-data">
          <button (click)="showPgRaw = !showPgRaw" class="btn-link">
            {{ showPgRaw ? '▼ Ocultar datos raw' : '▶ Ver datos raw' }}
          </button>
          <pre *ngIf="showPgRaw">{{ metrics.postgres | json }}</pre>
        </div>
      </div>

      <!-- MSSQL Section -->
      <div class="db-section">
        <div class="db-header mssql">
          <span class="db-icon">🔷</span>
          <h2>MSSQL Server</h2>
        </div>
        <div class="gauge-grid">
          <div class="gauge-card">
            <div class="gauge-value">{{ metrics.mssql?.totalSessions ?? '—' }}</div>
            <div class="gauge-label">Sesiones Totales</div>
            <div class="gauge-bar">
              <div class="gauge-fill mssql" [style.width.%]="getPercent(metrics.mssql?.activeSessions, metrics.mssql?.totalSessions)"></div>
            </div>
            <div class="gauge-detail">{{ metrics.mssql?.activeSessions ?? 0 }} activas</div>
          </div>
          <div class="gauge-card">
            <div class="gauge-value">{{ (metrics.mssql?.cpuUsagePercent ?? 0) | number:'1.1-1' }}%</div>
            <div class="gauge-label">CPU Usage</div>
            <div class="gauge-bar">
              <div class="gauge-fill" [class.warning]="(metrics.mssql?.cpuUsagePercent ?? 0) > 80" 
                   [class.danger]="(metrics.mssql?.cpuUsagePercent ?? 0) > 95"
                   [style.width.%]="metrics.mssql?.cpuUsagePercent ?? 0"></div>
            </div>
            <div class="gauge-detail" [class.text-warning]="(metrics.mssql?.cpuUsagePercent ?? 0) > 80">
              {{ (metrics.mssql?.cpuUsagePercent ?? 0) > 80 ? '🔥 Alto' : '✅ Normal' }}
            </div>
          </div>
          <div class="gauge-card">
            <div class="gauge-value">{{ metrics.mssql?.memoryGb !== undefined ? ((metrics.mssql?.memoryGb ?? 0) | number:'1.1-1') + ' GB' : '—' }}</div>
            <div class="gauge-label">Memory Usage</div>
            <div class="gauge-bar">
              <div class="gauge-fill mssql" [style.width.%]="Math.min(((metrics.mssql?.memoryGb ?? 0) / 64) * 100, 100)"></div>
            </div>
            <div class="gauge-detail">Memoria en uso</div>
          </div>
          <div class="gauge-card">
            <div class="gauge-value text-wait" [title]="metrics.mssql?.topWait ?? 'None'">{{ metrics.mssql?.topWait ?? 'None' }}</div>
            <div class="gauge-label">Top Wait State</div>
            <div class="gauge-bar">
              <div class="gauge-fill" [class.warning]="!!metrics.mssql?.topWait && metrics.mssql?.topWait !== 'None'" [style.width.%]="metrics.mssql?.topWait && metrics.mssql?.topWait !== 'None' ? 100 : 0"></div>
            </div>
            <div class="gauge-detail" [class.text-warning]="!!metrics.mssql?.topWait && metrics.mssql?.topWait !== 'None'">
              {{ (metrics.mssql?.topWait && metrics.mssql?.topWait !== 'None') ? '⚠️ ' + metrics.mssql?.topWait : '✅ Sin esperas críticas' }}
            </div>
          </div>
        </div>
        <div class="raw-data">
          <button (click)="showMssqlRaw = !showMssqlRaw" class="btn-link">
            {{ showMssqlRaw ? '▼ Ocultar datos raw' : '▶ Ver datos raw' }}
          </button>
          <pre *ngIf="showMssqlRaw">{{ metrics.mssql | json }}</pre>
        </div>
      </div>
    </div>

    <p *ngIf="lastUpdated" class="last-updated">Última actualización: {{ lastUpdated | date:'medium' }}</p>
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

    .metrics-container { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }

    .db-section { background: #fff; border-radius: 14px; padding: 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
    .db-header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 2px solid #eee; }
    .db-header.pg { border-bottom-color: #336791; }
    .db-header.mssql { border-bottom-color: #cc2927; }
    .db-icon { font-size: 2rem; }
    .db-header h2 { margin: 0; color: #1a1a2e; }

    .gauge-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .gauge-card { background: #f8f9ff; padding: 20px; border-radius: 12px; text-align: center; }
    .gauge-value { font-size: 2.4rem; font-weight: bold; color: #0f3460; }
    .gauge-label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin: 4px 0 12px; }
    .gauge-bar { height: 8px; background: #e8ecf4; border-radius: 4px; overflow: hidden; }
    .gauge-fill { height: 100%; border-radius: 4px; background: #28a745; transition: width 0.5s; }
    .gauge-fill.pg { background: #336791; }
    .gauge-fill.mssql { background: #cc2927; }
    .gauge-fill.warning { background: #ffc107; }
    .gauge-fill.danger { background: #e94560; }
    .gauge-detail { margin-top: 8px; font-size: 13px; color: #666; }
    .text-warning { color: #e65100 !important; font-weight: 600; }
    .text-danger { color: #e94560 !important; font-weight: 600; }
    .text-wait { font-size: 1.5rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .raw-data { margin-top: 16px; }
    .btn-link { background: none; border: none; color: #0f3460; cursor: pointer; font-size: 13px; padding: 0; }
    .btn-link:hover { text-decoration: underline; }
    pre { background: #f0f0f0; padding: 12px; border-radius: 8px; overflow-x: auto; font-size: 12px; margin-top: 8px; }

    .last-updated { color: #888; font-size: 13px; margin-top: 20px; text-align: center; }

    @media (max-width: 768px) { .metrics-container { grid-template-columns: 1fr; } }
  `],
})
export class MetricsComponent implements OnInit, OnDestroy {
  metrics: Metrics | null = null;
  loading = false;
  error: string | null = null;
  autoRefresh = false;
  lastUpdated: Date | null = null;
  showPgRaw = false;
  showMssqlRaw = false;
  Math = Math;
  private intervalId: any = null;

  constructor(private api: ApiService) {}

  ngOnInit() { this.refresh(); }
  ngOnDestroy() { this.stopAutoRefresh(); }

  refresh() {
    this.loading = true;
    this.api.getMetrics().subscribe({
      next: (data) => { this.metrics = data; this.lastUpdated = new Date(); this.loading = false; this.error = null; },
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
