import { z } from "zod";
import { SEARCH_CONFIG } from "@/modules/gurbani/gurbani.constants";

export const SearchBodySchema = z.object({
  query: z.union([
    z.string().max(SEARCH_CONFIG.MAX_QUERY_LENGTH),
    z.object({
      unicode: z.string().max(SEARCH_CONFIG.MAX_QUERY_LENGTH).optional(),
      text: z.string().max(SEARCH_CONFIG.MAX_QUERY_LENGTH).optional(),
    }),
  ]),
  currentShabadId: z.union([z.number(), z.string()]).optional().nullable(),
  currentLineId: z.union([z.number(), z.string()]).optional().nullable(),
  currentPage: z.union([z.number(), z.string()]).optional().nullable(),
  /** Rolling STT phrases (max 3) for duplicate-line shabad disambiguation. */
  contextLines: z
    .array(z.string().max(200))
    .max(SEARCH_CONFIG.CONTEXT_WINDOW_SIZE)
    .optional(),
});

export type SearchBody = z.infer<typeof SearchBodySchema>;
