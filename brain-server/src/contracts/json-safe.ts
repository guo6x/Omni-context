/**
 * JSON-safe wire values for Goal24 contracts (Checkpoint 2.1).
 *
 * Contract fields that cross a wire boundary must contain only JSON-compatible
 * primitives: null, boolean, finite number, string, arrays of those, and plain
 * objects of those. The runtime schemas below reject undefined, BigInt, Date,
 * Map, Set, function, symbol, class instances and circular objects — we do not
 * rely on a later JSON.stringify failure.
 */

import { z } from 'zod';

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** True only for plain objects (Object.prototype or null prototype). */
function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Recursive JSON-safety check with cycle detection. A true cycle (an object
 * reachable from itself) is rejected; shared non-cyclic references are fine
 * because JSON.stringify handles them by duplication.
 */
function isJsonSafeValue(value: unknown, seen?: WeakSet<object>): boolean {
  if (value === null) return true;
  if (typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object') return false; // undefined, function, symbol, bigint
  if (seen === undefined) seen = new WeakSet();
  if (seen.has(value)) return false; // cycle
  seen.add(value);
  let ok: boolean;
  if (Array.isArray(value)) {
    ok = value.every((item) => isJsonSafeValue(item, seen));
  } else if (isPlainJsonObject(value)) {
    ok = Object.values(value).every((item) => isJsonSafeValue(item, seen));
  } else {
    ok = false; // Date, Map, Set, RegExp, class instance, ...
  }
  seen.delete(value);
  return ok;
}

export const JsonValueSchema = z.custom<JsonValue>(
  (value): value is JsonValue => isJsonSafeValue(value),
  {
    message:
      'value must be JSON-safe: null, boolean, finite number, string, array, or plain object; ' +
      'Date/BigInt/function/symbol/class instances and cycles are rejected',
  },
);

export const JsonObjectSchema = z.custom<JsonObject>(
  (value): value is JsonObject => isPlainJsonObject(value) && isJsonSafeValue(value),
  {
    message: 'value must be a JSON-safe plain object (no cycles, no non-JSON values)',
  },
);
