import { navigate, routes } from './navigate';

export const AI_SETTINGS_FOCUS_KEY = 'phaneris.ai-settings.focus';
export const AI_SETTINGS_FOCUS_EVENT = 'phaneris:ai-settings-focus';

/** Retain the target across route mounting, and support the page already being open. */
export function openDecisionModelSettings() {
  sessionStorage.setItem(AI_SETTINGS_FOCUS_KEY, 'decisions');
  window.dispatchEvent(new Event(AI_SETTINGS_FOCUS_EVENT));
  navigate(routes.view.settings('ai'));
}
