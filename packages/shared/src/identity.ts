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
 *
 * `process` is absent in a browser context (the Electron renderer runs with
 * `nodeIntegration: false`, and the Playground is served to a plain browser),
 * and this module is re-exported from the shared index, so the override has to
 * be read defensively — the same guard `feature-flags.ts` documents for
 * `process.env`. Without it, importing anything that reaches the shared index
 * fails at module init with `process is not defined`.
 */
export const RESOLVED_DEEPLINK_SCHEME = (typeof process === 'undefined' ? undefined : process.env.PHANERIS_DEEPLINK_SCHEME) || DEEPLINK_SCHEME;

/** Value to compare against `URL.protocol`, e.g. `phaneris:`. */
export const DEEPLINK_PROTOCOL = `${RESOLVED_DEEPLINK_SCHEME}:`;

/** Prefix for `startsWith` checks and for building links, e.g. `phaneris://`. */
export const DEEPLINK_SCHEME_PREFIX = `${RESOLVED_DEEPLINK_SCHEME}://`;
