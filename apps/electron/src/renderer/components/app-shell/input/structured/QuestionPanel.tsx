import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { MessageCircleQuestion, Check, ChevronLeft, ChevronRight, X, Pencil } from 'lucide-react'
import { Markdown } from '@phaneris/ui'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type {
  AskUserRequest,
  AskUserQuestion,
  AskUserAnswerItem,
} from '../../../../../shared/types'
import type { QuestionResponse } from './types'

interface QuestionPanelProps {
  request: AskUserRequest
  onResponse: (response: QuestionResponse) => void
  /** When true, removes container styling (shadow, rounded) - used when wrapped by InputContainer */
  unstyled?: boolean
}

/**
 * Recognise the conventional recommendation suffix without changing the answer
 * value: the label shown loses "(Recommended)", the label ECHOED keeps it
 * verbatim so the model receives exactly the option it offered.
 */
const RECOMMENDED_SUFFIX = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i

function splitRecommended(label: string): { text: string; recommended: boolean } {
  return RECOMMENDED_SUFFIX.test(label)
    ? { text: label.replace(RECOMMENDED_SUFFIX, ''), recommended: true }
    : { text: label, recommended: false }
}

/**
 * Narrow a request to the plan-review presentation.
 *
 * The card is one decision over one plan, and it claims a request only when it
 * can send every answer that request allows: exactly one question, carrying the
 * intent AND the plan as `detail`, offering the approve label the intent names,
 * and binary single-choice. Anything else falls back to the generic flow, so a
 * request is never left unanswerable.
 */
export function planReviewOf(
  questions: readonly AskUserQuestion[],
): { question: AskUserQuestion; approve: string; decline?: string } | undefined {
  if (questions.length !== 1) return undefined
  const question = questions[0] as AskUserQuestion
  const intent = question.intent
  if (intent?.kind !== 'plan-review' || !question.detail?.trim()) return undefined
  if (question.multiSelect === true) return undefined
  const options = question.options ?? []
  if (options.length > 2) return undefined
  if (!options.some(option => option.label === intent.approve)) return undefined
  const decline = options.find(option => option.label !== intent.approve)
  return {
    question,
    approve: intent.approve,
    ...(decline === undefined ? {} : { decline: decline.label }),
  }
}

