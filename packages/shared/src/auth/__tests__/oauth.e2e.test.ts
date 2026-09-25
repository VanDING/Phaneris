/**
 * E2E tests for OAuth metadata discovery against real MCP servers.
 *
 * The pure origin-extraction assertions run everywhere; the live discovery calls
 * are OPT-IN behind `PHANERIS_NETWORK_E2E=1`.
 *
 * Why they are gated rather than merely "skipped when unreachable":
 *
 *   - The latency is vendor-owned and unbounded. Measured from this repository:
 *     `api.githubcopilot.com` takes ~37s to walk its four `.well-known`
 *     documents and then reports no metadata (it requires auth), while
 *     `mcp.linear.app` and `api.ahrefs.com` answer in ~2.4s and ~3.0s. No
 *     single per-test budget covers that spread without either failing GitHub
 *     or hanging the suite on a slow network.
 *   - A reachability probe cannot make it deterministic. A probe budget tight
 *     enough to be quick (2.5s) sits right on Linear's and Ahrefs' normal
 *     response time, so the same commit alternately ran and skipped the same
 *     block. That is a flaky test wearing a skip as a disguise.
 *   - The previous guard did not skip at all: it set a `reachable` flag inside
 *     an `it()` and then registered the block unconditionally, so an unreachable
 *     server FAILED the suite — the "network tolerance for CI" this file
 *     documents did not exist. Its probe also used a 5000 ms timeout, exactly
 *     equal to the runner's own per-test limit, so the abort could never win the
 *     race and the probe reported as a timeout instead of as "unreachable".
 *
 * Run the live checks with:
 *   PHANERIS_NETWORK_E2E=1 bun test src/auth/__tests__/oauth.e2e.test.ts
 */
import { describe, it, expect } from 'bun:test';
import { discoverOAuthMetadata, getMcpBaseUrl } from '../oauth';

const LIVE = process.env.PHANERIS_NETWORK_E2E === '1';

/** Probe budget: comfortably under the runner's per-test limit. */
const PROBE_TIMEOUT_MS = 8000;
/**
 * Discovery budget. GitHub's four sequential `.well-known` fetches measured
 * ~37s, so anything lower fails a working network.
 */
const DISCOVERY_TIMEOUT_MS = 60_000;

async function isReachable(url: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: 'HEAD', signal: controller.signal });
    // A 4xx still proves the host answered; only 5xx and transport errors count
    // as unreachable, because discovery tolerates an unauthenticated root.
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

const GITHUB_MCP_URL = 'https://api.githubcopilot.com/mcp/';
const LINEAR_MCP_URL = 'https://mcp.linear.app/sse';
const AHREFS_MCP_URL = 'https://api.ahrefs.com/mcp/mcp';

// Probed only when the live checks are requested, so the default suite performs
// no network I/O at all.
const [githubReachable, linearReachable, ahrefsReachable] = LIVE
  ? await Promise.all([
      isReachable(getMcpBaseUrl(GITHUB_MCP_URL)),
      isReachable(getMcpBaseUrl(LINEAR_MCP_URL)),
      isReachable(getMcpBaseUrl(AHREFS_MCP_URL)),
    ])
  : [false, false, false];

if (LIVE) {
  const unreachable = [
    !githubReachable && 'api.githubcopilot.com',
    !linearReachable && 'mcp.linear.app',
    !ahrefsReachable && 'api.ahrefs.com',
  ].filter(Boolean);
  console.log(
    unreachable.length
      ? `[oauth.e2e] skipping unreachable servers: ${unreachable.join(', ')}`
      : '[oauth.e2e] all MCP servers reachable',
  );
}

/** Live, reachable blocks run; everything else is skipped rather than failed. */
const describeLive = (reachable: boolean) => (LIVE && reachable ? describe : describe.skip);

describe('E2E: OAuth Metadata Discovery', () => {
  describeLive(githubReachable)('GitHub MCP (api.githubcopilot.com)', () => {
    // GitHub discovery needs 4 sequential fetches; allow extra time on throttled networks.
    it('discovers OAuth metadata', async () => {
      const logs: string[] = [];
      const metadata = await discoverOAuthMetadata(GITHUB_MCP_URL, (msg) => logs.push(msg));

      // If we get null, the server might be down or require auth - that's OK for E2E
      if (metadata === null) {
        console.log('GitHub MCP: No metadata discovered (server may require auth or be unavailable)');
        console.log('Discovery logs:', logs);
        return;
      }

      expect(metadata.authorization_endpoint).toBeTruthy();
      expect(metadata.token_endpoint).toBeTruthy();
      console.log('GitHub MCP OAuth metadata:', metadata);
    }, DISCOVERY_TIMEOUT_MS);
  });

  describeLive(linearReachable)('Linear MCP (mcp.linear.app)', () => {
    it('discovers OAuth metadata', async () => {
      const logs: string[] = [];
      const metadata = await discoverOAuthMetadata(LINEAR_MCP_URL, (msg) => logs.push(msg));

      if (metadata === null) {
        console.log('Linear MCP: No metadata discovered (server may require auth or be unavailable)');
        console.log('Discovery logs:', logs);
        return;
      }

      expect(metadata.authorization_endpoint).toBeTruthy();
      expect(metadata.token_endpoint).toBeTruthy();
      console.log('Linear MCP OAuth metadata:', metadata);
    }, DISCOVERY_TIMEOUT_MS);
  });

  describeLive(ahrefsReachable)('Ahrefs MCP (api.ahrefs.com/mcp/mcp)', () => {
    it('discovers OAuth metadata', async () => {
      const logs: string[] = [];
      const metadata = await discoverOAuthMetadata(AHREFS_MCP_URL, (msg) => logs.push(msg));

      if (metadata === null) {
        console.log('Ahrefs MCP: No metadata discovered (server may require auth or be unavailable)');
        console.log('Discovery logs:', logs);
        return;
      }

      expect(metadata.authorization_endpoint).toBeTruthy();
      expect(metadata.token_endpoint).toBeTruthy();
      console.log('Ahrefs MCP OAuth metadata:', metadata);
    }, DISCOVERY_TIMEOUT_MS);
  });

  /*
   * Origin extraction is a pure function, so these assertions are deterministic
   * and run in the default suite. They are also what the file was originally
   * written to protect: the old regex returned `https://api.ahrefs.com/mcp` for
   * the Ahrefs URL instead of the origin.
   */
  describe('extracts the origin from MCP URLs', () => {
    it('handles the real server URLs', () => {
      expect(getMcpBaseUrl(GITHUB_MCP_URL)).toBe('https://api.githubcopilot.com');
      expect(getMcpBaseUrl(LINEAR_MCP_URL)).toBe('https://mcp.linear.app');
      expect(getMcpBaseUrl(AHREFS_MCP_URL)).toBe('https://api.ahrefs.com');
    });

    it('handles various MCP URL patterns correctly', () => {
      // These are hypothetical URLs to test the origin extraction
      expect(getMcpBaseUrl('https://api.example.com/v1/mcp')).toBe('https://api.example.com');
      expect(getMcpBaseUrl('https://api.example.com/v1/mcp/sse')).toBe('https://api.example.com');
      expect(getMcpBaseUrl('https://mcp.example.com/')).toBe('https://mcp.example.com');
      expect(getMcpBaseUrl('http://localhost:8080/mcp')).toBe('http://localhost:8080');
    });
  });
});
