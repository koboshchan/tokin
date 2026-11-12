import assert from 'node:assert';
import { acceptedId } from '../irys-id.js';
const id = 'a'.repeat(43);
assert.equal(acceptedId({ status: 200, data: { id } }), id);
assert.equal(acceptedId({ status: 200, data: { data: { id } } }), id);
assert.throws(() => acceptedId({ status: 200, data: { error: 'nope' } }));
assert.throws(() => acceptedId({ status: 402, data: { id } }));
assert.throws(() => acceptedId({ status: 200, data: 'x' }));
console.log('irys id tests pass');
