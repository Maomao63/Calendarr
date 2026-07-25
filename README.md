# Calendarr

Ein übersichtlicher Release-Kalender für Sonarr und Radarr, optimiert für Docker
und die Einbindung als Homarr-Iframe.

## Funktionen

- Gemeinsamer Kalender für Sonarr-Episoden und Radarr-Filme
- Mehrere Sonarr- und Radarr-Instanzen
- Tages-, 3-Tage-, Wochen- und Monatsansicht
- Detailansicht mit Poster, Beschreibung und direktem Sonarr-/Radarr-Link
- Kompakte Punkte- oder Namensdarstellung
- Anpassbare Farben und automatische Aktualisierung
- Deutsche Oberfläche und konfigurierbares Datumsformat
- Persistente Konfiguration mit API-Keys außerhalb des Images
- Docker-Images für `linux/amd64` und `linux/arm64`
- Für Homarr und andere Iframes optimiertes Layout

## Schnellstart

Voraussetzung ist ein Docker-Netzwerk, das Calendarr mit Sonarr und Radarr
verbindet. Der Standardname ist `media`.

```sh
docker network create media
cp .env.example .env
cp config/config.example.json config/config.json
```

Anschließend die URLs und API-Keys in `config/config.json` eintragen und starten:

```sh
docker compose up -d
```

Calendarr ist danach standardmäßig unter `http://localhost:3000` erreichbar.

## Docker-Image

Compose zieht standardmäßig immer das aktuelle Image:

```text
ghcr.io/maomao63/calendarr:latest
```

Aktualisieren:

```sh
docker compose pull
docker compose up -d
```

Bei jedem Push auf den Branch `main` erstellt GitHub Actions ein neues
Multi-Arch-Image mit dem Tag `latest`.

## `.env`

Die Compose-Einstellungen liegen in `.env`:

```env
CALENDARR_IMAGE=ghcr.io/maomao63/calendarr:latest
CALENDARR_CONFIG_PATH=./config
MEDIA_NETWORK=media
CALENDARR_PORT=3000
```

`CALENDARR_CONFIG_PATH` darf auch ein frei gewählter absoluter Pfad sein:

```env
CALENDARR_CONFIG_PATH=/srv/docker/calendarr
```

In diesem Verzeichnis muss die Datei `config.json` liegen. Das Verzeichnis wird
im Container schreibgeschützt unter `/config` eingebunden.

## `config.json`

```json
{
  "sonarrInstances": [
    {
      "name": "Sonarr",
      "url": "http://sonarr:8989",
      "apiKey": "DEIN_SONARR_API_KEY"
    }
  ],
  "radarrInstances": [
    {
      "name": "Radarr",
      "url": "http://radarr:7878",
      "apiKey": "DEIN_RADARR_API_KEY"
    }
  ],
  "settings": {
    "locale": "de-DE",
    "refreshIntervalMinutes": 5,
    "defaultView": "month",
    "defaultDisplay": "names",
    "colors": {
      "sonarr": "#55d6be",
      "radarr": "#ffbe5c"
    }
  }
}
```

Unterstützte Werte:

| Einstellung | Werte |
| --- | --- |
| `defaultView` | `day`, `three`, `week`, `month` |
| `defaultDisplay` | `names`, `dots` |
| `refreshIntervalMinutes` | Positive Zahl |
| `locale` | Zum Beispiel `de-DE` oder `en-US` |
| `colors` | Farben im Format `#RRGGBB` |

Sonarr oder Radarr darf leer bleiben:

```json
"radarrInstances": []
```

Geänderte Instanzen oder API-Keys werden bei der nächsten Aktualisierung des
Kalenders übernommen. Änderungen an den Oberflächen-Einstellungen greifen nach
dem Neuladen der Seite. API-Keys werden nicht an den Browser ausgeliefert.
Individuell im Browser gewählte Ansicht und Farben werden weiterhin lokal
gespeichert und überschreiben dort die Standardwerte.

## Homarr

Als Iframe-URL:

```text
http://<docker-host>:3000/?embed=1
```

Ansicht und Darstellungsmodus können optional vorgegeben werden:

```text
http://<docker-host>:3000/?embed=1&view=week&display=dots
```

## Lokale Entwicklung

```sh
npm ci
npm run build
CONFIG_FILE=./config/config.json npm start
```

Healthcheck:

```text
GET /api/health
```

## Grundlage

Dieses Projekt basiert auf
[Nino1500/calendarr](https://github.com/Nino1500/calendarr).
