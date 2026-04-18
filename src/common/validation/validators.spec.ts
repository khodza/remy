import { InvalidInputError } from '@common/errors';
import {
  validateText,
  validateDelayMinutes,
  validateTimezone,
  validateScheduledAt,
} from './validators';

describe('validateText', () => {
  it('should pass for valid text', () => {
    expect(() => validateText('Buy groceries')).not.toThrow();
  });

  it('should throw for empty string', () => {
    expect(() => validateText('')).toThrow(InvalidInputError);
    expect(() => validateText('')).toThrow('Text cannot be empty');
  });

  it('should throw for whitespace-only string', () => {
    expect(() => validateText('   ')).toThrow(InvalidInputError);
  });

  it('should throw for text exceeding default max length', () => {
    const longText = 'a'.repeat(4001);
    expect(() => validateText(longText)).toThrow(InvalidInputError);
    expect(() => validateText(longText)).toThrow('Text too long');
  });

  it('should accept text at exactly max length', () => {
    const text = 'a'.repeat(4000);
    expect(() => validateText(text)).not.toThrow();
  });

  it('should respect custom max length', () => {
    expect(() => validateText('hello', 3)).toThrow(InvalidInputError);
    expect(() => validateText('hi', 3)).not.toThrow();
  });
});

describe('validateDelayMinutes', () => {
  it('should pass for valid delay', () => {
    expect(() => validateDelayMinutes(15)).not.toThrow();
    expect(() => validateDelayMinutes(60)).not.toThrow();
    expect(() => validateDelayMinutes(1)).not.toThrow();
  });

  it('should pass for max delay (1 week)', () => {
    expect(() => validateDelayMinutes(10080)).not.toThrow();
  });

  it('should throw for zero', () => {
    expect(() => validateDelayMinutes(0)).toThrow(InvalidInputError);
    expect(() => validateDelayMinutes(0)).toThrow(
      'Delay must be greater than 0',
    );
  });

  it('should throw for negative numbers', () => {
    expect(() => validateDelayMinutes(-5)).toThrow(InvalidInputError);
  });

  it('should throw for delay exceeding 1 week', () => {
    expect(() => validateDelayMinutes(10081)).toThrow(InvalidInputError);
    expect(() => validateDelayMinutes(10081)).toThrow('Delay too long');
  });

  it('should throw for NaN', () => {
    expect(() => validateDelayMinutes(NaN)).toThrow(InvalidInputError);
    expect(() => validateDelayMinutes(NaN)).toThrow(
      'Delay must be a valid number',
    );
  });
});

describe('validateTimezone', () => {
  it('should pass for valid IANA timezone', () => {
    expect(() => validateTimezone('UTC')).not.toThrow();
  });

  it('should pass for continent/city format', () => {
    expect(() => validateTimezone('Asia/Tokyo')).not.toThrow();
  });

  it('should throw for empty string', () => {
    expect(() => validateTimezone('')).toThrow(InvalidInputError);
    expect(() => validateTimezone('')).toThrow('Timezone cannot be empty');
  });

  it('should throw for invalid format', () => {
    expect(() => validateTimezone('invalid')).toThrow(InvalidInputError);
    expect(() => validateTimezone('invalid')).toThrow('Invalid timezone format');
  });

  it('should throw for whitespace-only string', () => {
    expect(() => validateTimezone('   ')).toThrow(InvalidInputError);
  });
});

describe('validateScheduledAt', () => {
  it('should pass for a valid date', () => {
    expect(() => validateScheduledAt(new Date())).not.toThrow();
  });

  it('should throw for invalid date', () => {
    expect(() => validateScheduledAt(new Date('invalid'))).toThrow(
      InvalidInputError,
    );
    expect(() => validateScheduledAt(new Date('invalid'))).toThrow(
      'Scheduled time must be a valid date',
    );
  });

  it('should pass for past date when requireFuture is false', () => {
    const pastDate = new Date('2020-01-01');
    expect(() => validateScheduledAt(pastDate)).not.toThrow();
  });

  it('should throw for past date when requireFuture is true', () => {
    const pastDate = new Date('2020-01-01');
    expect(() => validateScheduledAt(pastDate, true)).toThrow(
      InvalidInputError,
    );
    expect(() => validateScheduledAt(pastDate, true)).toThrow(
      'Scheduled time must be in the future',
    );
  });

  it('should pass for future date when requireFuture is true', () => {
    const futureDate = new Date(Date.now() + 86400000); // tomorrow
    expect(() => validateScheduledAt(futureDate, true)).not.toThrow();
  });
});
