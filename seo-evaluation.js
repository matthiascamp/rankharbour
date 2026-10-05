/* ================================================================
   RankHarbour — seo-evaluation.js
   SEO Evaluation tab. Sends one public URL to the seo-evaluate Edge
   Function with the signed-in user's session and renders the result.
   Every value from the response is written with textContent; no
   scraped HTML is ever parsed or inserted.
   ================================================================ */

const FUNCTION_PATH = '/functions/v1/seo-evaluate';
const TIMEOUT_MS = 60000;
const MAX_TEXT = 600; // keeps unexpectedly long strings from flooding the layout

const STATUS = {
  fail: { order: 0, text: 'Failed' },
  warn: { order: 1, text: 'Warning' },
  pass: { order: 2, text: 'Passed' },
  unknown: { order: 3, text: 'Not rated' },
};

const METRICS = [
  ['title', 'Title tag', 'text'],
  ['description', 'Meta description', 'text'],
  ['h1Count', 'H1 headings'],
  ['wordCount', 'Words on the page'],
  ['imageCount', 'Images'],
  ['missingAltCount', 'Images missing alt text'],
  ['internalLinks', 'Internal links'],
  ['externalLinks', 'External links'],
];

class EvaluationError extends Error {}

const text = (value) => {
  if (value == null) return '';
  const str = typeof value === 'string' ? value : String(value);
  return str.length > MAX_TEXT ? `${str.slice(0, MAX_TEXT)}…` : str;
};
const isCount = (value) => typeof value === 'number' && Number.isFinite(value);

function el(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content != null) node.textContent = content;
  return node;
}

function formatDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return null;
  return {
    iso: date.toISOString(),
    label: date.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' }),
  };
}

/** Accepts "example.com", "example.com/page" or a full http(s) URL. Throws a user-facing message. */
export function normaliseUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new EvaluationError('Please enter the address of the page you want to evaluate.');
  if (/\s/.test(raw)) throw new EvaluationError('Web addresses can’t contain spaces. Please check the URL.');

  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(raw) && !/^[^:/]+:\d+(\/|$)/.test(raw);
  if (hasScheme && !/^https?:\/\//i.test(raw)) {
    throw new EvaluationError('Only web pages starting with http:// or https:// can be evaluated.');
  }

  let url;
  try {
    url = new URL(hasScheme ? raw : `https://${raw.replace(/^\/+/, '')}`);
  } catch {
    throw new EvaluationError('That doesn’t look like a valid web address. Try something like example.com.au.');
  }
  if (url.username || url.password) {
    throw new EvaluationError('Please remove the username or password from the URL. Only public pages can be evaluated.');
  }
  if (!url.hostname.includes('.') || url.hostname.endsWith('.')) {
    throw new EvaluationError('Please enter a full public domain, such as example.com.au.');
  }
  url.hash = '';
  return url.href;
}

async function requestEvaluation(url, signal) {
  // Loaded on demand so a missing SDK can never break the rest of the dashboard.
  const [{ getSupabaseClient }, { getAuthConfig }] = await Promise.all([
    import('./src/auth/client.js'),
    import('./src/auth/config.js'),
  ]);
  const { url: base, publishableKey } = getAuthConfig();
  const { data, error } = await getSupabaseClient().auth.getSession();
  const token = data?.session?.access_token;
  if (error || !token) throw new EvaluationError('Your session has ended. Please log in again to run an evaluation.');
  signal.throwIfAborted();

  let response;
  try {
    response = await fetch(new URL(FUNCTION_PATH, base), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: publishableKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url }),
      signal,
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch (cause) {
    if (signal.aborted) throw cause;
    throw new EvaluationError('We couldn’t reach the evaluation service. Check your connection and try again.');
  }

  let body = null;
  try { body = await response.json(); } catch { /* handled below */ }

  if (!response.ok) {
    const reason = typeof body?.error === 'string' ? text(body.error.trim()) : '';
    if (response.status === 401) {
      throw new EvaluationError('Your session couldn’t be verified. Please log out and sign in again.');
    }
    throw new EvaluationError(reason
      ? `The evaluation couldn’t be completed: ${reason}`
      : `The evaluation couldn’t be completed (error ${response.status}). Please try again.`);
  }
  if (!body || typeof body !== 'object' || !Array.isArray(body.checks)) {
    throw new EvaluationError('The evaluation service returned an unexpected response. Please try again.');
  }
  return body;
}

