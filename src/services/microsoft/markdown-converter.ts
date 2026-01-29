/**
 * Markdown Converter Utility
 *
 * Utilities for converting between Markdown and HTML for OneNote pages
 */

import { marked } from 'marked';
import { logger } from '../../common';

/**
 * Escape HTML special characters
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Convert Markdown to OneNote-compatible HTML
 *
 * @param title Page title (will be escaped)
 * @param markdown Markdown content
 * @returns HTML string formatted for OneNote API
 */
export function markdownToOneNoteHtml(title: string, markdown: string): string {
  try {
    // Configure marked for GitHub Flavored Markdown
    marked.setOptions({
      gfm: true,
      breaks: true,
    });

    // Convert markdown body to HTML
    const bodyHtml = marked.parse(markdown);

    // Wrap in OneNote HTML template
    const html = `
<!DOCTYPE html>
<html>
  <head>
    <title>${escapeHtml(title)}</title>
    <meta name="created" content="${new Date().toISOString()}" />
  </head>
  <body>
    ${bodyHtml}
  </body>
</html>
    `.trim();

    logger.debug({
      title,
      markdownLength: markdown.length,
      htmlLength: html.length,
    }, 'Converted markdown to HTML');

    return html;
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      title,
    }, 'Failed to convert markdown to HTML');
    throw new Error(`Markdown conversion failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Convert HTML to Markdown (for reading content back)
 *
 * Note: This is a basic implementation. For full HTML-to-Markdown conversion,
 * consider using a library like turndown in the future.
 *
 * @param html HTML content from OneNote
 * @returns Markdown string
 */
export function htmlToMarkdown(html: string): string {
  try {
    // Basic HTML stripping for now
    // In the future, implement proper HTML-to-Markdown conversion with turndown
    let markdown = html
      // Remove HTML tags but keep content
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '')
      // Decode HTML entities
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      // Normalize whitespace
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();

    logger.debug({
      htmlLength: html.length,
      markdownLength: markdown.length,
    }, 'Converted HTML to markdown');

    return markdown;
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
    }, 'Failed to convert HTML to markdown');
    return html; // Return original HTML as fallback
  }
}

/**
 * Validate that markdown doesn't contain potentially problematic content
 */
export function validateMarkdown(markdown: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Check for excessively long content
  if (markdown.length > 1000000) {
    errors.push('Markdown content exceeds 1MB limit');
  }

  // Check for script tags (security)
  if (/<script/i.test(markdown)) {
    errors.push('Markdown contains script tags');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
