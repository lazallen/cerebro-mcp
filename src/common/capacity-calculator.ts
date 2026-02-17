/**
 * Capacity Calculator Utility
 *
 * Implements 20% capacity buffer calculation for meeting room booking (FR-027).
 */

/**
 * Calculate required room capacity with 20% buffer rounded up
 *
 * Applies a 20% buffer to attendee count and rounds up to ensure sufficient space.
 *
 * Examples:
 * - 5 attendees → 6 capacity minimum (5 * 1.2 = 6)
 * - 8 attendees → 10 capacity minimum (8 * 1.2 = 9.6, rounded up to 10)
 * - 10 attendees → 12 capacity minimum (10 * 1.2 = 12)
 *
 * @param attendeeCount Number of meeting attendees
 * @returns Minimum required room capacity (rounded up)
 * @throws {Error} If attendeeCount is not a positive integer
 */
export function calculateRequiredCapacity(attendeeCount: number): number {
  // Validate input
  if (!Number.isInteger(attendeeCount) || attendeeCount < 1) {
    throw new Error(`Attendee count must be a positive integer, got: ${attendeeCount}`);
  }

  // Apply 20% buffer and round up (FR-027)
  return Math.ceil(attendeeCount * 1.2);
}
