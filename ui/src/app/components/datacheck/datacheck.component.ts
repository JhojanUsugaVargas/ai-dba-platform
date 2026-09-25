import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, DataCheckReport } from '../../services/api.service';

@Component({
  selector: 'app-datacheck',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <h1>✅ Data Quality Check</h1>
    <p>Paste a JSON array of records below and click "Run Check".</p>
    <textarea [(ngModel)]="jsonInput" rows="10" placeholder='[{"id":1,"name":"Alice"},{"id":2}]' class="json-input"></textarea>
    <div class="toolbar">
      <button (click)="runCheck()" [disabled]="loading" class="btn">{{ loading ? 'Checking...' : '🔍 Run Check' }}</button>
      <button (click)="loadSample()" class="btn btn-secondary">📋 Load Sample</button>
    </div>
    <div *ngIf="parseError" class="error">{{ parseError }}</div>
    <div *ngIf="report" class="report">
      <h2>Report</h2>
      <div class="stat-row">
        <div class="stat"><strong>Total Records</strong><span>{{ report.total }}</span></div>
        <div class="stat"><strong>Duplicates</strong><span [class.warning]="report.duplicates > 0">{{ report.duplicates }}</span></div>
      </div>
      <div *ngIf="report.missingFields && objectKeys(report.missingFields).length > 0">
        <h3>Missing Fields</h3>
        <table class="data-table">
          <tr><th>Field</th><th>Missing Count</th></tr>
          <tr *ngFor="let key of objectKeys(report.missingFields)">
            <td>{{ key }}</td><td>{{ report.missingFields[key] }}</td>
          </tr>
        </table>
      </div>
      <div *ngIf="report.numericStats && objectKeys(report.numericStats).length > 0">
        <h3>Numeric Statistics</h3>
        <table class="data-table">
          <tr><th>Field</th><th>Min</th><th>Max</th><th>Avg</th></tr>
          <tr *ngFor="let key of objectKeys(report.numericStats)">
            <td>{{ key }}</td>
            <td>{{ report.numericStats[key].min }}</td>
            <td>{{ report.numericStats[key].max }}</td>
            <td>{{ report.numericStats[key].avg | number:'1.2-2' }}</td>
          </tr>
        </table>
      </div>
      <div *ngIf="report.issues && report.issues.length > 0">
        <h3>Issues</h3>
        <ul class="issues"><li *ngFor="let issue of report.issues">⚠️ {{ issue }}</li></ul>
      </div>
    </div>
  `,
  styles: [`
    h1 { color: #1a1a2e; }
    .json-input { width: 100%; font-family: monospace; padding: 12px; border: 2px solid #ddd; border-radius: 8px; resize: vertical; box-sizing: border-box; }
    .json-input:focus { border-color: #0f3460; outline: none; }
    .toolbar { display: flex; gap: 12px; margin: 16px 0; }
    .btn { padding: 10px 20px; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; background: #0f3460; color: #fff; }
    .btn:hover { background: #1a4a7a; }
    .btn:disabled { opacity: 0.6; }
    .btn-secondary { background: #333; }
    .btn-secondary:hover { background: #555; }
    .error { color: #e94560; padding: 12px; background: #ffe0e6; border-radius: 8px; margin: 8px 0; }
    .report { background: #fff; padding: 24px; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); margin-top: 16px; }
    .report h2 { margin-top: 0; color: #0f3460; }
    .stat-row { display: flex; gap: 20px; margin-bottom: 20px; }
    .stat { background: #f0f4ff; padding: 16px 24px; border-radius: 8px; text-align: center; }
    .stat strong { display: block; font-size: 13px; color: #666; }
    .stat span { font-size: 24px; font-weight: bold; color: #0f3460; }
    .stat span.warning { color: #e94560; }
    .data-table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; }
    .data-table th, .data-table td { padding: 8px 12px; border: 1px solid #e0e0e0; text-align: left; }
    .data-table th { background: #f0f4ff; color: #333; }
    .issues { padding-left: 20px; }
    .issues li { margin: 4px 0; color: #333; }
  `],
})
export class DatacheckComponent {
  jsonInput = '';
  loading = false;
  report: any = null;
  parseError: string | null = null;
  objectKeys = Object.keys;

  constructor(private api: ApiService) {}

  loadSample() {
    this.jsonInput = JSON.stringify([
      { id: 1, name: 'Server-A', cpu: 45.2, memory: 8192 },
      { id: 2, name: 'Server-B', cpu: 78.9 },
      { id: 1, name: 'Server-A', cpu: 45.2, memory: 8192 },
      { id: 3, memory: 16384 },
    ], null, 2);
  }

  runCheck() {
    this.parseError = null;
    let data: any[];
    try {
      data = JSON.parse(this.jsonInput);
      if (!Array.isArray(data)) throw new Error('Input must be a JSON array');
    } catch (e: any) {
      this.parseError = 'Invalid JSON: ' + e.message;
      return;
    }
    this.loading = true;
    this.api.postDataCheck(data).subscribe({
      next: (report) => { this.report = report; this.loading = false; },
      error: (err) => { this.parseError = 'Server error: ' + (err.message || err.statusText); this.loading = false; },
    });
  }
}
