export interface SendWhatsAppParams {
  toPhone: string;
  templateName?: string;
  languageCode?: string;
  bodyText?: string;
  parameters?: string[];
}

export interface WhatsAppSendResult {
  messageId: string;
  status: 'SENT' | 'FAILED';
  error?: string;
}

export interface WhatsAppProvider {
  sendMessage(params: SendWhatsAppParams): Promise<WhatsAppSendResult>;
}

export class DevWhatsAppProvider implements WhatsAppProvider {
  async sendMessage(params: SendWhatsAppParams): Promise<WhatsAppSendResult> {
    const cleaned = params.toPhone.replace(/[^0-9]/g, '');
    if (cleaned.length < 10) {
      return {
        messageId: '',
        status: 'FAILED',
        error: 'Invalid recipient phone number',
      };
    }

    const messageId = `wamid.dev_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    return {
      messageId,
      status: 'SENT',
    };
  }
}

export class MetaCloudWhatsAppProvider implements WhatsAppProvider {
  constructor(
    private phoneNumberId: string,
    private accessToken: string,
  ) {}

  async sendMessage(params: SendWhatsAppParams): Promise<WhatsAppSendResult> {
    const cleanedPhone = params.toPhone.replace(/[^0-9]/g, '');
    const to = cleanedPhone.startsWith('91') && cleanedPhone.length === 12 ? cleanedPhone : `91${cleanedPhone.slice(-10)}`;

    try {
      const body: any = {
        messaging_product: 'whatsapp',
        to,
      };

      if (params.templateName) {
        body.type = 'template';
        body.template = {
          name: params.templateName,
          language: { code: params.languageCode || 'en_US' },
          components: params.parameters?.length
            ? [
                {
                  type: 'body',
                  parameters: params.parameters.map((p) => ({ type: 'text', text: p })),
                },
              ]
            : undefined,
        };
      } else {
        body.type = 'text';
        body.text = { body: params.bodyText || '' };
      }

      const res = await fetch(`https://graph.facebook.com/v21.0/${this.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.text();
        return { messageId: '', status: 'FAILED', error: `Meta WhatsApp API error: ${err}` };
      }

      const data = (await res.json()) as any;
      const msgId = data.messages?.[0]?.id || `wamid.${Date.now()}`;
      return { messageId: msgId, status: 'SENT' };
    } catch (e: any) {
      return { messageId: '', status: 'FAILED', error: e.message };
    }
  }
}

