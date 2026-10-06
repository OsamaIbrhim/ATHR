import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { CATALOG } from './catalog';
import { toPlanView } from './plan-view';
import { SignupDto } from './signup.dto';
import { SignupService } from './signup.service';

/** Unauthenticated endpoints for the landing/pricing page. */
@Public()
@Controller('public')
export class PublicController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signups: SignupService,
  ) {}

  /** Public, active plans plus the catalog labels to render their features and limits. */
  @Get('plans')
  async plans() {
    const plans = await this.prisma.plan.findMany({
      where: { is_public: true, is_active: true },
      orderBy: [{ sort_order: 'asc' }, { price_monthly: 'asc' }],
    });
    return { plans: plans.map(toPlanView), catalog: CATALOG };
  }

  @Post('signup')
  signup(@Body() dto: SignupDto, @Req() req: Request) {
    return this.signups.signup(dto, req.ip ?? 'unknown');
  }
}
