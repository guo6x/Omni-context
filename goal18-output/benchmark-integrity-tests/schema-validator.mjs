// Zero-dependency JSON Schema (draft 2020-12 subset) validator for decision-benchmark-schema.json.
// Supported keywords: type (incl. unions), properties, required, additionalProperties,
// items, enum, const, pattern, minLength, maxLength, minimum, maximum, minItems, format(date-time).
export function validateSchema(value, schema, path = '$', errors = []) {
  if (schema === true) return errors;
  if (schema === false) { errors.push({ path, message: 'schema false' }); return errors; }
  if (schema.const !== undefined) {
    if (JSON.stringify(value) !== JSON.stringify(schema.const)) errors.push({ path, message: `expected const ${JSON.stringify(schema.const)}` });
  }
  if (schema.enum !== undefined) {
    if (!schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value))) errors.push({ path, message: `not in enum ${JSON.stringify(schema.enum)}` });
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const ok = types.some((t) => matchesType(value, t));
    if (!ok) errors.push({ path, message: `expected type ${types.join('|')}, got ${value === null ? 'null' : typeof value}` });
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push({ path, message: `minLength ${schema.minLength}` });
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push({ path, message: `maxLength ${schema.maxLength}` });
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) errors.push({ path, message: `pattern ${schema.pattern}` });
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) errors.push({ path, message: `invalid date-time ${value}` });
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push({ path, message: `minimum ${schema.minimum}` });
    if (schema.maximum !== undefined && value > schema.maximum) errors.push({ path, message: `maximum ${schema.maximum}` });
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push({ path, message: `minItems ${schema.minItems}` });
    if (schema.items !== undefined) value.forEach((item, i) => validateSchema(item, schema.items, `${path}[${i}]`, errors));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    if (schema.properties !== undefined) {
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (key in value) validateSchema(value[key], sub, `${path}.${key}`, errors);
      }
    }
    if (schema.required !== undefined) {
      for (const key of schema.required) if (!(key in value)) errors.push({ path, message: `missing required "${key}"` });
    }
    if (schema.additionalProperties === false && schema.properties !== undefined) {
      for (const key of Object.keys(value)) if (!(key in schema.properties)) errors.push({ path: `${path}.${key}`, message: 'additional property not allowed' });
    }
  }
  return errors;
}

function matchesType(value, t) {
  if (t === 'null') return value === null;
  if (t === 'array') return Array.isArray(value);
  if (t === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (t === 'number') return typeof value === 'number';
  if (t === 'string') return typeof value === 'string';
  if (t === 'boolean') return typeof value === 'boolean';
  if (t === 'integer') return Number.isInteger(value);
  return true;
}

export function validateAll(samples, schema) {
  const errors = [];
  samples.forEach((sample, i) => {
    if (sample === null || typeof sample !== 'object') { errors.push({ path: `line ${i + 1}`, message: 'not an object' }); return; }
    validateSchema(sample, schema, `#${sample.sample_id || i}`, errors);
  });
  return errors;
}