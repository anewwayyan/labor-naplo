# LaborNapló – ideiglenes API-hitelesítési diagnosztika

Ez a csomag kizárólag a tokenelutasítás pontos okának azonosítására szolgál.

## Mit tartalmaz?
- `api/src/lib/auth.js`: rövid, nem érzékeny elutasítási kódokat rendel a hitelesítési hibákhoz.
- `api/src/functions/me.js`: csak az `AUTH_DIAGNOSTICS=true` környezeti változó mellett adja vissza a diagnosztikai kódot.
- `assets/js/auth.js`: a visszaadott kódot megjeleníti a hibaüzenetben és a böngésző konzoljában.

## Telepítés
A három fájlt a repository gyökeréhez viszonyított útvonalon kell felülírni. Más fájlhoz, különösen a workflow-hoz és az Entra-konfigurációhoz ne nyúlj.

Az Azure Static Web Apps Production környezetében ideiglenesen add hozzá:

`AUTH_DIAGNOSTICS=true`

Deploy után jelentkezz be újra, majd próbáld meg a `/api/me` ellenőrzést. A felületen megjelenő diagnosztikai kódot küldd el. A bearer tokent, Authorization fejlécet vagy teljes JWT-t soha ne másold ki.

A diagnózis után töröljük az `AUTH_DIAGNOSTICS` változót, és a diagnosztikai kódot kiadó ideiglenes módosítást is eltávolítjuk.

## Adatvédelem
A diagnosztika nem naplóz bearer tokent, e-mail-címet, `oid` vagy `sub` claimet, és nem adja vissza a claimértékeket. Csak egy előre meghatározott hibakódot közöl.
