const queryParameters = new URLSearchParams(window.location.search);
const embedParameter = queryParameters.get("embed");
const isEmbedded = embedParameter === "1" || (embedParameter !== "0" && window.self !== window.top);
const availableViews = ["day", "three", "week", "month"];
const appSettings = window.CALENDARR_SETTINGS ?? {};
const locale = appSettings.locale ?? "de-DE";

function loadSavedView() {
  const requestedView = queryParameters.get("view");
  if (availableViews.includes(requestedView)) return requestedView;
  try {
    const savedView = window.localStorage.getItem("calendarr-view");
    if (availableViews.includes(savedView)) return savedView;
  } catch {}
  return isEmbedded ? "week" : (availableViews.includes(appSettings.defaultView) ? appSettings.defaultView : "month");
}

function loadToolbarPreference() {
  try { return window.localStorage.getItem("calendarr-toolbar-collapsed") === "true"; }
  catch { return false; }
}

function loadDisplayMode() {
  const requestedDisplay = queryParameters.get("display");
  if (["names", "dots"].includes(requestedDisplay)) return requestedDisplay;
  try {
    const displayMode = window.localStorage.getItem("calendarr-display-mode");
    if (["names", "dots"].includes(displayMode)) return displayMode;
  } catch {}
  return ["names", "dots"].includes(appSettings.defaultDisplay) ? appSettings.defaultDisplay : "names";
}

function loadColor(key, fallback) {
  try {
    const color = window.localStorage.getItem(key);
    if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  } catch {}
  return fallback;
}

const defaultColors = {
  sonarr: appSettings.colors?.sonarr ?? "#55d6be",
  radarr: appSettings.colors?.radarr ?? "#ffbe5c",
};
const state = {
  date: new Date(),
  events: [],
  view: loadSavedView(),
  displayMode: loadDisplayMode(),
  colors: {
    sonarr: loadColor("calendarr-sonarr-color", defaultColors.sonarr),
    radarr: loadColor("calendarr-radarr-color", defaultColors.radarr),
  },
  activeColorService: "sonarr",
  toolbarCollapsed: loadToolbarPreference(),
  lastLoadedAt: 0,
  config: {
    sonarrInstances: [],
    radarrInstances: [],
  },
};
const calendar = document.querySelector("#calendar");
const weekdays = document.querySelector("#weekdays");
const periodTitle = document.querySelector("#monthTitle");
const status = document.querySelector("#status");
const modal = document.querySelector("#details");
const dayModal = document.querySelector("#dayDetails");
const configModal = document.querySelector("#configModal");
const hoverPreview = document.querySelector("#hoverPreview");
let hoverPreviewTimer;

document.body.classList.toggle("embedded", isEmbedded);

function applyColors() {
  document.documentElement.style.setProperty("--sonarr", state.colors.sonarr);
  document.documentElement.style.setProperty("--radarr", state.colors.radarr);
  document.querySelector("#sonarrColorPreview").style.background = state.colors.sonarr;
  document.querySelector("#radarrColorPreview").style.background = state.colors.radarr;
  document.querySelector("#colorHex").value = state.colors[state.activeColorService].toUpperCase();
  document.querySelectorAll("[data-color-service]").forEach((button) => button.classList.toggle("active", button.dataset.colorService === state.activeColorService));
  document.querySelectorAll("[data-color]").forEach((button) => button.classList.toggle("selected", button.dataset.color.toLowerCase() === state.colors[state.activeColorService].toLowerCase()));
}

applyColors();

const pad = (value) => String(value).padStart(2, "0");
const isoDate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const addDays = (date, amount) => {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
};
const startOfWeek = (date) => addDays(new Date(date.getFullYear(), date.getMonth(), date.getDate()), -((date.getDay() + 6) % 7));

function getVisibleRange() {
  if (state.view === "day") {
    const start = new Date(state.date.getFullYear(), state.date.getMonth(), state.date.getDate());
    return { start, end: addDays(start, 1) };
  }
  if (state.view === "three") {
    const start = new Date(state.date.getFullYear(), state.date.getMonth(), state.date.getDate());
    return { start, end: addDays(start, 3) };
  }
  if (state.view === "week") {
    const start = startOfWeek(state.date);
    return { start, end: addDays(start, 7) };
  }
  return {
    start: new Date(state.date.getFullYear(), state.date.getMonth(), 1),
    end: new Date(state.date.getFullYear(), state.date.getMonth() + 1, 1),
  };
}

