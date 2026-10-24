const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESC[c]!);

/** Plain text (e.g. an SMS template) as e-mail HTML: escaped, paragraphs on blank lines, <br> on single breaks. */
export function textToHtml(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** Readable plain-text alternative of an HTML e-mail (multipart/alternative). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/tr|\/li)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim();
}

/** "fee.invoice_issued" -> "Invoice issued" (subject when a template has none). */
export function humanizeEvent(eventCode: string): string {
  const last = eventCode.split('.').pop() ?? eventCode;
  const words = last.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * School e-mail layout: table-based and inline-styled (survives Gmail / Outlook), one column, max 600px.
 * `contentHtml` must already be safe HTML (escaped template output or textToHtml); title / school are escaped here.
 */
const LAYOUT_TEXT = {
  en: {
    footer: (school: string) => `This message was sent by ${school}. Please do not reply to this address.`,
    preferences: 'Notification preferences',
  },
  bn: {
    footer: (school: string) => `এই বার্তাটি ${school} থেকে পাঠানো হয়েছে। অনুগ্রহ করে এই ঠিকানায় উত্তর দেবেন না।`,
    preferences: 'বিজ্ঞপ্তির পছন্দসমূহ',
  },
};

export function emailLayout(i: {
  school: string;
  title: string;
  contentHtml: string;
  preferencesUrl?: string;
  locale?: 'en' | 'bn';
}): string {
  const locale = i.locale ?? 'en';
  const text = LAYOUT_TEXT[locale];
  const school = escapeHtml(i.school);
  const title = escapeHtml(i.title);
  const prefs = i.preferencesUrl
    ? `<br><a href="${escapeHtml(i.preferencesUrl)}" style="color:#5b6b7f">${text.preferences}</a>`
    : '';
  // Bangla needs a Bengali font first; clients without one fall back to the system font
  const fonts =
    locale === 'bn'
      ? "'Noto Sans Bengali','Hind Siliguri',SolaimanLipi,Vrinda,'Segoe UI',Helvetica,Arial,sans-serif"
      : 'Segoe UI,Helvetica,Arial,sans-serif';
  return `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f2f4f7;font-family:${fonts};color:#1d2733">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f4f7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="background:#1f4e79;color:#ffffff;padding:18px 24px;font-size:18px;font-weight:600">${school}</td></tr>
<tr><td style="padding:24px 24px 8px;font-size:20px;font-weight:600">${title}</td></tr>
<tr><td style="padding:8px 24px 24px;font-size:15px;line-height:1.55">${i.contentHtml}</td></tr>
<tr><td style="padding:16px 24px;background:#f7f9fb;color:#5b6b7f;font-size:12px;line-height:1.5">
${text.footer(school)}${prefs}
</td></tr></table></td></tr></table></body></html>`;
}
