/**
 * Resolved product identity for this process.
 *
 * `identity.generated.ts` carries the frozen identity from
 * `phaneris.identity.json`. This module is where a development-only override is
 * applied on top of it, so that every consumer — the Electron main process that
 * registers the protocol, the parser that validates it, the server that routes
 * it — gets the same answer from one place.
 *
 * Do not derive these forms anywhere else. Two copies of "the scheme plus a
 * colon" is exactly how a registrar and a parser drift apart, and the failure
 * mode (links that open the app but route nowhere) is silent.
 */

import { DEEPLINK_SCHEME } from './identity.generated.ts';

/**
 * Bare scheme, e.g. `phaneris`. `PHANERIS_DEEPLINK_SCHEME` overrides it so
 * several development instances can register different schemes
 * (`phaneris1://`, `phaneris2://`) without fighting over one protocol
 * registration. Never used to claim the upstream scheme.
 */
export const RESOLVED_DEEPLINK_SCHEME = process.env.PHANERIS_DEEPLINK_SCHEME || DEEPLINK_SCHEME;

/** Value to compare against `URL.protocol`, e.g. `phaneris:`. */
export const DEEPLINK_PROTOCOL = `${RESOLVED_DEEPLINK_SCHEME}:`;

/** Prefix for `startsWith` checks and for building links, e.g. `phaneris://`. */
export const DEEPLINK_SCHEME_PREFIX = `${RESOLVED_DEEPLINK_SCHEME}://`;
