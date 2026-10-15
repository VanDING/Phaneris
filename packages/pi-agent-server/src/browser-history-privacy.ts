import type { SessionManager } from '@earendil-works/pi-coding-agent';
import { redactBrowserHistory } from '@phaneris/shared/utils/browser-input-privacy';

/** Filter the SDK journal copy while retaining exact live model/tool inputs. */
export function protectBrowserJournal(manager: SessionManager): SessionManager {
  const append = manager.appendMessage.bind(manager);
  manager.appendMessage = message => append(redactBrowserHistory(message));
  return manager;
}
