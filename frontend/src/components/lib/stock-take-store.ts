/** No list endpoint for stock-takes: started / opened ids are remembered in this browser only. */

export interface RememberedStockTake {
  id: string;
  campusId: string | null;
  startedAt: string;
}

const KEY = "sms.lib.stockTakes";

export function loadStockTakes(): RememberedStockTake[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as RememberedStockTake[]) : [];
  } catch {
    return [];
  }
}

export function rememberStockTake(entry: RememberedStockTake): void {
  try {
    const list = loadStockTakes().filter((s) => s.id !== entry.id);
    window.localStorage.setItem(
      KEY,
      JSON.stringify([entry, ...list].slice(0, 30)),
    );
  } catch {
    /* storage blocked */
  }
}

export function forgetStockTake(id: string): void {
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify(loadStockTakes().filter((s) => s.id !== id)),
    );
  } catch {
    /* storage blocked */
  }
}
