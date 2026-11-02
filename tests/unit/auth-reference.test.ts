import { expect, it } from 'vitest';
import { fixtureEmail, identity } from '../auth-reference/helpers.js';

it('L1-14/R07 reference SQL/mail lookups accept generated fixture literals and reject SQL syntax, foreign mail and ambiguous addresses', () => {
  expect(fixtureEmail(identity('sql-boundary').email)).toMatch(/^reference-sql-boundary-/);
  for (const value of ["x' OR true--@example.test", 'x@example.test;DROP TABLE auth.users', 'x@other.test', 'X@example.test', 'x@example.test\n', 'x@example.test ', 'x y@example.test', 'x\\y@example.test', 'x@example.test@example.test']) {
    expect(() => fixtureEmail(value)).toThrow('Only generated fixture email');
  }
});
