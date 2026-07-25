import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFile, rename, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const port = Number(process.env.PORT ?? 3000);
const publicDirectory = join(__dirname, "public");
const configFile = process.env.CONFIG_FILE ?? "/config/config.json";

type ServiceName = "sonarr" | "radarr";

class ClientError extends Error {}

interface ServiceConfig {
  name?: string;
  url: string;
  apiKey: string;
  color?: string;
}

interface CalendarResult {
  sourceLocation: { protocol: string; port: string; pathname: string };
  items: unknown[];
}

interface UiSettings {
  locale: string;
  refreshIntervalMinutes: number;
  defaultView: "day" | "three" | "week" | "month";
  defaultDisplay: "names" | "dots";
  colors: {
    sonarr: string;
    radarr: string;
  };
}

interface AppConfig {
  sonarrInstances: ServiceConfig[];
  radarrInstances: ServiceConfig[];
  settings: UiSettings;
}

const defaultSettings: UiSettings = {
  locale: "de-DE",
  refreshIntervalMinutes: 5,
  defaultView: "month",
  defaultDisplay: "names",
  colors: {
    sonarr: "#55d6be",
    radarr: "#ffbe5c",
  },
};

function validateInstances(
  serviceName: ServiceName,
  value: unknown,
): ServiceConfig[] {
  if (value === undefined) return [];

  if (!Array.isArray(value)) {
    throw new Error(`${serviceName}Instances must be an array`);
  }

  return value.map((instance, index) => {
    if (
      typeof instance !== "object" || instance === null ||
      !("url" in instance) || !("apiKey" in instance) ||
      typeof instance.url !== "string" || typeof instance.apiKey !== "string" ||
      ("name" in instance && instance.name !== undefined && typeof instance.name !== "string") ||
      ("color" in instance && instance.color !== undefined &&
        (typeof instance.color !== "string" || !/^#[0-9a-f]{6}$/i.test(instance.color)))
    ) {
      throw new Error(`${serviceName}Instances entry ${index + 1} is invalid`);
    }
    return {
      url: instance.url,
      apiKey: instance.apiKey,
      name: instance.name,
      color: instance.color,
    };
  });
}

function parseEnvironmentInstances(serviceName: ServiceName, value: string | undefined): ServiceConfig[] {
  if (!value) return [];
  try {
    return validateInstances(serviceName, JSON.parse(value));
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`Invalid ${serviceName.toUpperCase()}_INSTANCES: ${message}`);
  }
}

function parseSettings(value: unknown): UiSettings {
  const settings = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const colors = typeof settings.colors === "object" && settings.colors !== null
    ? settings.colors as Record<string, unknown>
    : {};
  const locale = typeof settings.locale === "string" && settings.locale ? settings.locale : defaultSettings.locale;
  const refreshIntervalMinutes = typeof settings.refreshIntervalMinutes === "number" &&
    Number.isFinite(settings.refreshIntervalMinutes) && settings.refreshIntervalMinutes > 0
    ? settings.refreshIntervalMinutes
    : defaultSettings.refreshIntervalMinutes;
  const defaultView = ["day", "three", "week", "month"].includes(String(settings.defaultView))
    ? settings.defaultView as UiSettings["defaultView"]
    : defaultSettings.defaultView;
  const defaultDisplay = ["names", "dots"].includes(String(settings.defaultDisplay))
    ? settings.defaultDisplay as UiSettings["defaultDisplay"]
    : defaultSettings.defaultDisplay;
  const validColor = (color: unknown, fallback: string): string =>
    typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;

  return {
    locale,
    refreshIntervalMinutes,
    defaultView,
    defaultDisplay,
    colors: {
      sonarr: validColor(colors.sonarr, defaultSettings.colors.sonarr),
      radarr: validColor(colors.radarr, defaultSettings.colors.radarr),
    },
  };
}

async function loadConfig(): Promise<AppConfig> {
  try {
    const contents = await readFile(configFile, "utf8");
    const parsed: unknown = JSON.parse(contents);
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("root value must be an object");
    }
    const config = parsed as Record<string, unknown>;
    return {
      sonarrInstances: validateInstances("sonarr", config.sonarrInstances),
      radarrInstances: validateInstances("radarr", config.radarrInstances),
      settings: parseSettings(config.settings),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      const message = error instanceof Error ? error.message : "unknown error";
      throw new Error(`Invalid config file ${configFile}: ${message}`);
    }

    return {
      sonarrInstances: parseEnvironmentInstances("sonarr", process.env.SONARR_INSTANCES),
      radarrInstances: parseEnvironmentInstances("radarr", process.env.RADARR_INSTANCES),
      settings: defaultSettings,
    };
  }
}

