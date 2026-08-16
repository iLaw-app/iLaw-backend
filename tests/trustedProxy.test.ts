import { describe, expect, it } from 'vitest';
import { isTrustedProxyAddress } from '../src/config/trustedProxy';

describe('isTrustedProxyAddress', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.7',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.10',
    '169.254.10.20',
    '::1',
    'fe80::1',
    'fc00::1',
    'fd12:3456:789a::1',
    '::ffff:10.0.0.7',
  ])('trusts private reverse-proxy peer %s', (address) => {
    expect(isTrustedProxyAddress(address)).toBe(true);
  });

  it.each(['203.0.113.20', '8.8.8.8', '2001:4860:4860::8888', 'not-an-ip'])(
    'rejects public or invalid direct socket peer %s so rotating XFF is ignored',
    (address) => {
      expect(isTrustedProxyAddress(address)).toBe(false);
    },
  );
});