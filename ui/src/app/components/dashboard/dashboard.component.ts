import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <h1>Dashboard</h1>
    <div class="cards">
      <div class="card" (click)="loadMetrics()">
        <h3>📈 Metrics</h3>
        <p *ngIf="!metrics">Click to load database metrics</p>
        <div *ngIf="metrics">
          <p><strong>PostgreSQL Sessions:</strong> {{ metrics.postgres?.totalSessions ?? 'N/A' }}</p>
          <p><strong>MSSQL Sessions:</strong> {{ metrics.mssql?.totalSessions ?? 'N/A' }}</p>
        </div>
      </div>
      <div class="card">
        <h3>✅ DataCheck</h3>
        <p>Data quality validation</p>
        <a routerLink="/datacheck" class="btn">Open DataCheck</a>
      </div>
      <div class="card">
        <h3>🤖 AI Analysis</h3>
        <p>AI-powered recommendations</p>
        <a routerLink="/analysis" class="btn">Run Analysis</a>
      </div>
    </div>
    <div *ngIf="error" class="error">{{ error }}</div>
  `,
  styles: [`
    h1 { color: #1a1a2e; margin-bottom: 24px; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; }
    .card {
      background: #fff; border-radius: 12px; padding: 24px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1); cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .card:hover { transform: translateY(-2px); box-shadow: 0 4px 16px rgba(0,0,0,0.15); }
    .card h3 { margin-top: 0; color: #0f3460; }
    .btn {
      display: inline-block; padding: 8px 16px; background: #e94560;
      color: #fff; border-radius: 6px; text-decoration: none; margin-top: 8px;
    }
    .btn:hover { background: #c73e54; }
    .error { color: #e94560; margin-top: 16px; padding: 12px; background: #ffe0e6; border-radius: 8px; }
  `],
})
export class DashboardComponent implements OnInit {
  metrics: any = null;
  error: string | null = null;

  constructor(private api: ApiService) {}

  ngOnInit() { this.loadMetrics(); }

  loadMetrics() {
    this.api.getMetrics().subscribe({
      next: (data) => { this.metrics = data; this.error = null; },
      error: (err) => { this.error = 'Could not load metrics: ' + (err.message || err.statusText); },
    });
  }
}