async function readRequestBody(request: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of request) {
    body += chunk.toString();
    if (body.length > 256_000) throw new ClientError("Request body is too large");
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new ClientError("Request body must be valid JSON");
  }
}

function sanitizeConfig(config: AppConfig): unknown {
  const sanitizeInstances = (instances: ServiceConfig[]) => instances.map((instance, configIndex) => ({
    configIndex,
    name: instance.name ?? "",
    url: instance.url,
    apiKey: "",
    hasApiKey: Boolean(instance.apiKey),
    color: instance.color,
  }));

  return {
    sonarrInstances: sanitizeInstances(config.sonarrInstances),
    radarrInstances: sanitizeInstances(config.radarrInstances),
  };
}

function validateConfigUpdateInstances(
  serviceName: ServiceName,
  value: unknown,
  existingInstances: ServiceConfig[],
  fallbackColor: string,
): ServiceConfig[] {
  if (!Array.isArray(value)) throw new ClientError(`${serviceName}Instances must be an array`);
  const usedIndexes = new Set<number>();

  return value.map((rawInstance, index) => {
    if (typeof rawInstance !== "object" || rawInstance === null) {
      throw new ClientError(`${serviceName} instance ${index + 1} is invalid`);
    }
    const instance = rawInstance as Record<string, unknown>;
    const name = typeof instance.name === "string" ? instance.name.trim() : "";
    const rawUrl = typeof instance.url === "string" ? instance.url.trim().replace(/\/+$/, "") : "";
    const url = rawUrl && !/^https?:\/\//i.test(rawUrl) ? `http://${rawUrl}` : rawUrl;
    const submittedApiKey = typeof instance.apiKey === "string" ? instance.apiKey.trim() : "";
    const color = typeof instance.color === "string" ? instance.color.trim() : fallbackColor;
    const configIndex = typeof instance.configIndex === "number" && Number.isInteger(instance.configIndex)
      ? instance.configIndex
      : undefined;

    if (!name) throw new ClientError(`${serviceName} instance ${index + 1} needs a name`);
    try {
      const parsedUrl = new URL(url);
      if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error();
    } catch {
      throw new ClientError(`${serviceName} instance ${index + 1} needs a valid HTTP(S) URL`);
    }
    if (!/^#[0-9a-f]{6}$/i.test(color)) {
      throw new ClientError(`${serviceName} instance ${index + 1} needs a valid color`);
    }
    if (configIndex !== undefined) {
      if (!existingInstances[configIndex] || usedIndexes.has(configIndex)) {
        throw new ClientError(`${serviceName} instance ${index + 1} has an invalid reference`);
      }
      usedIndexes.add(configIndex);
    }
    const apiKey = submittedApiKey || (configIndex !== undefined ? existingInstances[configIndex].apiKey : "");
    if (!apiKey) throw new ClientError(`${serviceName} instance ${index + 1} needs an API key`);

    return { name, url, apiKey, color };
  });
}

