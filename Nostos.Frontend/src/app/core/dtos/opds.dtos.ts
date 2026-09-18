/** E-reader access as the server reports it (`GET /api/opds/info`). */
export interface OpdsInfo {
  /** False when the server is not publishing a catalog at all (`Opds:Enabled=false`). */
  enabled: boolean;
  /** The address a reader should be given. Null when disabled — none can work. */
  catalogUrl: string | null;
  /** 'configured' when the server's `Opds:PublicBaseUrl` decided the address, 'request' when it was derived from how this page was opened. */
  urlSource: 'configured' | 'request';
  /** True when the address is a loopback one (localhost, 127.x, ::1), so no other device can reach it. */
  localOnly: boolean;
}
