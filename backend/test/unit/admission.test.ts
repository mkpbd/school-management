import { describe, expect, it } from 'vitest';
import {
  campaignLink,
  classifySource,
  isRepeatEnquiry,
  isSpam,
  scoreSubmission,
  utmOf,
} from '../../src/modules/adm/domain/webForms.js';

const clean = {
  honeypot: '',
  token: { valid: true, ageSec: 45 },
  minSeconds: 4,
  captcha: null,
  names: ['Ayaan Rahman', 'Farhana Rahman'],
  message: 'Is there a seat in Year 3 for next session?',
  email: 'farhana@example.com',
};

describe('spam scoring', () => {
  it('a normal family passes', () => {
    expect(scoreSubmission(clean)).toEqual({ score: 0, reasons: [] });
    expect(isSpam(0, 50)).toBe(false);
  });

  it('hard signals: honeypot, missing / forged token, failed captcha', () => {
    expect(scoreSubmission({ ...clean, honeypot: 'http://x.io' }).reasons).toContain('honeypot');
    expect(scoreSubmission({ ...clean, token: { valid: false, ageSec: null } }).score).toBeGreaterThanOrEqual(100);
    expect(scoreSubmission({ ...clean, captcha: false }).reasons).toEqual(['captcha_failed']);
    expect(scoreSubmission({ ...clean, captcha: true }).score).toBe(0);
  });

  it('soft signals add up: too fast, links, odd names, disposable e-mail', () => {
    const fast = scoreSubmission({ ...clean, token: { valid: true, ageSec: 1 } });
    expect(fast).toEqual({ score: 60, reasons: ['too_fast'] });
    expect(isSpam(fast.score, 50)).toBe(true);
    const links = scoreSubmission({ ...clean, message: 'see http://a.io http://b.io http://c.io' });
    expect(links.reasons).toEqual(['links_in_message']);
    expect(scoreSubmission({ ...clean, names: ['www.cheap-loans.biz'] }).reasons).toContain('link_in_name');
    expect(scoreSubmission({ ...clean, names: ['12345'] }).reasons).toContain('name_without_letters');
    expect(scoreSubmission({ ...clean, names: ['আয়ান রহমান'] }).score).toBe(0); // Bangla names are letters
    expect(scoreSubmission({ ...clean, email: 'x@mailinator.com' }).reasons).toEqual(['disposable_email']);
    expect(scoreSubmission({ ...clean, token: { valid: true, ageSec: 3 * 3600 } }).reasons).toEqual(['token_stale']);
  });
});

describe('campaign tracking', () => {
  it('source from the campaign, else UTM / referrer, else website', () => {
    expect(classifySource({}, 'qr')).toBe('qr');
    expect(classifySource({ utmSource: 'facebook', utmMedium: 'paid_social' })).toBe('facebook');
    expect(classifySource({ referrer: 'https://l.facebook.com/l.php?u=x' })).toBe('facebook');
    expect(classifySource({ utmSource: 'google', utmMedium: 'cpc' })).toBe('google');
    expect(classifySource({ utmMedium: 'qr' })).toBe('qr');
    expect(classifySource({ referrer: 'not a url' })).toBe('website');
    expect(classifySource({})).toBe('website');
  });

  it('UTM kept trimmed, empty dropped', () => {
    expect(utmOf({ utmSource: ' fb ', utmMedium: '', utmCampaign: 'open-day' })).toEqual({
      source: 'fb',
      campaign: 'open-day',
    });
    expect(utmOf({})).toBeNull();
  });

  it('tracked link for QR codes and ads', () => {
    expect(
      campaignLink('https://lis.edu.bd', {
        code: 'OPENDAY26',
        landingPath: '/admissions/enquire',
        utmSource: 'poster',
        utmMedium: 'qr',
      }),
    ).toBe('https://lis.edu.bd/admissions/enquire?campaign=OPENDAY26&utm_source=poster&utm_medium=qr');
  });
});

describe('duplicates', () => {
  const now = new Date('2096-03-01T10:00:00Z');
  const open = { childName: 'Ayaan  Rahman', stage: 'enquiry', createdAt: new Date('2096-02-20T10:00:00Z') };
  it('same child within the window merges; another child, a closed lead or an old one does not', () => {
    expect(isRepeatEnquiry(open, 'ayaan rahman', now, 30)).toBe(true);
    expect(isRepeatEnquiry(open, 'Inaya Rahman', now, 30)).toBe(false);
    expect(isRepeatEnquiry({ ...open, stage: 'lost' }, 'Ayaan Rahman', now, 30)).toBe(false);
    expect(isRepeatEnquiry(open, 'Ayaan Rahman', now, 5)).toBe(false);
  });
});
