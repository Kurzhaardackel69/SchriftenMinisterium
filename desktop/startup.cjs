const retryable = new Set(['ERR_FAILED', 'ERR_ABORTED', 'ERR_CONNECTION_REFUSED', 'ERR_CONNECTION_RESET', 'ERR_NETWORK_CHANGED', 'ERR_EMPTY_RESPONSE', 'ERR_TIMED_OUT', 'STARTUP_TIMEOUT']);
function errorCode(error) { return error.code || String(error.message || '').match(/\bERR_[A-Z_]+\b/)?.[0] || 'UNKNOWN'; }

async function loadWithRetry({ load, ready, stop = () => {}, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), report = () => {}, attempts = 3, timeout = 15000 }) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    let timer;
    try {
      report('load-attempt', { attempt });
      await Promise.race([
        Promise.resolve().then(load),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('Die lokale Oberfläche antwortet noch nicht.'), { code:'STARTUP_TIMEOUT' })), timeout); })
      ]);
      clearTimeout(timer);
      if (!await ready()) throw Object.assign(new Error('Die Oberfläche ist noch nicht bereit.'), { code:'ERR_FAILED' });
      report('load-ready', { attempt }); return;
    } catch (error) {
      clearTimeout(timer); lastError = error;
      const code = errorCode(error); report('load-failed', { attempt, code, message: String(error.message).slice(0, 600) });
      // A competing same-page navigation can reject loadURL even though the page finished loading.
      if (await Promise.resolve().then(ready).catch(() => false)) { report('load-ready-after-navigation', { attempt }); return; }
      stop();
      if (!retryable.has(code) || attempt === attempts) throw error;
      await wait(300 * attempt);
    }
  }
  throw lastError;
}
module.exports = { loadWithRetry, errorCode };
