import { extendZodWithOpenApi, OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import type { BaseController } from './BaseController.js';
import type { RouteDefinition } from './RouteDefinition.js';

// adds .openapi() to zod schemas (component refs, examples); idempotent
extendZodWithOpenApi(z);

const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  detail: z.string().optional(),
  errors: z.array(z.object({ path: z.string(), code: z.string(), message: z.string() })).optional(),
  requestId: z.string(),
});

/** OpenAPI 3.1 built from the same RouteDefinitions that build the middleware chain (contract = behaviour). */
export class OpenApiBuilder {
  readonly registry = new OpenAPIRegistry();

  constructor(private readonly accessCookieName = '__Host-access') {
    this.registry.register('Problem', ProblemSchema);
    this.registry.registerComponent('securitySchemes', 'bearerAuth', {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
    this.registry.registerComponent('securitySchemes', 'cookieAuth', {
      type: 'apiKey',
      in: 'cookie',
      name: this.accessCookieName,
    });
  }

  add(controller: BaseController, fullPath: string, route: RouteDefinition): void {
    const problem = { description: 'Problem', content: { 'application/problem+json': { schema: ProblemSchema } } };
    const okSchema = route.schema?.response
      ? z.object({ data: route.schema.response })
      : z.object({ data: z.unknown() });
    const status = String(route.successStatus ?? (route.method === 'post' ? 201 : 200));
    const authenticated = route.auth === undefined || route.auth === 'user' || route.auth === 'optional';
    const headers: Record<string, z.ZodType> = {};
    if (route.idempotent) {
      headers['Idempotency-Key'] = z
        .string()
        .min(8)
        .default('auto')
        .openapi({
          description:
            'Required by the server: a unique key per operation (8-100 chars). Retries with the same key replay the ' +
            'first response. In Swagger UI the value `auto` is replaced by a fresh UUID on every request.',
        });
    }
    if (authenticated) {
      headers['X-Campus-Id'] = z.string().uuid().optional().openapi({
        description: 'Active campus for writes; must be one of your campuses (403 OUT_OF_SCOPE otherwise).',
      });
    }
    this.registry.registerPath({
      method: route.method,
      path: fullPath.replace(/:([A-Za-z0-9_]+)/g, '{$1}'),
      tags: [controller.tag],
      summary: route.summary,
      description:
        [
          route.description,
          route.permission ? `Permission: \`${route.permission}\`` : undefined,
          route.idempotent ? 'Requires `Idempotency-Key` header.' : undefined,
        ]
          .filter(Boolean)
          .join('\n\n') || undefined,
      security: route.auth === 'none' || route.auth === 'webhook' ? [] : [{ bearerAuth: [] }, { cookieAuth: [] }],
      request: {
        ...(Object.keys(headers).length ? { headers: z.object(headers) } : {}),
        ...(route.schema?.params ? { params: route.schema.params as z.ZodObject } : {}),
        ...(route.schema?.query ? { query: route.schema.query as z.ZodObject } : {}),
        ...(route.schema?.body ? { body: { content: { 'application/json': { schema: route.schema.body } } } } : {}),
      },
      responses: {
        [status]: { description: 'Success', content: { 'application/json': { schema: okSchema } } },
        400: problem,
        401: problem,
        403: problem,
        404: problem,
        409: problem,
        422: problem,
        429: problem,
      },
    });
  }

  document(serverUrl: string) {
    return new OpenApiGeneratorV31(this.registry.definitions).generateDocument({
      openapi: '3.1.0',
      info: {
        title: 'School Management Platform API',
        version: '1.0.0',
        description: [
          'Modular monolith API. Errors are RFC 9457 `application/problem+json` with a stable `code`.',
          'Money is integer **paisa**; dates are `YYYY-MM-DD` (Asia/Dhaka).',
          '',
          '**Testing in Swagger UI**',
          '1. `POST /api/v1/auth/login` with `client: "staff_app"`: the access token is applied to **Authorize** automatically',
          '   (or paste it there yourself). With `client: "web"` the browser keeps cookies and the CSRF header is added for you.',
          '2. Guardians: `POST /auth/otp/request` then `POST /auth/otp/verify` (development SMS goes to `com.outbound_message`).',
          '3. `Idempotency-Key: auto` is turned into a fresh UUID per request.',
        ].join('\n'),
      },
      servers: [
        { url: '/', description: 'This server' },
        { url: serverUrl, description: 'Configured public URL' },
      ],
    });
  }
}
