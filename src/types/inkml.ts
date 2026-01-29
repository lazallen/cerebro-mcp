/**
 * InkML Type Definitions
 *
 * Type definitions for InkML (Ink Markup Language) parsing and OCR processing
 */

// Core InkML types
export interface InkData {
  hasInk: boolean;
  strokes: Stroke[];
  bounds?: BoundingBox;
}

export interface Stroke {
  id?: string;
  points: Point[];
  brush: BrushProperties;
  contextRef?: string;
}

export interface Point {
  x: number;              // himetric units
  y: number;              // himetric units
  pressure: number;       // normalized 0-8191
}

export interface BrushProperties {
  width: number;          // himetric units
  height: number;         // himetric units
  color: string;          // hex color (#RRGGBB)
  transparency?: number;  // 0-1 alpha
}

export interface BoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

// OCR types
export interface OCRResult {
  text: string;           // Recognized text (markdown format)
  confidence?: number;    // 0-1 confidence score
  method: 'tesseract' | 'localfoundry' | 'none';
  processingTime: number; // milliseconds
}

export interface InkToTextInput {
  sectionName: string;
  meetingTitle: string;
  language?: string;      // ISO 639-1 code (default: 'eng')
  useLocalFoundry?: boolean;
  savePng?: boolean;      // Debug: save rendered image
  dpi?: number;           // Rendering DPI (default: 150)
}

export interface InkToTextResult {
  pageId: string;
  title: string;
  hasInk: boolean;
  recognizedText: string; // Markdown format
  ocrMethod: 'tesseract' | 'localfoundry' | 'none';
  confidence?: number;
  processingTime: number;
  strokeCount?: number;
  imageDimensions?: {
    width: number;
    height: number;
  };
  debugPngPath?: string;
}

// InkML XML parsing types
export interface InkMLDocument {
  ink: {
    context?: InkMLContext[];
    brush?: InkMLBrush[];
    trace: InkMLTrace[];
  };
}

export interface InkMLContext {
  '@_xml:id': string;
  inkSource?: {
    channelProperties?: {
      channel: InkMLChannel[];
    };
  };
}

export interface InkMLChannel {
  '@_name': string;
  '@_type': string;
  '@_units': string;
}

export interface InkMLBrush {
  '@_xml:id': string;
  brushProperty: InkMLBrushProperty[];
}

export interface InkMLBrushProperty {
  '@_name': string;
  '@_value': string;
  '@_units'?: string;
}

export interface InkMLTrace {
  '@_contextRef': string;
  '@_brushRef': string;
  '#text': string;  // Coordinate data as string
}
