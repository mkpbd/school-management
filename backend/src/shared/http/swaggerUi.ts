import express, { type Express, type RequestHandler } from 'express';
import swaggerUiDist from 'swagger-ui-dist';

/**
 * Self-hosted Swagger UI at /api/docs (no CDN, strict CSP: scripts only from this origin).
 * Convenience for manual API testing:
 *  - after a successful login / OTP / MFA / refresh call, the returned access token is applied to "Authorize"
 *  - web (cookie) sessions: the X-CSRF-Token header is copied from the csrf cookie on unsafe methods
 *  - Idempotency-Key "auto" (the pre-filled default) is replaced with a fresh UUID per request
 * Disabled in production unless SWAGGER_ENABLED=true.
 */
const CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; " +
  "connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

export function mountSwaggerUi(app: Express, opts: { basePath: string; specUrl: string }): void {
  const { basePath, specUrl } = opts;
  const withCsp: RequestHandler = (_req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP);
    next();
  };

  app.use(
    `${basePath}/assets`,
    withCsp,
    express.static(swaggerUiDist.getAbsoluteFSPath(), { index: false, maxAge: '1d' }),
  );

  app.get(`${basePath}/init.js`, withCsp, (_req, res) => {
    res.type('application/javascript').send(initScript(specUrl));
  });

  app.get([basePath, `${basePath}/`], withCsp, (_req, res) => {
    res.type('html').send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>School Platform API · Swagger</title>
  <link rel="icon" type="image/png" href="${basePath}/assets/favicon-32x32.png" />
  <link rel="stylesheet" href="${basePath}/assets/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${basePath}/assets/swagger-ui-bundle.js"></script>
  <script src="${basePath}/assets/swagger-ui-standalone-preset.js"></script>
  <script src="${basePath}/init.js"></script>
</body>
</html>`);
  });
}

function initScript(specUrl: string): string {
  return `'use strict';
(function () {
  var UNSAFE = { POST: 1, PUT: 1, PATCH: 1, DELETE: 1 };
  var TOKEN_PATHS = /\\/auth\\/(login|refresh|otp\\/verify|mfa\\/verify)$/;

  function cookie(name) {
    var parts = document.cookie ? document.cookie.split('; ') : [];
    for (var i = 0; i < parts.length; i++) {
      var idx = parts[i].indexOf('=');
      var key = parts[i].slice(0, idx);
      if (key === name || key === '__Host-' + name) return decodeURIComponent(parts[i].slice(idx + 1));
    }
    return null;
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  }

  window.addEventListener('load', function () {
    var ui = SwaggerUIBundle({
      url: ${JSON.stringify(specUrl)},
      dom_id: '#swagger-ui',
      deepLinking: true,
      persistAuthorization: true,
      displayRequestDuration: true,
      tryItOutEnabled: true,
      filter: true,
      validatorUrl: null,
      docExpansion: 'list',
      defaultModelsExpandDepth: 0,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
      layout: 'StandaloneLayout',
      requestInterceptor: function (req) {
        req.headers = req.headers || {};
        var method = (req.method || 'GET').toUpperCase();
        if (req.headers['Idempotency-Key'] === 'auto' || req.headers['idempotency-key'] === 'auto') {
          delete req.headers['idempotency-key'];
          req.headers['Idempotency-Key'] = uuid();
        }
        var csrf = cookie('csrf');
        if (UNSAFE[method] && csrf && !req.headers['X-CSRF-Token']) req.headers['X-CSRF-Token'] = csrf;
        return req;
      },
      responseInterceptor: function (res) {
        try {
          if (res.ok && TOKEN_PATHS.test(new URL(res.url, location.href).pathname)) {
            var body = typeof res.body === 'object' ? res.body : JSON.parse(res.text);
            var token = body && body.data && body.data.accessToken;
            if (token) {
              ui.authActions.authorize({
                bearerAuth: { name: 'bearerAuth', schema: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, value: token }
              });
            }
          }
        } catch (e) { /* ignore */ }
        return res;
      }
    });
    window.ui = ui;
  });
})();
`;
}
