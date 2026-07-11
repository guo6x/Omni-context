import { describe, expect, it } from 'vitest';
import { parseTemporalExpression } from '../src/utils/temporal-parser.js';

describe('parseTemporalExpression', () => {
  const reference = new Date('2026-07-12T04:30:00.000Z');

  it('parses Chinese and English relative days in an explicit timezone', () => {
    expect(parseTemporalExpression('昨天', { reference, timezone: 'Asia/Shanghai' })).toMatchObject({
      start: '2026-07-10T16:00:00.000Z',
      end: '2026-07-11T16:00:00.000Z',
      precision: 'day',
      temporalSource: 'relative_expression',
      timezone: 'Asia/Shanghai',
    });
    expect(parseTemporalExpression('3 days ago', { reference, timezone: 'UTC' })?.start)
      .toBe('2026-07-09T00:00:00.000Z');
  });

  it('parses explicit calendar dates without depending on machine timezone', () => {
    const result = parseTemporalExpression('2026年7月3日', {
      reference,
      timezone: 'Asia/Shanghai',
    });
    expect(result).toMatchObject({
      start: '2026-07-02T16:00:00.000Z',
      end: '2026-07-03T16:00:00.000Z',
      precision: 'day',
      confidence: 1,
      temporalSource: 'explicit_date',
    });
  });

  it('marks missing timezone as uncertain instead of inventing a local timezone', () => {
    const result = parseTemporalExpression('tomorrow', { reference });
    expect(result).toMatchObject({
      start: '2026-07-13T00:00:00.000Z',
      end: '2026-07-14T00:00:00.000Z',
      timezone: undefined,
      confidence: 0.6,
      temporalSource: 'relative_expression_unknown_timezone',
    });
  });

  it('returns null for invalid dates and unrelated text', () => {
    expect(parseTemporalExpression('2026-02-30', { reference, timezone: 'UTC' })).toBeNull();
    expect(parseTemporalExpression('no time information here', { reference })).toBeNull();
  });

  it('returns deterministic week ranges with Monday as the first day', () => {
    expect(parseTemporalExpression('last week', { reference, timezone: 'UTC' })).toMatchObject({
      start: '2026-06-29T00:00:00.000Z',
      end: '2026-07-06T00:00:00.000Z',
      precision: 'week',
    });
  });
});
