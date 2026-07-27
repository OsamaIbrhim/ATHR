import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../auth/authenticated-user';
import {
  RequireCapabilities,
  Roles,
} from '../auth/roles.guard';
import { PosProtocolGuard } from '../updates/pos-protocol.guard';
import { TerminalsService } from '../terminals/terminals.service';
import {
  ListSaleReviewsDto,
  ResolveSaleReviewDto,
  SubmitSaleReviewDto,
} from './dto/sale-review.dto';
import { SaleReviewsService } from './sale-reviews.service';

@Controller('pos/sale-reviews')
@Roles('branch_manager', 'cashier')
@RequireCapabilities('sales.create')
@UseGuards(new PosProtocolGuard())
export class PosSaleReviewsController {
  constructor(
    private readonly reviews: SaleReviewsService,
    private readonly terminals: TerminalsService,
  ) {}

  @Post()
  async submit(
    @Body() dto: SubmitSaleReviewDto,
    @Headers('x-pos-device-id') deviceId: string | undefined,
    @Headers('x-pos-device-token') deviceToken: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const terminal = await this.terminals.authenticate(
      deviceId,
      deviceToken,
      req.user,
    );
    return this.reviews.submit(dto, req.user, terminal);
  }

  @Get(':syncId')
  async status(
    @Param('syncId') syncId: string,
    @Headers('x-pos-device-id') deviceId: string | undefined,
    @Headers('x-pos-device-token') deviceToken: string | undefined,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    const terminal = await this.terminals.authenticate(
      deviceId,
      deviceToken,
      req.user,
    );
    return this.reviews.statusForPos(syncId, req.user, terminal);
  }
}

@Controller('sale-reviews')
@Roles('owner', 'branch_manager')
@RequireCapabilities('sales.reconcile')
export class SaleReviewsController {
  constructor(private readonly reviews: SaleReviewsService) {}

  @Get()
  list(
    @Query() dto: ListSaleReviewsDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.reviews.list(dto, req.user);
  }

  @Get(':id')
  get(
    @Param('id') id: string,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.reviews.get(id, req.user);
  }

  @Post(':id/approve')
  approve(
    @Param('id') id: string,
    @Body() dto: ResolveSaleReviewDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.reviews.approve(id, dto, req.user);
  }

  @Post(':id/reject')
  reject(
    @Param('id') id: string,
    @Body() dto: ResolveSaleReviewDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.reviews.reject(id, dto, req.user);
  }
}
