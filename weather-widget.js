/* Precipitation accumulation outlook for METRO municipalities. Read-only Open-Meteo data. */
(() => {
  const root = document.getElementById('weather-widget');
  if (!root) return;

  const $ = id => document.getElementById(id);
  const storageKey = 'metro-weather-open-meteo-v3';
  const locationsStorageKey = 'metro-weather-geocoding-v1';
  const cacheTtl = 20 * 60 * 1000;
  const staleLimit = 6 * 60 * 60 * 1000;
  const refreshEvery = 30 * 60 * 1000;
  const anchorCity = { name: 'Belo Horizonte', latitude: -19.92083, longitude: -43.93778 };
  const municipalityNames = ['Conselheiro Lafaiete', 'Mariana', 'Divinópolis', 'João Monlevade', 'Ponte Nova'];
  let resolvedLocations = null;
  let lastLoadedAt = 0;
  let inFlight = null;
  let featuredCityName = null;
  let leaderAnimationTimer = 0;

  const weatherTypes = {
    0: ['Céu limpo', 'sun'],
    1: ['Predomínio de céu limpo', 'sun'],
    2: ['Parcialmente nublado', 'cloud'],
    3: ['Nublado', 'cloud'],
    45: ['Neblina', 'fog'],
    48: ['Neblina densa', 'fog'],
    51: ['Garoa leve', 'drizzle'],
    53: ['Garoa moderada', 'drizzle'],
    55: ['Garoa intensa', 'rain'],
    56: ['Garoa congelante leve', 'drizzle'],
    57: ['Garoa congelante intensa', 'rain'],
    61: ['Chuva leve', 'rain'],
    63: ['Chuva moderada', 'rain'],
    65: ['Chuva forte', 'rain'],
    66: ['Chuva congelante leve', 'rain'],
    67: ['Chuva congelante forte', 'rain'],
    71: ['Neve leve', 'snow'],
    73: ['Neve moderada', 'snow'],
    75: ['Neve forte', 'snow'],
    77: ['Grãos de neve', 'snow'],
    80: ['Pancadas de chuva leves', 'rain'],
    81: ['Pancadas de chuva moderadas', 'rain'],
    82: ['Pancadas de chuva fortes', 'rain'],
    85: ['Pancadas de neve leves', 'snow'],
    86: ['Pancadas de neve fortes', 'snow'],
    95: ['Trovoadas', 'storm'],
    96: ['Trovoadas com granizo leve', 'storm'],
    99: ['Trovoadas com granizo forte', 'storm']
  };

  const icons = {
    sun: '<svg viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="5.2"/><path d="M16 2.8v3.1M16 26.1v3.1M2.8 16h3.1M26.1 16h3.1M6.7 6.7l2.2 2.2m14.2 14.2 2.2 2.2m0-18.6-2.2 2.2M8.9 23.1l-2.2 2.2"/></svg>',
    cloud: '<svg viewBox="0 0 32 32" fill="none"><path d="M9 23.2h14a5 5 0 0 0 .2-10A7.4 7.4 0 0 0 9 15a4.1 4.1 0 0 0 0 8.2Z"/></svg>',
    fog: '<svg viewBox="0 0 32 32" fill="none"><path d="M9 18.5h14a4.2 4.2 0 0 0 .2-8.4A6.3 6.3 0 0 0 9 12.5a3 3 0 0 0 0 6Z"/><path d="M5 23h18m-13 4h16"/></svg>',
    drizzle: '<svg viewBox="0 0 32 32" fill="none"><path d="M9 19h14a4.4 4.4 0 0 0 .2-8.8A6.4 6.4 0 0 0 9 13a3 3 0 0 0 0 6Z"/><path d="m12 22-1 2m7-2-1 2m7-2-1 2"/></svg>',
    rain: '<svg viewBox="0 0 32 32" fill="none"><path d="M9 18.5h14a4.5 4.5 0 0 0 .2-9A6.5 6.5 0 0 0 9 12.5a3 3 0 0 0 0 6Z"/><path d="m11 22-1 3m7-3-1 3m7-3-1 3"/></svg>',
    storm: '<svg viewBox="0 0 32 32" fill="none"><path d="M9 17h14a4.4 4.4 0 0 0 .2-8.8A6.4 6.4 0 0 0 9 11a3 3 0 0 0 0 6Z"/><path d="m17 18-4 7h4l-1 5 6-8h-4l2-4"/></svg>',
    snow: '<svg viewBox="0 0 32 32" fill="none"><path d="M9 17h14a4.4 4.4 0 0 0 .2-8.8A6.4 6.4 0 0 0 9 11a3 3 0 0 0 0 6Z"/><path d="M12 22v6m-2-5 4 4m0-4-4 4m10-5v6m-2-5 4 4m0-4-4 4"/></svg>'
  };

  const conditionFor = code => weatherTypes[Number(code)] || ['Condição variável', 'cloud'];
  const svgNode = (kind, className = '') => `<span class="${className}" data-kind="${kind}" aria-hidden="true">${icons[kind] || icons.cloud}</span>`;
  const number = (value, digits = 0) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
    ? new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Number(value))
    : '—';
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, ' ').trim();

  function readJson(key) {
    try { return JSON.parse(localStorage.getItem(key) || 'null'); }
    catch { return null; }
  }

  function readCache() {
    const cached = readJson(storageKey);
    return cached && Array.isArray(cached.data) && cached.data.length === municipalityNames.length + 1
      && Array.isArray(cached.locations) && cached.locations.length === municipalityNames.length + 1
      && Number.isFinite(cached.savedAt) ? cached : null;
  }

  function validLocations(locations) {
    return Array.isArray(locations) && locations.length === municipalityNames.length + 1
      && locations[0]?.name === anchorCity.name
      && municipalityNames.every((name, index) => locations[index + 1]?.name === name
        && Number.isFinite(Number(locations[index + 1]?.latitude))
        && Number.isFinite(Number(locations[index + 1]?.longitude)));
  }

  async function resolveLocations() {
    if (resolvedLocations) return resolvedLocations;
    const stored = readJson(locationsStorageKey);
    if (validLocations(stored)) {
      resolvedLocations = [anchorCity, ...stored.slice(1).map(city => ({ ...city, latitude: Number(city.latitude), longitude: Number(city.longitude) }))];
      return resolvedLocations;
    }

    const municipalities = await Promise.all(municipalityNames.map(async name => {
      const params = new URLSearchParams({ name: `${name}, Minas Gerais`, count: '10', language: 'pt', countryCode: 'BR', format: 'json' });
      const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`, { method: 'GET', mode: 'cors', credentials: 'omit' });
      if (!response.ok) throw new Error(`Não foi possível localizar ${name} no geocodificador.`);
      const payload = await response.json();
      const candidates = Array.isArray(payload.results) ? payload.results : [];
      const city = candidates.find(result => result.country_code === 'BR'
        && normalize(result.admin1) === normalize('Minas Gerais')
        && normalize(result.name) === normalize(name));
      if (!city || !Number.isFinite(Number(city.latitude)) || !Number.isFinite(Number(city.longitude))) {
        throw new Error(`O geocodificador não encontrou ${name}, Minas Gerais.`);
      }
      return { name, latitude: Number(city.latitude), longitude: Number(city.longitude) };
    }));

    resolvedLocations = [anchorCity, ...municipalities];
    try { localStorage.setItem(locationsStorageKey, JSON.stringify(resolvedLocations)); } catch { /* locations remain cached in memory */ }
    return resolvedLocations;
  }

  function nextPrecipitationWindow(reading) {
    const times = reading?.hourly?.time;
    const amounts = reading?.hourly?.precipitation;
    const currentTime = reading?.current?.time;
    if (!Array.isArray(times) || !Array.isArray(amounts) || times.length !== amounts.length) return null;
    const indices = times.map((time, index) => ({ time, index }))
      .filter(item => typeof currentTime !== 'string' || item.time > currentTime)
      .slice(0, 3)
      .map(item => item.index);
    if (indices.length !== 3) return null;
    const values = indices.map(index => Number(amounts[index]));
    return values.every(Number.isFinite) ? values.reduce((total, value) => total + value, 0) : null;
  }

  function renderMunicipalities(cities, featured) {
    const preview = $('weather-municipality-preview');
    const towns = cities.filter(city => city.name !== featured?.name);
    preview.setAttribute('aria-label', 'Precipitação prevista nas demais cidades da regional METRO');
    preview.replaceChildren(...towns.map(city => {
      const row = document.createElement('span');
      row.className = 'weather-mini-city';
      row.setAttribute('role', 'listitem');
      row.setAttribute('aria-label', `${city.name}: ${number(city.precipitation, 1)} milímetros de precipitação previstos`);
      row.title = row.getAttribute('aria-label');
      const iconKind = city.precipitation > 0 ? (city.kind === 'storm' ? 'storm' : 'rain') : city.kind;
      row.innerHTML = `<span class="weather-mini-city-name">${city.name}</span>${svgNode(iconKind, 'weather-mini-icon')}<strong>${number(city.precipitation, 1)} mm</strong>`;
      return row;
    }));
  }

  function render(data, { stale = false, locations = resolvedLocations } = {}) {
    const readings = Array.isArray(data) ? data : [data];
    if (!validLocations(locations) || readings.length !== locations.length) throw new Error('Condições atuais indisponíveis para a regional.');
    const cities = locations.map((place, index) => {
      const reading = readings[index];
      const current = reading?.current || {};
      const [, kind] = conditionFor(current.weather_code);
      return { ...place, current, kind, precipitation: nextPrecipitationWindow(reading) };
    });
    const available = cities.filter(city => Number.isFinite(city.precipitation));
    if (!available.length) throw new Error('Previsão de precipitação indisponível para a regional.');
    const maximum = Math.max(...available.map(city => city.precipitation));
    const contenders = available.filter(city => Math.abs(city.precipitation - maximum) < 0.0001);
    const featured = maximum > 0
      ? (contenders.find(city => city.name === featuredCityName) || contenders[0])
      : null;
    const nextFeaturedName = featured?.name || null;
    if (featuredCityName !== null && featuredCityName !== nextFeaturedName) {
      window.clearTimeout(leaderAnimationTimer);
      root.classList.remove('is-leader-changing');
      requestAnimationFrame(() => root.classList.add('is-leader-changing'));
      leaderAnimationTimer = window.setTimeout(() => root.classList.remove('is-leader-changing'), 280);
    }
    featuredCityName = nextFeaturedName;
    const kind = featured ? (featured.kind === 'storm' ? 'storm' : 'rain') : cities[0].kind;
    root.dataset.condition = kind;
    const icon = $('weather-icon');
    const iconKind = featured ? kind : 'cloud';
    icon.dataset.kind = iconKind;
    icon.innerHTML = icons[iconKind] || icons.cloud;
    $('weather-featured-city').textContent = featured?.name || 'Sem chuva prevista';
    $('weather-precipitation').textContent = number(maximum, 1);
    renderMunicipalities(cities, featured);
    root.setAttribute('aria-label', featured
      ? `Precipitação prevista em ${featured.name}: ${number(maximum, 1)} milímetros`
      : 'Sem chuva prevista nas cidades da regional METRO');
    root.dataset.weatherState = stale ? 'stale' : 'ready';
    root.setAttribute('aria-busy', 'false');
  }

  function showError(message) {
    root.dataset.weatherState = 'error';
    $('weather-featured-city').textContent = 'Previsão indisponível';
    $('weather-precipitation').textContent = '—';
    $('weather-icon').dataset.kind = 'cloud';
    $('weather-icon').innerHTML = icons.cloud;
    root.dataset.condition = 'cloud';
    const preview = $('weather-municipality-preview');
    preview.replaceChildren(...municipalityNames.map(name => {
      const row = document.createElement('span');
      row.className = 'weather-mini-city weather-mini-city-unavailable';
      row.setAttribute('role', 'listitem');
      row.setAttribute('aria-label', `${name}: previsão de precipitação indisponível`);
      row.innerHTML = `<span class="weather-mini-city-name">${name}</span>${svgNode('cloud', 'weather-mini-icon')}<strong title="${message || 'Sem conexão'}">— mm</strong>`;
      return row;
    }));
    root.setAttribute('aria-busy', 'false');
  }

  function requestUrl(locations) {
    const params = new URLSearchParams({
      latitude: locations.map(place => place.latitude).join(','),
      longitude: locations.map(place => place.longitude).join(','),
      current: 'weather_code',
      hourly: 'precipitation',
      forecast_hours: '5',
      timezone: 'America/Sao_Paulo'
    });
    return `https://api.open-meteo.com/v1/forecast?${params}`;
  }

  async function load({ force = false } = {}) {
    if (inFlight) return inFlight;
    const cache = readCache();
    const age = cache ? Date.now() - cache.savedAt : Infinity;
    if (!force && cache && age < cacheTtl) {
      try { render(cache.data, { locations: cache.locations }); resolvedLocations = cache.locations; lastLoadedAt = cache.savedAt; return; }
      catch { /* discard malformed or old cached schema and fetch fresh data */ }
    }

    root.setAttribute('aria-busy', 'true');
    inFlight = resolveLocations()
      .then(locations => fetch(requestUrl(locations), { method: 'GET', mode: 'cors', credentials: 'omit' }).then(response => {
        if (!response.ok) throw new Error(`Serviço meteorológico indisponível (${response.status}).`);
        return response.json();
      }).then(data => ({ data, locations })))
      .then(({ data, locations }) => {
        const savedAt = Date.now();
        render(data, { locations });
        lastLoadedAt = savedAt;
        try { localStorage.setItem(storageKey, JSON.stringify({ savedAt, data, locations })); } catch { /* weather remains available for this session */ }
      })
      .catch(error => {
        if (cache && Date.now() - cache.savedAt < staleLimit) {
          try { render(cache.data, { stale: true, locations: cache.locations }); resolvedLocations = cache.locations; lastLoadedAt = Date.now(); return; }
          catch { /* bad cache: show the service error below */ }
        }
        showError(error instanceof TypeError ? 'Verifique a conexão e tente novamente.' : error.message);
      })
      .finally(() => {
        root.setAttribute('aria-busy', 'false');
        inFlight = null;
      });
    return inFlight;
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastLoadedAt >= refreshEvery) load();
  });
  setInterval(() => { if (!document.hidden && root.dataset.weatherStarted === 'true') load({ force: true }); }, refreshEvery);

  function startWhenReportIsAvailable() {
    const authScreen = $('auth-screen');
    const start = () => {
      if (document.body.dataset.auth === 'locked' || (authScreen && !authScreen.hidden)) return false;
      if (root.dataset.weatherStarted === 'true') return true;
      root.dataset.weatherStarted = 'true';
      load();
      return true;
    };
    start();
    const observer = new MutationObserver(start);
    if (authScreen) observer.observe(authScreen, { attributes: true, attributeFilter: ['hidden'] });
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-auth'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startWhenReportIsAvailable, { once: true });
  else startWhenReportIsAvailable();
})();
