/**
 * The one local stamp every byline in the app uses — note cards and the
 * conversation panel alike (APP-48): "Aug 22, 8:23 AM".
 */
export function stampLabel(time: number | string): string | undefined {
  const ms = typeof time === 'number' ? time : Date.parse(time)
  if (Number.isNaN(ms)) return undefined
  return new Date(ms).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}
