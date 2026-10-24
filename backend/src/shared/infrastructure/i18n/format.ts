import { SCHOOL_TIME_ZONE } from '../../domain/LocalDate.js';
import type { Money } from '../../domain/Money.js';

export type Locale = 'en' | 'bn';

const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

/** "2026" -> "২০২৬" */
export function toBanglaDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => BN_DIGITS[Number(d)]!);
}

/** Lakh/crore grouping: 660000 paisa*100 -> "৳6,60,000.00" (en) / "৳৬,৬০,০০০.০০" (bn). */
export function formatMoney(money: Money, locale: Locale = 'en'): string {
  const formatted = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    money.paisa / 100,
  );
  const text = `৳${formatted}`;
  return locale === 'bn' ? toBanglaDigits(text) : text;
}

export function formatDate(isoDate: string, locale: Locale = 'en'): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  return new Intl.DateTimeFormat(locale === 'bn' ? 'bn-BD' : 'en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

/**
 * Hijri date (Umm al-Qura) with the school's moon-sighting offset (core.hijri_adjustment.offset_days).
 */
export function formatHijri(instant: Date, locale: Locale = 'en', offsetDays = 0): string {
  const shifted = new Date(instant.getTime() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat(`${locale === 'bn' ? 'bn-BD' : 'en-GB'}-u-ca-islamic-umalqura`, {
    timeZone: SCHOOL_TIME_ZONE,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(shifted);
}

/** Localised titles for problem+json responses (code -> text). Unknown codes fall back to English/default. */
const PROBLEM_TITLES: Record<string, { en: string; bn: string }> = {
  VALIDATION_FAILED: { en: 'Validation failed', bn: 'তথ্য সঠিক নয়' },
  UNAUTHENTICATED: { en: 'Sign-in required', bn: 'লগইন প্রয়োজন' },
  INVALID_CREDENTIALS: { en: 'Incorrect username or password', bn: 'ব্যবহারকারীর নাম বা পাসওয়ার্ড ভুল' },
  TOKEN_EXPIRED: { en: 'Session expired', bn: 'সেশনের মেয়াদ শেষ' },
  FORBIDDEN: { en: 'Not allowed', bn: 'অনুমতি নেই' },
  OUT_OF_SCOPE: { en: 'Outside your access', bn: 'আপনার প্রবেশাধিকারের বাইরে' },
  NOT_FOUND: { en: 'Not found', bn: 'পাওয়া যায়নি' },
  DUPLICATE: { en: 'Already exists', bn: 'ইতিমধ্যে বিদ্যমান' },
  RATE_LIMITED: { en: 'Too many attempts, try later', bn: 'অনেকবার চেষ্টা করা হয়েছে, পরে চেষ্টা করুন' },
  PAPER_LOCKED: { en: 'Marks are locked', bn: 'নম্বর লক করা হয়েছে' },
  ALLOCATION_EXCEEDS_DUE: { en: 'Amount exceeds the due amount', bn: 'পরিমাণ বকেয়ার চেয়ে বেশি' },
  INTERNAL_ERROR: { en: 'Something went wrong', bn: 'কিছু একটা সমস্যা হয়েছে' },
};

export function problemTitle(code: string, locale: Locale, fallback: string): string {
  return PROBLEM_TITLES[code]?.[locale] ?? fallback;
}
