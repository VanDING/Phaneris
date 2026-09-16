import { motion } from 'motion/react'
import { MOTION_DURATION, MOTION_EASE } from '@phaneris/ui/motion'
import { PhanerisSymbol } from './icons/PhanerisSymbol'

interface SplashScreenProps {
  isExiting: boolean
  onExitComplete?: () => void
}

/**
 * SplashScreen - Shows the Phaneris mark during app initialization
 *
 * The mark traces itself in (outline, then fill) via the shared `.logo-mark`
 * entrance in index.css. The splash is the app's first impression, so it runs
 * that entrance slower than the empty-session landing does — see the
 * --logo-draw-duration / --logo-ink-delay overrides below.
 *
 * On exit, the mark lifts subtly while the background fades away.
 */
export function SplashScreen({ isExiting, onExitComplete }: SplashScreenProps) {
  return (
    <motion.div
      className="fixed inset-0 z-splash flex items-center justify-center bg-background"
      initial={{ opacity: 1 }}
      animate={{ opacity: isExiting ? 0 : 1 }}
      transition={{ duration: MOTION_DURATION.emphasis, ease: MOTION_EASE.exit }}
      onAnimationComplete={() => {
        if (isExiting && onExitComplete) {
          onExitComplete()
        }
      }}
    >
      <motion.div
        initial={{ scale: 1.5, opacity: 1 }}
        animate={{
          scale: isExiting ? 1.65 : 1.5,
          opacity: isExiting ? 0 : 1
        }}
        transition={{
          duration: MOTION_DURATION.standard,
          ease: MOTION_EASE.enter,
        }}
      >
        {/*
          h-20 = 80px wide (≈119px tall) at the default rem. Sized in rem so it
          scales with the theme, and deliberately well clear of the 32px the splash
          used before — at that size the tracing entrance was barely legible.
          Themed, not brand-fixed: a splash that stays purple under a graphite or
          amber theme is the first thing the user sees and the most jarring.
        */}
        <PhanerisSymbol
          tone="accent"
          className="logo-mark logo-relief h-20 text-accent"
          style={{
            '--logo-draw-duration': '1200ms',
            '--logo-ink-delay': '700ms',
            '--logo-ink-duration': '900ms',
          } as React.CSSProperties}
        />
      </motion.div>
    </motion.div>
  )
}
