# LaborNapló – JWT diagnosztika (3. kör)

Ez a csomag csak ideiglenes hibakeresésre szolgál. A bearer tokent, e-mail-címet, felhasználói azonosítót és teljes JWT-claim értékeket nem naplózza és nem küldi vissza.

## GitHubon felülírandó fájlok

- `api/src/lib/auth.js`
- `api/src/functions/me.js`
- `assets/js/auth.js`

A mappaszerkezetet tartsd meg, és a repository gyökerébe másold a fájlokat. A többi fájlt ne módosítsd.

## Azure

Az Azure Static Web App Production környezeti változói között maradjon ideiglenesen:

- `AUTH_DIAGNOSTICS=true`

A csomag a következő diagnosztikai mezőket adja vissza: szabványos JOSE hibakód (allowlistből), hibatípus, token aláírási algoritmusa és annak jelzése, hogy van-e `kid` fejlécmező. A `kid` konkrét értékét nem teszi közzé.

## Teszt

Várd meg a zöld GitHub Actions deployt, frissítsd az oldalt, majd jelentkezz be újra. Másold el a felületen megjelenő teljes diagnosztikai kódot, például `SIGNING_KEY_FETCH_TIMEOUT (ERR_JWKS_TIMEOUT, JWKSTimeout, alg=RS256, kid=present)`.

A hiba elhárítása után ezt az ideiglenes diagnosztikát el kell távolítani, és `AUTH_DIAGNOSTICS` értékét `false`-ra kell állítani vagy törölni kell.
