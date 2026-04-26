/**
 * Extract a creation timestamp from a MongoDB ObjectId string.
 *
 * MongoDB ObjectIds are 24 hex characters. The first 8 hex chars (4 bytes)
 * encode the creation time as seconds since the Unix epoch.
 *
 * UniFi uses MongoDB internally, so every _id on config objects (networks,
 * WLANs, firewall rules, devices, etc.) encodes when that object was created.
 *
 * V2 API objects (firewall policies, traffic rules) sometimes have longer IDs
 * but the first 8 hex chars still encode the creation timestamp.
 */
export function objectIdToDate(objectId: string): Date | null {
  if (!objectId || objectId.length < 8) return null;

  // Only parse if first 8 chars are valid hex
  const hexPrefix = objectId.substring(0, 8);
  if (!/^[0-9a-fA-F]{8}$/.test(hexPrefix)) return null;

  const timestamp = parseInt(hexPrefix, 16);
  if (isNaN(timestamp) || timestamp <= 0) return null;

  const date = new Date(timestamp * 1000);

  // Sanity check: reject dates before 2010 or in the future
  const year = date.getFullYear();
  if (year < 2010 || year > new Date().getFullYear() + 1) return null;

  return date;
}
