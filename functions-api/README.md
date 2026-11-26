# LaborNapló API

Azure Functions v4, JavaScript programming model v4.

## HTTP endpoints

- `GET /api/health` — public, non-sensitive health check.
- `GET /api/me` — authenticated identity and database/RLS diagnostic endpoint.
- `GET /api/profile`, `PUT /api/profile` — authenticated user profile.
- `GET|POST /api/medications`, `GET|PUT|DELETE /api/medications/{id}` — medication records.
- `GET|POST /api/allergies`, `GET|PUT|DELETE /api/allergies/{id}` — allergy records.
- `POST /api/reports` — upload a private PDF report.
- `GET /api/reports` — list the authenticated user's reports.
- `GET /api/reports/{id}/pdf` — securely stream one report PDF.
- `DELETE /api/reports/{id}` — mark a report for deletion and remove its private PDF.
- `POST /api/reports/{id}/extract` — OCR the first two pages with Azure AI Document Intelligence Read (F0-compatible) and store review candidates.
- `GET /api/reports/{id}/values` — retrieve extracted values for review.
- `POST /api/reports/{id}/approve` — save user-reviewed values and approve the report.
- `GET /api/lab-values` — list approved laboratory values for the authenticated user.

## Document Intelligence configuration

Create an Azure AI Document Intelligence resource using the **Free (F0)** pricing tier. Configure these Function App settings:

- `DOCUMENT_INTELLIGENCE_ENDPOINT` — the resource endpoint, for example `https://<resource-name>.cognitiveservices.azure.com/`.
- `DOCUMENT_INTELLIGENCE_KEY` — one of the resource keys. Store it only in Function App application settings / Key Vault, never in frontend code or Git.

The API calls the `prebuilt-read` model and explicitly limits the request to pages `1-2`, matching the F0 first-two-pages restriction and avoiding accidental paid-tier page processing. F0 currently provides 500 pages/month. The API does not automatically switch to S0.

The OCR service extracts text; the Leletke parser only proposes likely laboratory rows. It does not make medical interpretations. Users must review and correct every value before approval. A successful extraction is saved as `Review`; only an explicit approval writes to `LabValues` and makes values appear in results.

If the Document Intelligence settings are absent, extraction returns a clear configuration error; PDF upload and preview continue to work.

## Response shapes

Collection GET responses use `{ "items": [] }` or, for reports, `{ "reports": [] }`. Approval accepts `{ "values": [{ "extractedValueId": "...", "parameterName": "...", "valueNumeric": 5.1, "valueText": null, "unit": "mmol/L", "referenceRange": "3.9-6.1", "referenceLow": 3.9, "referenceHigh": 6.1, "isAbnormal": false }] }`. Exactly one of `valueNumeric` and `valueText` must be provided per item.

## Security

All user-owned endpoints validate the Entra External ID access token and derive tenant/user ownership only from verified claims. SQL access runs with the per-request RLS session context. Queries are parameterized; owner identifiers are never accepted from the client. Responses use `Cache-Control: no-store`. PDF bytes remain in private Blob Storage. Never log OCR text, extracted medical values, access tokens, keys, or connection strings.

## Local prerequisites

- Node.js 22
- Azure Functions Core Tools v4

From this directory, run `npm install` and `func start`.

Do not commit `local.settings.json`, secrets, connection strings, API keys, or real health documents.
