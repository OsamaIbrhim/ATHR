import { Body, Controller, Post } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { RequirePermission } from '../identity/permission.guard';
import { TenantCtx } from '../identity/tenant-context.decorator';
import type { TenantContext } from '../identity/tenant-context.type';
@Controller('notifications')
export class NotificationsController {
  constructor(private svc: NotificationsService) {}
  @RequirePermission('notifications.notification.resend')
  @Post('send-report') send(
    @TenantCtx() ctx: TenantContext,
    @Body() dto: { report: any, channels: string[] },
  ) {
    return this.svc.sendReport(ctx, dto.report, dto.channels);
  }
}
