import { resource } from "../resource";

/** Co-curricular master data (backend/src/modules/cca/presentation/CcaController.ts). */
export const cca = {
  /** Houses: students belong to one; notices can target a house. */
  houses: resource("/api/v1/cca/houses", "/api/v1/cca/houses/{id}"),
};
