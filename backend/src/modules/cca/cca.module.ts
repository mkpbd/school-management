import type { BaseController } from '../../shared/http/BaseController.js';
import type { ModuleDefinition } from '../../shared/module.js';
import { CcaController } from './presentation/CcaController.js';

/** CCA: co-curricular master data. Houses for now (students' house, notice audiences). */
export class CcaModule implements ModuleDefinition {
  readonly name = 'cca';

  register(): void {}

  controllers(): BaseController[] {
    return [new CcaController()];
  }
}
