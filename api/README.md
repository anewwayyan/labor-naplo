# LaborNapló API

Azure Functions v4, JavaScript programming model v4.

## First endpoint

- `GET /api/health` — public, non-sensitive health check. Returns the API status and a UTC timestamp.

## Local prerequisites

- Node.js 22
- Azure Functions Core Tools v4

## Local run

From this `api` directory:

```bash
npm install
func start
```

The local endpoint is normally `http://localhost:7071/api/health`.

Do not commit `local.settings.json`, secrets, connection strings, API keys, or real health documents.

## Current scope

The API currently exposes only a health-check endpoint. It does not accept, store, or process personal or medical data.
