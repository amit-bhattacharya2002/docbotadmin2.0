export interface GeneratedFaqItem {
  id: string;
  question: string;
  answer: string;
  sourceUrl?: string;
}

export type GeneratedFaqResponse = GeneratedFaqItem[];


