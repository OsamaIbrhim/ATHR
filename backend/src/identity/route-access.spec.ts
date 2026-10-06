import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { MembershipRole } from '@prisma/client';
import { actorFor } from '../auth/testing/actors';
import { PermissionGuard } from './permission.guard';
import { AssortmentController } from '../assortment/assortment.controller';
import { BranchesController } from '../branches/branches.controller';
import { BrandsController } from '../brands/brands.controller';
import { BundleController } from '../promotions/bundle.controller';
import { CouponController } from '../promotions/coupon.controller';
import { CustomersController } from '../customers/customers.controller';
import { InventoryController } from '../inventory/inventory.controller';
import { NotificationsController } from '../notifications/notifications.controller';
import { OffersController } from '../offers/offers.controller';
import { OverridesController } from '../pricing/overrides.controller';
import { PriceBookController } from '../pricing/price-book.controller';
import { PricingController } from '../pricing/pricing.controller';
import { ProductsController } from '../products/products.controller';
import { ProductTypesController } from '../catalog/product-types.controller';
import { TenantSettingsController } from '../catalog/tenant-settings.controller';
import { PromotionController } from '../promotions/promotion.controller';
import { PurchasingController } from '../purchasing/purchasing.controller';
import { ReportsController } from '../reports/reports.controller';
import { SalesController } from '../sales/sales.controller';
import { SellersController } from '../sellers/sellers.controller';
import { ShiftsController } from '../shifts/shifts.controller';
import { SuppliersController } from '../suppliers/suppliers.controller';
import { SyncController } from '../sync/sync.controller';
import { TaxController } from '../tax/tax.controller';
import { TerminalsController } from '../terminals/terminals.controller';
import { TransfersController } from '../transfers/transfers.controller';
import { UomController } from '../uom/uom.controller';
import { UsersController } from '../users/users.controller';

/**
 * Regression table for the authorization unification (W1a). Before it, routes
 * were guarded by `@Roles`, `@RequireCapabilities` (legacy `User.role` and
 * capability list) and `@RequirePermission`. This pins, for every guarded route,
 * which Membership roles may call it — the set the legacy guards effectively
 * allowed (role capability AND permission) — evaluated by the one remaining
 * guard against each role's default permissions.
 *
 * Roles: O = tenant_owner (was owner), L = location_manager (was branch_manager),
 * C = cashier, W = warehouse_manager, S = seller.
 *
 * One deliberate difference: `GET /branches` was owner-only through the legacy
 * capability, but its permission (`location.view`) always allowed managers, so
 * a branch manager can now list branches (read-only; the admin pickers need it).
 */
const ROLES: Record<string, MembershipRole> = {
  O: 'tenant_owner',
  L: 'location_manager',
  C: 'cashier',
  W: 'warehouse_manager',
  S: 'seller',
};

const CONTROLLERS: Record<string, any> = {
  AssortmentController,
  BranchesController,
  BrandsController,
  BundleController,
  CouponController,
  CustomersController,
  InventoryController,
  NotificationsController,
  OffersController,
  OverridesController,
  PriceBookController,
  PricingController,
  ProductsController,
  ProductTypesController,
  PromotionController,
  PurchasingController,
  ReportsController,
  SalesController,
  SellersController,
  ShiftsController,
  SuppliersController,
  SyncController,
  TaxController,
  TenantSettingsController,
  TerminalsController,
  TransfersController,
  UomController,
  UsersController,
};

