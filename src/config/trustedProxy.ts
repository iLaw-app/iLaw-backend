import { BlockList, isIP } from 'net';

const trustedProxyRanges = new BlockList();
trustedProxyRanges.addSubnet('127.0.0.0', 8, 'ipv4');
trustedProxyRanges.addSubnet('10.0.0.0', 8, 'ipv4');
trustedProxyRanges.addSubnet('172.16.0.0', 12, 'ipv4');
trustedProxyRanges.addSubnet('192.168.0.0', 16, 'ipv4');
trustedProxyRanges.addSubnet('169.254.0.0', 16, 'ipv4');
trustedProxyRanges.addAddress('::1', 'ipv6');
trustedProxyRanges.addSubnet('fe80::', 10, 'ipv6');
trustedProxyRanges.addSubnet('fc00::', 7, 'ipv6');

export function isTrustedProxyAddress(rawAddress: string): boolean {
  const address = rawAddress.split('%', 1)[0].toLowerCase();
  const mappedIpv4 = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (mappedIpv4) return isTrustedProxyAddress(mappedIpv4);

  const version = isIP(address);
  if (version === 4) return trustedProxyRanges.check(address, 'ipv4');
  if (version === 6) return trustedProxyRanges.check(address, 'ipv6');
  return false;
}

/**
 * Railway is expected to connect its public edge to this service through a
 * private, link-local, or loopback peer. Only those socket peers may supply XFF;
 * a public direct connection therefore cannot rotate req.ip with spoofed XFF.
 *
 * Private-network callers are trusted to supply forwarding metadata by this
 * deployment boundary. They could spoof a client IP if independently exposed or
 * compromised, so private service access must remain restricted; this setting is
 * not an authentication control between internal services.
 */
export const trustedProxy = (address: string): boolean => isTrustedProxyAddress(address);