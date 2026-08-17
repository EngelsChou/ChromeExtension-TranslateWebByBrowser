export const CHATGPT_WAKE_DELAY_MS = 8_000;
export const M365_WAKE_DELAY_MS = 750;

export function providerWakeDelayMs(providerId) {
  return providerId === 'm365' ? M365_WAKE_DELAY_MS : CHATGPT_WAKE_DELAY_MS;
}
