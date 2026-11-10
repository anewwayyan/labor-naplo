# LaborNapló

A LaborNapló jelenlegi, statikus frontend-prototípusa. A projekt egyszerű HTML, CSS és JavaScript alapú, ezért közvetlenül kiszolgálható Azure Static Web Apps-en, külön buildlépés nélkül.

## Mappastruktúra

- `index.html` – az alkalmazás belépőoldala
- `assets/css/styles.css` – megjelenés és reszponzív stílusok
- `assets/js/app.js` – jelenlegi kliensoldali működés
- `api/` – későbbi Azure Functions API helye; jelenleg még nincs benne működő API
- `docs/` – fejlesztési és architekturális dokumentáció

## Azure Static Web Apps beállítás

Amíg nincs backend/API:

- App location: `/`
- API location: üres
- Output location: üres

Később, amikor az `api/` mappába bekerül a tényleges Azure Functions projekt, a GitHub Actions workflow `api_location` értékét `api`-ra kell állítani. A már meglévő `.github/workflows/` workflow-fájlt és az Azure által létrehozott GitHub Secretet meg kell őrizni. A csomag szándékosan nem tartalmaz új workflow-fájlt, nehogy felülírja a működő deploy-konfigurációt.

## Fontos

Ez még csak frontend-prototípus. Nincs benne felhasználói hitelesítés, szerveroldali dokumentumfeltöltés, adatbázis vagy AI-feldolgozás. Éles egészségügyi adatot ne tölts fel.
