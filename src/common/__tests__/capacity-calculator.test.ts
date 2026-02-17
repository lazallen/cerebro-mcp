/**
 * Tests for capacity calculator utility
 */

import { calculateRequiredCapacity } from '../capacity-calculator';

describe('calculateRequiredCapacity', () => {
  describe('valid inputs', () => {
    it('should apply 20% buffer and round up for 5 attendees (5 → 6)', () => {
      expect(calculateRequiredCapacity(5)).toBe(6);
    });

    it('should apply 20% buffer and round up for 8 attendees (8 → 10)', () => {
      expect(calculateRequiredCapacity(8)).toBe(10);
    });

    it('should apply 20% buffer for exact result (10 → 12)', () => {
      expect(calculateRequiredCapacity(10)).toBe(12);
    });

    it('should handle single attendee (1 → 2)', () => {
      expect(calculateRequiredCapacity(1)).toBe(2);
    });

    it('should handle 4 attendees (4 → 5)', () => {
      expect(calculateRequiredCapacity(4)).toBe(5);
    });

    it('should handle 7 attendees (7 → 9)', () => {
      expect(calculateRequiredCapacity(7)).toBe(9);
    });

    it('should handle large meeting (50 → 60)', () => {
      expect(calculateRequiredCapacity(50)).toBe(60);
    });

    it('should handle very large meeting (100 → 120)', () => {
      expect(calculateRequiredCapacity(100)).toBe(120);
    });
  });

  describe('rounding behavior', () => {
    it('should round up when result has decimal (3 → 4, not 3.6)', () => {
      expect(calculateRequiredCapacity(3)).toBe(4);
    });

    it('should round up when result has decimal (6 → 8, not 7.2)', () => {
      expect(calculateRequiredCapacity(6)).toBe(8);
    });

    it('should round up when result has decimal (9 → 11, not 10.8)', () => {
      expect(calculateRequiredCapacity(9)).toBe(11);
    });
  });

  describe('invalid inputs', () => {
    it('should throw error for zero attendees', () => {
      expect(() => calculateRequiredCapacity(0)).toThrow(
        'Attendee count must be a positive integer, got: 0'
      );
    });

    it('should throw error for negative attendees', () => {
      expect(() => calculateRequiredCapacity(-5)).toThrow(
        'Attendee count must be a positive integer, got: -5'
      );
    });

    it('should throw error for decimal attendees', () => {
      expect(() => calculateRequiredCapacity(5.5)).toThrow(
        'Attendee count must be a positive integer, got: 5.5'
      );
    });

    it('should throw error for NaN', () => {
      expect(() => calculateRequiredCapacity(NaN)).toThrow(
        'Attendee count must be a positive integer'
      );
    });
  });

  describe('edge cases', () => {
    it('should handle minimum valid input (1 attendee)', () => {
      expect(calculateRequiredCapacity(1)).toBe(2);
    });

    it('should handle 2 attendees (2 → 3)', () => {
      expect(calculateRequiredCapacity(2)).toBe(3);
    });

    it('should be consistent for repeated calls', () => {
      expect(calculateRequiredCapacity(5)).toBe(6);
      expect(calculateRequiredCapacity(5)).toBe(6);
      expect(calculateRequiredCapacity(5)).toBe(6);
    });
  });
});
