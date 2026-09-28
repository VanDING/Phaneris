/**
 * Centralized branding assets for Phaneris
 * Used by OAuth callback pages
 */

import { PRODUCT_NAME, SERVICE_URLS } from './identity.generated.ts';

export const PHANERIS_LOGO = [PRODUCT_NAME] as const;

/** Logo as a single string for HTML templates */
export const PHANERIS_LOGO_HTML = PHANERIS_LOGO.map((line) => line.trimEnd()).join('\n');

/** Session viewer base URL */
export const VIEWER_URL: string | null = SERVICE_URLS.viewer;
