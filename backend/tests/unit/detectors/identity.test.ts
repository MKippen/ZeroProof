import {
  createDetectorIdentity, detectorFingerprint, deviceIdentityKey, identityScopeKey,
  normalizeIp, normalizeMac, parseDetectorIdentity, scopedDeviceKey,
} from '../../../src/detectors/identity';

const input = {
  sourceKind: 'unifi' as const, connectionId: 'controller-1', scopeId: 'site-1',
  srcIp: '10.0.0.5', srcMac: 'AA-BB-CC-DD-EE-01', eventId: 'event-1', observedAt: '2026-05-07T12:00:00Z',
};

describe('detector identity', () => {
  it.each(['AA:BB:CC:DD:EE:01', 'aa-bb-cc-dd-ee-01', 'aabb.ccdd.ee01', 'AABBCCDDEE01'])('normalizes a valid MAC spelling: %s', (mac) => {
    expect(normalizeMac(mac)).toBe('aa:bb:cc:dd:ee:01');
  });

  it.each([null, '', 'phone', 'aa:bb:cc:dd:ee', 'aa:bb-cc:dd:ee:01', '00:00:00:00:00:00', 'ff:ff:ff:ff:ff:ff'])('rejects non-device MAC identity: %s', (mac) => {
    expect(normalizeMac(mac)).toBeNull();
  });

  it.each([
    ['2001:0DB8:0000:0:0:0:0:1', '2001:db8::1'],
    [' 2001:db8::1 ', '2001:db8::1'],
    ['::FFFF:192.0.2.1', '192.0.2.1'],
    ['::ffff:c000:201', '192.0.2.1'],
    ['192.0.2.1', '192.0.2.1'],
  ])('normalizes equivalent IP representations: %s', (address, expected) => {
    expect(normalizeIp(address)).toBe(expected);
  });

  it.each([null, '', 'device-name', '192.168.001.2', '10.0.0.1:443', '2001:db8:::1', 'fe80::1%eth0'])('rejects ambiguous or invalid IP identity: %s', (address) => {
    expect(normalizeIp(address)).toBeNull();
  });

  it('round-trips typed metadata with normalized machine identity and observed time', () => {
    const identity = createDetectorIdentity(input);
    expect(identity).toEqual({ ...input, version: 2, srcMac: 'aa:bb:cc:dd:ee:01', observedAt: '2026-05-07T12:00:00.000Z' });
    expect(parseDetectorIdentity(JSON.parse(JSON.stringify(identity)))).toEqual(identity);
  });

  it.each([
    null, {}, { affectedResource: 'phone', srcMac: 'aa:bb:cc:dd:ee:01' },
    { ...input, version: 1 }, { ...input, version: 2, sourceKind: 'unknown' },
    { ...input, version: 2, observedAt: 'not-a-date' }, { ...input, version: 2, srcIp: 'phone' },
    { ...input, version: 2, eventId: '' },
  ])('rejects legacy, incomplete, or malformed correlation metadata: %s', (value) => {
    expect(parseDetectorIdentity(value)).toBeNull();
  });

  it('uses immutable scope plus normalized MAC despite address, label, or event-time changes', () => {
    const first = createDetectorIdentity(input);
    const next = createDetectorIdentity({ ...input, srcMac: 'aa:bb:cc:dd:ee:01', srcIp: '10.0.0.9', eventId: 'event-2', observedAt: '2026-05-07T12:01:00Z' });
    expect(scopedDeviceKey(first)).toBe(scopedDeviceKey(next));
    expect(detectorFingerprint('ioc_match', first, 'ip:203.0.113.5')).toBe(detectorFingerprint('ioc_match', next, 'ip:203.0.113.5'));
    expect(detectorFingerprint('ioc_match', first, 'ip:203.0.113.5')).toMatch(/^ioc_match:v2:[a-f0-9]{64}$/);
  });

  it.each([
    { sourceKind: 'adguard' as const }, { connectionId: 'controller-2' }, { scopeId: 'site-2' }, { srcMac: 'aa:bb:cc:dd:ee:02' },
  ])('separates different machine provenance: %s', (change) => {
    const first = createDetectorIdentity(input);
    const other = createDetectorIdentity({ ...input, ...change });
    expect(scopedDeviceKey(first)).not.toBe(scopedDeviceKey(other));
  });

  it('uses IP only when no MAC is available, and event IDs when no device or immutable scope exists', () => {
    const ipOnly = createDetectorIdentity({ ...input, srcMac: null });
    expect(deviceIdentityKey(ipOnly)).toBe('ip:10.0.0.5');
    const missing = createDetectorIdentity({ ...input, srcIp: null, srcMac: null });
    expect(deviceIdentityKey(missing)).toBe('event:event-1');
    expect(scopedDeviceKey(missing)).not.toBe(scopedDeviceKey({ ...missing, eventId: 'event-2' }));
    const legacy = createDetectorIdentity({ ...input, scopeId: null });
    expect(identityScopeKey(legacy)).not.toBe(identityScopeKey({ ...legacy, eventId: 'event-2' }));
  });

  it('keeps DNS correlation within its own connection without implying a UniFi binding', () => {
    const dns = createDetectorIdentity({ ...input, sourceKind: 'adguard', scopeId: null, srcMac: null });
    expect(scopedDeviceKey(dns)).toBe(scopedDeviceKey({ ...dns, eventId: 'other-query' }));
    expect(identityScopeKey(dns)).not.toBe(identityScopeKey({ ...dns, sourceKind: 'unifi' }));
  });

  it('avoids delimiter collisions in scoped keys and isolates different indicators', () => {
    const first = createDetectorIdentity({ ...input, connectionId: 'a:b', scopeId: 'c' });
    const other = createDetectorIdentity({ ...input, connectionId: 'a', scopeId: 'b:c' });
    expect(identityScopeKey(first)).not.toBe(identityScopeKey(other));
    expect(detectorFingerprint('ioc_match', first, 'one')).not.toBe(detectorFingerprint('ioc_match', first, 'two'));
  });

  it('requires an event ID even when the device is unidentified', () => {
    expect(() => createDetectorIdentity({ ...input, eventId: '' })).toThrow('requires an event ID');
  });
});
