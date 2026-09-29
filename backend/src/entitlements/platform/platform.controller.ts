import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../../auth/authenticated-user';
import { PlatformRoute } from './platform-admin.guard';
import {
  AddNoteDto, ChangePlanDto, CreatePlanDto, ExtendDto, ListTenantsDto, SetStatusDto, UpdatePlanDto,
} from './platform.dto';
import { PlatformService } from './platform.service';

type PlatformRequest = Request & { user: AuthenticatedUser };

/** The platform owner's console API. No tenant context; platform admins only. */
@PlatformRoute()
@Controller('platform')
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('tenants')
  listTenants(@Query() query: ListTenantsDto) {
    return this.platform.listTenants(query);
  }

  @Get('tenants/:tenantId')
  getTenant(@Param('tenantId', ParseUUIDPipe) tenantId: string) {
    return this.platform.getTenant(tenantId);
  }

  @Post('tenants/:tenantId/subscription/plan')
  changePlan(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: ChangePlanDto, @Req() req: PlatformRequest) {
    return this.platform.changePlan(tenantId, dto.plan_code, req.user.sub, dto.note);
  }

  @Post('tenants/:tenantId/subscription/status')
  setStatus(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: SetStatusDto, @Req() req: PlatformRequest) {
    return this.platform.setStatus(tenantId, dto.status, req.user.sub, dto.note);
  }

  @Post('tenants/:tenantId/subscription/extend')
  extend(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: ExtendDto, @Req() req: PlatformRequest) {
    return this.platform.extend(tenantId, dto, req.user.sub);
  }

  @Post('tenants/:tenantId/subscription/note')
  addNote(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Body() dto: AddNoteDto, @Req() req: PlatformRequest) {
    return this.platform.addNote(tenantId, dto.note, req.user.sub);
  }

  @Get('plans')
  listPlans() {
    return this.platform.listPlans();
  }

  @Post('plans')
  createPlan(@Body() dto: CreatePlanDto) {
    return this.platform.createPlan(dto);
  }

  @Patch('plans/:id')
  updatePlan(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlanDto) {
    return this.platform.updatePlan(id, dto);
  }

  @Delete('plans/:id')
  deletePlan(@Param('id', ParseUUIDPipe) id: string) {
    return this.platform.deletePlan(id);
  }
}
