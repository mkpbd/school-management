import { describe, expect, it } from 'vitest';
import { numberInWords, takaInWords } from '../../src/shared/domain/words.js';

describe('amount in words (lakh / crore)', () => {
  it('numbers', () => {
    expect(numberInWords(0)).toBe('Zero');
    expect(numberInWords(15)).toBe('Fifteen');
    expect(numberInWords(69_333)).toBe('Sixty-Nine Thousand Three Hundred Thirty-Three');
    expect(numberInWords(1_50_000)).toBe('One Lakh Fifty Thousand');
    expect(numberInWords(2_35_07_011)).toBe('Two Crore Thirty-Five Lakh Seven Thousand Eleven');
  });
  it('taka and paisa', () => {
    expect(takaInWords(6_933_333)).toBe(
      'Taka Sixty-Nine Thousand Three Hundred Thirty-Three and Paisa Thirty-Three Only',
    );
    expect(takaInWords(1_500_000)).toBe('Taka Fifteen Thousand Only');
  });
});
