namespace Nostos.Shared.Dtos;

// What Settings needs in order to describe e-reader access (issue #187):
// whether the catalogue is served at all, the URL a reader should be given,
// where that URL came from, and whether it can only be reached from this
// machine. Reported even when the catalogue is switched off — "turned off" has
// to be distinguishable from "broken".
public record OpdsInfoDto(
    bool Enabled,
    // Null when the catalogue is disabled: no URL can work.
    string? CatalogUrl,
    // "configured" when Opds:PublicBaseUrl decided the origin, "request" when it
    // was derived from the request the client made.
    string UrlSource,
    // True when the effective origin is a loopback address (localhost, 127.x,
    // ::1): the URL is real but no other device can reach it.
    bool LocalOnly
);