function getDisplayDates() {
  const range = getVisibleRange();
  const dates = [];
  if (state.view === "month") {
    const first = startOfWeek(range.start);
    const lastDay = addDays(range.end, -1);
    const end = addDays(lastDay, 7 - ((lastDay.getDay() + 6) % 7));
    for (let date = first; date < end; date = addDays(date, 1)) dates.push(date);
    return dates;
  }
  for (let date = range.start; date < range.end; date = addDays(date, 1)) dates.push(date);
  return dates;
}

function formatPeriodTitle() {
  if (state.view === "month") {
    return state.date.toLocaleDateString(locale, { month: "long", year: "numeric" });
  }
  const range = getVisibleRange();
  const end = addDays(range.end, -1);
  const startLabel = range.start.toLocaleDateString(locale, { month: "short", day: "numeric" });
  const endLabel = range.start.getMonth() === end.getMonth()
    ? `${end.getDate()}, ${end.getFullYear()}`
    : end.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });
  return `${startLabel} – ${endLabel}`;
}

function createSourceUrl(baseUrl, path) {
  if (!baseUrl || !path) return undefined;
  try { return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString(); }
  catch { return undefined; }
}

function createBrowserServiceUrl(location) {
  if (!location?.protocol) return undefined;
  const port = location.port ? `:${location.port}` : "";
  const pathname = location.pathname || "/";
  const hostname = location.hostname || window.location.hostname;
  return `${location.protocol}//${hostname}${port}${pathname}`;
}

function normalizeEvents(service, items, sourceLocation) {
  return items.map((item) => {
    const isEpisode = service === "sonarr";
    const instance = item._calendarr ?? {};
    const title = isEpisode ? item.series?.title ?? item.title : item.title;
    const date = isEpisode ? item.airDateUtc ?? item.airDate : item.digitalRelease ?? item.physicalRelease ?? item.inCinemas;
    const season = isEpisode ? `S${pad(item.seasonNumber)}E${pad(item.episodeNumber)}` : "Film";
    const remotePoster = (isEpisode ? item.series?.images : item.images)?.find((image) => image.coverType === "poster")?.remoteUrl;
    const release = new Date(date);
    const releaseDate = Number.isNaN(release.getTime()) ? "Veröffentlichungsdatum unbekannt" : release.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" });
    const hasExplicitMovieTime = !isEpisode && /T\d{2}:\d{2}/.test(date) && (release.getUTCHours() !== 0 || release.getUTCMinutes() !== 0);
    const releaseTime = (isEpisode || hasExplicitMovieTime) && !Number.isNaN(release.getTime()) ? release.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : undefined;
    const releaseSubtitle = isEpisode ? `${releaseTime ? `${releaseTime} · ` : ""}${season} · ${item.title}` : item.year ?? "Demnächst";
    const subtitle = instance.name ? `${releaseSubtitle} · ${instance.name}` : releaseSubtitle;
    const sourceSlug = isEpisode ? item.series?.titleSlug : item.titleSlug;
    const sourceBaseUrl = createBrowserServiceUrl(instance.sourceLocation ?? sourceLocation);
    const sourceUrl = sourceSlug ? createSourceUrl(sourceBaseUrl, `${isEpisode ? "series" : "movie"}/${sourceSlug}`) : undefined;
    return {
      service,
      title,
      date,
      subtitle,
      releaseDate,
      releaseTime,
      sourceUrl,
      overview: item.overview ?? item.series?.overview ?? "Keine Beschreibung verfügbar.",
      poster: remotePoster,
      color: instance.color,
    };
  }).filter((event) => event.date && event.title);
}

function eventColor(event) {
  return /^#[0-9a-f]{6}$/i.test(event.color) ? event.color : state.colors[event.service];
}

