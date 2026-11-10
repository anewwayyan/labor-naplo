# LaborNapló – API tokenvédelem beállítása

## Entra alkalmazások

A külső tenantban két külön alkalmazásregisztráció van:

- `LaborNaplo-Web`: böngészőben futó SPA.
- `LaborNaplo-API`: a backend API.

A `LaborNaplo-API` az `Expose an API` oldalon közzéteszi az `access_as_user` delegated scope-ot. A `LaborNaplo-Web` API permissions oldalán ez a scope Delegated permissionként hozzá van adva, és az admin consent státusza `Granted`.

A `LaborNaplo-API` manifestjében az `accessTokenAcceptedVersion` értéke `2`.

## Frontend konfiguráció

Az `assets/js/auth-config.js` tartalmazza a SPA nyilvános Client ID-ját, a tenant subdomaint, a redirect URI-t és az API scope-ot.

Ezek nem titkos értékek. Client secretet böngészőben futó SPA-hoz nem szabad létrehozni vagy tárolni.

## Backend környezeti változók

Azure Portal → LaborNapló Static Web App → Settings → Environment variables → Production:

| Name | Value |
|---|---|
| `ENTRA_TENANT_SUBDOMAIN` | `labornaplo` |
| `ENTRA_TENANT_ID` | `d6755fbb-1091-4a15-8b03-9599770766f2` |
| `ENTRA_API_CLIENT_ID` | `6ec0ba97-551c-4efc-8e4f-88128c2048c0` |
| `ENTRA_SPA_CLIENT_ID` | `1edcad85-b889-428d-93e7-1734fcc6040d` |
| `ENTRA_API_SCOPE` | `access_as_user` |

Ezeket a beállításokat már létrehoztad az Azure-ban; újra felvenni nem kell.

## Tokenellenőrzés

A backend a tenant-specifikus discovery dokumentumot tölti le erről a címről:

`https://labornaplo.ciamlogin.com/d6755fbb-1091-4a15-8b03-9599770766f2/v2.0/.well-known/openid-configuration`

A token `iss` értékét nem saját maga építi fel: a discovery dokumentum `issuer` mezőjével ellenőrzi. Ez fontos, mert az External ID issuer pontos értékét a tenant discovery metadata határozza meg.

A metadata URL a tenant subdomainjét használja. A metadata `issuer` és `jwks_uri` értékeinél a kód HTTPS-t és a tenant subdomainjéhez vagy tenant GUID-jához tartozó `ciamlogin.com` hostot fogad el. A JWKS-kulcsok Microsofttól automatikusan frissülnek, így a kulcsrotációt nem kell kézzel kezelni.

A JWT-ellenőrzés ellenőrzi:

- az aláírást (RS256, Microsoft JWKS kulccsal),
- az issuer értéket (a discovery metadata alapján),
- az audience értéket (API Client ID),
- a `tid` tenant claimet,
- a `azp` / `appid` hívó kliensazonosítót (SPA Client ID),
- az `access_as_user` scope-ot,
- a felhasználó `oid` azonosítóját.

## GitHub-frissítés

A ZIP tartalmát a repository gyökerébe kell bemásolni, a könyvtárstruktúrát megtartva.

Felülírható fájlok:

- `README.md`
- `assets/js/auth-config.js`
- `assets/js/auth.js`
- `api/package.json`
- `api/src/index.js`
- `api/src/functions/health.js` (az eddigi, nyilvános health végponttal azonos tartalom)
- `api/host.json` és `api/.funcignore` (változatlan, meglévő beállítások)

Új fájlok:

- `docs/API_TOKEN_VEDELEM_BEALLITAS.md`
- `api/src/lib/auth.js`
- `api/src/functions/me.js`

Ne írd felül a `.github/workflows/` mappát, a `staticwebapp.config.json` fájlt, a frontend `index.html` fájlt, `assets/css/` stíluslapokat vagy a `assets/js/app.js` fájlt.

Commit message javaslat:

`feat: protect API with Entra External ID access tokens`

## Tesztelés deploy után

1. Nyisd meg a `/api/health` címet: elvárt HTTP 200 és `status: ok`.
2. Nyisd meg bejelentkezés nélkül a `/api/me` címet: elvárt HTTP 401 `unauthorized`.
3. Jelentkezz be a LaborNaplóba e-mailes OTP-vel: az SPA API access tokent kér, a `/api/me` végpontot meghívja, és sikeres ellenőrzés esetén a válaszban `authenticated: true` szerepel.
4. Ha a tokenellenőrzés konfigurációs hibával leáll, az API 503-at ad. Ilyenkor a Static Web Apps API logjában keresd a `LaborNapló API authentication configuration error` bejegyzést. Tokent vagy teljes Authorization fejlécet soha ne másolj be hibajegybe vagy chatbe.

## Fontos korlátozás

Ez a csomag a `/api/me` tesztvégpontot védi. A laboreredmények kezelése még nincs megvalósítva. Mielőtt személyes vagy egészségügyi adatot fogadnánk, minden új végpontban kötelező a `authenticateRequest` meghívása, és minden lekérdezést a tokenből származó felhasználói `oid`-hez kell kötni.
