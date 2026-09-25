# AI DBA Platform

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.18-brightgreen.svg)](https://nodejs.org/)
[![Angular Version](https://img.shields.io/badge/angular-17-red.svg)](https://angular.dev/)
[![TypeScript](https://img.shields.io/badge/typescript-5.5-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Next-Generation Enterprise Database Observability, Data Quality & Dual-AI Operations Platform.**
> A unified solution fusing battle-tested diagnostic philosophies from [performancemonitor](https://github.com/erikdarlingdata/performancemonitor), [ai-dba-platform](https://github.com/kaizen-dayro/ai-dba-platform), and [DataCheck-web](https://github.com/JhojanUsugaVargas/DataCheck-web).

**Author:** Jhojan Usuga

---

## Table of Contents

- [Overview](#overview)
- [Enterprise Features](#enterprise-features)
- [Architecture](#architecture)
- [Security & Authentication](#security--authentication)
- [Multi-Server Configuration](#multi-server-configuration)
- [AI Capabilities](#ai-capabilities)
  - [Claude AI: Fleet Diagnostic & Predictive Analysis](#1-anthropic-claude--global-fleet-analysis)
  - [Gemini AI: Interactive SQL Assistant](#2-google-gemini--interactive-sql-assistant)
- [Data Quality Engine (DataCheck)](#data-quality-engine-datacheck)
- [API Reference](#api-reference)
- [Environment Variables](#environment-variables)
- [Quick Start](#quick-start)
  - [Prerequisites](#prerequisites)
  - [Backend Setup](#backend-setup)
  - [Frontend Setup (Angular 17)](#frontend-setup-angular-17)
- [Project Structure](#project-structure)
- [License](#license)

---

## Overview

The **AI DBA Platform** is an enterprise-grade SaaS observability and diagnostic platform built to manage heterogeneous database ecosystems at scale. Modern IT organizations operate diverse database stacks—combining relational engines (PostgreSQL, Microsoft SQL Server), document stores (MongoDB), and in-memory caches (Redis).

Managing this diversity requires more than basic telemetry: it requires intelligent correlation, data profiling, proactive issue mitigation, and intelligent automated DBA assistance. The AI DBA Platform solves this challenge by unifying:

1. **Multi-Engine Performance Telemetry** across RDBMS and NoSQL engines.
2. **Dynamic Multi-Server Fleet Management** via structured configuration.
3. **Data Quality Validation** to catch data drift, anomalies, and duplicates.
4. **Dual-AI Intelligence** combining Anthropic Claude (deep analytical reports) and Google Gemini (real-time interactive SQL troubleshooting).
5. **Enterprise Security** with JWT authentication and Angular route protection.

---

## Enterprise Features

- **Multi-Engine Telemetry Collectors:**
  - **PostgreSQL Collector:** Live session tracking via `pg_stat_activity`, query latency calculations, buffer cache hit ratio, and database size footprint via `pg_stat_database`.
  - **Microsoft SQL Server Collector:** Session states via `sys.dm_exec_sessions`, hardware/CPU telemetry via `sys.dm_os_performance_counters`, OS memory usage from `sys.dm_os_sys_memory`, and top wait statistics via `sys.dm_os_wait_stats` (e.g. `PAGEIOLATCH_SH`).
  - **MongoDB Collector:** Connection pools, operations per second (`opcounters.query`), cluster status, and storage utilization via `serverStatus`.
  - **Redis Collector:** Real-time throughput, connected client counts, human-readable memory usage (`used_memory_human`), and cache hit rate analytics via Redis `INFO`.
- **Dynamic Multi-Server Fleet Architecture:** Scale to monitor dozens of instances simultaneously using JSON-driven server configurations (`src/config/servers.json`) with automated fail-safe mock fallback.
- **Enterprise Security & Session Management:** Signed JSON Web Tokens (JWT) securing all diagnostic endpoints, paired with client-side authentication guards and HTTP interceptors.
- **Dual-AI Operational Copilots:**
  - **Anthropic Claude 3.5 Sonnet:** Deep, holistic analysis combining multi-server telemetry and data-quality health reports into actionable optimization blueprints.
  - **Google Gemini 2.5 Flash:** Real-time conversational SQL assistant capable of debugging syntax errors, tuning slow queries, and advising on database indexing strategies.
- **Data Quality & Profiling (DataCheck):** Real-time automated data validation including deep duplicate record detection, missing/null field auditing, and statistical numeric column distributions.
- **Modern Angular 17 UI:** Enterprise dashboard featuring real-time telemetry gauges, interactive query assistants, data-quality inspection matrices, and responsive controls.

---

## Architecture

The platform follows a decoupled, secure client-server architecture designed for high availability and low latency:

```mermaid
flowchart TD
    subgraph Client["Frontend (Angular 17)"]
        UI["Angular SPA Dashboard"]
        Guard["AuthGuard & Interceptors"]
        ChatUI["Interactive SQL Assistant UI"]
        UI --> Guard
    end

    subgraph Backend["Core API (Node.js & Express)"]
        Auth["JWT Auth Service (/api/login)"]
        Router["Protected API Router"]
        ServerConf["Server Registry (src/config/servers.json)"]
        DataCheck["DataCheck Quality Engine"]
        
        Guard -->|Bearer Token| Router
        UI -->|Credentials| Auth
        Auth -.->|Returns JWT| UI
    end

    subgraph Collectors["Multi-Engine Collectors"]
        PG["PostgreSQL Collector"]
        MSSQL["MSSQL Collector"]
        Mongo["MongoDB Collector"]
        Redis["Redis Collector"]
    end

    subgraph AI["Dual-AI Engine"]
        Claude["Anthropic Claude 3.5 Sonnet\n(Holistic Fleet Analysis)"]
        Gemini["Google Gemini 2.5 Flash\n(Interactive SQL Assistant)"]
    end

    subgraph Targets["Monitored Database Fleet"]
        DB_PG[("PostgreSQL")]
        DB_MS[("Microsoft SQL Server")]
        DB_MG[("MongoDB")]
        DB_RD[("Redis Cache")]
    end

    Router --> ServerConf
    ServerConf --> Collectors
    Collectors --> PG & MSSQL & Mongo & Redis
    PG --> DB_PG
    MSSQL --> DB_MS
    Mongo --> DB_MG
    Redis --> DB_RD

    Router --> DataCheck
    Router --> Claude
    Router --> Gemini
    ChatUI --> Gemini
```

---

## Security & Authentication

The platform implements enterprise security standards to protect sensitive database connection strings, operational telemetry, and administrative actions:

### JWT-Based Access Control

All API endpoints (except `/health` and `/login`) are protected behind a JSON Web Token (JWT) verification middleware (`verifyToken`). Requests must include the token in the HTTP `Authorization` header:

```http
Authorization: Bearer <your_jwt_token>
```

### Default Credentials

For initial deployment and administrative onboarding, the system ships with default credentials:

| Username | Default Password | Role | Expiration |
|----------|------------------|------|------------|
| `admin`  | `admin123`       | Administrator | 1 Hour |

> [!IMPORTANT]
> When deploying to production environments, configure robust password hashing and define a secure `SECRET_KEY` in your environment or secret management service.

### Frontend Security Integration

The Angular 17 frontend seamlessly handles the authentication lifecycle:
- **`authGuard` (`ui/src/app/guards/auth.guard.ts`)**: Prevents unauthorized navigation to `/`, `/metrics`, `/datacheck`, `/analysis`, and `/chat`, redirecting unauthenticated users to `/login`.
- **`authInterceptor` (`ui/src/app/interceptors/auth.interceptor.ts`)**: Automatically attaches the stored JWT token to all outbound `/api/*` HTTP requests.
- **Session Expiry & Logout**: Allows immediate administrative revocation and clearing of local credentials.

---

## Multi-Server Configuration

Rather than restricting monitoring to a single database defined in static `.env` variables, the platform leverages a dynamic fleet configuration file located at:

```
src/config/servers.json
```

This configuration decouples application code from infrastructure topology, allowing DevOps and DBA teams to register, update, and manage heterogeneous database instances at runtime.

### Configuration Schema

Each entry in `src/config/servers.json` adheres to the following structure:

```json
[
  {
    "id": "1",
    "name": "Production Postgres Primary",
    "type": "postgres",
    "connectionString": "postgresql://postgres:secret@postgres-prod.internal:5432/app_db"
  },
  {
    "id": "2",
    "name": "MSSQL Enterprise DataWarehouse",
    "type": "mssql",
    "connectionString": "Server=mssql-dw.internal;Database=Analytics;User Id=sa;Password=SecurePass123!;Encrypt=true;"
  },
  {
    "id": "3",
    "name": "Customer Profile MongoDB Cluster",
    "type": "mongodb",
    "connectionString": "mongodb://dba_admin:Pass456@mongo-cluster.internal:27017/admin?authSource=admin"
  },
  {
    "id": "4",
    "name": "Session Store Redis Cluster",
    "type": "redis",
    "connectionString": "redis://:RedisAuthPass@redis-cache.internal:6379"
  }
]
```

### Supported Database Types

| Type Identifier | Database Engine | Metrics Gathered |
|-----------------|-----------------|------------------|
| `postgres` | PostgreSQL 12+ | Active & total sessions, average query run time, cache hit ratio, database size |
| `mssql` | Microsoft SQL Server 2017+ | Total & active sessions, CPU usage %, physical memory allocation, top wait type |
| `mongodb` | MongoDB 4.4+ | Active client connections, query ops per second, cluster health status |
| `redis` | Redis 6.0+ | Connected clients, human-formatted memory footprint, cache hit rate ratio |

> [!TIP]
> **Mock Telemetry Resilience:** If a connection string is empty, invalid, or unreachable during local development or staging demos, the platform automatically logs a warning and generates synthetic telemetry. This ensures development workflows and UI testing never fail due to network partitions.

---

## AI Capabilities

The platform combines two state-of-the-art foundation models to deliver complementary operational intelligence:

### 1. Anthropic Claude — Global Fleet Analysis

- **Model:** `claude-3-5-sonnet-20241022`
- **Role:** Deep Diagnostic Reasoner & Strategic Optimizer
- **Endpoint:** `POST /analyze`
- **Functionality:**
  - Evaluates cross-server metric telemetry collected from all databases in `servers.json`.
  - Ingests the data quality validation report generated by DataCheck.
  - Correlates performance bottlenecks (such as high CPU waits or low buffer cache hits) with data anomalies (like missing columns or duplicate records).
  - Produces prioritized, plain-text optimization action items and tuning recommendations.

### 2. Google Gemini — Interactive SQL Assistant

- **Model:** `gemini-2.5-flash`
- **Role:** Conversational Database Assistant & SQL Troubleshooting Copilot
- **Endpoint:** `POST /api/chat` and `POST /chat`
- **Functionality:**
  - Fast, context-aware conversational assistance available directly within the Angular UI (`/chat`).
  - Diagnoses complex SQL errors, syntax exceptions, and join ambiguities.
  - Generates optimized SQL queries and index creation recommendations.
  - Provides answers in clear, concise language for accelerated DBA decision-making.

> [!NOTE]
> When API keys (`ANTHROPIC_API_KEY` or `GEMINI_API_KEY`) are not provided, both AI modules smoothly fallback to built-in simulation engines with informative sample recommendations.

---

## Data Quality Engine (DataCheck)

Originating from the [DataCheck-web](https://github.com/JhojanUsugaVargas/DataCheck-web) initiative, the platform incorporates an in-memory data quality engine (`DataCheckService`) accessible via `POST /datacheck`:

- **Duplicate Record Detection:** Performs deep equality comparison across all records in the batch.
- **Missing Field & Null Auditing:** Inspects schemas across polymorphic rows, reporting exact counts of missing or `null` attributes.
- **Numeric Column Profiling:** Computes statistical distributions (minimum, maximum, and average values) for every numeric column.
- **Unified Issue Ledger:** Compiles data quality findings into a structured report ready for consumption by humans or downstream analysis by Claude AI.

---

## API Reference

All protected endpoints require a valid JWT token passed in the `Authorization: Bearer <token>` header.

| Method | Endpoint | Auth Required | Description |
|:-------|:---------|:-------------:|:------------|
| `GET` | `/health` | No | System health check and server timestamp. |
| `POST` | `/api/login` / `/login` | No | Authenticate administrator credentials; returns `{ token: string }`. |
| `GET` | `/servers` | **Yes** | Returns the list of registered database servers from `servers.json`. |
| `GET` | `/metrics` | **Yes** | Concurrently polls metrics from all registered database servers. |
| `POST` | `/datacheck` | **Yes** | Runs data quality analysis on provided JSON records (body: `{ "data": [...] }`). |
| `POST` | `/analyze` | **Yes** | Polls all server metrics, runs DataCheck, and invokes Claude AI for recommendations. |
| `POST` | `/api/chat` / `/chat` | **Yes** | Interactive SQL query and diagnostic assistant powered by Google Gemini (body: `{ "question": "..." }`). |

---

## Environment Variables

Configure application settings by copying `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Variable | Required | Default | Description |
|----------|:--------:|:-------:|:------------|
| `PORT` | Optional | `3000` | Port for the Express backend server. |
| `ANTHROPIC_API_KEY` | Optional | `your-anthropic-api-key` | API key for Anthropic Claude 3.5 Sonnet analysis. |
| `GEMINI_API_KEY` | Optional | `your_gemini_api_key` | API key for Google Gemini 2.5 Flash SQL chat. |

> [!NOTE]
> Database target credentials and connection strings are managed dynamically in `src/config/servers.json`.

---

## Quick Start

### Prerequisites

- **Node.js:** `>= 22.18.0`
- **npm:** `>= 10.0.0`

### Backend Setup

1. **Install backend dependencies:**
   ```bash
   npm install
   ```

2. **Configure your database fleet:**
   Edit [`src/config/servers.json`](src/config/servers.json) to point to your database instances, or leave the default entries to explore with mock telemetry.

3. **Configure environment variables (Optional):**
   ```bash
   cp .env.example .env
   # Add your ANTHROPIC_API_KEY and GEMINI_API_KEY if available
   ```

4. **Start the backend development server:**
   ```bash
   npm run dev
   ```
   The backend API will start on `http://localhost:3000`.

### Frontend Setup (Angular 17)

1. **Navigate to the UI directory and install dependencies:**
   ```bash
   cd ui
   npm install
   ```

2. **Start the Angular development server:**
   ```bash
   npm start
   ```
   The Angular application will launch on `http://localhost:4200` with automated proxy configuration forwarding `/api/*` requests to `http://localhost:3000`.

3. **Log In:**
   - Navigate to `http://localhost:4200/login`
   - **Username:** `admin`
   - **Password:** `admin123`

---

## Project Structure

```
ai-dba-platform/
├── src/
│   ├── server.ts                   # Express server & API routes
│   ├── auth/
│   │   └── auth.ts                 # JWT authentication & route verification
│   ├── config/
│   │   └── servers.json            # Dynamic multi-server fleet definition
│   ├── collectors/
│   │   ├── postgresCollector.ts    # PostgreSQL performance telemetry
│   │   ├── mssqlCollector.ts       # Microsoft SQL Server DMV telemetry
│   │   ├── mongoCollector.ts       # MongoDB cluster telemetry
│   │   └── redisCollector.ts       # Redis memory & throughput telemetry
│   ├── datacheck/
│   │   └── datacheck.service.ts    # In-memory data quality engine
│   ├── ai/
│   │   ├── analyze.ts              # Anthropic Claude 3.5 Sonnet integration
│   │   └── chat.ts                 # Google Gemini 2.5 Flash SQL Assistant
│   ├── routes/
│   │   └── datacheckRouter.ts      # REST router for DataCheck
│   └── __tests__/
│       └── datacheck.service.test.ts # Unit tests
├── ui/                             # Angular 17 Enterprise SPA
│   ├── src/app/
│   │   ├── components/
│   │   │   ├── login/              # Admin login component
│   │   │   ├── dashboard/          # Enterprise fleet monitoring dashboard
│   │   │   ├── metrics/            # Detailed multi-server telemetry views
│   │   │   ├── datacheck/          # Data quality audit workbench
│   │   │   ├── analysis/           # Claude AI fleet diagnostic reports
│   │   │   └── chat/               # Gemini AI SQL assistant copilot
│   │   ├── guards/
│   │   │   └── auth.guard.ts       # Angular route guard for authentication
│   │   ├── interceptors/
│   │   │   └── auth.interceptor.ts # HTTP interceptor injecting Bearer JWT
│   │   ├── services/
│   │   │   └── api.service.ts      # Angular API client service
│   │   ├── app.component.ts        # App root component & navigation
│   │   └── app.config.ts           # Routing & HTTP provider configuration
│   └── proxy.conf.json             # Dev proxy mapping /api to backend
├── .env.example                    # Sample environment variables
├── package.json                    # Backend dependencies and scripts
└── README.md                       # Enterprise platform documentation
```

---

## License

This project is licensed under the **MIT License**.

Contributions, issues, and feature requests are welcome!
