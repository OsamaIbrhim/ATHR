import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { getJwtSecret } from './jwt.config';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionPolicyService } from '../identity/permission-policy.service';
import { resolveIdentityClaims } from './identity-claims';
import { AuthenticatedUser } from './authenticated-user';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly cache = new Map<string, { expiresAt: number; user: AuthenticatedUser }>();
  private readonly inFlight = new Map<string, Promise<AuthenticatedUser>>();

  constructor(private prisma: PrismaService, private permissionPolicy: PermissionPolicyService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: getJwtSecret()
    });
  }
  async validate(payload: { sub?: string; tenant_id?: string | null }) {
    if (!payload.sub) throw new UnauthorizedException();
    const tenantId = payload.tenant_id ?? null;
    const key = `${payload.sub}:${tenantId ?? ''}`;
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) return cached.user;

    let lookup = this.inFlight.get(key);
    if (!lookup) {
      lookup = this.loadAuthenticatedUser(payload.sub, tenantId);
      this.inFlight.set(key, lookup);
    }
    try {
      const user = await lookup;
      const ttl = Math.min(5_000, Math.max(0, Number(process.env.AUTH_RECHECK_TTL_MS || 1_000)));
      if (ttl > 0) {
        if (this.cache.size >= 1_000) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, { expiresAt: Date.now() + ttl, user });
      }
      return user;
    } finally {
      if (this.inFlight.get(key) === lookup) this.inFlight.delete(key);
    }
  }

  private async loadAuthenticatedUser(userId: string, tenantId: string | null): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, is_active: true, is_platform_admin: true },
    });
    if (!user?.is_active) throw new UnauthorizedException();
    // The very short cache coalesces bursts from one logged-in user while role,
    // scope, permission, disable, and revocation changes still take effect
    // within 1 second.
    const claims = await resolveIdentityClaims(this.prisma, this.permissionPolicy, user.id, tenantId);
    return { sub: user.id, is_platform_admin: user.is_platform_admin, ...claims };
  }
}
