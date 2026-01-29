/**
 * Ink Renderer
 *
 * Renders InkML strokes to PNG images using node-canvas
 */

import { createCanvas, CanvasRenderingContext2D } from 'canvas';
import { writeFile } from 'fs/promises';
import { logger } from '../../common';
import type { InkData, Stroke } from '../../types/inkml';
import { himetricToPixels } from './inkml-parser';

/**
 * Render InkML strokes to PNG buffer
 */
export async function renderStrokesToPNG(
  inkData: InkData,
  dpi: number = 150
): Promise<{ buffer: Buffer; width: number; height: number }> {
  try {
    logger.debug({
      strokeCount: inkData.strokes.length,
      dpi,
    }, 'Rendering strokes to PNG');

    if (inkData.strokes.length === 0) {
      throw new Error('No strokes to render');
    }

    // Recalculate bounds at the rendering DPI (bounds from parser may be at different DPI)
    const { calculateBounds } = await import('./inkml-parser');
    const bounds = calculateBounds(inkData.strokes, dpi);

    // Calculate canvas dimensions from bounds (already in pixels)
    const padding = 20; // Add padding around strokes
    let width = Math.ceil(bounds.width + padding * 2);
    let height = Math.ceil(bounds.height + padding * 2);

    // Limit canvas size for smaller images and better OCR
    // Use UNIFORM scaling to preserve aspect ratio and prevent distortion
    const MAX_DIMENSION = 2048;
    let scale = 1.0;

    if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
      // Use the smaller scale factor to ensure both dimensions fit
      const scaleForWidth = width > MAX_DIMENSION ? MAX_DIMENSION / width : 1.0;
      const scaleForHeight = height > MAX_DIMENSION ? MAX_DIMENSION / height : 1.0;
      scale = Math.min(scaleForWidth, scaleForHeight);

      logger.warn({
        originalWidth: width,
        originalHeight: height,
        scale,
      }, 'Canvas dimensions too large, scaling uniformly to preserve aspect ratio');

      width = Math.ceil(width * scale);
      height = Math.ceil(height * scale);
    }

    // Ensure minimum dimensions
    width = Math.max(1, width);
    height = Math.max(1, height);

    logger.info({ width, height, padding }, 'Canvas dimensions calculated');

    // Create canvas
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Set white background for better OCR
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);

    // Filter strokes to remove shapes/drawings that aren't text
    // Text strokes have lower point density and reasonable dimensions
    const textStrokes = inkData.strokes.filter((stroke, i) => {
      if (stroke.points.length === 0) return false;

      // Calculate stroke bounding box in pixels (unscaled)
      const xCoords = stroke.points.map(p => himetricToPixels(p.x, dpi));
      const yCoords = stroke.points.map(p => himetricToPixels(p.y, dpi));
      const minX = Math.min(...xCoords);
      const maxX = Math.max(...xCoords);
      const minY = Math.min(...yCoords);
      const maxY = Math.max(...yCoords);
      const strokeWidth = maxX - minX;
      const strokeHeight = maxY - minY;
      const strokeArea = strokeWidth * strokeHeight;

      // Calculate point density using UNSCALED area (points per 100 square pixels)
      // This prevents the extreme canvas scaling from affecting filtering
      const density = strokeArea > 0 ? (stroke.points.length / strokeArea) * 100 : 0;

      // Filter criteria for text strokes (using unscaled dimensions):
      // 1. Not too dense (blobs typically have >5 points per 100px²)
      // 2. Not too large (solid fills/backgrounds typically > 10M px²)
      // 3. Not too small (noise/dots typically < 100px²)
      const isTextStroke = density < 5.0 && strokeArea >= 100 && strokeArea < 10000000;

      if (i < 5) {
        logger.info({
          strokeIndex: i,
          pointCount: stroke.points.length,
          width: strokeWidth.toFixed(1),
          height: strokeHeight.toFixed(1),
          area: strokeArea.toFixed(1),
          density: density.toFixed(2),
          isText: isTextStroke,
        }, 'Stroke analysis');
      }

      return isTextStroke;
    });

    logger.info({
      totalStrokes: inkData.strokes.length,
      textStrokes: textStrokes.length,
      filteredOut: inkData.strokes.length - textStrokes.length,
    }, 'Filtered strokes for text recognition');

    // Draw text strokes only
    logger.info({
      strokesToDraw: textStrokes.length,
      boundsMinX: bounds.minX,
      boundsMinY: bounds.minY,
    }, 'Starting stroke rendering');

    textStrokes.forEach((stroke, i) => {
      if (i < 3) {
        logger.info({
          strokeIndex: i,
          pointCount: stroke.points.length,
          brushColor: stroke.brush.color,
        }, 'Drawing stroke');
      }
      drawStroke(ctx, stroke, bounds.minX - padding, bounds.minY - padding, dpi, scale);
    });

    logger.info('Finished drawing all strokes');

    // Convert to PNG buffer
    const buffer = canvas.toBuffer('image/png');

    logger.info({
      width,
      height,
      bufferSize: buffer.length,
    }, 'Rendered strokes to PNG');

    return { buffer, width, height };
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
    }, 'Failed to render strokes');
    throw new Error(`Stroke rendering failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Draw a single stroke on canvas
 */
function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  offsetX: number,
  offsetY: number,
  dpi: number,
  scale: number = 1.0
): void {
  if (stroke.points.length === 0) {
    return;
  }

  // Set stroke style from brush properties
  const brush = stroke.brush;

  // Scale stroke width based on canvas scaling to maintain visibility
  // Use thicker base width (10px) that scales down appropriately
  // Minimum 5px to ensure excellent visibility for OCR
  let strokeWidth = Math.max(5.0, 10.0 * scale);

  // Convert blue ink to black for better OCR
  const color = brush.color.toLowerCase() === '#004f8b' ? '#000000' : brush.color;

  ctx.strokeStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // InkML transparency: 0 = transparent, 1 = opaque
  // But if transparency is 0, assume it means opaque (OneNote default)
  ctx.globalAlpha = brush.transparency === 0 ? 1.0 : (brush.transparency || 1.0);

  // Performance optimization: Downsample points to reduce rendering time
  // while maintaining visual quality for OCR
  const downsampledPoints: typeof stroke.points = [];
  const DOWNSAMPLE_INTERVAL = 3; // Keep every 3rd point

  for (let i = 0; i < stroke.points.length; i++) {
    // Always include first and last points, plus every Nth point
    if (i === 0 || i === stroke.points.length - 1 || i % DOWNSAMPLE_INTERVAL === 0) {
      const point = stroke.points[i];
      if (point) {
        downsampledPoints.push(point);
      }
    }
  }

  // Draw as single path for performance
  ctx.beginPath();

  const firstPoint = downsampledPoints[0];
  if (!firstPoint) {
    return;
  }

  const startX = (himetricToPixels(firstPoint.x, dpi) - offsetX) * scale;
  const startY = (himetricToPixels(firstPoint.y, dpi) - offsetY) * scale;
  ctx.moveTo(startX, startY);

  // Draw remaining points as continuous path
  for (let i = 1; i < downsampledPoints.length; i++) {
    const point = downsampledPoints[i];
    if (!point) {
      continue;
    }

    const x = (himetricToPixels(point.x, dpi) - offsetX) * scale;
    const y = (himetricToPixels(point.y, dpi) - offsetY) * scale;
    ctx.lineTo(x, y);
  }

  ctx.stroke();

  // Reset alpha
  ctx.globalAlpha = 1.0;
}

/**
 * Save PNG buffer to file for debugging
 */
export async function savePngForDebug(
  buffer: Buffer,
  pageId: string,
  outputDir: string = './debug'
): Promise<string> {
  try {
    const filePath = `${outputDir}/ink-${pageId}.png`;
    await writeFile(filePath, buffer);

    logger.info({ filePath }, 'Saved PNG for debugging');

    return filePath;
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
      pageId,
    }, 'Failed to save PNG for debugging');
    throw error;
  }
}
