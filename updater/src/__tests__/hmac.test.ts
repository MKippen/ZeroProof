import crypto from 'node:crypto';
import { isValidTargetRef, verifyHmac } from '../index';

describe('verifyHmac', () => {
  const secret = 'test-secret-do-not-use-in-prod';

  function sign(body: string): string {
    return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  }

  it('accepts a valid signature', () => {
    const body = '{"target":"v1.1.5"}';
    expect(verifyHmac(body, sign(body), secret)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const body = '{"target":"v1.1.5"}';
    const sig = sign(body);
    expect(verifyHmac(body + ' ', sig, secret)).toBe(false);
  });

  it('rejects an empty signature', () => {
    expect(verifyHmac('{}', '', secret)).toBe(false);
  });

  it('rejects a signature signed with a different secret', () => {
    const body = '{"op":"rollback"}';
    const wrongSig = crypto
      .createHmac('sha256', 'different-secret')
      .update(body, 'utf8')
      .digest('hex');
    expect(verifyHmac(body, wrongSig, secret)).toBe(false);
  });

  it('rejects a malformed (different-length) signature', () => {
    expect(verifyHmac('{}', 'abc', secret)).toBe(false);
  });

  it('rejects an empty secret', () => {
    expect(verifyHmac('{}', sign('{}'), '')).toBe(false);
  });
});

describe('isValidTargetRef', () => {
  it.each(['v1.2.3', 'v1.2.3-beta.10', 'release/v1.2.3', 'origin/main', 'abc123'])(
    'accepts %s',
    (target) => {
      expect(isValidTargetRef(target)).toBe(true);
    }
  );

  it.each(['', '-main', 'feature/thing;', 'feature//thing', 'v1..2', 'main@{1}', 'main.', 'main/'])(
    'rejects %s',
    (target) => {
      expect(isValidTargetRef(target)).toBe(false);
    }
  );
});
