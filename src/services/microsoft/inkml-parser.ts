/**
 * InkML Parser
 *
 * Utilities for parsing InkML XML and converting coordinate data
 */

import { XMLParser } from 'fast-xml-parser';
import { logger } from '../../common';
import type { InkData, Stroke, Point, BrushProperties, BoundingBox } from '../../types/inkml';

// Himetric to pixel conversion factor for rendering
// 1 himetric = 0.01mm, at 96 DPI: pixels = himetric * 3.779528
// For better OCR quality, use 150 DPI: pixels = himetric * 5.9055
const HIMETRIC_TO_PIXEL_96DPI = 3.779528;
const HIMETRIC_TO_PIXEL_150DPI = 5.9055;

/**
 * Convert himetric units to pixels at specified DPI
 */
export function himetricToPixels(himetric: number, dpi: number = 150): number {
  if (dpi === 96) {
    return himetric * HIMETRIC_TO_PIXEL_96DPI;
  } else if (dpi === 150) {
    return himetric * HIMETRIC_TO_PIXEL_150DPI;
  } else {
    // Custom DPI: pixels = himetric * 0.0393701 * dpi
    return himetric * 0.0393701 * dpi;
  }
}

/**
 * Calculate bounding box for a set of strokes
 */
export function calculateBounds(strokes: Stroke[], dpi: number = 150): BoundingBox {
  if (strokes.length === 0) {
    return {
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0,
      width: 0,
      height: 0,
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const stroke of strokes) {
    for (const point of stroke.points) {
      // Convert to pixels for consistent bounds
      const pixelX = himetricToPixels(point.x, dpi);
      const pixelY = himetricToPixels(point.y, dpi);

      if (pixelX < minX) minX = pixelX;
      if (pixelY < minY) minY = pixelY;
      if (pixelX > maxX) maxX = pixelX;
      if (pixelY > maxY) maxY = pixelY;
    }
  }

  const width = maxX - minX;
  const height = maxY - minY;

  return {
    minX,
    minY,
    maxX,
    maxY,
    width,
    height,
  };
}

/**
 * Parse InkML XML and extract stroke data
 */
export function parseInkML(inkmlXml: string): InkData {
  try {
    logger.info({ xmlLength: inkmlXml.length }, 'Parsing InkML XML');

    // Save raw XML for debugging if enabled
    if (process.env['ONENOTE_DEBUG_IMAGES'] === 'true') {
      const fs = require('fs/promises');
      fs.writeFile('./debug/inkml-raw.xml', inkmlXml).catch((err: Error) => {
        logger.warn({ error: err.message }, 'Failed to save debug InkML');
      });
    }

    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
    });

    const parsed = parser.parse(inkmlXml);

    // Debug: Log parsed structure keys
    logger.info({
      rootKeys: Object.keys(parsed),
      hasInkmlInk: !!parsed['inkml:ink'],
      hasInk: !!parsed['ink'],
    }, 'Parsed InkML root structure');

    // Navigate InkML structure
    const ink = parsed['inkml:ink'] || parsed['ink'];
    if (!ink) {
      logger.error({
        availableKeys: Object.keys(parsed),
        parsedSample: JSON.stringify(parsed).substring(0, 500),
      }, 'Invalid InkML: no ink element found');
      throw new Error('Invalid InkML: no ink element found');
    }

    logger.info({
      inkKeys: Object.keys(ink),
      hasTrace: !!(ink['inkml:trace'] || ink['trace']),
      hasBrush: !!(ink['inkml:brush'] || ink['brush']),
    }, 'InkML element structure');

    // Extract brush properties
    // Brushes can be at root level or in definitions section
    const brushes = new Map<string, BrushProperties>();
    let brushElements: any[] = [];

    // Try root level brushes first
    if (ink['inkml:brush']) {
      brushElements = Array.isArray(ink['inkml:brush'])
        ? ink['inkml:brush']
        : [ink['inkml:brush']];
    }
    // Try definitions section
    else if (ink['inkml:definitions'] && ink['inkml:definitions']['inkml:brush']) {
      const definitionsBrush = ink['inkml:definitions']['inkml:brush'];
      brushElements = Array.isArray(definitionsBrush)
        ? definitionsBrush
        : [definitionsBrush];
    }

    for (const brush of brushElements) {
      const id = brush['@_xml:id'] || brush['@_id'];
      const properties: BrushProperties = {
        width: 47, // Default values
        height: 47,
        color: '#000000',
        transparency: 1.0,
      };

      // Parse brush properties
      const props = Array.isArray(brush['inkml:brushProperty'])
        ? brush['inkml:brushProperty']
        : brush['inkml:brushProperty']
        ? [brush['inkml:brushProperty']]
        : [];

      for (const prop of props) {
        const name = prop['@_name'];
        const value = prop['@_value'];
        const units = prop['@_units'];

        if (name === 'width' && units === 'himetric') {
          properties.width = parseFloat(value);
        } else if (name === 'height' && units === 'himetric') {
          properties.height = parseFloat(value);
        } else if (name === 'color') {
          properties.color = value;
        } else if (name === 'transparency') {
          properties.transparency = parseFloat(value);
        }
      }

      if (id) {
        brushes.set(id, properties);
      }
    }

    // Extract strokes from traces
    // OneNote can structure traces in two ways:
    // 1. Direct traces: ink['inkml:trace']
    // 2. Grouped traces: ink['inkml:traceGroup']['inkml:trace']
    const strokes: Stroke[] = [];
    let traceElements: any[] = [];

    // Try direct traces first
    if (ink['inkml:trace']) {
      traceElements = Array.isArray(ink['inkml:trace'])
        ? ink['inkml:trace']
        : [ink['inkml:trace']];
    }
    // Try trace group if no direct traces
    else if (ink['inkml:traceGroup']) {
      const traceGroup = ink['inkml:traceGroup'];
      if (traceGroup['inkml:trace']) {
        traceElements = Array.isArray(traceGroup['inkml:trace'])
          ? traceGroup['inkml:trace']
          : [traceGroup['inkml:trace']];
      }
    }

    logger.info({
      traceElementsFound: traceElements.length,
      hasTraceGroup: !!ink['inkml:traceGroup'],
      hasDirectTrace: !!ink['inkml:trace'],
    }, 'Trace elements extraction');

    // Limit number of strokes to prevent memory issues
    const MAX_STROKES = 10000;
    const tracesToProcess = traceElements.slice(0, MAX_STROKES);

    if (traceElements.length > MAX_STROKES) {
      logger.warn({
        totalTraces: traceElements.length,
        processing: MAX_STROKES,
      }, 'Too many traces, limiting to prevent memory issues');
    }

    for (const trace of tracesToProcess) {
      const brushRef = trace['@_brushRef'];
      const coordinateData = trace['#text'] || trace;

      if (typeof coordinateData !== 'string') {
        continue;
      }

      // Parse coordinates: "X Y PRESSURE, X Y PRESSURE, ..."
      const points: Point[] = [];
      const triplets = coordinateData.split(',').map(s => s.trim());

      // Limit points per stroke to prevent memory issues
      const MAX_POINTS_PER_STROKE = 10000;
      const tripletsToProcess = triplets.slice(0, MAX_POINTS_PER_STROKE);

      for (const triplet of tripletsToProcess) {
        const [xStr, yStr, pressureStr] = triplet.split(/\s+/);
        if (xStr && yStr) {
          points.push({
            x: parseFloat(xStr),
            y: parseFloat(yStr),
            pressure: pressureStr ? parseFloat(pressureStr) : 1.0,
          });
        }
      }

      if (points.length > 0) {
        // Get brush properties (remove # prefix from ref)
        const brushId = brushRef ? brushRef.replace('#', '') : undefined;
        const brush = brushId ? brushes.get(brushId) : undefined;

        strokes.push({
          points,
          brush: brush || {
            width: 47,
            height: 47,
            color: '#000000',
            transparency: 1.0,
          },
        });
      }
    }

    logger.info({
      strokeCount: strokes.length,
      totalPoints: strokes.reduce((sum, s) => sum + s.points.length, 0),
    }, 'Parsed InkML successfully');

    return {
      hasInk: strokes.length > 0,
      strokes,
      bounds: calculateBounds(strokes),
    };
  } catch (error) {
    logger.error({
      error: error instanceof Error ? error.message : String(error),
    }, 'Failed to parse InkML');
    throw new Error(`InkML parsing failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
