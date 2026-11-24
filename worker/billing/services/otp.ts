import type { Env } from '../types';
import { brandEmail, resolveBrand } from '@billing/shared';

export interface OtpSender {
  sendOtp(target: string, code: string, purpose: string): Promise<{ success: boolean; messageId?: string }>;
}

export class Msg91SmsSender implements OtpSender {
  constructor(private env: Env) {}

  async sendOtp(target: string, code: string, _purpose: string): Promise<{ success: boolean; messageId?: string }> {
    if (!this.env.MSG91_AUTH_KEY) {
      console.warn('[Msg91SmsSender] MSG91_AUTH_KEY not set. Using Dev fallback.');
      return new DevOtpSender(this.env).sendOtp(target, code, _purpose);
    }

    try {
      const formattedMobile = target.replace(/[^0-9]/g, '');
      const response = await fetch('https://control.msg91.com/api/v5/otp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authkey: this.env.MSG91_AUTH_KEY,
        },
        body: JSON.stringify({
          template_id: this.env.MSG91_DLT_TE_ID || 'default_otp_template',
          mobile: formattedMobile,
          otp: code,
          otp_expiry: 5, // 5 minutes
        }),
      });

      const data: any = await response.json();
      return { success: response.ok, messageId: data.message };
    } catch (err) {
      console.error('[Msg91SmsSender] Error sending SMS:', err);
      return { success: false };
    }
  }
}

export class ResendEmailSender implements OtpSender {
  constructor(private env: Env) {}

  async sendOtp(target: string, code: string, purpose: string): Promise<{ success: boolean; messageId?: string }> {
    if (!this.env.RESEND_API_KEY) {
      console.warn('[ResendEmailSender] RESEND_API_KEY not set. Using Dev fallback.');
      return new DevOtpSender(this.env).sendOtp(target, code, purpose);
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({
          from: `${resolveBrand({ productName: this.env.PRODUCT_NAME }).productName} Verification <${brandEmail('auth', resolveBrand({ baseDomain: this.env.APP_BASE_DOMAIN }).baseDomain)}>`,
          to: target,
          subject: `Your ${resolveBrand({ productName: this.env.PRODUCT_NAME }).productName} ${purpose} verification code is ${code}`,
          html: `
            <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
              <h2>GexGrow Verification Code</h2>
              <p>Your one-time verification code for ${purpose} is:</p>
              <div style="font-size: 32px; font-weight: bold; letter-spacing: 6px; padding: 16px 0; color: #FF7A1A;">
                ${code}
              </div>
              <p style="color: #64748B; font-size: 13px;">This code is valid for 5 minutes. Never share this code with anyone.</p>
            </div>
          `,
        }),
      });

      const data: any = await response.json();
      return { success: response.ok, messageId: data.id };
    } catch (err) {
      console.error('[ResendEmailSender] Error sending email:', err);
      return { success: false };
    }
  }
}

/**
 * EmailJS (https://www.emailjs.com) through its REST API. Needs, in Cloudflare:
 *   vars    EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY
 *   secret  EMAILJS_PRIVATE_KEY
 * and "Allow EmailJS API for non-browser applications" switched on in the EmailJS account (Account → Security).
 * The template receives: to_email, passcode, purpose, product_name, valid_minutes.
 */
export class EmailJsEmailSender implements OtpSender {
  constructor(private env: Env) {}

  static configured(env: Env): boolean {
    return Boolean(env.EMAILJS_SERVICE_ID && env.EMAILJS_TEMPLATE_ID && env.EMAILJS_PUBLIC_KEY && env.EMAILJS_PRIVATE_KEY);
  }

  async sendOtp(target: string, code: string, purpose: string): Promise<{ success: boolean; messageId?: string }> {
    const purposeText = purpose === 'PASSWORD_RESET' ? 'password reset' : purpose.toLowerCase().replace(/_/g, ' ');
    try {
      const response = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_id: this.env.EMAILJS_SERVICE_ID,
          template_id: this.env.EMAILJS_TEMPLATE_ID,
          user_id: this.env.EMAILJS_PUBLIC_KEY,
          accessToken: this.env.EMAILJS_PRIVATE_KEY,
          template_params: {
            to_email: target,
            passcode: code,
            purpose: purposeText,
            product_name: resolveBrand({ productName: this.env.PRODUCT_NAME }).productName,
            valid_minutes: '5',
          },
        }),
      });
      if (!response.ok) console.error('[EmailJsEmailSender] EmailJS rejected the email:', response.status, (await response.text()).slice(0, 200));
      return { success: response.ok };
    } catch (err) {
      console.error('[EmailJsEmailSender] Error sending email:', err);
      return { success: false };
    }
  }
}

export class DevOtpSender implements OtpSender {
  constructor(private env: Env) {}

  async sendOtp(target: string, code: string, purpose: string): Promise<{ success: boolean; messageId?: string }> {
    // In development only, log the OTP to console for easy developer testing
    if (this.env.ENVIRONMENT === 'development' || !this.env.ENVIRONMENT) {
      console.log(`\n======================================================`);
      console.log(`[DEV OTP SENDER] Target: ${target} | Purpose: ${purpose}`);
      console.log(`[DEV OTP SENDER] CODE: ${code}`);
      console.log(`======================================================\n`);
    }
    return { success: true, messageId: `dev-${Date.now()}` };
  }
}

export function getOtpSender(channel: string, env: Env): OtpSender {
  if (channel === 'SMS') {
    return new Msg91SmsSender(env);
  }
  if (EmailJsEmailSender.configured(env)) return new EmailJsEmailSender(env);
  return new ResendEmailSender(env);
}

