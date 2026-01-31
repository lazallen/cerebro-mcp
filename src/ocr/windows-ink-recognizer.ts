/**
 * Windows Ink Recognizer
 *
 * Uses Windows 11 native handwriting recognition via InkWinRec.exe
 * for high-accuracy ink-to-text conversion
 */

import { spawn } from 'child_process';
import { logger } from '../common';
import * as path from 'path';

/**
 * Result from Windows Ink recognition
 */
export interface WindowsInkItem {
  text: string;
  confidence: number;
  candidates: string[];
  bounds: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  strokeCount: number;
  pointCount: number;
  line: number;
  orderInLine: number;
}

export interface WindowsInkResult {
  recognizer: string;
  scaleApplied: number;
  items: WindowsInkItem[];
}

export interface RecognizedText {
  fullText: string;
  lowConfidenceWords: Array<{
    word: string;
    confidence: number;
    candidates: string[];
  }>;
  lineCount: number;
  wordCount: number;
}

/**
 * Execute Windows Ink recognizer on InkML data
 *
 * @param inkmlXml - InkML XML string from OneNote
 * @param confidenceThreshold - Words below this confidence are flagged (default: 0.7)
 * @returns Parsed recognition result with confidence annotations
 */
export async function recognizeWithWindowsInk(
  inkmlXml: string,
  confidenceThreshold: number = 0.7
): Promise<RecognizedText> {
  const startTime = Date.now();

  try {
    logger.info({
      operation: 'windows_ink_recognition',
      inkmlLength: inkmlXml.length,
      confidenceThreshold,
    }, 'Starting Windows Ink recognition');

    // Get executable path (relative to project root)
    const exePath = path.join(process.cwd(), 'windows', 'InkWinRec.exe');

    // Spawn the Windows executable
    const proc = spawn(exePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    // Collect stdout
    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    // Collect stderr
    proc.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    // Write InkML to stdin
    proc.stdin.write(inkmlXml);
    proc.stdin.end();

    // Wait for process to complete
    const exitCode = await new Promise<number>((resolve, reject) => {
      proc.on('close', (code) => {
        if (code === null) {
          reject(new Error('Process terminated without exit code'));
        } else {
          resolve(code);
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn InkWinRec.exe: ${err.message}`));
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        proc.kill();
        reject(new Error('Windows Ink recognition timed out after 30 seconds'));
      }, 30000);
    });

    if (exitCode !== 0) {
      logger.error({
        operation: 'windows_ink_recognition',
        exitCode,
        stderr,
      }, 'Windows Ink recognition failed');
      throw new Error(`InkWinRec.exe failed with exit code ${exitCode}: ${stderr}`);
    }

    // Parse JSON output
    const result: WindowsInkResult = JSON.parse(stdout);

    logger.debug({
      operation: 'windows_ink_recognition',
      recognizer: result.recognizer,
      itemCount: result.items.length,
      scaleApplied: result.scaleApplied,
    }, 'Parsed Windows Ink JSON response');

    // Reconstruct text with line awareness
    const reconstructed = reconstructText(result, confidenceThreshold);

    const processingTime = Date.now() - startTime;

    logger.info({
      operation: 'windows_ink_recognition',
      wordCount: reconstructed.wordCount,
      lineCount: reconstructed.lineCount,
      lowConfidenceCount: reconstructed.lowConfidenceWords.length,
      processingTime,
    }, 'Windows Ink recognition complete');

    return reconstructed;
  } catch (error) {
    const processingTime = Date.now() - startTime;

    logger.error({
      operation: 'windows_ink_recognition',
      error: error instanceof Error ? error.message : String(error),
      processingTime,
    }, 'Windows Ink recognition failed');

    throw new Error(`Windows Ink recognition failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Reconstruct text from Windows Ink items, preserving line structure
 * and identifying low-confidence words
 */
function reconstructText(
  result: WindowsInkResult,
  confidenceThreshold: number
): RecognizedText {
  if (result.items.length === 0) {
    return {
      fullText: '',
      lowConfidenceWords: [],
      lineCount: 0,
      wordCount: 0,
    };
  }

  // Group items by line
  const lineMap = new Map<number, WindowsInkItem[]>();
  for (const item of result.items) {
    if (!lineMap.has(item.line)) {
      lineMap.set(item.line, []);
    }
    lineMap.get(item.line)!.push(item);
  }

  // Sort lines by line number
  const sortedLines = Array.from(lineMap.entries()).sort((a, b) => a[0] - b[0]);

  // Build text line by line
  const lines: string[] = [];
  const lowConfidenceWords: Array<{
    word: string;
    confidence: number;
    candidates: string[];
  }> = [];

  for (const [, items] of sortedLines) {
    // Sort items within line by orderInLine
    const sortedItems = items.sort((a, b) => a.orderInLine - b.orderInLine);

    // Build line text
    const lineWords = sortedItems.map(item => {
      // Track low confidence words
      if (item.confidence < confidenceThreshold) {
        lowConfidenceWords.push({
          word: item.text,
          confidence: item.confidence,
          candidates: item.candidates,
        });
      }
      return item.text;
    });

    lines.push(lineWords.join(' '));
  }

  const fullText = lines.join('\n');
  const wordCount = result.items.length;
  const lineCount = lineMap.size;

  return {
    fullText,
    lowConfidenceWords,
    lineCount,
    wordCount,
  };
}
