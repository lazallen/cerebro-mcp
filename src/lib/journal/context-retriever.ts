/**
 * JournalContextRetriever — lightweight keyword-based context extraction.
 *
 * Builds an inverted index over the last N days of journal files, then for a
 * given item extracts key terms and retrieves the most relevant snippets. The
 * result is a short "context brief" (≤200 chars) injected into the phi-4-mini
 * enrichment prompt to improve intent classification.
 *
 * Intentionally simple — no embeddings, no dependencies beyond Node fs.
 * Journal format: {rootDir}/areas/journal/YYYY-MM/YYYY-MM-DD.md
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { Item, MessageItem } from '../item/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JournalSnippet {
  date: string;      // YYYY-MM-DD
  text: string;      // the matching line(s)
  score: number;     // number of matching terms
}

// ---------------------------------------------------------------------------
// Stop words — filtered from term extraction so we only get meaningful tokens
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'this', 'that', 'it', 'its', 'we', 'i', 'you',
  'he', 'she', 'they', 'my', 'your', 'our', 'their', 'what', 'which',
  're', 'if', 'as', 'so', 'up', 'out', 'no', 'not', 'hi', 'hey',
  'please', 'thanks', 'thank', 'just', 'can', 'get', 'let', 'know',
  'about', 'all', 'also', 'into', 'more', 'any', 'than', 'then',
  'email', 'message', 'subject', 'inbox',
]);

// ---------------------------------------------------------------------------
// JournalContextRetriever
// ---------------------------------------------------------------------------

export class JournalContextRetriever {
  /** inverted index: term → list of snippets containing the term */
  private index = new Map<string, JournalSnippet[]>();
  private built = false;

  /**
   * Build (or rebuild) the in-memory inverted index from journal files.
   * Reads journal files for the last `daysBack` days. Missing files are silently skipped.
   */
  async buildIndex(journalDir: string, daysBack: number = 14): Promise<void> {
    this.index.clear();
    this.built = false;

    const today = new Date();
    const entries: Array<{ date: string; lines: string[] }> = [];

    for (let i = 0; i < daysBack; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const yyyy = d.getFullYear().toString();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const dateStr = `${yyyy}-${mm}-${dd}`;
      const filePath = path.join(journalDir, `${yyyy}-${mm}`, `${dateStr}.md`);

      try {
        const content = await fs.readFile(filePath, 'utf-8');
        // Strip frontmatter (--- ... ---) and markdown syntax
        const cleaned = content
          .replace(/^---[\s\S]*?---\n?/m, '')
          .replace(/^#+\s+/gm, '')   // headings
          .replace(/[*_`]/g, '');    // bold/italic/code markers

        const lines = cleaned
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 20);  // skip very short lines

        entries.push({ date: dateStr, lines });
      } catch {
        // File doesn't exist — skip
      }
    }

    // Build inverted index
    for (const { date, lines } of entries) {
      for (const line of lines) {
        const terms = tokenise(line);
        for (const term of terms) {
          const existing = this.index.get(term) ?? [];
          existing.push({ date, text: line, score: 1 });
          this.index.set(term, existing);
        }
      }
    }

    this.built = true;
  }

  /**
   * Given a set of search terms (extracted from an item), retrieve the top
   * matching journal snippets scored by number of term hits.
   */
  retrieve(terms: string[], maxSnippets: number = 3): JournalSnippet[] {
    if (!this.built || terms.length === 0) return [];

    // Score each unique snippet by how many query terms it matches
    const scoreMap = new Map<string, JournalSnippet>();

    for (const term of terms) {
      const snippets = this.index.get(term) ?? [];
      for (const snippet of snippets) {
        const key = `${snippet.date}:${snippet.text}`;
        const existing = scoreMap.get(key);
        if (existing) {
          existing.score += 1;
        } else {
          scoreMap.set(key, { ...snippet, score: 1 });
        }
      }
    }

    return Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score || b.date.localeCompare(a.date))
      .slice(0, maxSnippets);
  }

  /**
   * Format snippets into a short context brief (≤200 chars).
   * Returns undefined when there are no matching snippets.
   */
  formatBrief(snippets: JournalSnippet[]): string | undefined {
    if (snippets.length === 0) return undefined;

    const parts = snippets.map((s) => `[${s.date}] ${s.text}`);
    let brief = parts.join(' | ');
    if (brief.length > 200) {
      brief = brief.slice(0, 197) + '...';
    }
    return brief;
  }

  get isReady(): boolean {
    return this.built;
  }
}

// ---------------------------------------------------------------------------
// extractTermsFromItem — pull meaningful tokens from an item for index lookup
// ---------------------------------------------------------------------------

/**
 * Extract search terms from an item's title/subject, sender, and body.
 * Returns a deduplicated array of lowercase tokens ≥4 chars that are not stop words.
 */
export function extractTermsFromItem(item: Item): string[] {
  const parts: string[] = [];

  if (item.type === 'MESSAGE') {
    const msg = item as MessageItem;
    if (msg.subject) parts.push(msg.subject);
    if (msg.from) parts.push(msg.from);
    // Include first 200 chars of body for context
    if (msg.body) parts.push(msg.body.slice(0, 200));
  } else {
    // EVENT
    if (item.title) parts.push(item.title);
    if (item.organizer) parts.push(item.organizer);
    if (item.description) parts.push(item.description.slice(0, 200));
  }

  const allText = parts.join(' ');
  const tokens = tokenise(allText);

  // Deduplicate
  return Array.from(new Set(tokens));
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')  // keep hyphens for compound words
    .split(/[\s-]+/)
    .filter((t) => t.length >= 4 && !STOP_WORDS.has(t));
}
