import { BaseController } from '../../../shared/http/BaseController.js';
import { defineRoute, type RouteDefinition } from '../../../shared/http/RouteDefinition.js';
import type { GetMe } from '../application/GetMe.js';

export class MeController extends BaseController {
  readonly basePath = '/me';
  readonly tag = 'Auth';

  routes(): RouteDefinition[] {
    return [
      defineRoute({
        method: 'get',
        path: '',
        summary: 'Current user and effective grants',
        handler: async (_input, req) => this.ok(await this.resolve<GetMe>(req, 'getMe').execute()),
      }),
    ];
  }
}
