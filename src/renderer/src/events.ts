/**
 * Application-level event channel names + payload types.
 * Published via IEventAggregator; subscribe in any component.
 */

import type { ToastModel } from '@syncfusion/ej2-notifications'

/** Generic show-toast event. Payload is a Syncfusion ToastModel. */
export const SHOW_TOAST_EVENT = 'app:show-toast'
export type ShowToastPayload = ToastModel
