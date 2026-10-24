import type { AdmissionTracking } from "@/lib/api/services/adm-public";

const KEY = "sms.admissions.tracking";

const LIMITS: Record<keyof AdmissionTracking, number> = {
  campaign: 40,
  utmSource: 200,
  utmMedium: 200,
  utmCampaign: 200,
  utmTerm: 200,
  utmContent: 200,
  referrer: 1000,
  landingUrl: 1000,
};

const URL_PARAMS: Array<[keyof AdmissionTracking, string]> = [
  ["campaign", "campaign"],
  ["utmSource", "utm_source"],
  ["utmMedium", "utm_medium"],
  ["utmCampaign", "utm_campaign"],
  ["utmTerm", "utm_term"],
  ["utmContent", "utm_content"],
];

function clean(t: Partial<Record<keyof AdmissionTracking, unknown>>) {
  const out: AdmissionTracking = {};
  for (const key of Object.keys(LIMITS) as Array<keyof AdmissionTracking>) {
    const v = t[key];
    if (typeof v === "string" && v.trim())
      out[key] = v.trim().slice(0, LIMITS[key]);
  }
  return out;
}

/** A link from a campaign / ad (campaign code or any UTM value). */
function isTagged(t: AdmissionTracking): boolean {
  return URL_PARAMS.some(([key]) => !!t[key]);
}

function readStored(): AdmissionTracking | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? clean(JSON.parse(raw) as AdmissionTracking) : null;
  } catch {
    return null;
  }
}

/**
 * First-touch attribution for the website forms: the campaign / UTM tags, referrer and landing URL of the first
 * page of the visit, kept in sessionStorage so they survive moving between the enquiry and application pages.
 * A later tagged link replaces an untagged first visit. Browser only.
 */
export function captureTracking(): AdmissionTracking {
  const params = new URLSearchParams(window.location.search);
  const current = clean({
    ...Object.fromEntries(URL_PARAMS.map(([key, p]) => [key, params.get(p)])),
    referrer: document.referrer,
    landingUrl: window.location.href,
  });
  const stored = readStored();
  if (stored && (isTagged(stored) || !isTagged(current))) return stored;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage blocked: send this page's data only */
  }
  return current;
}
