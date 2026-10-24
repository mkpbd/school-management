import { ComModule } from '../modules/com/com.module.js';
import { AcaModule } from '../modules/aca/aca.module.js';
import { AdmModule } from '../modules/adm/adm.module.js';
import { AccModule } from '../modules/acc/acc.module.js';
import { AttModule } from '../modules/att/att.module.js';
import { CcaModule } from '../modules/cca/cca.module.js';
import { CoreModule } from '../modules/core/core.module.js';
import { FeeModule } from '../modules/fee/fee.module.js';
import { HrmModule } from '../modules/hrm/hrm.module.js';
import { HstModule } from '../modules/hst/hst.module.js';
import { IamModule } from '../modules/iam/iam.module.js';
import { InvModule } from '../modules/inv/inv.module.js';
import { LibModule } from '../modules/lib/lib.module.js';
import { PlatformModule } from '../modules/platform/platform.module.js';
import { SisModule } from '../modules/sis/sis.module.js';
import { TrnModule } from '../modules/trn/trn.module.js';
import type { ModuleDefinition } from '../shared/module.js';

/**
 * Module registry (docs/backend/README.md §5). Feature modules (sis, adm, aca, att, fee, exm, ...) are added here as
 * they are implemented; per-organisation switches live in core.org_module.
 */
export function createModules(): ModuleDefinition[] {
  return [
    new PlatformModule(),
    new IamModule(),
    new ComModule(),
    new CoreModule(),
    new HrmModule(),
    new AcaModule(),
    new SisModule(),
    new AdmModule(),
    new AttModule(),
    new FeeModule(),
    new LibModule(),
    new TrnModule(),
    new InvModule(),
    new AccModule(),
    new HstModule(),
    new CcaModule(),
  ];
}

export const MODULES: ModuleDefinition[] = createModules();