async function loadEvents() {
  status.textContent = "Releases werden geladen…";
  const range = getVisibleRange();
  try {
    const responses = await Promise.all(["sonarr", "radarr"].map(async (service) => {
      const response = await fetch(`/api/${service}/calendar?start=${isoDate(range.start)}&end=${isoDate(range.end)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      return { service, ...body };
    }));
    state.events = responses
      .flatMap((result) => normalizeEvents(result.service, result.items, result.sourceLocation))
      .sort((first, second) => new Date(first.date).getTime() - new Date(second.date).getTime());
    const configured = responses.filter((result) => result.configured).length;
    status.textContent = configured ? `${state.events.length} Releases · ${configured}/2 Dienste verbunden` : "Sonarr oder Radarr in config.json eintragen";
  } catch (error) {
    state.events = [];
    status.textContent = error.message ?? "Releases konnten nicht geladen werden";
  }
  state.lastLoadedAt = Date.now();
  render();
}

function hideHoverPreview() {
  window.clearTimeout(hoverPreviewTimer);
  hoverPreview.hidden = true;
  hoverPreview.setAttribute("aria-hidden", "true");
}

function showHoverPreview(event, anchor, clientX, clientY) {
  if (!anchor.isConnected) return;
  const previewType = document.querySelector("#hoverPreviewType");
  previewType.textContent = event.service === "sonarr" ? "Serienepisode" : "Film";
  previewType.className = `pill ${event.service}`;
  document.querySelector("#hoverPreviewTitle").textContent = event.title;
  document.querySelector("#hoverPreviewSubtitle").textContent = event.subtitle;
  document.querySelector("#hoverPreviewRelease").textContent = event.releaseTime
    ? `Erscheint am ${event.releaseDate} um ${event.releaseTime}`
    : `Veröffentlichung am ${event.releaseDate}`;
  document.querySelector("#hoverPreviewOverview").textContent = event.overview;
  document.querySelector("#hoverPreviewPoster").style.backgroundImage = event.poster
    ? `linear-gradient(0deg,rgba(10,14,22,.3),transparent),url("${event.poster}")`
    : "";
  hoverPreview.hidden = false;
  hoverPreview.setAttribute("aria-hidden", "false");

  window.requestAnimationFrame(() => {
    if (hoverPreview.hidden || !anchor.isConnected) return;
    const previewRect = hoverPreview.getBoundingClientRect();
    const gap = 15;
    let left = clientX + gap;
    if (left + previewRect.width > window.innerWidth - 8) {
      left = clientX - previewRect.width - gap;
    }
    left = Math.max(8, left);
    
    let top = clientY - (previewRect.height / 2);
    top = Math.max(8, Math.min(top, window.innerHeight - previewRect.height - 8));
    
    hoverPreview.style.left = `${left}px`;
    hoverPreview.style.top = `${top}px`;
  });
}

function attachHoverPreview(anchor, event) {
  let lastMouseX = 0;
  let lastMouseY = 0;

  anchor.addEventListener("mousemove", (e) => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  });

  anchor.addEventListener("mouseenter", (e) => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    window.clearTimeout(hoverPreviewTimer);
    hoverPreviewTimer = window.setTimeout(() => showHoverPreview(event, anchor, lastMouseX, lastMouseY), 180);
  });
  
  anchor.addEventListener("mouseleave", hideHoverPreview);
  
  anchor.addEventListener("focus", () => {
    const rect = anchor.getBoundingClientRect();
    showHoverPreview(event, anchor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  });
  
  anchor.addEventListener("blur", hideHoverPreview);
}

function openDetails(event) {
  hideHoverPreview();
  const detailType = document.querySelector("#detailType");
  detailType.textContent = event.service === "sonarr" ? "Serienepisode" : "Film";
  detailType.className = `pill ${event.service}`;
  document.querySelector("#detailTitle").textContent = event.title;
  document.querySelector("#detailSubtitle").textContent = event.subtitle;
  document.querySelector("#detailRelease").textContent = event.releaseTime
    ? `Erscheint am ${event.releaseDate} um ${event.releaseTime}`
    : `Veröffentlichung am ${event.releaseDate}`;
  document.querySelector("#detailOverview").textContent = event.overview;
  const detailOverview = document.querySelector("#detailOverview");
  const overviewToggle = document.querySelector("#overviewToggle");
  detailOverview.classList.add("collapsed");
  overviewToggle.textContent = "Mehr anzeigen";
  overviewToggle.hidden = true;
  window.requestAnimationFrame(() => {
    overviewToggle.hidden = detailOverview.scrollHeight <= detailOverview.clientHeight;
  });
  document.querySelector("#detailPoster").style.backgroundImage = event.poster ? `linear-gradient(0deg,rgba(10,14,22,.3),transparent),url("${event.poster}")` : "";
  const sourceLink = document.querySelector("#detailSource");
  sourceLink.hidden = !event.sourceUrl;
  sourceLink.href = event.sourceUrl ?? "";
  sourceLink.textContent = `In ${event.service === "sonarr" ? "Sonarr" : "Radarr"} öffnen ↗`;
  sourceLink.className = `source-link ${event.service}`;
  modal.hidden = false;
}

function openDayDetails(date, events) {
  document.querySelector("#dayDetailTitle").textContent = date.toLocaleDateString(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  document.querySelector("#dayDetailCount").textContent = `${events.length} ${events.length === 1 ? "Release" : "Releases"}`;
  const releaseList = document.querySelector("#dayReleaseList");
  releaseList.replaceChildren();

  events.forEach((event) => {
    const item = document.createElement("button");
    item.className = `day-release-item ${event.service}`;
    item.innerHTML = `<i class="release-dot"></i><span class="day-release-copy"><strong></strong><small></small></span><span class="day-release-service"></span>`;
    item.querySelector("strong").textContent = event.title;
    item.querySelector("small").textContent = event.subtitle;
    item.querySelector(".day-release-service").textContent = event.service === "sonarr" ? "Serie" : "Film";
    const releaseDot = item.querySelector(".release-dot");
    releaseDot.style.background = eventColor(event);
    releaseDot.style.boxShadow = `0 0 8px ${eventColor(event)}88`;
    item.addEventListener("click", () => {
      dayModal.hidden = true;
      openDetails(event);
    });
    releaseList.append(item);
  });

  dayModal.hidden = false;
}

function render() {
  document.body.classList.remove("view-day", "view-three", "view-week", "view-month");
  document.body.classList.add(`view-${state.view}`);
  document.body.classList.toggle("display-dots", state.displayMode === "dots");
  document.body.classList.toggle("toolbar-collapsed", isEmbedded && state.toolbarCollapsed);
  const toolbarToggle = document.querySelector("#toolbarToggle");
  toolbarToggle.textContent = state.toolbarCollapsed ? "⌄" : "⌃";
  toolbarToggle.setAttribute("aria-expanded", String(!state.toolbarCollapsed));
  toolbarToggle.setAttribute("aria-label", state.toolbarCollapsed ? "Werkzeugleiste anzeigen" : "Werkzeugleiste ausblenden");
  document.querySelector("#viewSelect").value = state.view;
  document.querySelectorAll("[data-display]").forEach((button) => {
    const active = button.dataset.display === state.displayMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  const dates = getDisplayDates();
  const columns = state.view === "day" ? 1 : state.view === "three" ? 3 : 7;
  const rows = Math.ceil(dates.length / columns);
  periodTitle.textContent = formatPeriodTitle();
  calendar.style.setProperty("--columns", columns);
  calendar.style.setProperty("--rows", rows);
  weekdays.style.setProperty("--columns", columns);
  weekdays.replaceChildren();
  const today = isoDate(new Date());
  dates.slice(0, columns).forEach((date) => {
    const label = document.createElement("span");
    const weekday = date.toLocaleDateString(locale, { weekday: "short" });
    label.textContent = state.view === "month" ? weekday : `${weekday} ${date.getDate()}`;
    label.classList.toggle("today-label", isoDate(date) === today);
    weekdays.append(label);
  });

  calendar.replaceChildren();
  dates.forEach((date, index) => {
    const key = isoDate(date);
    const outsideMonth = state.view === "month" && date.getMonth() !== state.date.getMonth();
    const day = document.createElement("div");
    day.className = `day${outsideMonth ? " outside empty" : ""}${key === today ? " today" : ""}${(index + 1) % columns === 0 ? " last-column" : ""}`;
    if (outsideMonth) {
      calendar.append(day);
      return;
    }

    if (state.view === "month") day.innerHTML = `<span class="day-number">${date.getDate()}</span>`;
    const dayEvents = state.events.filter((event) => event.date.slice(0, 10) === key);
    if (state.displayMode === "dots" && dayEvents.length) {
      day.classList.add("dots-day");
      day.tabIndex = 0;
      day.setAttribute("role", "button");
      day.setAttribute("aria-label", `${dayEvents.length} Releases am ${date.toLocaleDateString(locale, { month: "long", day: "numeric" })}`);
      const dots = document.createElement("div");
      dots.className = "day-dots";
      dayEvents.forEach((event) => {
        const dot = document.createElement("i");
        dot.className = `release-dot ${event.service}`;
        dot.style.background = eventColor(event);
        dot.style.boxShadow = `0 0 8px ${eventColor(event)}88`;
        attachHoverPreview(dot, event);
        dots.append(dot);
      });
      day.append(dots);
      day.addEventListener("click", () => openDayDetails(date, dayEvents));
      day.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openDayDetails(date, dayEvents);
        }
      });
      calendar.append(day);
      return;
    }
    const eventList = document.createElement("div");
    eventList.className = "day-events";
    dayEvents.forEach((event) => {
      const button = document.createElement("button");
      button.className = `event ${event.service}`;
      const bgStyle = event.poster ? `background-image: linear-gradient(0deg,rgba(10,14,22,.6),transparent),url('${event.poster.replace(/'/g, "%27")}')` : "";
      button.innerHTML = `<i class="event-bar"></i><div class="event-poster" style="${bgStyle}"></div><span class="event-copy"><span class="event-title"></span><span class="event-subtitle"></span><span class="event-overview"></span></span>`;
      button.querySelector(".event-title").textContent = event.title;
      button.querySelector(".event-subtitle").textContent = event.subtitle;
      button.querySelector(".event-overview").textContent = event.overview;
      button.querySelector(".event-bar").style.background = eventColor(event);
      if (state.view === "month") {
        attachHoverPreview(button, event);
      }
      button.addEventListener("click", () => openDetails(event));
      eventList.append(button);
    });
    day.append(eventList);
    calendar.append(day);
  });
}