async function updateConfig(request: IncomingMessage): Promise<AppConfig> {
  const submitted = await readRequestBody(request);
  if (typeof submitted !== "object" || submitted === null) {
    throw new ClientError("Configuration must be an object");
  }
  const body = submitted as Record<string, unknown>;
  const current = await loadConfig();
  const updated: AppConfig = {
    sonarrInstances: validateConfigUpdateInstances(
      "sonarr",
      body.sonarrInstances,
      current.sonarrInstances,
      current.settings.colors.sonarr,
    ),
    radarrInstances: validateConfigUpdateInstances(
      "radarr",
      body.radarrInstances,
      current.radarrInstances,
      current.settings.colors.radarr,
    ),
    settings: current.settings,
  };
  const temporaryFile = `${configFile}.tmp`;
  await writeFile(temporaryFile, `${JSON.stringify(updated, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryFile, configFile);
  return updated;
}

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function proxyCalendar(
  requestUrl: URL,
  serviceName: ServiceName,
  response: ServerResponse,
): Promise<void> {
  const config = await loadConfig();
  const services: Record<ServiceName, ServiceConfig[]> = {
    sonarr: config.sonarrInstances,
    radarr: config.radarrInstances,
  };
  const instances = services[serviceName];
  if (!instances.length) {
    json(response, 200, { configured: false, items: [] });
    return;
  }

  const results = await Promise.all(instances.map(async (service): Promise<CalendarResult | Error> => {
    try {
      const upstream = new URL("api/v3/calendar", service.url.endsWith("/") ? service.url : `${service.url}/`);
      upstream.searchParams.set("start", requestUrl.searchParams.get("start") ?? "");
      upstream.searchParams.set("end", requestUrl.searchParams.get("end") ?? "");
      upstream.searchParams.set("includeSeries", "true");
      upstream.searchParams.set("includeEpisodeFile", "true");
      upstream.searchParams.set("includeMovie", "true");

      const upstreamResponse = await fetch(upstream, {
        headers: { "X-Api-Key": service.apiKey },
        signal: AbortSignal.timeout(15_000),
      });
      if (!upstreamResponse.ok) {
        throw new Error(`${service.name ?? service.url} returned ${upstreamResponse.status}`);
      }

      const items: unknown = await upstreamResponse.json();
      if (!Array.isArray(items)) {
        throw new Error(`${service.name ?? service.url} returned an invalid calendar response`);
      }

      const serviceUrl = new URL(service.url);
      const sourceLocation = {
        protocol: serviceUrl.protocol,
        port: serviceUrl.port,
        pathname: serviceUrl.pathname,
      };
      return {
        sourceLocation,
        items: items.map((item) => typeof item === "object" && item !== null
          ? {
            ...item,
            _calendarr: {
              name: service.name ?? serviceUrl.hostname,
              color: service.color,
              sourceLocation,
            },
          }
          : item),
      };
    } catch (error) {
      return error instanceof Error ? error : new Error(`Could not reach ${serviceName}`);
    }
  }));

  const successfulResults = results.filter((result): result is CalendarResult => !(result instanceof Error));
  if (!successfulResults.length) {
    json(response, 502, { error: results.map((result) => result instanceof Error ? result.message : "").filter(Boolean).join("; ") });
    return;
  }

  json(response, 200, {
    configured: true,
    sourceLocation: successfulResults[0].sourceLocation,
    items: successfulResults.flatMap((result) => result.items),
  });
}

async function serveStatic(pathname: string, response: ServerResponse): Promise<void> {
  const requestedPath = pathname === "/" ? "index.html" : pathname.slice(1);
  const safePath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDirectory, safePath);

  try {
    const file = await readFile(filePath);
    const extension = extname(filePath);
    const shouldRevalidate = [".html", ".css", ".js"].includes(extension);
    response.writeHead(200, {
      "Content-Type": contentTypes[extension] ?? "application/octet-stream",
      "Cache-Control": shouldRevalidate ? "no-cache" : "public, max-age=3600",
      "Content-Security-Policy": "frame-ancestors *",
    });
    response.end(file);
  } catch {
    json(response, 404, { error: "Not found" });
  }
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const calendarMatch = requestUrl.pathname.match(/^\/api\/(sonarr|radarr)\/calendar$/);

  try {
    if (calendarMatch) {
      await proxyCalendar(requestUrl, calendarMatch[1] as ServiceName, response);
      return;
    }

    if (requestUrl.pathname === "/api/settings.js") {
      const config = await loadConfig();
      response.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(`window.CALENDARR_SETTINGS=${JSON.stringify(config.settings)};`);
      return;
    }

    if (requestUrl.pathname === "/api/config" && request.method === "GET") {
      const config = await loadConfig();
      json(response, 200, sanitizeConfig(config));
      return;
    }

    if (requestUrl.pathname === "/api/config" && request.method === "PUT") {
      const config = await updateConfig(request);
      json(response, 200, { status: "saved", config: sanitizeConfig(config) });
      return;
    }

    if (requestUrl.pathname === "/api/health") {
      await loadConfig();
      json(response, 200, { status: "ok" });
      return;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Configuration error";
    json(response, error instanceof ClientError ? 400 : 500, { error: message });
    return;
  }

  await serveStatic(requestUrl.pathname, response);
}

createServer((request, response) => {
  void handleRequest(request, response);
}).listen(port, "0.0.0.0", () => {
  console.log(`Calendarr is running on http://0.0.0.0:${port}`);
});
