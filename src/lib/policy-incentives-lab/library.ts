/** The live catalogue is paginated, never a committed copy of government documents. */
export const LIBRARY_TYPES = {
  policy: { label: 'Policy papers', types: 'policy_paper' },
  consultation: { label: 'Consultations and responses', types: 'open_consultation,closed_consultation,consultation_outcome' },
  guidance: { label: 'Guidance and regulation', types: 'guidance,detailed_guide,statutory_guidance,regulation,notice' },
  all: { label: 'All policy material', types: 'policy_paper,open_consultation,closed_consultation,consultation_outcome,guidance,detailed_guide,statutory_guidance,regulation,notice,impact_assessment' },
} as const;
export interface LibraryEntry { title: string; path: string; description: string; publisher: string; updated: string | null; type: string }
export interface LibraryPage { entries: LibraryEntry[]; total: number; start: number; count: number; retrieved_at: string }
export interface LibraryDocument { title: string; url: string; format: string; supported: boolean }
export interface LibraryContent {
  path: string; title: string; publisher: string; publication_date: string | null; source_url: string;
  updated: string | null; retrieved_at: string; withdrawn: boolean; documents: LibraryDocument[];
  selected: number; sections: { id: string; location: string; text: string }[]; warnings: string[];
}
