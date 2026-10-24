import type { RequestContext } from '../../../shared/application/RequestContext.js';
import type { UnitOfWork } from '../../../shared/infrastructure/db/UnitOfWork.js';
import { postMovements, type InvRepository } from '../application/InventoryUseCases.js';
import type { InvModuleApi, StoreInfo, VariantInfo } from '../public-api/InvModuleApi.js';

export class InvModuleApiImpl implements InvModuleApi {
  constructor(private readonly d: { uow: UnitOfWork; invRepo: InvRepository; ctx: RequestContext }) {}

  private run<T>(fn: () => Promise<T>): Promise<T> {
    return this.d.uow.run(fn, { readOnly: !this.d.uow.isActive() });
  }

  variants(ids: string[]): Promise<Map<string, VariantInfo>> {
    return this.run(() => this.d.invRepo.variantsWithItems(ids));
  }

  store(id: string): Promise<StoreInfo | null> {
    return this.run(async () => {
      const s = await this.d.invRepo.store(id);
      return s ? { id: s.id, campusId: s.campusId, code: s.code, name: s.name, isActive: s.isActive } : null;
    });
  }

  receivePurchase(i: {
    storeId: string;
    refType: string;
    refId: string;
    reason: string;
    lines: Array<{ variantId: string; qty: number; unitCostPaisa: number }>;
  }): Promise<void> {
    return this.d.uow.run(async () => {
      const s = await this.d.invRepo.store(i.storeId);
      if (!s) throw new Error('store not found');
      // several PO lines may be the same variant: one movement each, posted line by line
      for (const l of i.lines)
        await postMovements(this.d, s, 'receipt', [l], { refType: i.refType, refId: i.refId, reason: i.reason });
    });
  }
}
