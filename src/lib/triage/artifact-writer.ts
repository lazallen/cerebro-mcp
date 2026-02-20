/**
 * Shared atomic artifact writer for system/ directory artifacts.
 * Wraps the EventWriter pattern: temp file + atomic rename + proper-lockfile.
 * Uses gray-matter for frontmatter-enriched markdown.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as lockfile from 'proper-lockfile';
import matter from 'gray-matter';
import { logger } from '../../common/logger';

/**
 * Write a frontmatter-enriched markdown artifact atomically.
 * @param dir Target directory (created if absent)
 * @param filename Filename (e.g., "20260219-email-a1b2.md")
 * @param frontmatter YAML frontmatter object
 * @param body Markdown body content
 * @returns Absolute path to the written file
 */
export async function writeArtifact(
  dir: string,
  filename: string,
  frontmatter: Record<string, unknown>,
  body: string
): Promise<string> {
  await fs.mkdir(dir, { recursive: true });

  const filepath = path.join(dir, filename);
  const fileContent = matter.stringify(body, frontmatter);

  const lockPath = `${filepath}.lock`;

  // Ensure lock file exists before acquiring
  try {
    await fs.access(lockPath);
  } catch {
    await fs.writeFile(lockPath, '');
  }

  let release: (() => Promise<void>) | null = null;
  try {
    release = await lockfile.lock(lockPath, {
      retries: { retries: 5, minTimeout: 50, maxTimeout: 500 },
      stale: 10000,
    });

    const tempPath = `${filepath}.tmp`;
    await fs.writeFile(tempPath, fileContent, 'utf-8');
    await fs.rename(tempPath, filepath);

    logger.debug({
      operation: 'artifact_written',
      filepath,
      message: `Artifact written: ${filename}`,
    });

    return filepath;
  } catch (err) {
    logger.error({
      operation: 'artifact_write_error',
      filepath,
      error: (err as Error).message,
      message: `Failed to write artifact: ${filename}`,
    });
    throw err;
  } finally {
    if (release) {
      await release();
      try {
        await fs.unlink(lockPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Read a frontmatter-enriched markdown artifact.
 * Returns { data: frontmatter object, content: markdown body }.
 * Returns null if the file does not exist.
 */
export async function readArtifact(
  filepath: string
): Promise<{ data: Record<string, unknown>; content: string } | null> {
  try {
    const raw = await fs.readFile(filepath, 'utf-8');
    const parsed = matter(raw);
    return {
      data: parsed.data as Record<string, unknown>,
      content: parsed.content,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/**
 * List all .md files in a directory.
 * Returns absolute paths sorted by filename (which sorts by date prefix for YYYYMMDD-* names).
 */
export async function listArtifacts(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir);
    return entries
      .filter((e) => e.endsWith('.md'))
      .sort()
      .map((e) => path.join(dir, e));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}
