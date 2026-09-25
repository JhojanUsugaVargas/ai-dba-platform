import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Metrics {
  postgres: any;
  mssql: any;
}

export interface DataCheckReport {
  total: number;
  issues: string[];
}

export interface AnalysisResult {
  aiResult: string;
  metrics: Metrics;
  dataCheck: DataCheckReport;
}

@Injectable({
  providedIn: 'root',
})
export class ApiService {
  private readonly baseUrl = '/api'; // Proxy will forward to backend

  constructor(private http: HttpClient) {}

  getMetrics(): Observable<Metrics> {
    return this.http.get<Metrics>(`${this.baseUrl}/metrics`);
  }

  postDataCheck(data: any[]): Observable<DataCheckReport> {
    return this.http.post<DataCheckReport>(`${this.baseUrl}/datacheck`, { data });
  }

  postAnalyze(payload: { metrics?: Metrics; data?: any[] }): Observable<AnalysisResult> {
    return this.http.post<AnalysisResult>(`${this.baseUrl}/analyze`, payload);
  }
}
