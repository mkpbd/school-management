import { accounting } from "./acc-accounting";
import { procurement } from "./acc-procurement";

/** Accounts, budgets and procurement (backend/src/modules/acc/presentation/*Controller.ts). */
export const acc = { ...accounting, ...procurement };
