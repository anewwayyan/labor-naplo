# LaborNapló

A LaborNapló statikus webes felülete Microsoft Entra External ID e-mailes egyszer használatos kódos (OTP) bejelentkezéssel, valamint Azure Functions API-val.

## Projekt fő részei

- `index.html` – a webalkalmazás felülete (a repository meglévő fájlja)
- `assets/css/` – megjelenés
- `assets/js/` – frontend működés és Entra-hitelesítés
- `api/` – Azure Functions v4 backend
- `docs/` – fejlesztési és üzemeltetési dokumentáció

## Hitelesítés

A felhasználók a Microsoft Entra External ID bejelentkezési oldalán, e-mailes egyszer használatos kóddal regisztrálnak és lépnek be. A böngésző MSAL Browser segítségével API-specifikus access tokent kér, majd a `/api/me` végpontnak küldi.

A backend a token aláírását, kibocsátóját, közönségét, tenantazonosítóját, a hívó SPA azonosítóját és a `access_as_user` scope-ot is ellenőrzi. A `/api/health` szándékosan nyilvános állapotellenőrző végpont; a `/api/me` bejelentkezést igényel.

## Fontos biztonsági szabályok

- API-kulcsot, kliens-titkot, adatbázis-jelszót vagy Storage-kulcsot ne tegyél a frontendbe vagy a GitHub repositoryba.
- A `auth-config.js` csak nyilvános alkalmazásazonosítókat és scope-ot tartalmaz.
- Minden új, személyes vagy egészségügyi adatot kezelő API-végpontnak ellenőriznie kell a tokent.
- Minden adatbázis-lekérdezést a tokenből ellenőrzött `oid` felhasználói azonosítóhoz kell kötni. A kliens által küldött user ID önmagában nem megbízható.
- A jelenlegi `/api/me` csak a hitelesítést ellenőrzi; még nincs benne laboradat-tárolás.

## Azure Static Web Apps deploy

A GitHub Actions workflow-ban:

- `app_location: "/"`
- `api_location: "api"`
- `output_location: ""`

A meglévő `.github/workflows/` fájlokat és a deploy secretet őrizd meg.

## Helyi és éles beállítások

A backend az Azure Static Web Apps Production környezetében beállított alábbi app settingeket használja:

- `ENTRA_TENANT_SUBDOMAIN`
- `ENTRA_TENANT_ID`
- `ENTRA_API_CLIENT_ID`
- `ENTRA_SPA_CLIENT_ID`
- `ENTRA_API_SCOPE`

A pontos értékeket és a tokenellenőrzés részleteit a `docs/API_TOKEN_VEDELEM_BEALLITAS.md` tartalmazza.
