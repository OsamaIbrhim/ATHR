import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BranchesModule } from '../branches/branches.module';
import { PublicController } from './public.controller';
import { SignupRateLimiter } from './signup-rate-limiter';
import { SignupService } from './signup.service';

/** Unauthenticated pricing page data and self-service signup. */
@Module({
  imports: [AuthModule, BranchesModule],
  controllers: [PublicController],
  providers: [SignupService, SignupRateLimiter],
})
export class PublicModule {}
