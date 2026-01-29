/**
 * LocalFoundry Recognizer
 *
 * Fallback OCR solution using LocalFoundry vision model
 */

import { logger } from '../common';

/**
 * Recognize handwriting using LocalFoundry vision model
 */
export async function recognizeWithVision(
  imageBuffer: Buffer,
  endpoint: string,
  model: string
): Promise<{ text: string; confidence: number }> {
  const startTime = Date.now();

  try {
    logger.info({
      operation: 'localfoundry_vision',
      endpoint,
      model,
      imageSize: imageBuffer.length,
    }, 'Starting LocalFoundry vision recognition');

    // Convert buffer to base64 for vision API
    const base64Image = imageBuffer.toString('base64');

    // Call LocalFoundry vision API
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Transcribe all handwritten text from this image. Return only the text content, preserving the original structure and line breaks. Do not add any commentary or explanations.',
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/png;base64,${base64Image}`,
                },
              },
            ],
          },
        ],
        max_tokens: 1000,
        temperature: 0.1, // Low temperature for more consistent transcription
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LocalFoundry API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json() as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };

    const text = data.choices?.[0]?.message?.content?.trim() || '';

    const processingTime = Date.now() - startTime;

    logger.info({
      operation: 'localfoundry_vision',
      textLength: text.length,
      processingTime,
    }, 'LocalFoundry vision recognition complete');

    return {
      text,
      confidence: 0.85, // LocalFoundry doesn't provide confidence, use fixed estimate
    };
  } catch (error) {
    const processingTime = Date.now() - startTime;

    logger.error({
      operation: 'localfoundry_vision',
      error: error instanceof Error ? error.message : String(error),
      processingTime,
    }, 'LocalFoundry vision recognition failed');

    throw new Error(`LocalFoundry vision failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
