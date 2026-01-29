/**
 * Tesseract.js Recognizer
 *
 * Primary OCR solution for handwriting recognition
 */

import { createWorker, Worker } from 'tesseract.js';
import { logger } from '../common';

// Cache worker instance for performance
let cachedWorker: Worker | null = null;

/**
 * Get or create Tesseract worker
 */
async function getWorker(language: string = 'eng'): Promise<Worker> {
  if (cachedWorker) {
    logger.debug({ language }, 'Reusing cached Tesseract worker');
    return cachedWorker;
  }

  logger.info({ language }, 'Creating new Tesseract worker');

  const worker = await createWorker(language, 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        logger.debug({ progress: m.progress }, 'Tesseract progress');
      }
    },
  });

  cachedWorker = worker;

  return worker;
}

/**
 * Recognize handwriting from PNG buffer using Tesseract.js
 */
export async function recognizeHandwriting(
  imageBuffer: Buffer,
  language: string = 'eng'
): Promise<{ text: string; confidence: number }> {
  const startTime = Date.now();

  try {
    logger.info({
      operation: 'tesseract_recognize',
      language,
      imageSize: imageBuffer.length,
    }, 'Starting Tesseract recognition');

    const worker = await getWorker(language);

    // Recognize text from buffer
    const {
      data: { text, confidence },
    } = await worker.recognize(imageBuffer);

    const processingTime = Date.now() - startTime;

    logger.info({
      operation: 'tesseract_recognize',
      confidence,
      textLength: text.length,
      processingTime,
    }, 'Tesseract recognition complete');

    return {
      text: text.trim(),
      confidence: confidence / 100, // Convert 0-100 to 0-1
    };
  } catch (error) {
    const processingTime = Date.now() - startTime;

    logger.error({
      operation: 'tesseract_recognize',
      error: error instanceof Error ? error.message : String(error),
      processingTime,
    }, 'Tesseract recognition failed');

    throw new Error(`Tesseract recognition failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Terminate the cached worker (cleanup)
 */
export async function terminateWorker(): Promise<void> {
  if (cachedWorker) {
    logger.info('Terminating Tesseract worker');
    await cachedWorker.terminate();
    cachedWorker = null;
  }
}