/** One selectable option row: radio semantics for single-select, checkbox for multi. */
function OptionRow({
  label,
  description,
  index,
  selected,
  multiSelect,
  onSelect,
}: {
  label: string
  description?: string
  index: number
  selected: boolean
  multiSelect: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()
  const { text, recommended } = splitRecommended(label)

  return (
    <button
      type="button"
      role={multiSelect ? 'checkbox' : 'radio'}
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'w-full flex items-start gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors',
        selected
          ? 'border-info/60 bg-info/10'
          : 'border-foreground/10 hover:bg-foreground/5',
      )}
    >
      {multiSelect ? (
        <span
          className={cn(
            'mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded border',
            selected ? 'border-info bg-info text-background' : 'border-foreground/25',
          )}
        >
          {selected && <Check className="h-3 w-3" />}
        </span>
      ) : (
        <span
          className={cn(
            'mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium',
            selected ? 'border-info bg-info text-background' : 'border-foreground/25 text-muted-foreground',
          )}
        >
          {index + 1}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-foreground">{text}</span>
          {recommended && (
            <span className="rounded-sm bg-info/15 px-1.5 py-px text-[10px] font-medium text-info">
              {t('chat.question.recommended')}
            </span>
          )}
        </span>
        {description && (
          <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{description}</span>
        )}
      </span>
    </button>
  )
}

/**
 * QuestionPanel - structured input for an ask_user question.
 *
 * Renders one question at a time; the answers accumulate and are submitted as a
 * single batch, so a multi-question request is answered in one round trip.
 *
 * Two presentations, one request: a question carrying the `plan-review` intent
 * becomes a decision card over its `detail` (the plan), and every other question
 * takes the generic option/free-text flow. The answer encoding is identical.
 */
export function QuestionPanel({ request, onResponse, unstyled = false }: QuestionPanelProps) {
  const { t } = useTranslation()
  const questions = request.questions
  const review = React.useMemo(() => planReviewOf(questions), [questions])

  const [index, setIndex] = React.useState(0)
  const [answers, setAnswers] = React.useState<Record<string, AskUserAnswerItem>>({})
  const [customDrafts, setCustomDrafts] = React.useState<Record<string, string>>({})
  const [showError, setShowError] = React.useState(false)

  const question = questions[index] as AskUserQuestion | undefined
  const isLast = index >= questions.length - 1
  const total = questions.length

  const answerFor = React.useCallback(
    (id: string): AskUserAnswerItem => answers[id] ?? { id, selected: [] },
    [answers],
  )

  const patchAnswer = React.useCallback((id: string, next: AskUserAnswerItem) => {
    setAnswers(prev => ({ ...prev, [id]: next }))
    setShowError(false)
  }, [])

  const selectOption = React.useCallback((q: AskUserQuestion, label: string) => {
    const current = answerFor(q.id)
    if (q.multiSelect) {
      const selected = current.selected.includes(label)
        ? current.selected.filter(entry => entry !== label)
        : [...current.selected, label]
      patchAnswer(q.id, { ...current, selected })
      return
    }
    // Single-select: a chosen option replaces any free-text answer.
    patchAnswer(q.id, { id: q.id, selected: [label] })
    setCustomDrafts(prev => ({ ...prev, [q.id]: '' }))
  }, [answerFor, patchAnswer])

  const setCustom = React.useCallback((q: AskUserQuestion, text: string) => {
    setCustomDrafts(prev => ({ ...prev, [q.id]: text }))
    const current = answerFor(q.id)
    patchAnswer(q.id, q.multiSelect
      // Multi-select: free text supplements the labels.
      ? { ...current, custom: text }
      // Single-select: free text overrides the choice.
      : { id: q.id, selected: [], custom: text })
  }, [answerFor, patchAnswer])

  const isAnswered = React.useCallback((q: AskUserQuestion): boolean => {
    const answer = answers[q.id]
    if (!answer) return false
    return answer.selected.length > 0 || !!answer.custom?.trim()
  }, [answers])

  const handleSkip = React.useCallback((q: AskUserQuestion) => {
    patchAnswer(q.id, { id: q.id, selected: [] })
    setCustomDrafts(prev => ({ ...prev, [q.id]: '' }))
    if (!isLast) setIndex(prev => prev + 1)
  }, [isLast, patchAnswer])

  const submit = React.useCallback(() => {
    const payload: AskUserAnswerItem[] = questions.map(q => {
      const answer = answerFor(q.id)
      const custom = answer.custom?.trim()
      return {
        id: q.id,
        selected: [...answer.selected],
        ...(custom ? { custom } : {}),
      }
    })
    onResponse({ type: 'question', answers: payload, cancelled: false })
  }, [answerFor, onResponse, questions])

  const handleContinue = React.useCallback(() => {
    if (!question) return
    if (!isAnswered(question)) {
      setShowError(true)
      return
    }
    if (isLast) submit()
    else setIndex(prev => prev + 1)
  }, [isAnswered, isLast, question, submit])

  const handleDismiss = React.useCallback(() => {
    onResponse({ type: 'question', answers: [], cancelled: true })
  }, [onResponse])

  // ---- plan-review presentation -------------------------------------------------
  // DORMANT: reachable only when a host-side producer sets
  // `intent: { kind: 'plan-review', approve }`. `ask_user` does not expose
  // `intent` to the model, so no shipped call reaches this branch today; it
  // exists so the presentation is ready and tested if one ever does. This is
  // NOT a replacement for `SubmitPlan` — see AskUserQuestionIntent in @phaneris/core.
  if (review) {
    const { question: q, approve, decline } = review
    return (
      <div
        className={cn(
          'overflow-hidden h-full flex flex-col bg-info/5',
          unstyled ? 'border-0' : 'border border-info/30 rounded-[8px] shadow-middle',
        )}
      >
        <div className="flex items-center gap-1.5 px-4 pt-3 text-xs font-medium text-info">
          <MessageCircleQuestion className="h-3.5 w-3.5" />
          <span>{q.header || t('chat.question.planReview')}</span>
        </div>

        <div className="p-4 pt-2 flex-1 min-h-0 overflow-y-auto">
          <p className="sr-only">{q.question}</p>
          {q.detail && <Markdown mode="minimal">{q.detail}</Markdown>}
        </div>

        <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-t border-border/50">
          <Button size="sm" className="h-7 gap-1.5" onClick={() => onResponse({
            type: 'question',
            answers: [{ id: q.id, selected: [approve] }],
            cancelled: false,
          })}>
            <Check className="h-3.5 w-3.5" />
            {t('chat.question.approve')}
          </Button>
          {decline && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5"
              onClick={() => onResponse({
                type: 'question',
                answers: [{ id: q.id, selected: [decline] }],
                cancelled: false,
              })}
            >
              <X className="h-3.5 w-3.5" />
              {t('chat.question.refuse')}
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7" onClick={handleDismiss}>
            {t('chat.question.discuss')}
          </Button>
        </div>
      </div>
    )
  }

  // ---- generic flow -------------------------------------------------------------
  if (!question) return null

  const hasOptions = (question.options?.length ?? 0) > 0
  const answer = answerFor(question.id)
  const customDraft = customDrafts[question.id] ?? answer.custom ?? ''
  const showCustomField = hasOptions

  return (
    <div
      className={cn(
        'overflow-hidden h-full flex flex-col bg-info/5',
        unstyled ? 'border-0' : 'border border-info/30 rounded-[8px] shadow-middle',
      )}
    >
      <div className="p-4 space-y-3 flex-1 min-h-0 flex flex-col overflow-y-auto">
        <div className="space-y-2 pb-1">
          <div className="flex items-start gap-1.5">
            <MessageCircleQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
            <div className="min-w-0 flex-1">
              {question.header && (
                <div className="text-[10px] font-medium uppercase tracking-wide text-info">
                  {question.header}
                </div>
              )}
              <div className="text-sm font-medium text-foreground">{question.question}</div>
            </div>
            {total > 1 && (
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {index + 1} / {total}
              </span>
            )}
          </div>

          {question.detail && (
            <div className="rounded-md bg-foreground/5 p-3 text-xs leading-[18px]">
              <Markdown mode="minimal">{question.detail}</Markdown>
            </div>
          )}
        </div>

        {(hasOptions || !showCustomField) && (
          <div
            role={question.multiSelect ? 'group' : 'radiogroup'}
            aria-label={question.question}
            className="space-y-1.5"
          >
            {(question.options ?? []).map((option, optionIndex) => (
              <OptionRow
                key={option.label}
                label={option.label}
                description={option.description}
                index={optionIndex}
                selected={answer.selected.includes(option.label)}
                multiSelect={question.multiSelect === true}
                onSelect={() => selectOption(question, option.label)}
              />
            ))}
          </div>
        )}

        {/* Free-text answer. With options it is an extra row; without options it IS the answer. */}
        <div className={cn('flex items-start gap-2.5', showCustomField && 'rounded-md border border-dashed border-foreground/15 px-2.5 py-2')}>
          {showCustomField && (
            <span
              className={cn(
                'mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                !question.multiSelect && answer.custom
                  ? 'border-info bg-info text-background'
                  : 'border-foreground/25',
              )}
            >
              {!question.multiSelect && answer.custom
                ? <Check className="h-3 w-3" />
                : <Pencil className="h-2.5 w-2.5 text-muted-foreground" />}
            </span>
          )}
          <textarea
            autoFocus={!hasOptions}
            value={customDraft}
            rows={hasOptions ? 1 : 2}
            placeholder={hasOptions ? t('chat.question.otherPlaceholder') : t('chat.question.answerPlaceholder')}
            onChange={(event) => setCustom(question, event.target.value)}
            onKeyDown={(event) => {
              // Enter continues, Shift+Enter inserts a newline. IME composition wins.
              if (event.key !== 'Enter' || event.shiftKey) return
              if (event.nativeEvent.isComposing) return
              event.preventDefault()
              handleContinue()
            }}
            className={cn(
              'min-w-0 flex-1 resize-none bg-transparent text-xs leading-[18px] text-foreground outline-none placeholder:text-muted-foreground',
              !hasOptions && 'rounded-md border border-foreground/15 px-2.5 py-2',
            )}
          />
        </div>

        {showError && (
          <div role="status" className="text-[11px] text-destructive">
            {t('chat.question.answerRequired')}
          </div>
        )}
      </div>

      <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-t border-border/50">
        {total > 1 && (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2"
              disabled={index === 0}
              onClick={() => setIndex(prev => Math.max(0, prev - 1))}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              {t('chat.question.previous')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2"
              disabled={isLast}
              onClick={() => setIndex(prev => Math.min(total - 1, prev + 1))}
            >
              {t('chat.question.next')}
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </>
        )}

        <Button size="sm" variant="ghost" className="h-7" onClick={() => handleSkip(question)}>
          {t('chat.question.skip')}
        </Button>
        <Button
          size="sm"
          className="h-7 gap-1.5"
          onClick={handleContinue}
        >
          <Check className="h-3.5 w-3.5" />
          {isLast ? t('chat.question.submit') : t('chat.question.next')}
        </Button>

        <span className="min-w-0 flex-1 basis-full text-[10px] text-muted-foreground sm:basis-auto sm:text-right">
          {t('chat.question.footerHint')}
        </span>
      </div>
    </div>
  )
}
