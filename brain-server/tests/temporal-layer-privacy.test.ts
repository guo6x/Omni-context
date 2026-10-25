import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseTemporalQuery } from '../src/retrieval/temporal-layer.js';

describe('temporal parser privacy diagnostics', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not copy raw user query text into logs', () => {
    const privateQuery = 'contact@example.test confidential-project-marker';
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});

    parseTemporalQuery(privateQuery);

    expect(warning).toHaveBeenCalled();
    expect(warning.mock.calls.flat().join(' ')).not.toContain(privateQuery);
    expect(warning.mock.calls.flat().join(' ')).toContain(`query_length=${privateQuery.length}`);
  });
});
