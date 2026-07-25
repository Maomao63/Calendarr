<div align="center">
  <h1>Calendarr</h1>
  <p>A beautiful, minimalistic, and modern calendar for your Sonarr and Radarr instances.</p>
</div>

---

## ✨ Features

- **Multi-Instance Support**: Connect as many Sonarr and Radarr instances as you need.
- **Modern UI**: A sleek, dark-themed interface with glassmorphism and ambient glows.
- **Responsive & Dynamic**: Works perfectly on mobile, tablet, and desktop.
- **Embedded Mode**: Perfectly integrates into dashboards like [Homarr](https://homarr.dev/), [Homepage](https://gethomepage.dev/), or [Dashy](https://dashy.to/) using an iframe.
- **Multiple Views**: Switch between Name view and Dot view.
- **No Database**: Completely stateless on the backend—everything is stored in a simple `config.json`. Configuration is handled entirely via the built-in UI!
- **Direct Links**: Click on any release to instantly open it in the respective Sonarr/Radarr instance.



---

## 🚀 Getting Started (Docker)

Calendarr is built to be run inside a Docker container.

### Docker Compose (Recommended)

Create a `docker-compose.yml` file:

```yaml
services:
  calendarr:
    image: ghcr.io/maomao63/calendarr:latest
    container_name: calendarr
    ports:
      - 3000:3000
    volumes:
      - ./config:/config
    restart: unless-stopped
```

Run it using:

```bash
docker-compose up -d
```

### Docker CLI

```bash
docker run -d \
  --name calendarr \
  -p 3000:3000 \
  -v ./config:/config \
  --restart unless-stopped \
  ghcr.io/maomao63/calendarr:latest
```

---

## ⚙️ Configuration

You do **not** need to edit any files manually! 

1. Start the container.
2. Open Calendarr in your browser at `http://localhost:3000`.
3. Click the **Settings/Gear icon** in the top right corner.
4. Add your Sonarr and Radarr instances:
   - Provide a **Name**
   - Provide the **URL** (e.g., `http://192.168.1.100:8989`)
   - Provide your **API Key**
   - Select a distinct **Color** for the calendar dots.

All configuration is automatically securely saved to `/config/config.json`.

---

## 🛠️ Dashboard Integration (Iframe)

Calendarr is optimized to be embedded into your favorite homelab dashboard. When loaded in an iframe, Calendarr automatically detects it and switches to a minimalistic UI without backgrounds, blending perfectly into your dashboard.

### Example for Homarr

Add an **Iframe Widget** to your Homarr dashboard with the following URL:

```text
http://<your-calendarr-ip>:3000/
```

**Tip:** Ensure the iframe block in your dashboard is large enough to display the calendar grid (e.g., at least 4x4 or 6x4 blocks).

---

## 🔧 Building from Source

If you want to run it without Docker or develop locally:

```bash
# Clone the repository
git clone https://github.com/Maomao63/Calendarr.git
cd Calendarr

# Install dependencies
npm install

# Build the frontend & backend
npm run build

# Start the server (default port 3000)
npm start
```

Your configuration will be saved to `config/config.json` by default when running locally.

---

## 📝 License

This project is licensed under the MIT License.
