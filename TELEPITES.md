# LaborNapló – OTP bejelentkezés telepítése

A csomag csak a módosítandó / hozzáadandó frontendfájlokat tartalmazza. A meglévő `assets/css/styles.css`, `assets/js/app.js`, `api/` és `.github/workflows/` fájlokat nem kell felülírni.

## GitHubra feltöltendő fájlok

A repository gyökerébe, a mappastruktúrát megtartva:

- `index.html` – a belépési képernyővel bővített oldal
- `assets/css/auth.css` – a belépési képernyő stílusai
- `assets/js/auth-config.js` – a már megadott Entra-azonosítók és redirect URL-ek
- `assets/js/auth.js` – MSAL Browser hitelesítési logika

A `TELEPITES.md` csak útmutató, nem szükséges publikálni.

## Entra beállítások ellenőrzése deploy előtt

Az új External tenantben ellenőrizd:

1. `LaborNaplo-Web` alkalmazásregisztráció platformja: **Single-page application (SPA)**.
2. Redirect URI pontosan: `https://gray-hill-07110e210.4.azurestaticapps.net/`.
3. `LaborNaploSignIn` user flow alatt az alkalmazás hozzá van adva.
4. A user flow e-mailes one-time passcode belépési módot használ.
5. A `tenantSubdomain` a tenant Primary domain `.onmicrosoft.com` előtti része (`labornaplo`).

## Telepítés

1. A fájlokat a repository gyökerébe másold, az útvonalakat megtartva.
2. Csak a felsorolt négy fájlt add hozzá / frissítsd.
3. A meglévő `.github/workflows/` és `api/` mappát ne módosítsd.
4. Commitold, majd várd meg a sikeres Azure Static Web Apps deployt.
5. Nyisd meg az alkalmazást privát böngészőablakban, és teszteld az e-mailes OTP belépést.

## Biztonsági megjegyzés

Ez a módosítás a frontend hitelesítési felületét és a Microsoft Entra External ID-val történő bejelentkezést vezeti be. A jelenlegi `/api/health` végpont továbbra is nyilvános. Mielőtt valódi laborleleteket vagy egészségügyi adatokat kezelnénk, az API-nak külön ellenőriznie kell a hozzáférési tokeneket, és minden adatot a hitelesített felhasználó stabil Entra-azonosítójához kell kötni.
