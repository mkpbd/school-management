/** Public API of LIB (SIS withdrawal / TC clearance, EXM admit cards, PRT portal). */
export interface LibModuleApi {
  /** Library clearance: no book still on loan. */
  clearanceStatus(studentId: string): Promise<{ cleared: boolean; activeLoans: number; overdueLoans: number }>;
}
