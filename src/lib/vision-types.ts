export interface Extraction {
  readable: boolean;
  game_over: boolean;
  home: { name: string | null; score: number | null };
  away: { name: string | null; score: number | null };
  confidence: number;
  notes: string;
}
