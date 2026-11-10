# LaborNapló – tervezett architektúra

## Jelenlegi állapot

A frontend egy statikus HTML/CSS/JavaScript prototípus. A fájlválasztás kizárólag böngészőoldali demonstráció; a fájl nem kerül feltöltésre vagy tárolásra.

## Tervezett felépítés

1. Azure Static Web Apps – frontend és később az API végpontok kiszolgálása.
2. Azure Functions – hitelesített szerveroldali műveletek és üzleti logika.
3. Azure SQL – strukturált laboreredmények, felhasználói profil és feldolgozási metaadatok.
4. Azure Blob Storage – eredeti leletek elkülönített, opcionális tárolása.
5. Dokumentumfeldolgozó és AI-szolgáltatás – adatok kinyerése, majd ellenőrzött strukturálás.

Az egészségügyi adatok védelmét, a felhasználói elkülönítést, a hozzáférés-szabályozást, a törlést/exportot és az adatfeldolgozók adatkezelését már a backend tervezésekor meg kell határozni.
