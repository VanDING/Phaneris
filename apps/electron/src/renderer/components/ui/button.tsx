/**
 * The renderer's Button is the shared one.
 *
 * It used to be a second definition of the same `cva` config, which meant the
 * product had two buttons that happened to look alike: a change to one (a focus
 * ring, a disabled treatment, a new size) had to be remembered in the other. The
 * atom now lives in `@phaneris/ui` and is consumed identically by the Electron
 * renderer, the web client and the viewer.
 *
 * Re-exported rather than imported everywhere so the ~90 existing call sites keep
 * their `@/components/ui/button` path and this stays a one-line move.
 */
export { Button, buttonVariants, type ButtonProps } from '@phaneris/ui'
