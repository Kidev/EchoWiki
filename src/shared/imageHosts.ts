import devvitConfig from "../../devvit.json";

// Single source of truth for which remote image hosts can be proxied.
//
// Devvit's server-side `fetch` only reaches hosts declared in
// `permissions.http.domains` in devvit.json, so that list bounds what the image
// proxy (`/api/image-proxy`) can ever load. Deriving the allowlist from the same
// declaration keeps the server validator and the editor's link checker in sync
// with the platform config automatically: add a host in devvit.json and both
// follow. Hosts are compared case-insensitively.
export const ALLOWED_IMAGE_HOSTS: readonly string[] = (
  devvitConfig.permissions?.http?.domains ?? []
).map((d) => d.toLowerCase());

export function isAllowedImageHost(hostname: string): boolean {
  return ALLOWED_IMAGE_HOSTS.includes(hostname.toLowerCase());
}
