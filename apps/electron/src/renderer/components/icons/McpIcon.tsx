import type { SVGProps } from "react"

/**
 * MCP (Model Context Protocol) logo icon
 * Official logo from https://github.com/modelcontextprotocol/docs
 *
 * Authored in the logo's own 150×170 viewBox, so it opts out of the theme's
 * `svg[stroke="currentColor"]` rule with `data-brand-glyph`. Its authored
 * `strokeWidth=12` is 12 × 16/170 ≈ 1.13px at 16px — the same optical weight as
 * a Lucide icon (1.65 × 16/24 ≈ 1.1px). Under the theme rule the 1.65 user units
 * meant 1.65 × 16/170 ≈ 0.16px, which is why the mark looked disabled.
 */
export function McpIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="18 22 150 170"
      fill="none"
      stroke="currentColor"
      strokeWidth="12"
      strokeLinecap="round"
      data-brand-glyph=""
      {...props}
    >
      <path d="M25 97.8528L92.8823 29.9706C102.255 20.598 117.451 20.598 126.823 29.9706V29.9706C136.196 39.3431 136.196 54.5391 126.823 63.9117L75.5581 115.177" />
      <path d="M76.2653 114.47L126.823 63.9117C136.196 54.5391 151.392 54.5391 160.765 63.9117L161.118 64.2652C170.491 73.6378 170.491 88.8338 161.118 98.2063L99.7248 159.6C96.6006 162.724 96.6006 167.789 99.7248 170.913L112.331 183.52" />
      <path d="M109.853 46.9411L59.6482 97.1457C50.2757 106.518 50.2757 121.714 59.6482 131.087V131.087C69.0208 140.459 84.2168 140.459 93.5894 131.087L143.794 80.8822" />
    </svg>
  )
}
