/* Open-Meteo city-centre coordinates, verified with its BR/MG geocoding results. */
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MetroWeatherData = api;
})(typeof window === 'undefined' ? globalThis : window, () => {
  const locations = Object.freeze([
    { name: 'Belo Horizonte', latitude: -19.92083, longitude: -43.93778 },
    { name: 'Conselheiro Lafaiete', latitude: -20.66028, longitude: -43.78611 },
    { name: 'Mariana', latitude: -20.37778, longitude: -43.41611 },
    { name: 'Divinópolis', latitude: -20.14355, longitude: -44.89065 },
    { name: 'João Monlevade', latitude: -19.81, longitude: -43.17361 },
    { name: 'Ponte Nova', latitude: -20.41639, longitude: -42.90861 }
  ].map(Object.freeze));
  function readCurrent(reading, now = Date.now()) {
    const current = reading?.current;
    // Current precipitation is a backward-looking model sum, not an hourly forecast.
    // Null, old observations and a different unit/interval must never become zero rain.
    if (!current || typeof current.precipitation !== 'number' || !Number.isFinite(current.precipitation)
      || current.precipitation < 0 || reading.current_units?.precipitation !== 'mm'
      || reading.current_units?.time !== 'unixtime' || current.interval !== 900
      || typeof current.time !== 'number' || !Number.isFinite(current.time)) return null;
    const age = now - current.time * 1000;
    if (age > 30 * 60 * 1000 || age < -5 * 60 * 1000) return null;
    return { amount: current.precipitation, time: current.time * 1000, intervalMinutes: 15 };
  }
  function requestUrl() {
    const params = new URLSearchParams({
      latitude: locations.map(city => city.latitude).join(','),
      longitude: locations.map(city => city.longitude).join(','),
      current: 'weather_code,precipitation', precipitation_unit: 'mm',
      timezone: 'America/Sao_Paulo', timeformat: 'unixtime', forecast_days: '1'
    });
    return `https://api.open-meteo.com/v1/forecast?${params}`;
  }
  return { locations, readCurrent, requestUrl };
});
