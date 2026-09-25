import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService, AnalysisResult } from '../../services/api.service';

@Component({
  selector: 'app-analysis',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="page-header">
      <h1>🤖 AI Analysis</h1>
      <p class="subtitle">Recolecta métricas, ejecuta chequeo de calidad y genera recomendaciones con IA (Claude)</p>
    </div>

    <div class="action-card">
      <div class="action-content">
        <div class="action-icon">🚀</div>
        <div>
          <h3>Ejecutar Análisis Completo</h3>
          <p>El sistema recolectará métricas de PostgreSQL y MSSQL, ejecutará validaciones de calidad,
             y enviará todo a Claude para obtener recomendaciones accionables.</p>
        </div>
      </div>
      <button (click)="runAnalysis()" [disabled]="loading" class="btn btn-ai btn-xl">
        {{ loading ? '⏳ Analizando...' : '🧠 Ejecutar Análisis AI' }}
      </button>
      <div *ngIf="loading" class="progress-bar"><div class="progress-fill"></div></div>
    </div>

    <div *ngIf="error" class="error-banner">❌ {{ error }}</div>

    <div *ngIf="result" class="results">
      <!-- AI Recommendations -->
      <div class="result-section ai-section">
        <div class="section-header">
          <span class="section-icon">💡</span>
          <h2>Recomendaciones AI</h2>
        </div>
        <div class="ai-response">{{ result.aiResult }}</div>
      </div>

      <!-- Metrics Summary -->
      <div class="result-grid">
        <div class="result-section" *ngFor="let server of result.metrics">
          <div class="section-header">
            <span class="section-icon">{{ server.type === 'postgres' ? '🐘' : server.type === 'mssql' ? '🔷' : server.type === 'mongodb' ? '🍃' : '🔴' }}</span>
            <h2>{{ server.name }}</h2>
          </div>
          <div class="metric-list">
            <div class="metric-row" *ngFor="let key of objectKeys(server.metrics || {})">
              <span class="metric-key">{{ key }}</span>
              <span class="metric-val">{{ server.metrics[key] }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Data Quality -->
      <div class="result-section">
        <div class="section-header">
          <span class="section-icon">✅</span>
          <h2>Reporte de Calidad de Datos</h2>
        </div>
        <div class="quality-grid">
          <div class="quality-item">
            <strong>Total registros</strong>
            <span>{{ result.dataCheck?.total ?? 0 }}</span>
          </div>
          <div class="quality-item">
            <strong>Duplicados</strong>
            <span [class.warn]="(result.dataCheck?.duplicates ?? 0) > 0">{{ result.dataCheck?.duplicates ?? 0 }}</span>
          </div>
        </div>
        <div *ngIf="(result.dataCheck?.issues?.length || 0) > 0" class="issues-list">
          <div *ngFor="let issue of result.dataCheck.issues" class="issue-row">⚠️ {{ issue }}</div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .page-header { margin-bottom: 24px; }
    .page-header h1 { color: #1a1a2e; margin: 0; }
    .subtitle { color: #666; margin-top: 4px; }

    .action-card {
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
      border-radius: 16px; padding: 32px; color: #fff; margin-bottom: 24px;
      box-shadow: 0 4px 20px rgba(15,52,96,0.3);
    }
    .action-content { display: flex; align-items: center; gap: 20px; margin-bottom: 20px; }
    .action-icon { font-size: 3rem; }
    .action-content h3 { margin: 0 0 8px; font-size: 1.3rem; }
    .action-content p { margin: 0; color: #b0b8cc; font-size: 14px; line-height: 1.5; }

    .btn-ai {
      background: linear-gradient(135deg, #7c3aed, #e94560); border: none; color: #fff;
      padding: 14px 36px; border-radius: 12px; font-size: 16px; font-weight: 700;
      cursor: pointer; transition: all 0.3s; box-shadow: 0 4px 15px rgba(124,58,237,0.4);
    }
    .btn-ai:hover:not(:disabled) { transform: translateY(-2px); box-shadow: 0 6px 25px rgba(124,58,237,0.5); }
    .btn-ai:disabled { opacity: 0.6; cursor: not-allowed; }
    .btn-xl { font-size: 16px; }

    .progress-bar { height: 4px; background: rgba(255,255,255,0.2); border-radius: 2px; margin-top: 16px; overflow: hidden; }
    .progress-fill {
      height: 100%; background: linear-gradient(90deg, #7c3aed, #e94560, #7c3aed);
      background-size: 200% 100%; border-radius: 2px;
      animation: shimmer 1.5s ease-in-out infinite;
    }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

    .error-banner { color: #e94560; padding: 14px 20px; background: #ffe0e6; border-radius: 10px; border-left: 4px solid #e94560; margin-bottom: 20px; }

    .results { display: flex; flex-direction: column; gap: 20px; }
    .result-section { background: #fff; border-radius: 14px; padding: 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
    .result-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }

    .section-header { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 2px solid #f0f0f0; }
    .section-icon { font-size: 1.5rem; }
    .section-header h2 { margin: 0; color: #1a1a2e; font-size: 1.1rem; }

    .ai-section { border-left: 4px solid #7c3aed; }
    .ai-response {
      background: #f8f5ff; padding: 20px; border-radius: 10px; line-height: 1.7;
      font-size: 14px; color: #333; white-space: pre-wrap;
    }

    .metric-list { display: flex; flex-direction: column; gap: 8px; }
    .metric-row { display: flex; justify-content: space-between; padding: 8px 12px; background: #f8f9ff; border-radius: 6px; font-size: 14px; }
    .metric-key { color: #666; }
    .metric-val { font-weight: 600; color: #0f3460; }

    .quality-grid { display: flex; gap: 16px; margin-bottom: 16px; }
    .quality-item { background: #f8f9ff; padding: 16px 24px; border-radius: 10px; text-align: center; }
    .quality-item strong { display: block; font-size: 12px; color: #888; text-transform: uppercase; margin-bottom: 4px; }
    .quality-item span { font-size: 1.8rem; font-weight: bold; color: #0f3460; }
    .quality-item span.warn { color: #e94560; }

    .issues-list { display: flex; flex-direction: column; gap: 6px; }
    .issue-row { padding: 10px 14px; background: #fffbf0; border-radius: 8px; border-left: 3px solid #ffc107; font-size: 14px; }

    @media (max-width: 768px) { .result-grid { grid-template-columns: 1fr; } }
  `],
})
export class AnalysisComponent {
  loading = false;
  result: AnalysisResult | null = null;
  error: string | null = null;
  objectKeys = Object.keys;

  constructor(private api: ApiService) {}

  runAnalysis() {
    this.loading = true;
    this.error = null;
    this.result = null;
    this.api.postAnalyze({}).subscribe({
      next: (res) => { this.result = res; this.loading = false; },
      error: (err) => { this.error = 'El análisis falló: ' + (err.message || err.statusText); this.loading = false; },
    });
  }
}