function movePeriod(direction) {
  if (state.view === "month") state.date = new Date(state.date.getFullYear(), state.date.getMonth() + direction, 1);
  else state.date = addDays(state.date, direction * (state.view === "week" ? 7 : state.view === "three" ? 3 : 1));
  void loadEvents();
}

function selectView(view) {
  state.view = view;
  try { window.localStorage.setItem("calendarr-view", view); } catch {}
  void loadEvents();
}

function selectDisplay(displayMode) {
  state.displayMode = displayMode;
  try { window.localStorage.setItem("calendarr-display-mode", displayMode); } catch {}
  render();
}

function updateColor(service, color) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return;
  state.colors[service] = color;
  try { window.localStorage.setItem(`calendarr-${service}-color`, color); } catch {}
  applyColors();
}

function selectColorService(service) {
  state.activeColorService = service;
  applyColors();
}

function setColorPanel(open) {
  document.querySelector("#colorPanel").hidden = !open;
  document.querySelector("#colorButton").setAttribute("aria-expanded", String(open));
}

function toggleToolbar() {
  state.toolbarCollapsed = !state.toolbarCollapsed;
  try { window.localStorage.setItem("calendarr-toolbar-collapsed", String(state.toolbarCollapsed)); } catch {}
  render();
}

function toggleOverview() {
  const detailOverview = document.querySelector("#detailOverview");
  const overviewToggle = document.querySelector("#overviewToggle");
  const collapsed = detailOverview.classList.toggle("collapsed");
  overviewToggle.textContent = collapsed ? "Mehr anzeigen" : "Weniger anzeigen";
}

