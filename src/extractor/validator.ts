import { z } from 'zod';

// Schema for authors (string or array of strings, normalized to array of strings)
export const AuthorsSchema = z.preprocess((val) => {
  if (typeof val === 'string') {
    if (!val) return [];
    return val.split(/\s+and\s+/i).map(s => s.trim()).filter(Boolean);
  }
  return val;
}, z.array(z.string())).nullable();

// Schema for year (coerced and validated to string, must be a number from 0 to 3000)
export const YearSchema = z.preprocess((val) => {
  if (typeof val === 'number') {
    return String(val);
  }
  if (val === '') return null;
  return val;
}, z.string().nullable().refine((val) => {
  if (val === null || val === '') return true;
  const num = parseInt(val, 10);
  return !isNaN(num) && num >= 0 && num <= 3000;
}, {
  message: "Year must be a number between 0 and 3000"
})).nullable();

// Zod Schema for Extracted Citation validation
export const CitationSchema = z.object({
  text: z.string().min(1),
  url: z.string().url().nullable(), // Must be a valid URL string or null
  page: z.number().int().positive(),
  startY: z.number(),
  authors: AuthorsSchema.optional(),
  title: z.string().nullable().optional(),
  venue: z.string().nullable().optional(),
  year: YearSchema.optional(),
});

export type Citation = z.infer<typeof CitationSchema>;

// Zod Schema for Inline Citation Links (used by the Chrome Extension to position tooltips)
export const InlineLinkSchema = z.object({
  sourcePage: z.number().int().positive(),
  sourceRect: z.array(z.number()).length(4), // [x1, y1, x2, y2]
  destName: z.string(),
  targetUrl: z.string().url().nullable(),
  targetMetadata: z.object({
    authors: AuthorsSchema,
    title: z.string().nullable(),
    venue: z.string().nullable(),
    year: YearSchema,
  }).nullable().optional(),
});

export type InlineLink = z.infer<typeof InlineLinkSchema>;

/**
 * Validates whether a string is a syntactically valid URL.
 * Returns the URL if valid, or null otherwise.
 */
export function validateUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    z.string().url().parse(url);
    return url;
  } catch (e) {
    return null;
  }
}

/**
 * Validates and sanitizes a citation object.
 * If the URL is invalid, it sets it to null so that the rest of the fields remain valid.
 */
export function validateCitation(data: any): Citation {
  const result = CitationSchema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  // Fallback: set url to null and validate again
  return CitationSchema.parse({
    ...data,
    url: null,
  });
}

/**
 * Validates and sanitizes an inline link object.
 * If the target URL is invalid, it sets it to null.
 */
export function validateInlineLink(data: any): InlineLink {
  const result = InlineLinkSchema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  return InlineLinkSchema.parse({
    ...data,
    targetUrl: null,
  });
}
