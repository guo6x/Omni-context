import test from 'node:test';
import assert from 'node:assert/strict';
import {validateValue} from './validate-json-document-schema.mjs';
test('authorization guard schema rejects invalid hashes',()=>{const errors=validateValue({type:'object',properties:{hash:{type:'string',pattern:'^[a-f0-9]{64}$'}}},{hash:'invalid'});assert.ok(errors.length>0);});
