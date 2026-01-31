/**
 * Handwriting Text Cleanup
 *
 * Uses LocalFoundry to clean up and format handwriting recognition results
 * with confidence-aware prompting
 */

import { logger } from '../common';
import { LocalFoundryClient } from '../services/localfoundry/localfoundry-client';
import type { RecognizedText } from './windows-ink-recognizer';

/**
 * Cleanup handwriting recognition text using LocalFoundry
 *
 * @param recognizedText - Windows Ink recognition result with confidence data
 * @param localFoundryClient - Initialized LocalFoundry client
 * @returns Cleaned and formatted text
 */
export async function cleanupHandwritingText(
  recognizedText: RecognizedText,
  localFoundryClient: LocalFoundryClient
): Promise<string> {
  const startTime = Date.now();

  try {
    logger.info({
      operation: 'handwriting_cleanup',
      wordCount: recognizedText.wordCount,
      lowConfidenceCount: recognizedText.lowConfidenceWords.length,
    }, 'Starting handwriting text cleanup with LocalFoundry');

    // Build confidence-aware prompt
    const prompt = buildCleanupPrompt(recognizedText);

    logger.debug({
      operation: 'handwriting_cleanup',
      promptLength: prompt.length,
    }, 'Built cleanup prompt');

    // Call LocalFoundry for cleanup
    const cleanedText = await localFoundryClient.chatCompletion(
      [
        {
          role: 'system',
          content: 'You are a handwriting transcription assistant. Your job is to review handwritten text that has been recognized by OCR and correct any errors while preserving the original meaning and structure. Return ONLY the corrected text without any explanations or commentary.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      {
        temperature: 0.3, // Low temperature for more consistent corrections
        max_tokens: 2000,
      }
    );

    const processingTime = Date.now() - startTime;

    logger.info({
      operation: 'handwriting_cleanup',
      originalLength: recognizedText.fullText.length,
      cleanedLength: cleanedText.length,
      processingTime,
    }, 'Handwriting text cleanup complete');

    return cleanedText.trim();
  } catch (error) {
    const processingTime = Date.now() - startTime;

    logger.error({
      operation: 'handwriting_cleanup',
      error: error instanceof Error ? error.message : String(error),
      processingTime,
    }, 'Handwriting text cleanup failed');

    // Return original text on failure
    logger.warn({
      operation: 'handwriting_cleanup',
    }, 'Returning original text due to cleanup failure');

    return recognizedText.fullText;
  }
}

/**
 * Build a confidence-aware prompt for LocalFoundry
 */
function buildCleanupPrompt(recognizedText: RecognizedText): string {
  const { fullText, lowConfidenceWords } = recognizedText;

  // If no low-confidence words, just ask for basic cleanup
  if (lowConfidenceWords.length === 0) {
    return `Recognized text: "${fullText}"\n\nPlease review this handwritten text for any errors and return the corrected version. The recognition was high confidence, so likely very accurate.`;
  }

  // Build detailed prompt with low-confidence annotations
  const lowConfidenceSections = lowConfidenceWords
    .slice(0, 10) // Limit to 10 words to keep prompt manageable
    .map(item => {
      const candidatesStr = item.candidates.slice(0, 5).join(', '); // Top 5 candidates
      const confidencePercent = (item.confidence * 100).toFixed(0);
      return `- "${item.word}" (${confidencePercent}% confidence) - alternatives: ${candidatesStr}`;
    })
    .join('\n');

  const remainingCount = lowConfidenceWords.length > 10 ? lowConfidenceWords.length - 10 : 0;
  const remainingNote = remainingCount > 0 ? `\n... and ${remainingCount} more low-confidence words` : '';

  return `Recognized text: "${fullText}"

Low-confidence words that may need correction:
${lowConfidenceSections}${remainingNote}

Please review the text and correct any obvious errors, paying special attention to the low-confidence words. Consider the alternative candidates provided. Return only the corrected text, preserving line breaks and structure.`;
}
