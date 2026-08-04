import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { BranchesModule } from './branches/branches.module';
import { ProductsModule } from './products/products.module';
import { PricingModule } from './pricing/pricing.module';
import { InventoryModule } from './inventory/inventory.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { PurchasingModule } from './purchasing/purchasing.module';
import { CustomersModule } from './customers/customers.module';
import { SalesModule } from './sales/sales.module';
import { TransfersModule } from './transfers/transfers.module';
import { ReportsModule } from './reports/reports.module';
import { OffersModule } from './offers/offers.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SyncModule } from './sync/sync.module';
import { ShiftsModule } from './shifts/shifts.module';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { TerminalsModule } from './terminals/terminals.module';
import { PerformanceInterceptor } from './common/performance.interceptor';
import { HealthModule } from './health/health.module';
import { SellersModule } from './sellers/sellers.module';
import { UpdatesModule } from './updates/updates.module';
import { IdentityModule } from './identity/identity.module';
import { TenantContextGuard } from './identity/tenant-context.guard';
import { PermissionGuard } from './identity/permission.guard';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    UsersModule,
    BranchesModule,
    ProductsModule,
    PricingModule,
    InventoryModule,
    SuppliersModule,
    PurchasingModule,
    CustomersModule,
    SalesModule,
    TransfersModule,
    ReportsModule,
    OffersModule,
    NotificationsModule,
    SyncModule,
    ShiftsModule,
    TerminalsModule,
    HealthModule,
    SellersModule,
    UpdatesModule,
    IdentityModule,
  ],
  // Guard order is significant and matches the Permission Matrix §74 denial
  // precedence: authenticate (JwtAuthGuard) → resolve tenant context
  // (TenantContextGuard, which needs `req.user`) → legacy role/capability
  // check (RolesGuard) → Matrix permission check (PermissionGuard).
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantContextGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
    { provide: APP_INTERCEPTOR, useClass: PerformanceInterceptor },
  ],
})
export class AppModule {}
