import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PermissionPolicyService } from '../identity/permission-policy.service';
import { IdentityClaims, resolveIdentityClaims } from './identity-claims';
import { AuthenticatedUser } from './authenticated-user';
import { toSessionUser } from './session-user';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private permissionPolicy: PermissionPolicyService,
  ) {}

  async login(phone: string, password: string, tenantId?: string) {
    const user = await this.prisma.user.findUnique({ where: { phone } });
    if (!user || !user.is_active || !await bcrypt.compare(password, user.password_hash)) {
      throw new UnauthorizedException('Invalid credentials');
    }
    return this.createSession(user, undefined, tenantId);
  }

  async refresh(refreshToken: string, tenantId?: string) {
    const tokenHash = this.hashToken(refreshToken);
    return this.prisma.$transaction(async (tx) => {
      const stored = await tx.refreshToken.findUnique({
        where: { token_hash: tokenHash },
        include: { user: true },
      });
      if (!stored || stored.revoked_at || stored.expires_at <= new Date() || !stored.user.is_active) {
        throw new UnauthorizedException('Invalid refresh token');
      }
      const revoked = await tx.refreshToken.updateMany({
        where: { id: stored.id, revoked_at: null },
        data: { revoked_at: new Date() },
      });
      if (revoked.count !== 1) throw new UnauthorizedException('Refresh token was already used');
      // Keep the tenant the session was issued for unless the client asks to switch.
      return this.createSession(stored.user, tx, tenantId ?? stored.tenant_id ?? undefined);
    });
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: { token_hash: this.hashToken(refreshToken), revoked_at: null },
      data: { revoked_at: new Date() },
    });
    return { ok: true };
  }

  async hash(password: string) { return bcrypt.hash(password, 12); }

  async me(actor: AuthenticatedUser) {
    const user = await this.prisma.user.findUnique({
      where: { id: actor.sub },
      select: { id: true, name: true, is_active: true },
    });
    if (!user?.is_active) throw new UnauthorizedException();
    const memberships = await this.prisma.membership.findMany({
      where: { user_id: actor.sub, status: 'active' },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      select: { tenant: { select: { id: true, name: true } } },
    });
    return { ...toSessionUser(user, actor), tenants: memberships.map((m) => m.tenant) };
  }

  private async createSession(user: User, transaction?: Prisma.TransactionClient, tenantId?: string) {
    const db = transaction || this.prisma;
    const claims = await resolveIdentityClaims(this.prisma, this.permissionPolicy, user.id, tenantId);
    const refreshToken = randomBytes(48).toString('base64url');
    await db.refreshToken.create({
      data: {
        user_id: user.id,
        tenant_id: claims.tenant_id,
        token_hash: this.hashToken(refreshToken),
        expires_at: new Date(Date.now() + this.refreshLifetimeMs()),
      },
    });
    // The token only names the identity and tenant; the Membership is reloaded
    // on every request (see JwtStrategy), so role/permission changes apply at once.
    const payload = { sub: user.id, tenant_id: claims.tenant_id, membership_id: claims.membership_id };
    return {
      access_token: await this.jwt.signAsync(payload),
      refresh_token: refreshToken,
      user: toSessionUser(user, claims),
    };
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private refreshLifetimeMs() {
    const value = process.env.REFRESH_EXPIRES || '30d';
    const match = /^(\d+)([mhd])$/.exec(value);
    if (!match) throw new Error('REFRESH_EXPIRES must use m, h, or d (for example 30d)');
    const amount = Number(match[1]);
    const unit = { m: 60000, h: 3600000, d: 86400000 }[match[2]];
    return amount * unit;
  }
}
