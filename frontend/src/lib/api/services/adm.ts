import { admissionOffice } from "./adm-office";
import { admissionForms } from "./adm-public";

/** Admissions (backend/src/modules/adm/presentation/AdmissionController.ts). */
export const adm = { ...admissionForms, ...admissionOffice };
