/**
 * SMS segmentation (docs/backend/cross-cutting.md §12). Bangla (any non GSM-7 character) forces UCS-2:
 * 70 characters single / 67 per concatenated segment, vs 160 / 153 for GSM-7. Cost = segments x rate.
 */
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7_EXTENDED = '^{}\\[~]|€\f';

export interface SmsSegmentInfo {
  encoding: 'gsm7' | 'ucs2';
  length: number; // in encoding units (GSM extended chars count 2; UCS-2 counts UTF-16 code units)
  segments: number;
  perSegment: number;
}

export function smsSegments(text: string): SmsSegmentInfo {
  let gsmLength = 0;
  let isGsm = true;
  for (const ch of text) {
    if (GSM7_BASIC.includes(ch)) gsmLength += 1;
    else if (GSM7_EXTENDED.includes(ch)) gsmLength += 2;
    else {
      isGsm = false;
      break;
    }
  }
  if (isGsm) {
    const single = 160;
    const multi = 153;
    return {
      encoding: 'gsm7',
      length: gsmLength,
      segments: gsmLength <= single ? 1 : Math.ceil(gsmLength / multi),
      perSegment: gsmLength <= single ? single : multi,
    };
  }
  const units = text.length; // UTF-16 code units
  return {
    encoding: 'ucs2',
    length: units,
    segments: units <= 70 ? 1 : Math.ceil(units / 67),
    perSegment: units <= 70 ? 70 : 67,
  };
}
