import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-datacheck',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="page-header">
      <h1>✅ Data Quality Check</h1>
      <p class="subtitle">Pega un array JSON de registros y analiza su calidad</p>
    </div>

    <div class="input-section">
      <div class="input-header">
        <label>📝 Datos JSON</label>
        <button (click)="loadSample()" class="btn btn-sm">📋 Cargar Ejemplo</button>
      </div>
      <textarea [(ngModel)]="jsonInput" rows="8"
        placeholder='[{"id":1,"name":"Server-A","cpu":45.2},{"id":2,"name":"Server-B"}]'
        class="json-input" [class.has-error]="parseError"></textarea>
      <div class="input-footer">
        <span class="char-count">{{ jsonInput.length }} caracteres</span>
        <button (click)="runCheck()" [disabled]="loading || !jsonInput.trim()" class="btn btn-primary btn-lg">
          {{ loading ? '⏳ Analizando...' : '🔍 Ejecutar Análisis' }}
        </button>
      </div>
    </div>

    <div *ngIf="parseError" class="error-banner">❌ {{ parseError }}</div>

    <div *ngIf="report" class="report">
      <h2>📊 Reporte de Calidad</h2>

      <!-- Summary Stats -->
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-icon">📄</div>
          <div class="stat-value">{{ report.total }}</div>
          <div class="stat-label">Total Registros</div>
        </div>
        <div class="stat-card" [class.stat-warning]="report.duplicates > 0">
          <div class="stat-icon">🔁</div>
          <div class="stat-value">{{ report.duplicates }}</div>
          <div class="stat-label">Duplicados</div>
        </div>
        <div class="stat-card" [class.stat-warning]="objectKeys(report.missingFields || {}).length > 0">
          <div class="stat-icon">⚠️</div>
          <div class="stat-value">{{ objectKeys(report.missingFields || {}).length }}</div>
          <div class="stat-label">Campos con Nulos</div>
        </div>
        <div class="stat-card stat-info">
          <div class="stat-icon">📐</div>
          <div class="stat-value">{{ objectKeys(report.numericStats || {}).length }}</div>
          <div class="stat-label">Cols Numéricas</div>
        </div>
      </div>

      <!-- Missing Fields -->
      <div *ngIf="report.missingFields && objectKeys(report.missingFields).length > 0" class="section">
        <h3>🔎 Campos Faltantes</h3>
        <table class="data-table">
          <thead><tr><th>Campo</th><th>Registros sin valor</th><th>% Completitud</th></tr></thead>
          <tbody>
            <tr *ngFor="let key of objectKeys(report.missingFields)">
              <td><code>{{ key }}</code></td>
              <td><span class="badge-warn">{{ report.missingFields[key] }}</span></td>
              <td>
                <div class="mini-bar">
                  <div class="mini-fill" [style.width.%]="getCompleteness(report.missingFields[key], report.total)"></div>
                </div>
                <span class="pct">{{ getCompleteness(report.missingFields[key], report.total) | number:'1.0-0' }}%</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Numeric Stats -->
      <div *ngIf="report.numericStats && objectKeys(report.numericStats).length > 0" class="section">
        <h3>📊 Estadísticas Numéricas</h3>
        <table class="data-table">
          <thead><tr><th>Campo</th><th>Mínimo</th><th>Máximo</th><th>Promedio</th><th>Rango</th></tr></thead>
          <tbody>
            <tr *ngFor="let key of objectKeys(report.numericStats)">
              <td><code>{{ key }}</code></td>
              <td>{{ report.numericStats[key].min | number:'1.2-2' }}</td>
              <td>{{ report.numericStats[key].max | number:'1.2-2' }}</td>
              <td><strong>{{ report.numericStats[key].avg | number:'1.2-2' }}</strong></td>
              <td>
                <div class="range-bar">
                  <div class="range-fill" [style.width.%]="100"></div>
                  <span class="range-label">{{ report.numericStats[key].min }} — {{ report.numericStats[key].max }}</span>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Issues -->
      <div *ngIf="report.issues && report.issues.length > 0" class="section">
        <h3>📋 Problemas Detectados</h3>
        <div *ngFor="let issue of report.issues" class="issue-item">
          <span class="issue-icon">⚠️</span>
          <span>{{ issue }}</span>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .page-header { margin-bottom: 20px; }
    .page-header h1 { color: #1a1a2e; margin: 0; }
    .subtitle { color: #666; margin-top: 4px; }

    .input-section { background: #fff; border-radius: 14px; padding: 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); margin-bottom: 20px; }
    .input-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .input-header label { font-weight: 600; color: #1a1a2e; }

    .json-input {
      width: 100%; font-family: 'Cascadia Code', 'Fira Code', monospace; padding: 14px;
      border: 2px solid #e0e0e0; border-radius: 10px; resize: vertical;
      box-sizing: border-box; font-size: 13px; line-height: 1.5;
      transition: border-color 0.2s;
    }
    .json-input:focus { border-color: #0f3460; outline: none; box-shadow: 0 0 0 3px rgba(15,52,96,0.1); }
    .json-input.has-error { border-color: #e94560; }

    .input-footer { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; }
    .char-count { font-size: 12px; color: #aaa; }

    .btn { padding: 8px 16px; border: none; border-radius: 8px; cursor: pointer; font-size: 13px; transition: all 0.2s; }
    .btn-sm { background: #f0f4ff; color: #0f3460; }
    .btn-sm:hover { background: #dde4f0; }
    .btn-primary { background: #0f3460; color: #fff; }
    .btn-primary:hover:not(:disabled) { background: #1a4a7a; }
    .btn-lg { padding: 12px 28px; font-size: 15px; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .error-banner { color: #e94560; padding: 14px 20px; background: #ffe0e6; border-radius: 10px; border-left: 4px solid #e94560; margin-bottom: 20px; }

    .report { background: #fff; border-radius: 14px; padding: 28px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
    .report h2 { margin: 0 0 20px; color: #1a1a2e; }

    .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 28px; }
    .stat-card {
      background: #f8f9ff; padding: 20px; border-radius: 12px; text-align: center;
      border: 2px solid transparent; transition: border-color 0.2s;
    }
    .stat-card.stat-warning { border-color: #ffc107; background: #fffbf0; }
    .stat-card.stat-info { border-color: #17a2b8; background: #f0faff; }
    .stat-icon { font-size: 1.5rem; margin-bottom: 4px; }
    .stat-value { font-size: 2rem; font-weight: bold; color: #0f3460; }
    .stat-label { font-size: 12px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }

    .section { margin-top: 24px; padding-top: 20px; border-top: 1px solid #eee; }
    .section h3 { margin: 0 0 14px; color: #1a1a2e; }

    .data-table { width: 100%; border-collapse: collapse; font-size: 14px; }
    .data-table th { background: #f0f4ff; padding: 10px 14px; text-align: left; font-weight: 600; color: #333; }
    .data-table td { padding: 10px 14px; border-bottom: 1px solid #f0f0f0; }
    .data-table tr:hover td { background: #fafbff; }
    code { background: #e8ecf4; padding: 2px 8px; border-radius: 4px; font-size: 13px; }

    .badge-warn { background: #fff3cd; color: #856404; padding: 3px 10px; border-radius: 10px; font-size: 13px; font-weight: 600; }

    .mini-bar { display: inline-block; width: 80px; height: 8px; background: #e8ecf4; border-radius: 4px; overflow: hidden; vertical-align: middle; margin-right: 8px; }
    .mini-fill { height: 100%; background: #28a745; border-radius: 4px; }
    .pct { font-size: 13px; color: #666; }

    .range-bar { position: relative; height: 20px; background: #e8ecf4; border-radius: 4px; overflow: hidden; }
    .range-fill { height: 100%; background: linear-gradient(90deg, #336791, #0f3460); border-radius: 4px; opacity: 0.2; }
    .range-label { position: absolute; top: 2px; left: 8px; font-size: 11px; color: #333; }

    .issue-item { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: #fffbf0; border-radius: 8px; margin-bottom: 8px; border-left: 3px solid #ffc107; }
    .issue-icon { font-size: 1.2rem; }

    @media (max-width: 768px) { .stat-grid { grid-template-columns: 1fr 1fr; } }
  `],
})
export class DatacheckComponent {
  jsonInput = '';
  loading = false;
  report: any = null;
  parseError: string | null = null;
  objectKeys = Object.keys;

  constructor(private api: ApiService) {}

  getCompleteness(missing: number, total: number): number {
    if (!total || total === 0) return 100;
    return ((total - missing) / total) * 100;
  }

  loadSample() {
    this.jsonInput = JSON.stringify([
      { id: 1, server: 'DB-PROD-01', cpu: 45.2, memory_gb: 64, connections: 120, status: 'healthy' },
      { id: 2, server: 'DB-PROD-02', cpu: 78.9, connections: 89 },
      { id: 1, server: 'DB-PROD-01', cpu: 45.2, memory_gb: 64, connections: 120, status: 'healthy' },
      { id: 3, server: 'DB-STAGING', memory_gb: 32, connections: 15, status: 'idle' },
      { id: 4, cpu: 12.1, memory_gb: 16 },
      { id: 5, server: 'DB-DEV', cpu: 5.3, memory_gb: 8, connections: 3, status: 'healthy' },
    ], null, 2);
    this.parseError = null;
    this.report = null;
  }

  runCheck() {
    this.parseError = null;
    let data: any[];
    try {
      data = JSON.parse(this.jsonInput);
      if (!Array.isArray(data)) throw new Error('El input debe ser un array JSON []');
    } catch (e: any) {
      this.parseError = 'JSON inválido: ' + e.message;
      return;
    }
    this.loading = true;
    this.api.postDataCheck(data).subscribe({
      next: (report) => { this.report = report; this.loading = false; },
      error: (err) => { this.parseError = 'Error del servidor: ' + (err.message || err.statusText); this.loading = false; },
    });
  }
}
