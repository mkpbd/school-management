import type { FieldDef } from "@/components/crud/fields";

/** Supplier form (create and edit; the code only on create). */
export const vendorFields: FieldDef[] = [
  {
    name: "code",
    label: "Code",
    required: true,
    mode: "create",
    placeholder: "ACME",
    help: "2-20 letters, digits, - and _ (stored upper case)",
  },
  { name: "name", label: "Name", required: true },
  { name: "phone", label: "Phone", type: "phone", nullable: true },
  { name: "email", label: "Email", type: "email", nullable: true },
  { name: "address", label: "Address", type: "textarea", nullable: true },
  { name: "tin", label: "TIN", nullable: true, help: "e-TIN (income tax)" },
  {
    name: "binVat",
    label: "BIN",
    nullable: true,
    help: "VAT registration (BIN)",
  },
  {
    name: "vatRatePct",
    label: "VAT deducted at source (%)",
    type: "number",
    nullable: true,
    help: "Withheld from each bill (0-100, 2 decimals)",
  },
  {
    name: "tdsRatePct",
    label: "TDS / AIT (%)",
    type: "number",
    nullable: true,
    help: "Income tax withheld from each bill",
  },
  {
    name: "paymentTermsDays",
    label: "Payment terms (days)",
    type: "number",
    defaultValue: "30",
    help: "Bill due date = bill date + terms",
  },
  { name: "isActive", label: "Active", type: "boolean", defaultValue: true },
  {
    name: "performanceNote",
    label: "Performance note",
    type: "textarea",
    nullable: true,
    help: "Quality, delivery, after-sales remarks",
  },
];
