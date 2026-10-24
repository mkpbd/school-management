/** Website admission forms: spam scoring, lead-source classification, duplicate matching (WEB-06). Pure rules. */

export type LeadSource =
  | 'website'
  | 'facebook'
  | 'google'
  | 'instagram'
  | 'youtube'
  | 'qr'
  | 'sms'
  | 'email'
  | 'event'
  | 'referral'
  | 'print'
  | 'phone'
  | 'walk_in'
  | 'other';

export interface Tracking {
  campaign?: string | undefined;
  utmSource?: string | undefined;
  utmMedium?: string | undefined;
  utmCampaign?: string | undefined;
  utmTerm?: string | undefined;
  utmContent?: string | undefined;
  referrer?: string | undefined;
  landingUrl?: string | undefined;
}

export interface SpamSignals {
  /** hidden field a person never fills */
  honeypot: string | undefined;
  /** the signed form token: valid, and seconds since it was issued */
  token: { valid: boolean; ageSec: number | null };
  minSeconds: number;
  /** captcha result when a captcha is configured; null when not configured */
  captcha: boolean | null;
  names: string[];
  message?: string | undefined;
  email?: string | undefined;
}

const URL_RE = /(https?:\/\/|www\.)\S+/gi;
const DISPOSABLE = new Set([
  'mailinator.com',
  'guerrillamail.com',
  '10minutemail.com',
  'tempmail.com',
  'yopmail.com',
  'trashmail.com',
  'sharklasers.com',
]);
const TOKEN_MAX_AGE_SEC = 2 * 60 * 60;

/**
 * Spam score 0-100+ with reasons. Hard signals (honeypot, bad token, failed captcha) score 100 on their own; soft
 * ones add up. The caller compares with the threshold setting; spam is stored but hidden, and the sender is never
 * told (bots learn nothing).
 */
export function scoreSubmission(s: SpamSignals): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(reason);
  };
  if (s.honeypot && s.honeypot.trim() !== '') add(100, 'honeypot');
  if (!s.token.valid) add(100, 'token_invalid');
  else if (s.token.ageSec !== null) {
    if (s.token.ageSec < s.minSeconds) add(60, 'too_fast');
    if (s.token.ageSec > TOKEN_MAX_AGE_SEC) add(30, 'token_stale');
  }
  if (s.captcha === false) add(100, 'captcha_failed');
  for (const n of s.names) {
    if (URL_RE.test(n)) add(60, 'link_in_name');
    URL_RE.lastIndex = 0;
    const letters = n.replace(/[^\p{L}]/gu, '');
    if (n.trim().length >= 2 && letters.length === 0) add(30, 'name_without_letters');
    if (/(.)\1{5,}/u.test(n)) add(20, 'repeated_characters');
  }
  const links = s.message?.match(URL_RE)?.length ?? 0;
  if (links > 2) add(40, 'links_in_message');
  else if (links > 0) add(10, 'link_in_message');
  const domain = s.email?.split('@')[1]?.toLowerCase();
  if (domain && DISPOSABLE.has(domain)) add(20, 'disposable_email');
  return { score, reasons: [...new Set(reasons)] };
}

export function isSpam(score: number, threshold: number): boolean {
  return score >= threshold;
}

/** Where the lead came from: the campaign's channel, else UTM / referrer hints, else the website itself. */
export function classifySource(t: Tracking, campaignChannel?: string | null): LeadSource {
  if (campaignChannel) return campaignChannel as LeadSource;
  const src = (t.utmSource ?? '').toLowerCase();
  const medium = (t.utmMedium ?? '').toLowerCase();
  let host = '';
  try {
    host = t.referrer ? new URL(t.referrer).hostname.toLowerCase() : '';
  } catch {
    host = '';
  }
  const has = (...needles: string[]) => needles.some((n) => src.includes(n) || host.includes(n));
  if (medium === 'qr' || src === 'qr') return 'qr';
  if (has('facebook', 'fb.', 'fb', 'm.me', 'messenger')) return 'facebook';
  if (has('instagram')) return 'instagram';
  if (has('youtube', 'youtu.be')) return 'youtube';
  if (has('google')) return 'google';
  if (medium === 'sms' || src === 'sms') return 'sms';
  if (medium === 'email' || src === 'email' || src === 'newsletter') return 'email';
  if (medium === 'referral' || src === 'referral') return 'referral';
  return 'website';
}

/** UTM values kept on the record (trimmed, empty dropped, max 200 chars each). */
export function utmOf(t: Tracking): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries({
    source: t.utmSource,
    medium: t.utmMedium,
    campaign: t.utmCampaign,
    term: t.utmTerm,
    content: t.utmContent,
  }))
    if (v && v.trim()) out[k] = v.trim().slice(0, 200);
  return Object.keys(out).length ? out : null;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** The same family enquiring again about the same child (merged into the open enquiry instead of a new lead). */
export function isRepeatEnquiry(
  existing: { childName: string; stage: string; createdAt: Date },
  childName: string,
  now: Date,
  windowDays: number,
): boolean {
  if (existing.stage === 'lost' || existing.stage === 'admitted') return false;
  if (now.getTime() - existing.createdAt.getTime() > windowDays * 86_400_000) return false;
  return norm(existing.childName) === norm(childName);
}

/** Tracked link of a campaign for printing as a QR code or pasting into an ad. */
export function campaignLink(
  baseUrl: string,
  c: {
    code: string;
    landingPath: string;
    utmSource?: string | null;
    utmMedium?: string | null;
    utmCampaign?: string | null;
  },
): string {
  const url = new URL(c.landingPath.startsWith('/') ? c.landingPath : `/${c.landingPath}`, baseUrl);
  url.searchParams.set('campaign', c.code);
  if (c.utmSource) url.searchParams.set('utm_source', c.utmSource);
  if (c.utmMedium) url.searchParams.set('utm_medium', c.utmMedium);
  if (c.utmCampaign) url.searchParams.set('utm_campaign', c.utmCampaign);
  return url.toString();
}
