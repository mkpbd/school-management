"use client";

import { useQuery } from "@tanstack/react-query";
import { CheckIcon, CopyIcon, MegaphoneIcon } from "lucide-react";
import { useId, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/hooks/use-hydrated";
import { api, isApiError } from "@/lib/api";
import type {
  AdmissionFormSetup,
  AdmissionTracking,
  PublicFormKind,
} from "@/lib/api/services/adm-public";
import { captureTracking } from "./tracking";

// ---------------------------------------------------------------- form setup

/**
 * Loads the form setup once per page visit (fresh signed token, captcha key, choices) and the first-touch
 * campaign tracking (`track: false` on the resume page: its URL holds the secret token). Both need the browser,
 * so nothing loads before hydration.
 */
export function useFormSetup(form: PublicFormKind, track = true) {
  const hydrated = useHydrated();
  const tracking = useMemo<AdmissionTracking | null>(
    () => (hydrated ? (track ? captureTracking() : {}) : null),
    [hydrated, track],
  );
  const campaign = tracking?.campaign;
  const query = useQuery({
    queryKey: ["adm-public-form", form, campaign ?? ""],
    queryFn: () => api.adm.publicForm.setup(form, campaign).then((r) => r.data),
    enabled: tracking !== null,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  return { ...query, tracking: tracking ?? {}, ready: tracking !== null };
}

/** Choices preselected when there is only one (or the campaign is for one campus). */
export function defaultChoice(setup: AdmissionFormSetup) {
  const campusId =
    setup.campaign?.campusId ??
    (setup.campuses.length === 1 ? setup.campuses[0]!.id : "");
  return {
    campusId,
    academicYearId:
      setup.academicYears.length === 1 ? setup.academicYears[0]!.id : "",
  };
}

// ---------------------------------------------------------------- errors

export type FieldErrors = Record<string, string>;

/** Domain errors that belong to one field. */
const CODE_FIELD: Record<string, string> = {
  CAMPUS_INVALID: "campusId",
  YEAR_NOT_OPEN: "academicYearId",
  CLASS_INVALID: "yearGroupId",
  GUARDIAN_REQUIRED: "guardians",
};

/** Field errors of a failed call, keyed like the body ("childFirstName", "guardians.0.phone"). */
export function serverFieldErrors(err: unknown): FieldErrors {
  if (!isApiError(err)) return {};
  const out: FieldErrors = {};
  for (const [path, message] of Object.entries(err.fieldErrors))
    out[path.replace(/^body\./, "")] = message;
  const field = CODE_FIELD[err.code];
  if (field) out[field] = err.message;
  return out;
}

/** One friendly sentence for the alert above the form. */
export function problemMessage(err: unknown): string {
  if (!isApiError(err))
    return "Something went wrong. Please try again. / কিছু একটা সমস্যা হয়েছে, আবার চেষ্টা করুন।";
  if (err.status === 429)
    return "Too many attempts from this connection. Please wait a few minutes and try again. / অনেকবার চেষ্টা করা হয়েছে — কয়েক মিনিট পরে আবার চেষ্টা করুন।";
  if (err.status === 0)
    return "We could not reach the school. Check your internet connection and try again. / ইন্টারনেট সংযোগ পরীক্ষা করে আবার চেষ্টা করুন।";
  if (err.status >= 500)
    return "The admission service is having a problem. Please try again later. / পরে আবার চেষ্টা করুন।";
  if (err.problem?.errors?.length)
    return "Please check the highlighted fields. / চিহ্নিত ঘরগুলো দেখে নিন।";
  return err.message;
}

export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="alert alert-error alert-soft text-sm"
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- phone

const BN_DIGITS = "০১২৩৪৫৬৭৮৯";

/**
 * Phone in E.164. Bangladesh mobiles may be typed as 01XXXXXXXXX, 8801XXXXXXXXX or +8801XXXXXXXXX (also with
 * Bangla digits, spaces or dashes) and become +8801XXXXXXXXX. Other countries must start with "+".
 * Returns null when it is not a valid number.
 */
export function normalisePhone(input: string): string | null {
  const ascii = input.replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
  const plus = ascii.trim().startsWith("+") || ascii.trim().startsWith("00");
  let digits = ascii.replace(/\D/g, "");
  if (ascii.trim().startsWith("00")) digits = digits.slice(2);
  if (/^01[3-9]\d{8}$/.test(digits)) return `+88${digits}`;
  if (/^8801[3-9]\d{8}$/.test(digits)) return `+${digits}`;
  if (digits.startsWith("880")) return null; // Bangladesh, but not a mobile number
  if (plus && /^[1-9]\d{7,14}$/.test(digits)) return `+${digits}`;
  return null;
}

export const PHONE_ERROR =
  "Enter a mobile number like 01712345678 / সঠিক মোবাইল নম্বর দিন";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = (v: string) => EMAIL_RE.test(v.trim());

/** Trimmed value, or undefined when empty (optional fields are left out of the body). */
export const opt = (v: string): string | undefined => v.trim() || undefined;

// ---------------------------------------------------------------- fields

/** Label with an optional Bangla line, required marker, hint and error, wired for screen readers. */
export function Field({
  label,
  bn,
  required,
  hint,
  error,
  className = "",
  children,
}: {
  label: string;
  bn?: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string;
  className?: string;
  children: (props: {
    id: string;
    "aria-invalid": boolean | undefined;
    "aria-describedby": string | undefined;
    "aria-required": boolean | undefined;
  }) => ReactNode;
}) {
  const id = useId();
  const describedBy =
    [hint ? `${id}-hint` : "", error ? `${id}-error` : ""]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <div className={`space-y-1.5 ${className}`}>
      <label htmlFor={id} className="block text-sm leading-tight font-medium">
        {label}
        {required ? (
          <span className="ml-0.5 text-destructive" aria-hidden>
            *
          </span>
        ) : (
          <span className="ml-1 text-xs font-normal text-muted-foreground">
            (optional)
          </span>
        )}
        {bn && (
          <span className="block text-xs font-normal text-muted-foreground">
            {bn}
          </span>
        )}
      </label>
      {children({
        id,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
        "aria-required": required || undefined,
      })}
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** Native select (daisyUI): best on phones. */
export function Choice({
  value,
  onChange,
  options,
  placeholder = "Select… / বাছাই করুন",
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  "aria-required"?: boolean;
}) {
  return (
    <select
      {...rest}
      className="select h-10 w-full aria-invalid:border-destructive"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export const inputClass = "h-10";

/** Hidden field a person never sees or fills; bots that fill every input reveal themselves. */
export function Honeypot({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      aria-hidden
      className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden"
    >
      <label htmlFor="adm-website">Website (leave empty)</label>
      <input
        id="adm-website"
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export const LOCALES = [
  { value: "en", label: "English" },
  { value: "bn", label: "বাংলা (Bangla)" },
];

// ---------------------------------------------------------------- bits

export function CampaignNote({ name }: { name: string }) {
  return (
    <div className="alert alert-info alert-soft text-sm">
      <MegaphoneIcon className="size-4" />
      <span>
        You came from: <strong>{name}</strong>
      </span>
    </div>
  );
}

export function SectionTitle({ title, bn }: { title: string; bn?: string }) {
  return (
    <legend className="mb-3 text-base font-semibold">
      {title}
      {bn && (
        <span className="ml-2 text-sm font-normal text-muted-foreground">
          {bn}
        </span>
      )}
    </legend>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          })
          .catch(() => setCopied(false));
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

export function formatLongDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
}

export function SubmitSpinner({ busy }: { busy: boolean }) {
  return busy ? <span className="loading loading-spinner loading-xs" /> : null;
}
