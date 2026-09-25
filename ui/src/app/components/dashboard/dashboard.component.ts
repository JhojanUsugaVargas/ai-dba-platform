import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="dashboard-header">
      <h1>🖥️ AI DBA Platform — Dashboard</h1>
      <p class="subtitle">Monitoreo inteligente de bases de datos PostgreSQL & MSSQL</p>
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
      <div class="card card-pg" (click)="loadMetrics()">
        <div class="card-icon">🐘</div>
        <div class="card-body">
          <h3>PostgreSQL</h3>
          <div *ngIf="metrics?.postgres; else pgLoading">
            <div class="metric-value">{{ metrics.postgres.totalSessions ?? 0 }}</div>
            <div class="metric-label">Sesiones totales</div>
            <div class="metric-detail">
              <span class="badge active">{{ metrics.postgres.activeSessions ?? 0 }} activas</span>
              <span class="badge idle">{{ (metrics.postgres.totalSessions ?? 0) - (metrics.postgres.activeSessions ?? 0) }} idle</span>
            </div>
            <div class="metric-detail" *ngIf="metrics.postgres.avgQuerySeconds !== undefined">
              ⏱️ Avg query: {{ metrics.postgres.avgQuerySeconds | number:'1.2-2' }}s
            </div>
          </div>
          <ng-template #pgLoading>
            <p class="hint">Click para cargar métricas</p>
          </ng-template>
        </div>
      </div>

      <div class="card card-mssql" (click)="loadMetrics()">
        <div class="card-icon">🔷</div>
        <div class="card-body">
          <h3>MSSQL Server</h3>
          <div *ngIf="metrics?.mssql; else mssqlLoading">
            <div class="metric-value">{{ metrics.mssql.totalSessions ?? 0 }}</div>
            <div class="metric-label">Sesiones totales</div>
            <div class="metric-detail">
              <span class="badge active">{{ metrics.mssql.activeSessions ?? 0 }} activas</span>
            </div>
            <div class="metric-detail" *ngIf="metrics.mssql.cpuUsagePercent !== undefined">
              🔥 CPU: {{ metrics.mssql.cpuUsagePercent | number:'1.1-1' }}%
            </div>
          </div>
          <ng-template #mssqlLoading>
            <p class="hint">Click para cargar métricas</p>
          </ng-template>
        </div>
      </div>

      <div class="card card-datacheck">
        <div class="card-icon">✅</div>
        <div class="card-body">
          <h3>DataCheck</h3>
          <p>Validación de calidad de datos</p>
          <ul class="feature-list">
            <li>🔍 Detección de duplicados</li>
            <li>📋 Campos faltantes</li>
            <li>📊 Estadísticas numéricas</li>
          </ul>
          <a routerLink="/datacheck" class="btn">Abrir DataCheck</a>
        </div>
      </div>

      <div class="card card-ai">
        <div class="card-icon">🤖</div>
        <div class="card-body">
          <h3>AI Analysis</h3>
          <p>Recomendaciones con IA (Claude)</p>
          <ul class="feature-list">
            <li>💡 Análisis de rendimiento</li>
            <li>⚡ Optimizaciones sugeridas</li>
            <li>🛡️ Detección de problemas</li>
          </ul>
          <a routerLink="/analysis" class="btn btn-ai">Ejecutar Análisis</a>
        </div>
      </div>
    </div>

    <!-- Quick Info Panel -->
    <div class="info-panels">
      <div class="info-panel">
        <h3>📌 Endpoints API Disponibles</h3>
        <table class="api-table">
          <thead><tr><th>Método</th><th>Ruta</th><th>Descripción</th></tr></thead>
          <tbody>
            <tr><td><span class="method get">GET</span></td><td>/health</td><td>Health check del servidor</td></tr>
            <tr><td><span class="method get">GET</span></td><td>/metrics</td><td>Métricas PostgreSQL & MSSQL</td></tr>
            <tr><td><span class="method post">POST</span></td><td>/datacheck</td><td>Chequeo de calidad de datos</td></tr>
            <tr><td><span class="method post">POST</span></td><td>/analyze</td><td>Análisis AI completo</td></tr>
          </tbody>
        </table>
      </div>
      <div class="info-panel">
        <h3>🏗️ Arquitectura del Proyecto</h3>
        <div class="arch-grid">
          <div class="arch-item"><strong>Frontend</strong><br>Angular 17 Standalone</div>
          <div class="arch-item"><strong>Backend</strong><br>Express + TypeScript</div>
          <div class="arch-item"><strong>DB Collectors</strong><br>PostgreSQL + MSSQL</div>
          <div class="arch-item"><strong>AI Engine</strong><br>Anthropic Claude</div>
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
    .card-pg { border-top-color: #336791; }
    .card-mssql { border-top-color: #cc2927; }
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
    .badge.idle { background: #fff3e0; color: #e65100; margin-left: 4px; }

    .hint { color: #aaa; font-style: italic; font-size: 13px; }

    .feature-list { list-style: none; padding: 0; margin: 0 0 12px; font-size: 13px; }
    .feature-list li { padding: 3px 0; }

    .btn {
      display: inline-block; padding: 8px 18px; border-radius: 8px;
      text-decoration: none; font-size: 13px; font-weight: 600;
      background: #0f3460; color: #fff; transition: background 0.2s;
    }
    .btn:hover { background: #1a4a7a; }
    .btn-ai { background: #7c3aed; }
    .btn-ai:hover { background: #6d28d9; }

    .info-panels { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; }
    .info-panel {
      background: #fff; border-radius: 14px; padding: 24px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.08);
    }
    .info-panel h3 { margin: 0 0 16px; color: #1a1a2e; font-size: 1rem; }

    .api-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .api-table th { background: #f0f4ff; padding: 8px 10px; text-align: left; font-weight: 600; }
    .api-table td { padding: 8px 10px; border-bottom: 1px solid #eee; }
    .method { padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: bold; color: #fff; }
    .method.get { background: #28a745; }
    .method.post { background: #007bff; }

    .arch-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .arch-item {
      background: #f8f9ff; padding: 14px; border-radius: 8px; text-align: center;
      font-size: 13px; border: 1px solid #e8ecf4;
    }
    .arch-item strong { color: #0f3460; display: block; margin-bottom: 4px; }

    .error-banner {
      color: #e94560; padding: 14px 20px; background: #ffe0e6;
      border-radius: 10px; border-left: 4px solid #e94560; margin-top: 16px;
    }

    @media (max-width: 768px) {
      .cards { grid-template-columns: 1fr; }
      .info-panels { grid-template-columns: 1fr; }
    }
  `],
})
export class DashboardComponent implements OnInit {
  metrics: any = null;
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
