import { Body, Controller, Get, Post, Req, UseFilters } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { AuthenticatedUser } from './authenticated-user';
import { AthrExceptionFilter } from '../common/http/athr-exception.filter';
import { Envelope } from '../common/http/response-envelope.interceptor';
@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}
  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) { return this.auth.login(dto.phone, dto.password); }
  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) { return this.auth.refresh(dto.refresh_token); }
  // WP-003 proof-of-concept command endpoint — already idempotent (revoking an
  // already-revoked/absent token is a no-op success), so it is low-risk to be
  // the first migrated command. See
  // docs/architecture/api-error-contract-foundation.md for the before/after
  // response shape. `@UseFilters` is route-scoped for the same reason as on
  // HealthController.live — see the comment there.
  @Public()
  @Envelope('command')
  @UseFilters(AthrExceptionFilter)
  @Post('logout')
  logout(@Body() dto: RefreshTokenDto) { return this.auth.logout(dto.refresh_token); }

  @Get('me')
  me(@Req() req: Request & { user: AuthenticatedUser }) { return this.auth.me(req.user.sub); }
}
