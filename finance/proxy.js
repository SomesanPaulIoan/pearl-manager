import http from 'node:http';

const port = process.env.PEARL_FINANCE_PORT;
const token = process.env.PEARL_FINANCE_TOKEN;
const allowedOrigin = process.env.PEARL_FINANCE_ORIGIN;

export function forwardFinance(req, res, url, sendJson) {
  if (!port || !token || !allowedOrigin) {
    return sendJson(res, 503, { error: { message: 'Registrul financiar nu este configurat.' } });
  }
  const target = new URL(allowedOrigin);
  if (req.headers.host !== target.host ||
      (req.headers.origin && req.headers.origin !== target.origin) ||
      (req.method === 'POST' && req.headers.origin !== target.origin)) {
    return sendJson(res, 403, { error: { message: 'Origine nepermisă.' } });
  }
  if (!['GET', 'POST'].includes(req.method)) {
    return sendJson(res, 405, { error: { message: 'Metodă nepermisă.' } });
  }
  if (req.method === 'POST') {
    const size = Number(req.headers['content-length']);
    const limit = url.pathname.endsWith('/receipt') ? 393216 : 65536;
    if (!Number.isSafeInteger(size) || size < 1 || size > limit || req.headers['transfer-encoding']) {
      return sendJson(res, 413, { error: { message: 'Dimensiune invalidă.' } });
    }
  }

  const headers = { 'X-Pearl-Finance-Key': token };
  for (const name of ['content-type', 'content-length']) {
    if (req.headers[name] !== undefined) headers[name] = req.headers[name];
  }
  const upstream = http.request({
    host: '127.0.0.1', port, method: req.method, path: url.pathname + url.search, headers,
  }, response => {
    res.writeHead(response.statusCode, response.headers);
    response.on('error', () => res.destroy());
    response.pipe(res);
  });
  upstream.setTimeout(42_000, () => upstream.destroy());
  upstream.on('error', () => {
    if (res.headersSent) return res.destroy();
    sendJson(res, 502, { error: { message: 'Serviciul financiar este indisponibil momentan.' } });
  });
  res.on('close', () => upstream.destroy());
  req.pipe(upstream);
}
