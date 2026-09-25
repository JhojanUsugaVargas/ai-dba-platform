import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService, AnalysisResult } from '../../services/api.service';

@Component({
  selector: 'app-analysis',
  standalone: true,
  imports: [CommonModule],
  template: `
    <h1>🤖 AI Analysis</h1>
    <p>Click below to collect metrics, run data-quality checks, and get AI-powered recommendations.</p>
    <button (click)="runAnalysis()" [disabled]="loading" class="btn">
      {{ loading ? '⏳ Analyzing...' : '🚀 Run Full Analysis' }}
    </button>
    <div *ngIf="error" class="error">{{ error }}</div>
    <div *ngIf="result" class="result">
      <div class="section">
        <h2>💡 AI Recommendations</h2>
        <div class="ai-text">{{ result.aiResult }}</div>
      </div>
      <div class="section">
        <h2>📊 Collected Metrics</h2>
        <pre>{{ result.metrics | json }}</pre>
      </div>
      <div class="section">
        <h2>✅ Data Quality Report</h2>
        <pre>{{ result.dataCheck | json }}</pre>
      </div>
    </div>
  `,
  styles: [`
    h1 { color: #1a1a2e; }
    .btn { padding: 12px 28px; border: none; border-radius: 8px; cursor: pointer; font-size: 16px; background: #e94560; color: #fff; }
    .btn:hover { background: #c73e54; }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .error { color: #e94560; padding: 12px; background: #ffe0e6; border-radius: 8px; margin-top: 16px; }
    .result { margin-top: 24px; }
    .section { background: #fff; padding: 24px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); margin-bottom: 20px; }
    .section h2 { margin-top: 0; color: #0f3460; }
    .ai-text { background: #f0fff0; padding: 16px; border-radius: 8px; border-left: 4px solid #28a745; line-height: 1.6; white-space: pre-wrap; }
    pre { background: #f0f0f0; padding: 12px; border-radius: 8px; overflow-x: auto; font-size: 13px; }
  `],
})
export class AnalysisComponent {
  loading = false;
  result: AnalysisResult | null = null;
  error: string | null = null;

  constructor(private api: ApiService) {}

  runAnalysis() {
    this.loading = true;
    this.error = null;
    this.api.postAnalyze({}).subscribe({
      next: (res) => { this.result = res; this.loading = false; },
      error: (err) => { this.error = 'Analysis failed: ' + (err.message || err.statusText); this.loading = false; },
    });
  }
}
