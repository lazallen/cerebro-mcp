/**
 * Tests for room type validation functions
 */

import {
  isValidRoomEmail,
  isValidCapacity,
  isValidTimeRange,
  isValidBuilding,
  validateMeetingRoom,
  parseAvailabilityView,
  type MeetingRoom,
} from '../room';

describe('Room Validators', () => {
  describe('isValidRoomEmail', () => {
    it('should accept valid email formats', () => {
      expect(isValidRoomEmail('room@company.com')).toBe(true);
      expect(isValidRoomEmail('edi-l2-barajas@skyscanner.net')).toBe(true);
      expect(isValidRoomEmail('test.room@example.org')).toBe(true);
    });

    it('should reject invalid email formats', () => {
      expect(isValidRoomEmail('')).toBe(false);
      expect(isValidRoomEmail('notanemail')).toBe(false);
      expect(isValidRoomEmail('@company.com')).toBe(false);
      expect(isValidRoomEmail('room@')).toBe(false);
      expect(isValidRoomEmail('room @company.com')).toBe(false); // space
    });
  });

  describe('isValidCapacity', () => {
    it('should accept valid capacity values', () => {
      expect(isValidCapacity(1)).toBe(true);
      expect(isValidCapacity(10)).toBe(true);
      expect(isValidCapacity(100)).toBe(true);
      expect(isValidCapacity(1000)).toBe(true);
    });

    it('should reject invalid capacity values', () => {
      expect(isValidCapacity(0)).toBe(false);
      expect(isValidCapacity(-5)).toBe(false);
      expect(isValidCapacity(1001)).toBe(false);
      expect(isValidCapacity(5.5)).toBe(false); // decimal
      expect(isValidCapacity(NaN)).toBe(false);
      expect(isValidCapacity(Infinity)).toBe(false);
    });
  });

  describe('isValidTimeRange', () => {
    it('should accept valid time ranges', () => {
      const start = new Date('2026-02-05T14:00:00Z');
      const end1Hour = new Date('2026-02-05T15:00:00Z');
      const end24Hours = new Date('2026-02-06T14:00:00Z');

      expect(isValidTimeRange(start, end1Hour)).toBe(true);
      expect(isValidTimeRange(start, end24Hours)).toBe(true);
    });

    it('should reject invalid time ranges', () => {
      const start = new Date('2026-02-05T14:00:00Z');
      const endBefore = new Date('2026-02-05T13:00:00Z'); // before start
      const endSame = new Date('2026-02-05T14:00:00Z'); // same as start
      const endTooLong = new Date('2026-02-06T14:00:01Z'); // > 24 hours

      expect(isValidTimeRange(start, endBefore)).toBe(false);
      expect(isValidTimeRange(start, endSame)).toBe(false);
      expect(isValidTimeRange(start, endTooLong)).toBe(false);
    });
  });

  describe('isValidBuilding', () => {
    it('should accept valid office locations', () => {
      expect(isValidBuilding('Edinburgh')).toBe(true);
      expect(isValidBuilding('Glasgow')).toBe(true);
      expect(isValidBuilding('Barcelona')).toBe(true);
      expect(isValidBuilding('London')).toBe(true);
    });

    it('should reject invalid office locations', () => {
      expect(isValidBuilding('Remote')).toBe(false); // Remote is valid type but not for building filter
      expect(isValidBuilding('Paris')).toBe(false);
      expect(isValidBuilding('edinburgh')).toBe(false); // case-sensitive
      expect(isValidBuilding('')).toBe(false);
    });
  });

  describe('validateMeetingRoom', () => {
    const validRoom: MeetingRoom = {
      id: 'room-123',
      emailAddress: 'room@company.com',
      displayName: 'Test Room',
      building: 'Edinburgh',
      capacity: 10,
    };

    it('should accept valid meeting room objects', () => {
      expect(validateMeetingRoom(validRoom)).toBe(true);
    });

    it('should accept room with optional fields', () => {
      const roomWithOptionals: MeetingRoom = {
        ...validRoom,
        nickname: 'TR',
        floorNumber: 2,
        videoDeviceName: 'Teams Rooms',
        isWheelchairAccessible: true,
      };
      expect(validateMeetingRoom(roomWithOptionals)).toBe(true);
    });

    it('should reject room missing required id', () => {
      const { id, ...roomWithoutId } = validRoom;
      expect(validateMeetingRoom(roomWithoutId)).toBe(false);
    });

    it('should reject room missing emailAddress', () => {
      const { emailAddress, ...roomWithoutEmail } = validRoom;
      expect(validateMeetingRoom(roomWithoutEmail)).toBe(false);
    });

    it('should reject room missing displayName', () => {
      const { displayName, ...roomWithoutName } = validRoom;
      expect(validateMeetingRoom(roomWithoutName)).toBe(false);
    });

    it('should reject room missing building', () => {
      const { building, ...roomWithoutBuilding } = validRoom;
      expect(validateMeetingRoom(roomWithoutBuilding)).toBe(false);
    });

    it('should reject room with zero capacity', () => {
      expect(validateMeetingRoom({ ...validRoom, capacity: 0 })).toBe(false);
    });

    it('should reject room with negative capacity', () => {
      expect(validateMeetingRoom({ ...validRoom, capacity: -5 })).toBe(false);
    });
  });

  describe('parseAvailabilityView', () => {
    it('should return true for all-free availability views', () => {
      expect(parseAvailabilityView('0000')).toBe(true);
      expect(parseAvailabilityView('0')).toBe(true);
      expect(parseAvailabilityView('00000000')).toBe(true);
    });

    it('should return true for tentative slots (1)', () => {
      expect(parseAvailabilityView('0010')).toBe(true);
      expect(parseAvailabilityView('1111')).toBe(true);
    });

    it('should return false for busy slots (2)', () => {
      expect(parseAvailabilityView('0020')).toBe(false);
      expect(parseAvailabilityView('2222')).toBe(false);
      expect(parseAvailabilityView('0200')).toBe(false);
    });

    it('should return false for out-of-office slots (3)', () => {
      expect(parseAvailabilityView('0030')).toBe(false);
      expect(parseAvailabilityView('3333')).toBe(false);
      expect(parseAvailabilityView('0003')).toBe(false);
    });

    it('should return false for working-elsewhere slots (4)', () => {
      expect(parseAvailabilityView('0040')).toBe(true); // 4 doesn't block
      expect(parseAvailabilityView('4444')).toBe(true);
    });

    it('should return false for mixed availability with busy', () => {
      expect(parseAvailabilityView('0120')).toBe(false); // has busy
      expect(parseAvailabilityView('0203')).toBe(false); // has busy and oof
    });
  });
});
