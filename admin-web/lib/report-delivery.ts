export type DeliveryChannel = 'email' | 'whatsapp'

export type DeliveryResult = {
  sent: boolean
  provider?: string
  messageId?: string
  id?: string
  reason?: string
  error?: unknown
}

export type ReportDeliveryResponse = Partial<Record<DeliveryChannel, DeliveryResult>>

export type DeliveryNotice = {
  channel: DeliveryChannel
  sent: boolean
  message: string
}

const channelLabels: Record<DeliveryChannel, string> = {
  email: 'البريد الإلكتروني',
  whatsapp: 'واتساب',
}

function errorText(error: unknown) {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    const candidate = error as { message?: unknown; error?: { message?: unknown } }
    if (typeof candidate.message === 'string') return candidate.message
    if (typeof candidate.error?.message === 'string') return candidate.error.message
  }
  return ''
}

export function deliveryNotices(
  requestedChannels: DeliveryChannel[],
  response: ReportDeliveryResponse,
): DeliveryNotice[] {
  return requestedChannels.map((channel) => {
    const result = response[channel]
    if (result?.sent) {
      return {
        channel,
        sent: true,
        message: `تم إرسال التقرير عبر ${channelLabels[channel]} بنجاح.`,
      }
    }

    const detail = result?.reason || errorText(result?.error)
    return {
      channel,
      sent: false,
      message: `لم يتم إرسال التقرير عبر ${channelLabels[channel]}${detail ? `: ${detail}` : '.'}`,
    }
  })
}
