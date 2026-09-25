import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService, ServerMetric } from '../../services/api.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="dashboard-header">
      <h1>🖥️ AI DBA Platform — Dashboard</h1>
      <p class="subtitle">Monitoreo inteligente de múltiples bases de datos</p>
    </div>

    <!-- Status Cards -->
    <div class="status-bar">
      <div class="status-item" [class.online]="backendOnline" [class.offline]="!backendOnline">
        <span class="dot"></span>
        <span>Backend: {{ backendOnline ? 'Online' : 'Offline' }}</span>
      </div>
      <div class="status-item online" *ngIf="lastRefresh">
        <span class="dot"></span>
        <span>Última actualización: {{ lastRefresh | date:'HH:mm:ss' }}</span>
      </div>
    </div>

    <!-- Summary Cards -->
    <div class="cards">
      <ng-container *ngIf="metrics && metrics.length > 0; else noMetrics">
        <div *ngFor="let server of metrics" class="card" [ngClass]="'card-' + server.type" (click)="loadMetrics()">
          <div class="card-icon">
            <ng-container [ngSwitch]="server.type">
              <span *ngSwitchCase="'postgres'">🐘</span>
              <span *ngSwitchCase="'mssql'">🔷</span>
              <span *ngSwitchCase="'mongodb'">🍃</span>
              <span *ngSwitchCase="'redis'">⚡</span>
              <span *ngSwitchCase="'dynamodb'">☁️</span>
            </ng-container>
          </div>
          <div class="card-body">
            <h3>{{ server.name }}</h3>

            <div *ngIf="server.type === 'postgres'">
              <div class="metric-value">{{ server.metrics.totalSessions ?? 0 }}</div>
              <div class="metric-label">Sesiones totales</div>
              <div class="metric-detail">
                <span class="badge active">{{ server.metrics.activeSessions ?? 0 }} activas</span>
              </div>
              <div class="metric-detail" *ngIf="server.metrics.avgQuerySeconds !== undefined">
                ⏱️ Avg query: {{ server.metrics.avgQuerySeconds | number:'1.2-2' }}s
              </div>
            </div>

            <div *ngIf="server.type === 'mssql'">
              <div class="metric-value">{{ server.metrics.totalSessions ?? 0 }}</div>
              <div class="metric-label">Sesiones totales</div>
              <div class="metric-detail">
                <span class="badge active">{{ server.metrics.activeSessions ?? 0 }} activas</span>
              </div>
              <div class="metric-detail" *ngIf="server.metrics.cpuUsagePercent !== undefined">
                🔥 CPU: {{ server.metrics.cpuUsagePercent | number:'1.1-1' }}%
              </div>
            </div>

            <div *ngIf="server.type === 'mongodb'">
              <div class="metric-value">{{ server.metrics.activeConnections ?? 0 }}</div>
              <div class="metric-label">Active Connections</div>
              <div class="metric-detail">
                Queries/sec: {{ server.metrics.queriesPerSec ?? 0 }}
              </div>
              <div class="metric-detail" *ngIf="server.metrics.dbSizeGb !== undefined">
                📦 Size: {{ server.metrics.dbSizeGb | number:'1.1-2' }} GB
              </div>
            </div>

            <div *ngIf="server.type === 'redis'">
              <div class="metric-value">{{ server.metrics.connectedClients ?? 0 }}</div>
              <div class="metric-label">Connected Clients</div>
              <div class="metric-detail">
                Hit Rate: {{ server.metrics.hitRate ?? 0 }}%
              </div>
              <div class="metric-detail" *ngIf="server.metrics.usedMemoryGb !== undefined">
                💾 Memory: {{ server.metrics.usedMemoryGb | number:'1.1-2' }} GB
              </div>
            </div>

            <div *ngIf="server.type === 'dynamodb'">
              <div class="metric-value">{{ server.metrics.activeTables ?? 0 }}</div>
              <div class="metric-label">Active Tables</div>
              <div class="metric-detail">
                RCU: {{ server.metrics.provisionedRcu ?? 0 }}
              </div>
              <div class="metric-detail">
                WCU: {{ server.metrics.provisionedWcu ?? 0 }}
              </div>
            </div>

          </div>
        </div>
      </ng-container>

      <ng-template #noMetrics>
        <div *ngIf="!error" style="color: #666; padding: 20px;">Cargando o sin métricas...</div>
      </ng-template>

      <!-- Tools Cards -->
      <div class="card card-datacheck">
        <div class="card-icon">✅</div>
        <div class="card-body">
          <h3>DataCheck</h3>
          <p>Validación de calidad de datos</p>
          <a routerLink="/datacheck" class="btn">Abrir DataCheck</a>
        </div>
      </div>

      <div class="card card-ai">
        <div class="card-icon">🤖</div>
        <div class="card-body">
          <h3>AI Analysis</h3>
          <p>Recomendaciones con IA</p>
          <a routerLink="/analysis" class="btn btn-ai">Ejecutar Análisis</a>
        </div>
      </div>
    </div>

    <div *ngIf="error" class="error-banner">⚠️ {{ error }}</div>
  `,
  styles: [`
    .dashboard-header { margin-bottom: 24px; }
    .dashboard-header h1 { color: #1a1a2e; margin: 0; font-size: 1.8rem; }
    .subtitle { color: #666; margin-top: 4px; }

    .status-bar { display: flex; gap: 20px; margin-bottom: 24px; }
    .status-item { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #666; }
    .dot { width: 10px; height: 10px; border-radius: 50%; }
    .online .dot { background: #28a745; box-shadow: 0 0 6px #28a745; }
    .offline .dot { background: #e94560; box-shadow: 0 0 6px #e94560; }

    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px; margin-bottom: 24px; }
    .card {
      background: #fff; border-radius: 14px; padding: 24px; display: flex; gap: 16px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.08); cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s; border-top: 4px solid #ddd;
    }
    .card:hover { transform: translateY(-3px); box-shadow: 0 6px 24px rgba(0,0,0,0.12); }
    .card-postgres { border-top-color: #336791; }
    .card-mssql { border-top-color: #cc2927; }
    .card-mongodb { border-top-color: #4db33d; }
    .card-redis { border-top-color: #d82c20; }
    .card-dynamodb { border-top-color: #f58536; }
    .card-datacheck { border-top-color: #28a745; }
    .card-ai { border-top-color: #7c3aed; }

    .card-icon { font-size: 2.5rem; }
    .card-body h3 { margin: 0 0 8px; color: #1a1a2e; font-size: 1.1rem; }
    .card-body p { color: #666; font-size: 14px; margin: 0 0 12px; }

    .metric-value { font-size: 2.2rem; font-weight: bold; color: #0f3460; }
    .metric-label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 1px; }
    .metric-detail { margin-top: 8px; font-size: 13px; }
    .badge { padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; }
    .badge.active { background: #e8f5e9; color: #2e7d32; }

    .btn {
      display: inline-block; padding: 8px 18px; border-radius: 8px;
      text-decoration: none; font-size: 13px; font-weight: 600;
      background: #0f3460; color: #fff; transition: background 0.2s;
    }
    .btn:hover { background: #1a4a7a; }
    .btn-ai { background: #7c3aed; }
    .btn-ai:hover { background: #6d28d9; }

    .error-banner {
      color: #e94560; padding: 14px 20px; background: #ffe0e6;
      border-radius: 10px; border-left: 4px solid #e94560; margin-top: 16px;
    }

    @media (max-width: 768px) {
      .cards { grid-template-columns: 1fr; }
    }
  `],
})
export class DashboardComponent implements OnInit {
  metrics: ServerMetric[] = [];
  error: string | null = null;
  backendOnline = false;
  lastRefresh: Date | null = null;

  constructor(private api: ApiService) {}

  ngOnInit() {
    this.loadMetrics();
  }

  loadMetrics() {
    this.error = null;
    this.api.getMetrics().subscribe({
      next: (data) => {
        this.metrics = data;
        this.backendOnline = true;
        this.lastRefresh = new Date();
      },
      error: (err) => {
        this.error = 'No se pudieron cargar las métricas: ' + (err.message || err.statusText);
        this.backendOnline = false;
      },
    });
  }
}
