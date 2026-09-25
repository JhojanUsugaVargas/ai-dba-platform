import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService, Metrics } from '../../services/api.service';

@Component({
  selector: 'app-metrics',
  standalone: true,
  imports: [CommonModule],
  template: `
    <h1>📈 Database Metrics</h1>
    <div class="toolbar">
      <button (click)="refresh()" [disabled]="loading" class="btn">{{ loading ? 'Loading...' : '🔄 Refresh' }}</button>
      <button (click)="toggleAutoRefresh()" class="btn btn-secondary">
        {{ autoRefresh ? '⏸ Stop Auto-Refresh' : '▶ Auto-Refresh (10s)' }}
      </button>
    </div>
    <div *ngIf="error" class="error">{{ error }}</div>
    <div *ngIf="metrics" class="metrics-grid">
      <div class="metric-card">
        <h3>🐘 PostgreSQL</h3>
        <pre>{{ metrics.postgres | json }}</pre>
      </div>
      <div class="metric-card">
        <h3>🔷 MSSQL</h3>
        <pre>{{ metrics.mssql | json }}</pre>
      </div>
    </div>
    <p *ngIf="lastUpdated" class="last-updated">Last updated: {{ lastUpdated | date:'medium' }}</p>
  `,
  styles: [`
    h1 { color: #1a1a2e; }
    .toolbar { display: flex; gap: 12px; margin-bottom: 20px; }
    .btn { padding: 10px 20px; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; background: #0f3460; color: #fff; }
    .btn:hover { background: #1a4a7a; }
    .btn:disabled { opacity: 0.6; cursor: not-allowed; }
    .btn-secondary { background: #333; }
    .btn-secondary:hover { background: #555; }
    .metrics-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .metric-card { background: #fff; padding: 20px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .metric-card h3 { margin-top: 0; }
    .metric-card pre { background: #f0f0f0; padding: 12px; border-radius: 8px; overflow-x: auto; font-size: 13px; }
    .error { color: #e94560; padding: 12px; background: #ffe0e6; border-radius: 8px; margin-bottom: 16px; }
    .last-updated { color: #888; font-size: 13px; margin-top: 16px; }
  `],
})
export class MetricsComponent implements OnInit, OnDestroy {
  metrics: Metrics | null = null;
  loading = false;
  error: string | null = null;
  autoRefresh = false;
  lastUpdated: Date | null = null;
  private intervalId: any = null;

  constructor(private api: ApiService) {}

  ngOnInit() { this.refresh(); }

  ngOnDestroy() { this.stopAutoRefresh(); }

  refresh() {
    this.loading = true;
    this.api.getMetrics().subscribe({
      next: (data) => { this.metrics = data; this.lastUpdated = new Date(); this.loading = false; this.error = null; },
      error: (err) => { this.error = 'Error: ' + (err.message || err.statusText); this.loading = false; },
    });
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