const ROUTES: Array<[controller: string, handler: string, allowed: string]> = [
  ['AssortmentController', 'list', 'OLW'],
  ['AssortmentController', 'upsert', 'OLW'],
  ['BranchesController', 'list', 'OL'],
  ['BranchesController', 'create', 'O'],
  ['BrandsController', 'list', 'OLCWS'],
  ['BrandsController', 'get', 'OLCWS'],
  ['BrandsController', 'create', 'OLW'],
  ['BrandsController', 'update', 'OLW'],
  ['BrandsController', 'archive', 'OLW'],
  ['CustomersController', 'list', 'OLCS'],
  ['CustomersController', 'byPhone', 'OLCS'],
  ['CustomersController', 'loyalty', 'OLCS'],
  ['CustomersController', 'get', 'OLCS'],
  ['CustomersController', 'create', 'OL'],
  ['CustomersController', 'update', 'OL'],
  ['CustomersController', 'setVip', 'OL'],
  ['CustomersController', 'remove', 'OL'],
  ['InventoryController', 'lookup', 'OLCWS'],
  ['InventoryController', 'movements', 'OLW'],
  ['InventoryController', 'reconciliation', 'OLW'],
  ['NotificationsController', 'send', 'OL'],
  ['OffersController', 'list', 'OL'],
  ['OffersController', 'review', 'OL'],
  ['OverridesController', 'savePolicy', 'OL'],
  ['OverridesController', 'applyOverride', 'OLC'],
  ['OverridesController', 'approveOverride', 'OL'],
  ['OverridesController', 'listOverrides', 'OL'],
  ['OverridesController', 'applyDiscount', 'OLC'],
  ['OverridesController', 'listDiscounts', 'OL'],
  ['PriceBookController', 'list', 'OL'],
  ['PriceBookController', 'get', 'OL'],
  ['PriceBookController', 'create', 'OL'],
  ['PriceBookController', 'updateDraft', 'OL'],
  ['PriceBookController', 'submit', 'OL'],
  ['PriceBookController', 'approve', 'OL'],
  ['PriceBookController', 'schedule', 'OL'],
  ['PriceBookController', 'activate', 'OL'],
  ['PriceBookController', 'end', 'OL'],
  ['PriceBookController', 'listEntries', 'OL'],
  ['PriceBookController', 'createEntry', 'OL'],
  ['PriceBookController', 'supersedeEntry', 'OL'],
  ['PricingController', 'calculate', 'OL'],
  ['ProductsController', 'list', 'OLCWS'],
  ['ProductsController', 'search', 'OLCWS'],
  ['ProductsController', 'create', 'OLW'],
  ['ProductsController', 'get', 'OLCWS'],
  ['ProductsController', 'update', 'OLW'],
  ['ProductsController', 'addVariant', 'OLW'],
  ['ProductsController', 'addBarcode', 'OLW'],
  ['ProductsController', 'updateBarcode', 'OLW'],
  ['ProductsController', 'removeBarcode', 'OLW'],
  ['ProductsController', 'updateVariant', 'OLW'],
  ['ProductTypesController', 'list', 'OLCWS'],
  ['ProductTypesController', 'create', 'OLW'],
  ['ProductTypesController', 'update', 'OLW'],
  ['TenantSettingsController', 'get', 'OLCWS'],
  ['TenantSettingsController', 'setScaleBarcode', 'O'],
  ['ProductsController', 'removeVariant', 'OLW'],
  ['BundleController', 'list', 'OLCWS'],
  ['BundleController', 'get', 'OLCWS'],
  ['BundleController', 'create', 'OLW'],
  ['BundleController', 'updateDraft', 'OLW'],
  ['BundleController', 'activate', 'OLW'],
  ['BundleController', 'end', 'OLW'],
  ['BundleController', 'supersede', 'OLW'],
  ['CouponController', 'list', 'OL'],
  ['CouponController', 'get', 'OL'],
  ['CouponController', 'create', 'OL'],
  ['CouponController', 'update', 'OL'],
  ['CouponController', 'redeem', 'OLC'],
  ['PromotionController', 'list', 'OL'],
  ['PromotionController', 'get', 'OL'],
  ['PromotionController', 'create', 'OL'],
  ['PromotionController', 'updateDraft', 'OL'],
  ['PromotionController', 'submit', 'OL'],
  ['PromotionController', 'approve', 'OL'],
  ['PromotionController', 'schedule', 'OL'],
  ['PromotionController', 'activate', 'OL'],
  ['PromotionController', 'pause', 'OL'],
  ['PromotionController', 'resume', 'OL'],
  ['PromotionController', 'end', 'OL'],
  ['PromotionController', 'cancel', 'OL'],
  ['PurchasingController', 'list', 'OLW'],
  ['PurchasingController', 'get', 'OLW'],
  ['PurchasingController', 'receive', 'OLW'],
  ['PurchasingController', 'returnToSupplier', 'OLW'],
  ['PurchasingController', 'listSupplierReturns', 'OLW'],
  ['PurchasingController', 'reverse', 'OLW'],
  ['PurchasingController', 'listCostMovements', 'OLW'],
  ['PurchasingController', 'costReconciliation', 'O'],
  ['PurchasingController', 'ocr', 'OLW'],
  ['ReportsController', 'sales', 'OLW'],
  ['ReportsController', 'best', 'OLW'],
  ['ReportsController', 'profitByItem', 'OL'],
  ['ReportsController', 'inventoryValuation', 'OLW'],
  ['ReportsController', 'send', 'OL'],
  ['SalesController', 'listSales', 'OLC'],
  ['SalesController', 'getSale', 'OLC'],
  ['SalesController', 'ret', 'OLC'],
  ['SalesController', 'lookupInvoice', 'OLC'],
  ['SalesController', 'getPdf', 'OLC'],
  ['SalesController', 'listReturns', 'OLC'],
  ['SellersController', 'report', 'OL'],
  ['SellersController', 'settings', 'OL'],
  ['SellersController', 'updateSettings', 'O'],
  ['SellersController', 'updateSellerSettings', 'O'],
  ['SellersController', 'periods', 'OL'],
  ['SellersController', 'closePeriod', 'O'],
  ['ShiftsController', 'list', 'OLC'],
  ['ShiftsController', 'current', 'OLC'],
  ['ShiftsController', 'open', 'OLC'],
  ['ShiftsController', 'offlineContext', 'OLC'],
  ['ShiftsController', 'close', 'OLC'],
  ['SuppliersController', 'list', 'OLW'],
  ['SuppliersController', 'resolve', 'OLW'],
  ['SuppliersController', 'get', 'OLW'],
  ['SuppliersController', 'create', 'OLW'],
  ['SuppliersController', 'update', 'OLW'],
  ['SuppliersController', 'remove', 'OLW'],
  ['SyncController', 'push', 'OLC'],
  ['SyncController', 'pull', 'OLC'],
  ['TaxController', 'listCategories', 'OL'],
  ['TaxController', 'createCategory', 'O'],
  ['TaxController', 'list', 'OL'],
  ['TaxController', 'get', 'OL'],
  ['TaxController', 'create', 'O'],
  ['TaxController', 'updateDraft', 'O'],
  ['TaxController', 'submit', 'O'],
  ['TaxController', 'approve', 'O'],
  ['TaxController', 'schedule', 'O'],
  ['TaxController', 'activate', 'O'],
  ['TaxController', 'supersede', 'O'],
  ['TaxController', 'listExemptions', 'OL'],
  ['TaxController', 'applyExemption', 'O'],
  ['TaxController', 'approveExemption', 'O'],
  ['TaxController', 'revokeExemption', 'O'],
  ['TerminalsController', 'createEnrollment', 'OL'],
  ['TerminalsController', 'heartbeat', 'OLC'],
  ['TerminalsController', 'selfDecommission', 'OL'],
  ['TerminalsController', 'list', 'OL'],
  ['TerminalsController', 'update', 'OL'],
  ['TransfersController', 'list', 'OLW'],
  ['TransfersController', 'reconcile', 'OLW'],
  ['TransfersController', 'get', 'OLW'],
  ['TransfersController', 'create', 'OLW'],
  ['TransfersController', 'ship', 'OLW'],
  ['TransfersController', 'receive', 'OLW'],
  ['TransfersController', 'cancel', 'OLW'],
  ['UomController', 'list', 'OLW'],
  ['UomController', 'listConversions', 'OLW'],
  ['UomController', 'get', 'OLW'],
  ['UomController', 'create', 'OLW'],
  ['UomController', 'update', 'OLW'],
  ['UomController', 'createConversion', 'OLW'],
  ['UomController', 'supersedeConversion', 'OLW'],
  ['UsersController', 'list', 'OL'],
  ['UsersController', 'create', 'OL'],
  ['UsersController', 'updatePermissions', 'OL'],
];

