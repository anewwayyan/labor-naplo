# LaborNapló API

Azure Functions v4, JavaScript programming model v4.

## HTTP endpoints

- `GET /api/health` — public, non-sensitive health check.
- `GET /api/me` — authenticated identity and database/RLS diagnostic endpoint.
- `GET /api/profile` — returns the authenticated user's profile, or default profile values if no profile has been saved yet.
- `PUT /api/profile` — creates or updates the authenticated user's profile fields: `firstName`, `preferredName`, `greetingEnabled`, `dateOfBirth`, and `sex`.
- `GET /api/reports` and the existing report endpoints — report workflows.

The profile PUT body may contain any non-empty subset of the supported fields. Send `null` to clear nullable text/date values. `greetingEnabled` must be a boolean.

## Security

The profile endpoints validate the Entra External ID access token and derive tenant/user ownership only from its verified claims. SQL access runs with the per-request RLS session context. Profile writes use parameterized SQL and never accept owner identifiers from the client. Medical-history collections are not yet exposed by the API.

## Local prerequisites

- Node.js 22
- Azure Functions Core Tools v4

From this directory, run `npm install` and `func start`.

Do not commit `local.settings.json`, secrets, connection strings, API keys, or real health documents.