function configListKey(service) {
  return `${service}Instances`;
}

function setConfigStatus(message, type = "") {
  const configStatus = document.querySelector("#configStatus");
  configStatus.textContent = message;
  configStatus.className = `config-status${type ? ` ${type}` : ""}`;
}

function selectConfigTab(service) {
  document.querySelectorAll("[data-config-service]").forEach((button) => {
    const active = button.dataset.configService === service;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("[data-config-panel]").forEach((panel) => {
    const active = panel.dataset.configPanel === service;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });
}

function renderInstanceList(service) {
  const list = document.querySelector(`#${service}InstanceList`);
  const instances = state.config[configListKey(service)];
  list.replaceChildren();

  instances.forEach((instance, index) => {
    const card = document.createElement("details");
    card.className = "instance-card";
    card.open = true;
    card.innerHTML = `
      <summary>
        <i class="instance-summary-color"></i>
        <span class="instance-summary-name"></span>
      </summary>
      <div class="instance-fields">
        <label class="instance-field">
          <span>Name</span>
          <input data-instance-field="name" type="text" maxlength="80" required placeholder="${service === "sonarr" ? "Sonarr 4K" : "Radarr 4K"}" />
        </label>
        <label class="instance-field">
          <span>URL oder IP</span>
          <input data-instance-field="url" type="text" inputmode="url" required placeholder="IP:Port oder http://host:${service === "sonarr" ? "8989" : "7878"}" />
        </label>
        <label class="instance-field wide">
          <span>API-Key</span>
          <input data-instance-field="apiKey" type="password" autocomplete="new-password" />
          <small class="instance-api-note"></small>
        </label>
        <label class="instance-field">
          <span>Punktfarbe</span>
          <span class="instance-color-row">
            <input data-instance-color-picker type="color" />
            <input data-instance-field="color" type="text" maxlength="7" pattern="#[0-9A-Fa-f]{6}" required />
          </span>
        </label>
        <button class="remove-instance" type="button">Instanz entfernen</button>
      </div>`;

    const nameInput = card.querySelector('[data-instance-field="name"]');
    const urlInput = card.querySelector('[data-instance-field="url"]');
    const apiKeyInput = card.querySelector('[data-instance-field="apiKey"]');
    const colorInput = card.querySelector('[data-instance-field="color"]');
    const colorPicker = card.querySelector("[data-instance-color-picker]");
    const summaryName = card.querySelector(".instance-summary-name");
    const summaryColor = card.querySelector(".instance-summary-color");
    const apiNote = card.querySelector(".instance-api-note");
    const color = /^#[0-9a-f]{6}$/i.test(instance.color) ? instance.color : state.colors[service];

    nameInput.value = instance.name ?? "";
    urlInput.value = instance.url ?? "";
    apiKeyInput.value = "";
    apiKeyInput.required = !instance.hasApiKey;
    apiKeyInput.placeholder = instance.hasApiKey ? "Gespeicherter API-Key bleibt erhalten" : "API-Key eintragen";
    apiNote.textContent = instance.hasApiKey
      ? "Leer lassen, um den gespeicherten API-Key beizubehalten."
      : "Für eine neue Instanz erforderlich.";
    colorInput.value = color.toUpperCase();
    colorPicker.value = color;
    summaryName.textContent = instance.name || `Neue ${service === "sonarr" ? "Sonarr" : "Radarr"}-Instanz`;
    summaryColor.style.background = color;
    summaryColor.style.color = color;

    nameInput.addEventListener("input", () => {
      instance.name = nameInput.value;
      summaryName.textContent = nameInput.value || `Neue ${service === "sonarr" ? "Sonarr" : "Radarr"}-Instanz`;
    });
    urlInput.addEventListener("input", () => { instance.url = urlInput.value; });
    apiKeyInput.addEventListener("input", () => { instance.apiKey = apiKeyInput.value; });
    colorInput.addEventListener("input", () => {
      if (!/^#[0-9a-f]{6}$/i.test(colorInput.value)) return;
      instance.color = colorInput.value;
      colorPicker.value = colorInput.value;
      summaryColor.style.background = colorInput.value;
      summaryColor.style.color = colorInput.value;
    });
    colorPicker.addEventListener("input", () => {
      instance.color = colorPicker.value;
      colorInput.value = colorPicker.value.toUpperCase();
      summaryColor.style.background = colorPicker.value;
      summaryColor.style.color = colorPicker.value;
    });
    card.querySelector(".remove-instance").addEventListener("click", () => {
      instances.splice(index, 1);
      renderInstanceList(service);
    });

    list.append(card);
  });
}

function addInstance(service) {
  state.config[configListKey(service)].push({
    configIndex: undefined,
    name: "",
    url: `http://host.docker.internal:${service === "sonarr" ? "8989" : "7878"}`,
    apiKey: "",
    hasApiKey: false,
    color: state.colors[service],
  });
  renderInstanceList(service);
}

async function openConfig() {
  configModal.hidden = false;
  setConfigStatus("Konfiguration wird geladen…");
  try {
    const response = await fetch("/api/config", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Konfiguration konnte nicht geladen werden");
    state.config.sonarrInstances = body.sonarrInstances ?? [];
    state.config.radarrInstances = body.radarrInstances ?? [];
    renderInstanceList("sonarr");
    renderInstanceList("radarr");
    selectConfigTab("sonarr");
    setConfigStatus("");
  } catch (error) {
    setConfigStatus(error.message ?? "Konfiguration konnte nicht geladen werden", "error");
  }
}

function closeConfig() {
  configModal.hidden = true;
  setConfigStatus("");
}

async function saveConfig(event) {
  event.preventDefault();
  if (!event.currentTarget.reportValidity()) return;
  const saveButton = document.querySelector("#saveConfig");
  saveButton.disabled = true;
  setConfigStatus("Konfiguration wird gespeichert…");

  try {
    const response = await fetch("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sonarrInstances: state.config.sonarrInstances,
        radarrInstances: state.config.radarrInstances,
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Konfiguration konnte nicht gespeichert werden");
    state.config.sonarrInstances = body.config.sonarrInstances;
    state.config.radarrInstances = body.config.radarrInstances;
    renderInstanceList("sonarr");
    renderInstanceList("radarr");
    setConfigStatus("Gespeichert. Der Kalender wird aktualisiert.", "success");
    await loadEvents();
  } catch (error) {
    setConfigStatus(error.message ?? "Konfiguration konnte nicht gespeichert werden", "error");
  } finally {
    saveButton.disabled = false;
  }
}

document.querySelector("#viewSelect").addEventListener("change", (event) => selectView(event.target.value));
document.querySelectorAll("[data-display]").forEach((button) => button.addEventListener("click", () => selectDisplay(button.dataset.display)));
document.querySelector("#previousButton").addEventListener("click", () => movePeriod(-1));
document.querySelector("#nextButton").addEventListener("click", () => movePeriod(1));
document.querySelector("#todayButton").addEventListener("click", () => { state.date = new Date(); void loadEvents(); });
document.querySelector("#refreshButton").addEventListener("click", loadEvents);
document.querySelector("#settingsButton").addEventListener("click", openConfig);
document.querySelector("#toolbarToggle").addEventListener("click", toggleToolbar);
document.querySelector("#overviewToggle").addEventListener("click", toggleOverview);
document.querySelector("#colorButton").addEventListener("click", () => setColorPanel(document.querySelector("#colorPanel").hidden));
document.querySelectorAll("[data-color-service]").forEach((button) => button.addEventListener("click", () => selectColorService(button.dataset.colorService)));
document.querySelectorAll("[data-color]").forEach((button) => button.addEventListener("click", () => updateColor(state.activeColorService, button.dataset.color)));
document.querySelector("#colorHex").addEventListener("input", (event) => {
  const color = event.target.value.startsWith("#") ? event.target.value : `#${event.target.value}`;
  if (/^#[0-9a-f]{6}$/i.test(color)) updateColor(state.activeColorService, color);
});
document.querySelector("#resetColors").addEventListener("click", () => {
  updateColor("sonarr", defaultColors.sonarr);
  updateColor("radarr", defaultColors.radarr);
});
document.querySelector("#doneColors").addEventListener("click", () => setColorPanel(false));
document.querySelector("#closeDetails").addEventListener("click", () => { modal.hidden = true; });
document.querySelector("#detailBackdrop").addEventListener("click", () => { modal.hidden = true; });
document.querySelector("#closeDayDetails").addEventListener("click", () => { dayModal.hidden = true; });
document.querySelector("#dayBackdrop").addEventListener("click", () => { dayModal.hidden = true; });
document.querySelector("#closeConfig").addEventListener("click", closeConfig);
document.querySelector("#configBackdrop").addEventListener("click", closeConfig);
document.querySelector("#cancelConfig").addEventListener("click", closeConfig);
document.querySelector("#configForm").addEventListener("submit", saveConfig);
document.querySelectorAll("[data-config-service]").forEach((button) => {
  button.addEventListener("click", () => selectConfigTab(button.dataset.configService));
});
document.querySelectorAll("[data-add-instance]").forEach((button) => {
  button.addEventListener("click", () => addInstance(button.dataset.addInstance));
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".display-controls")) setColorPanel(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideHoverPreview();
    modal.hidden = true;
    dayModal.hidden = true;
    configModal.hidden = true;
    setColorPanel(false);
  }
});
window.addEventListener("scroll", hideHoverPreview, true);
window.addEventListener("resize", () => {
  hideHoverPreview();
  render();
});
const refreshIntervalMinutes = Number(appSettings.refreshIntervalMinutes) > 0 ? Number(appSettings.refreshIntervalMinutes) : 5;
window.setInterval(() => { if (!document.hidden) void loadEvents(); }, refreshIntervalMinutes * 60 * 1000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && Date.now() - state.lastLoadedAt > 60 * 1000) void loadEvents();
});
void loadEvents();