function canCall(controller: string, handler: string, role: MembershipRole) {
  const type = CONTROLLERS[controller];
  const context = {
    getHandler: () => type.prototype[handler],
    getClass: () => type,
    switchToHttp: () => ({ getRequest: () => ({ user: actorFor(role) }) }),
  } as unknown as ExecutionContext;
  try {
    return new PermissionGuard(new Reflector()).canActivate(context);
  } catch {
    return false;
  }
}

describe('route access by membership role', () => {
  it.each(ROUTES)('%s.%s', (controller, handler, allowed) => {
    expect(typeof CONTROLLERS[controller].prototype[handler]).toBe('function');
    const actual = Object.entries(ROLES)
      .filter(([, role]) => canCall(controller, handler, role))
      .map(([letter]) => letter)
      .join('');
    expect(actual).toBe(allowed);
  });

  it('a formerly owner-only route still rejects a cashier membership', () => {
    // POST /notifications/send-report and POST /branches were @Roles('owner').
    expect(canCall('NotificationsController', 'send', 'cashier')).toBe(false);
    expect(canCall('BranchesController', 'create', 'cashier')).toBe(false);
    expect(canCall('BranchesController', 'create', 'location_manager')).toBe(false);
    expect(canCall('BranchesController', 'create', 'tenant_owner')).toBe(true);
  });
});
