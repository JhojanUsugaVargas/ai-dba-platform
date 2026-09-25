import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface PostgresMetrics {
  totalSessions?: number;
  activeSessions?: number;
  avgQuerySeconds?: number;
  cacheHitRatio?: number;
  dbSizeGb?: number;
  [key: string]: any;
}

export interface MssqlMetrics {
  totalSessions?: number;
  activeSessions?: number;
  cpuUsagePercent?: number;
  memoryGb?: number;
  topWait?: string;
  [key: string]: any;
}

export interface Metrics {
  postgres: PostgresMetrics;
  mssql: MssqlMetrics;
}

export interface DataCheckReport {
  total: number;
  duplicates: number;
  missingFields: Record<string, number>;
  numericStats: Record<string, { min: number; max: number; avg: number }>;
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

  postChat(question: string): Observable<{ answer: string }> {
    return this.http.post<{ answer: string }>(`${this.baseUrl}/chat`, { question, message: question });
  }
}
