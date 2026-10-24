import { asClass, Lifetime, type AwilixContainer } from 'awilix';
import type { BaseController } from '../../shared/http/BaseController.js';
import type { ModuleDefinition } from '../../shared/module.js';
import { CoreModuleApiImpl } from './infrastructure/CoreModuleApiImpl.js';
import { CoreController } from './presentation/CoreController.js';

/** CORE: organisation master data, academic calendar, settings (docs/backend/modules.md#core). */
export class CoreModule implements ModuleDefinition {
  readonly name = 'core';

  register(container: AwilixContainer): void {
    container.register({ coreApi: asClass(CoreModuleApiImpl, { lifetime: Lifetime.SCOPED }) });
  }

  controllers(): BaseController[] {
    return [new CoreController()];
  }
}
