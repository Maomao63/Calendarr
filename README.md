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

## Installation mit Docker Compose

Für die Installation werden drei Dateien benötigt:

```text
calendarr/
├── compose.yaml
├── .env
└── config/
    └── config.json
```

### 1. Verzeichnisse anlegen

```sh
mkdir -p calendarr/config
cd calendarr
```

### 2. `compose.yaml` erstellen

```yaml
services:
  calendarr:
    image: ghcr.io/maomao63/calendarr:latest
    pull_policy: always
    container_name: calendarr
    restart: unless-stopped
    ports:
      - "${CALENDARR_PORT:-3000}:3000"
    environment:
      PORT: 3000
      CONFIG_FILE: /config/config.json
    volumes:
      - "${CALENDARR_CONFIG_PATH:-./config}:/config:ro"
    extra_hosts:
      - "host.docker.internal:host-gateway"
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 3
```

### 3. `.env` erstellen

Die `.env` muss im selben Verzeichnis wie `compose.yaml` liegen:

```env
CALENDARR_CONFIG_PATH=./config
CALENDARR_PORT=3000
```

| Variable | Beschreibung |
| --- | --- |
| `CALENDARR_CONFIG_PATH` | Verzeichnis mit der `config.json` auf dem Docker-Host |
| `CALENDARR_PORT` | Von außen erreichbarer Port |

Der Speicherort der Konfiguration ist frei wählbar. Für einen absoluten Pfad
kann beispielsweise Folgendes verwendet werden:

```env
CALENDARR_CONFIG_PATH=/srv/docker/calendarr
```

In diesem Verzeichnis muss direkt die Datei `config.json` liegen. Das
Verzeichnis wird schreibgeschützt unter `/config` in den Container eingebunden.

### 4. `config/config.json` erstellen

```json
{
  "sonarrInstances": [
    {
      "name": "Sonarr",
      "url": "http://host.docker.internal:8989",
      "apiKey": "DEIN_SONARR_API_KEY"
    }
  ],
  "radarrInstances": [
    {
      "name": "Radarr",
      "url": "http://host.docker.internal:7878",
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

Die API-Keys befinden sich in Sonarr und Radarr jeweils unter
`Einstellungen > Allgemein > Sicherheit`.

### 5. Verbindung zu Sonarr und Radarr

Ein zusätzliches Docker-Netzwerk ist nicht erforderlich. Calendarr erreicht
Sonarr und Radarr über den Docker-Host:

```json
"url": "http://host.docker.internal:8989"
```

Die Ports von Sonarr und Radarr müssen dafür auf dem Docker-Host veröffentlicht
sein, normalerweise `8989` und `7878`. Alternativ kann in `config.json` eine
direkt erreichbare IP-Adresse oder Domain eingetragen werden.

### 6. Calendarr starten

```sh
docker compose up -d
```

Status prüfen:

```sh
docker compose ps
docker compose logs -f calendarr
```

Calendarr ist anschließend standardmäßig unter
`http://<docker-host>:3000` erreichbar.

## Konfiguration

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

## Updates

Compose verwendet das Multi-Arch-Image
`ghcr.io/maomao63/calendarr:latest` für `linux/amd64` und `linux/arm64`.

Eine neue Version wird folgendermaßen geladen:

```sh
docker compose pull
docker compose up -d
```

Bei jedem Push auf den Branch `main` erstellt GitHub Actions automatisch ein
neues Image mit dem Tag `latest`.

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
