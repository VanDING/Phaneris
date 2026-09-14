import phanerisLogo from "@/assets/phaneris_logo.svg"

interface PhanerisAppIconProps {
  className?: string
  size?: number
}

/**
 * PhanerisAppIcon — displays the Phaneris app mark.
 *
 * The artwork comes from `apps/electron/resources/icon.svg`, the single source
 * of truth for the brand mark; every platform icon and brand raster is
 * generated from it by `bun run scripts/generate-icons.ts`.
 */
export function PhanerisAppIcon({ className, size = 64 }: PhanerisAppIconProps) {
  return (
    <img
      src={phanerisLogo}
      alt="Phaneris"
      width={size}
      height={size}
      className={className}
    />
  )
}
