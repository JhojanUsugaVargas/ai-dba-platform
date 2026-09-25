import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ServerMetric {
  serverId: string;
  name: string;
  type: 'postgres' | 'mssql' | 'mongodb' | 'redis';
  metrics: any;
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
  metrics: ServerMetric[];
  dataCheck: DataCheckReport;
}

@Injectable({
  providedIn: 'root',
})
export class ApiService {
  private readonly baseUrl = '/api'; // Proxy will forward to backend

  constructor(private http: HttpClient) {}

  login(username: string, password: string): Observable<{ token: string }> {
    return this.http.post<{ token: string }>(`${this.baseUrl}/login`, { username, password });
  }

  getMetrics(): Observable<ServerMetric[]> {
    return this.http.get<ServerMetric[]>(`${this.baseUrl}/metrics`);
  }

  postDataCheck(data: any[]): Observable<DataCheckReport> {
    return this.http.post<DataCheckReport>(`${this.baseUrl}/datacheck`, { data });
  }

  postAnalyze(payload: { metrics?: ServerMetric[]; data?: any[] }): Observable<AnalysisResult> {
    return this.http.post<AnalysisResult>(`${this.baseUrl}/analyze`, payload);
  }

  postChat(question: string): Observable<{ answer: string }> {
    return this.http.post<{ answer: string }>(`${this.baseUrl}/chat`, { question, message: question });
  }
}
