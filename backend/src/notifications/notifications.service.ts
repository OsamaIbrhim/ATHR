import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import axios from 'axios';
import { moneyString } from '../common/money';
import { formatBusinessDateTime } from '../common/business-time';
import { PrismaService } from '../prisma/prisma.service';
import type { TenantContext } from '../identity/tenant-context.type';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private mailer: nodemailer.Transporter | null = null;

  constructor(private prisma: PrismaService) {}

  private getMailer() {
    if (this.mailer) return this.mailer;
    const host = process.env.SMTP_HOST;
    if (!host) return null;
    this.mailer = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 587),
      secure: false,
      auth: process.env.SMTP_USER ? {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      } : undefined,
    });
    return this.mailer;
  }

  async sendEmail(to: string, subject: string, html: string, text?: string) {
    const mailer = this.getMailer();
    if (!mailer) {
      this.logger.log(`[EMAIL STUB] to ${to}: ${subject}`);
      return { sent: false, reason: 'SMTP not configured – set SMTP_HOST in .env', provider: 'stub' };
    }
    try {
      const info = await mailer.sendMail({
        from: process.env.SMTP_FROM || '"ATHR Operations" <noreply@athr.local>',
        to, subject,
        text: text || subject,
        html,
      });
      return { sent: true, messageId: info.messageId, provider: 'smtp' };
    } catch (e: any) {
      this.logger.error(`Email send failed: ${e.message}`);
      return { sent: false, error: e.message };
    }
  }

  async sendWhatsApp(to: string, message: string) {
    const token = process.env.WHATSAPP_TOKEN;
    const phoneId = process.env.WHATSAPP_PHONE_ID;
    if (!token || !phoneId) {
      this.logger.log(`[WHATSAPP STUB] to ${to}: ${message}`);
      return { sent: false, reason: 'WhatsApp Cloud API not configured – set WHATSAPP_TOKEN and WHATSAPP_PHONE_ID in .env', provider: 'stub' };
    }
    try {
      // WhatsApp Cloud API – https://developers.facebook.com/docs/whatsapp/cloud-api/
      const url = `https://graph.facebook.com/v19.0/${phoneId}/messages`;
      const res = await axios.post(url, {
        messaging_product: 'whatsapp',
        to: to.replace(/\D/g, ''), // digits only
        type: 'text',
        text: { body: message }
      }, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }});
      return { sent: true, id: res.data.messages?.[0]?.id, provider: 'whatsapp_cloud' };
    } catch (e: any) {
      this.logger.error(`WhatsApp send failed: ${JSON.stringify(e.response?.data || e.message)}`);
      return { sent: false, error: e.response?.data || e.message };
    }
  }

  /** Report recipients are the tenant's active owners; provider credentials stay global. */
  private async ownerRecipients(tenantId: string) {
    const owners = await this.prisma.user.findMany({
      where: {
        is_active: true,
        memberships: { some: { tenant_id: tenantId, role: 'tenant_owner', status: 'active' } },
      },
      select: { email: true, phone: true },
    });
    return {
      emails: owners.map((o) => o.email).filter((v): v is string => !!v),
      phones: owners.map((o) => o.phone).filter((v): v is string => !!v),
    };
  }

  async sendReport(context: TenantContext, report: any, channels: string[]) {
    const totalSales = moneyString(report.total_sales || 0);
    const totalCost = moneyString(report.total_cost || 0);
    const profit = moneyString(report.total_profit || report.profit || 0);
    const summary = `تقرير ATHR\nالمبيعات: ${totalSales} ج\nالتكلفة: ${totalCost} ج\nالربح: ${profit} ج\nالفواتير: ${report.count||0}`;
    const html = `
      <div dir="rtl" style="font-family:Cairo,Arial,sans-serif">
      <h2>تقرير ATHR اليومي</h2>
      <p>المبيعات: <b>${totalSales} ج</b></p>
      <p>التكلفة: ${totalCost} ج</p>
      <p>الربح: <b>${profit} ج</b></p>
      <p>عدد الفواتير: ${report.count||0}</p>
      <hr><small>ATHR Operations – ${formatBusinessDateTime(new Date())}</small>
      </div>`;
    const results:any = { tenant_id: context.tenantId };
    if (!channels.length) return results;
    const { emails, phones } = await this.ownerRecipients(context.tenantId);
    if (channels.includes('email')) {
      results.email = emails.length
        ? await this.sendEmail(emails.join(','), 'تقرير ATHR اليومي', html, summary)
        : { sent: false, reason: 'No owner email on file for this tenant' };
    }
    if (channels.includes('whatsapp')) {
      results.whatsapp = phones.length
        ? await Promise.all(phones.map((to) => this.sendWhatsApp(to, summary)))
        : { sent: false, reason: 'No owner phone on file for this tenant' };
    }
    return results;
  }
}
