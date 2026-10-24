import { asClass, Lifetime, type AwilixContainer } from 'awilix';
import type { BaseController } from '../../shared/http/BaseController.js';
import type { ModuleDefinition } from '../../shared/module.js';
import {
  AddVariants,
  AdjustStock,
  CreateItem,
  CreateStore,
  GetItem,
  GetStock,
  IssueStock,
  ListItems,
  ListMovements,
  ListStores,
  ReceiveStock,
  SetReorderLevel,
  TransferStock,
  UpdateItem,
  UpdateStore,
} from './application/InventoryUseCases.js';
import { DrizzleInvRepository } from './infrastructure/DrizzleInvRepository.js';
import { InvModuleApiImpl } from './infrastructure/InvModuleApiImpl.js';
import { InvController } from './presentation/InvController.js';

/** INV: items with variants, stores, append-only stock ledger (no negative stock), counts, reorder levels. */
export class InvModule implements ModuleDefinition {
  readonly name = 'inv';

  register(container: AwilixContainer): void {
    const scoped = { lifetime: Lifetime.SCOPED };
    container.register({
      invRepo: asClass(DrizzleInvRepository, scoped),
      invApi: asClass(InvModuleApiImpl, scoped),
      listItems: asClass(ListItems, scoped),
      getItem: asClass(GetItem, scoped),
      createItem: asClass(CreateItem, scoped),
      updateItem: asClass(UpdateItem, scoped),
      addVariants: asClass(AddVariants, scoped),
      listStores: asClass(ListStores, scoped),
      createStore: asClass(CreateStore, scoped),
      updateStore: asClass(UpdateStore, scoped),
      getStock: asClass(GetStock, scoped),
      listMovements: asClass(ListMovements, scoped),
      receiveStock: asClass(ReceiveStock, scoped),
      issueStock: asClass(IssueStock, scoped),
      transferStock: asClass(TransferStock, scoped),
      adjustStock: asClass(AdjustStock, scoped),
      setReorderLevel: asClass(SetReorderLevel, scoped),
    });
  }

  controllers(): BaseController[] {
    return [new InvController()];
  }
}
