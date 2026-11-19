# LaborNapló API

Azure Functions v4, JavaScript programming model v4.

## HTTP endpoints

- `GET /api/health` — public, non-sensitive health check.
- `GET /api/me` — authenticated identity and database/RLS diagnostic endpoint.
- `GET /api/profile` — returns the authenticated user's profile, or default profile values if no profile has been saved yet.
- `PUT /api/profile` — creates or updates the authenticated user's profile fields: `firstName`, `preferredName`, `greetingEnabled`, `dateOfBirth`, and `sex`.
- `GET /api/medications` — lists the authenticated user's medications.
- `POST /api/medications` — creates a medication; `name` is required.
- `GET /api/medications/{id}`, `PUT /api/medications/{id}`, `DELETE /api/medications/{id}` — reads, partially updates, or deletes one medication.
- `GET /api/allergies` — lists the authenticated user's allergies.
- `POST /api/allergies` — creates an allergy; `substance` is required.
- `GET /api/allergies/{id}`, `PUT /api/allergies/{id}`, `DELETE /api/allergies/{id}` — reads, partially updates, or deletes one allergy.
- `GET /api/reports` and the existing report endpoints — report workflows.

Collection GET responses use `{ "items": [] }`; single-record operations use `{ "item": {} }`. Create, update, and delete responses include a corresponding `created`, `updated`, or `deleted` flag. PUT accepts a non-empty subset of the record's editable fields. Send `null` to clear nullable text/date fields. Medication `isActive` must be a boolean. Allergy `severity` is one of `Mild`, `Moderate`, `Severe`, or `Unknown`, or `null`.

## Security

All profile, medication, and allergy endpoints validate the Entra External ID access token and derive tenant/user ownership only from its verified claims. SQL access runs with the per-request RLS session context. Queries are parameterized; owner identifiers are never accepted from the client. Responses use `Cache-Control: no-store`. Child records automatically create an otherwise-empty `UserProfiles` root row when needed to satisfy the database foreign key. No personal or medical test data is inserted.

## Local prerequisites

- Node.js 22
- Azure Functions Core Tools v4

From this directory, run `npm install` and `func start`.

Do not commit `local.settings.json`, secrets, connection strings, API keys, or real health documents.
