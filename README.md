# AI DBA Platform

> Super mega herramienta DBA – fusión de [performancemonitor](https://github.com/erikdarlingdata/performancemonitor), [ai-dba-platform](https://github.com/kaizen-dayro/ai-dba-platform) y [DataCheck-web](https://github.com/JhojanUsugaVargas/DataCheck-web).

**Author:** Jhojan Usuga

## Features

- **MSSQL Collector** – Sessions, CPU usage, performance counters via `sys.dm_exec_sessions`.
- **PostgreSQL Collector** – Sessions and query stats via `pg_stat_activity`.
- **Data Quality Checks** – Duplicate detection, missing field analysis, numeric statistics.
- **AI Analysis** – Sends metrics + data-quality report to Anthropic Claude for actionable recommendations.
- **Angular 17 UI** – Dashboard with metrics, data-check reports, and AI recommendations.

## Quick Start

### Prerequisites
- Node.js >= 22
- npm >= 10

### Backend

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# Edit .env with your connection strings and API key

# Start development server
npm run dev
```

### Frontend (Angular)

```bash
cd ui
npm install
npm start
```

The Angular dev server runs on `http://localhost:4200` and proxies `/api/*` to `http://localhost:3000`.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/metrics` | Collect PostgreSQL & MSSQL metrics |
| POST | `/datacheck` | Run data-quality checks (body: `{ "data": [...] }`) |
| POST | `/analyze` | Collect metrics, run data-check, get AI recommendations |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `PG_CONNECTION_STRING` | PostgreSQL connection string |
| `MSSQL_CONNECTION_STRING` | MSSQL connection string |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude |
| `PORT` | Server port (default: 3000) |

## Project Structure

```
ai-dba-platform/
├── src/
│   ├── server.ts              # Express server
│   ├── collectors/
│   │   ├── mssqlCollector.ts   # MSSQL performance collector
│   │   └── postgresCollector.ts # PostgreSQL performance collector
│   ├── datacheck/
│   │   └── datacheck.service.ts # Data quality validation
│   ├── ai/
│   │   └── analyze.ts          # Anthropic Claude integration
│   ├── routes/
│   │   └── datacheckRouter.ts  # DataCheck REST router
│   └── __tests__/
│       └── datacheck.service.test.ts
├── ui/                         # Angular 17 frontend
│   ├── src/app/
│   │   ├── components/
│   │   │   ├── dashboard/      # Main dashboard
│   │   │   ├── metrics/        # Metrics display
│   │   │   ├── datacheck/      # Data quality checker
│   │   │   └── analysis/       # AI analysis results
│   │   └── services/
│   │       └── api.service.ts  # Backend API client
│   └── proxy.conf.json
├── data-check-web/             # Reference: DataCheck-web repo
├── .env.example
├── package.json
└── README.md
```

## License

MIT
