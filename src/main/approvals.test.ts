import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleFor } from './approvals';

test('ruleFor: the web tools run by default, everything else asks', () => {
  assert.equal(ruleFor('WebSearch', {}), 'allow');
  assert.equal(ruleFor('WebFetch', {}), 'allow');
  assert.equal(ruleFor('Bash', {}), 'ask');
  assert.equal(ruleFor('mcp__github__list_issues', {}), 'ask');
});
test('ruleFor: a rule for the exact tool wins over the default', () => {
  assert.equal(ruleFor('WebFetch', { WebFetch: 'ask' }), 'ask');
  assert.equal(ruleFor('WebSearch', { WebSearch: 'deny' }), 'deny');
  assert.equal(ruleFor('Bash', { Bash: 'allow' }), 'allow');
});