export function initSeoEvaluation(root) {
  const $ = (id) => root.querySelector(`#${id}`);
  const form = $('seo-form');
  const input = $('seo-url');
  const submit = $('seo-submit');
  const cancelBtn = $('seo-cancel');
  const status = $('seo-status');
  const results = $('seo-results');
  const rerun = $('seo-rerun');
  const download = $('seo-download');

  let controller = null;
  let timer = null;
  let runId = 0;
  let lastUrl = null;
  let lastResult = null;

  function setStatus(message = '', tone = 'info') {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function setRunning(running) {
    root.toggleAttribute('data-running', running);
    results.setAttribute('aria-busy', String(running));
    input.readOnly = running;
    submit.disabled = running;
    rerun.disabled = running;
    download.disabled = running;
    submit.textContent = running ? submit.dataset.busy : submit.dataset.label;
    cancelBtn.hidden = !running;
  }

  // Stops any in-flight request and makes sure its result is ignored.
  function stop() {
    runId += 1;
    clearTimeout(timer);
    controller?.abort();
    controller = null;
    setRunning(false);
  }

  async function run(url) {
    if (controller) return; // one evaluation at a time
    const id = ++runId;
    const current = new AbortController();
    controller = current;
    timer = setTimeout(() => current.abort(new DOMException('Timed out', 'TimeoutError')), TIMEOUT_MS);
    lastUrl = url;
    setRunning(true);
    setStatus(`Evaluating ${url}. This usually takes a few seconds…`);

    try {
      const result = await requestEvaluation(url, current.signal);
      if (id !== runId) return;
      render(result);
      const score = isCount(result.score) ? `${Math.round(result.score)} out of 100` : 'not available';
      setStatus(`Evaluation complete. On-page checklist score: ${score}.`, 'success');
      $('seo-results-title').focus({ preventScroll: true });
      $('seo-results-title').scrollIntoView({ block: 'nearest' });
    } catch (error) {
      if (id !== runId) return; // cancelled, reset or superseded
      const timedOut = current.signal.reason?.name === 'TimeoutError';
      setStatus(timedOut ? 'The page took too long to evaluate. Please try again in a moment.'
        : error instanceof EvaluationError ? error.message
          : 'Something went wrong while evaluating the page. Please try again.', 'error');
      if (!lastResult) results.hidden = true;
      input.focus();
    } finally {
      if (id === runId) {
        clearTimeout(timer);
        controller = null;
        setRunning(false);
      }
    }
  }

  function renderSummary(result, counts) {
    const finalUrl = text(result.finalUrl || result.url || lastUrl);
    $('seo-final-url').textContent = finalUrl;
    const requested = text(result.url);
    $('seo-requested-url').textContent = requested;
    $('seo-requested-row').hidden = !requested || requested === finalUrl;
    $('seo-http-status').textContent = isCount(result.status) ? String(result.status) : 'Not reported';

    const checked = formatDate(result.checkedAt);
    const time = $('seo-checked-at');
    time.textContent = checked ? checked.label : 'Not reported';
    if (checked) time.dateTime = checked.iso; else time.removeAttribute('datetime');

    const meter = $('seo-meter');
    const fill = $('seo-meter-fill');
    if (isCount(result.score)) {
      const score = Math.min(100, Math.max(0, Math.round(result.score)));
      $('seo-score').textContent = String(score);
      meter.setAttribute('aria-valuenow', String(score));
      meter.setAttribute('aria-valuetext', `${score} out of 100`);
      meter.dataset.band = score >= 80 ? 'high' : score >= 50 ? 'mid' : 'low';
      fill.style.width = `${score}%`;
    } else {
      $('seo-score').textContent = '–';
      meter.removeAttribute('aria-valuenow');
      meter.setAttribute('aria-valuetext', 'Not available');
      meter.dataset.band = 'none';
      fill.style.width = '0';
    }

    for (const key of ['pass', 'warn', 'fail']) $(`seo-count-${key}`).textContent = String(counts[key]);
  }

  function renderChecks(checks) {
    const list = $('seo-checks');
    const sorted = checks
      .map((check, index) => ({ check: check && typeof check === 'object' ? check : {}, index }))
      .map(({ check, index }) => ({ check, index, key: ['pass', 'warn', 'fail'].includes(check.status) ? check.status : 'unknown' }))
      .sort((a, b) => STATUS[a.key].order - STATUS[b.key].order || a.index - b.index);

    list.replaceChildren(...sorted.map(({ check, key }) => {
      const item = el('li', 'seo-check');
      item.dataset.status = key;
      const head = el('div', 'seo-check__head');
      const badge = el('span', 'seo-badge');
      badge.append(el('span', 'seo-icon'), el('span', null, STATUS[key].text));
      badge.firstChild.setAttribute('aria-hidden', 'true');
      head.append(badge, el('p', 'seo-check__label', text(check.label || check.id) || 'Unnamed check'));
      item.append(head);
      if (check.detail) {
        const detail = el('p', 'seo-check__detail');
        detail.append(el('span', 'seo-check__key', 'Found: '), document.createTextNode(text(check.detail)));
        item.append(detail);
      }
      if (check.recommendation) {
        const rec = el('p', 'seo-check__rec');
        rec.append(el('span', 'seo-check__key', key === 'pass' ? 'Note: ' : 'Recommendation: '), document.createTextNode(text(check.recommendation)));
        item.append(rec);
      }
      return item;
    }));
    if (!sorted.length) list.append(el('li', 'seo-check seo-check--empty', 'The evaluation service returned no checks for this page.'));
  }

  function renderMetrics(metrics) {
    const source = metrics && typeof metrics === 'object' ? metrics : {};
    $('seo-metrics').replaceChildren(...METRICS.map(([key, label, kind]) => {
      const value = source[key];
      const row = el('div', kind === 'text' ? 'seo-metric seo-metric--text' : 'seo-metric');
      let shown;
      if (kind === 'text') shown = typeof value === 'string' && value.trim() ? text(value.trim()) : 'Not found';
      else shown = isCount(value) ? value.toLocaleString('en-AU') : 'Not reported';
      const dd = el('dd', null, shown);
      if (shown === 'Not found' || shown === 'Not reported') dd.className = 'is-missing';
      row.append(el('dt', null, label), dd);
      return row;
    }));
  }

  function renderLimitations(result, finalUrl) {
    const items = Array.isArray(result.limitations) ? result.limitations.filter((item) => typeof item === 'string' && item.trim()) : [];
    $('seo-limitations').replaceChildren(...(items.length
      ? items.map((item) => el('li', null, text(item.trim())))
      : [el('li', null, 'No additional limitations were reported for this run.')]));

    const checked = formatDate(result.checkedAt);
    let host = finalUrl;
    try { host = new URL(finalUrl).host; } catch { /* keep the raw value */ }
    $('seo-attribution').textContent = `Results generated automatically by the RankHarbour SEO evaluation service from the server HTML of ${host}${checked ? ` on ${checked.label}` : ''}. Automated checks can’t judge every page in context, so treat them as a starting point for review.`;
  }

  function render(result) {
    lastResult = result;
    const checks = result.checks;
    const tally = (s) => checks.filter((check) => check?.status === s).length;
    const summary = result.summary && typeof result.summary === 'object' ? result.summary : {};
    const counts = {
      pass: isCount(summary.passed) ? summary.passed : tally('pass'),
      warn: isCount(summary.warnings) ? summary.warnings : tally('warn'),
      fail: isCount(summary.failed) ? summary.failed : tally('fail'),
    };
    renderSummary(result, counts);
    renderChecks(checks);
    renderMetrics(result.metrics);
    renderLimitations(result, text(result.finalUrl || result.url || lastUrl));
    results.hidden = false;
  }

  function downloadReport() {
    if (!lastResult) return;
    let host = 'page';
    try { host = new URL(lastResult.finalUrl || lastResult.url || lastUrl).hostname.replace(/[^a-z0-9.-]/gi, ''); } catch { /* default */ }
    const stamp = (formatDate(lastResult.checkedAt)?.iso || new Date().toISOString()).slice(0, 10);
    const blob = new Blob([JSON.stringify(lastResult, null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob);
    const link = el('a');
    link.href = href;
    link.download = `seo-evaluation-${host || 'page'}-${stamp}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 0);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (controller) return;
    input.removeAttribute('aria-invalid');
    let url;
    try {
      url = normaliseUrl(input.value);
    } catch (error) {
      setStatus(error.message, 'error');
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    input.value = url;
    run(url);
  });

  cancelBtn.addEventListener('click', () => {
    stop();
    setStatus('Evaluation cancelled.');
    input.focus();
  });
  rerun.addEventListener('click', () => {
    if (!lastUrl) return;
    input.value = lastUrl;
    run(lastUrl);
  });
  download.addEventListener('click', downloadReport);

  return {
    /** Abandons any in-flight request (its result is discarded) without clearing results. */
    cancel() {
      if (controller) { stop(); setStatus(''); }
    },
    /** Clears the form, results and status, and cancels any request (sign-out or user change). */
    reset() {
      stop();
      lastUrl = null;
      lastResult = null;
      form.reset();
      input.removeAttribute('aria-invalid');
      setStatus('');
      results.hidden = true;
      for (const id of ['seo-checks', 'seo-metrics', 'seo-limitations']) $(id).replaceChildren();
      for (const id of ['seo-final-url', 'seo-requested-url', 'seo-http-status', 'seo-checked-at', 'seo-attribution']) $(id).textContent = '';
      $('seo-requested-row').hidden = true;
      $('seo-checked-at').removeAttribute('datetime');
      $('seo-score').textContent = '–';
      $('seo-meter').removeAttribute('aria-valuenow');
      $('seo-meter').removeAttribute('aria-valuetext');
      $('seo-meter-fill').style.width = '0';
      for (const key of ['pass', 'warn', 'fail']) $(`seo-count-${key}`).textContent = '0';
    },
  };
}
