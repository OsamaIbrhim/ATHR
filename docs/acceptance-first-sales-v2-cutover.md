# Acceptance-first sales v2 cutover

This release is a clean protocol cutover. Do not deploy only one part of it.

## Guarantees

- A completed local sale is uploaded with the item names, attributes, prices,
  tax, cashier, seller and occurrence time captured on the POS.
- A later cloud price or catalog change does not reject that sale.
- Replaying the same `sync_id` and payload returns the existing invoice.
- Reusing a `sync_id` with different financial content is quarantined.
- Cloud stock can become negative and is reported as a warning instead of
  losing a completed sale.
- Receipt presentation is not part of the synchronization contract.

## Deployment order

1. Back up the current test database and export any records that must be kept.
2. Create the clean database or reset the test database during a maintenance
   window.
3. Apply every committed Prisma migration in order, including
   `202607280001_acceptance_first_sales_v2`.
4. Run the deterministic development/production seed intended for the target
   environment.
5. Deploy the backend and verify both `/api/v1/health/live` and
   `/api/v1/health/ready`.
6. Deploy the Admin Web and verify that sales warnings appear inside the sales
   list and invoice details. There is no sale-approval page in protocol v2.
7. Set the backend compatibility variables:

   ```text
   POS_PROTOCOL_MIN=2
   POS_PROTOCOL_MAX=2
   POS_REQUIRE_PROTOCOL_HEADERS=true
   POS_MIN_APP_VERSION=1.4.0
   ```

8. Remove the obsolete price-snapshot and offline-ticket key variables.
9. Build and install Bold POS `1.4.0` as a clean enrollment on each test till.
10. Enroll the device, log in, open a shift and complete one full catalog sync.

## Release verification

Before opening the environment to users, verify:

1. An online sale produces one invoice and one inventory movement per line.
2. An offline sale prints and remains pending locally.
3. Change the cloud price while the till is offline, reconnect, and confirm the
   original paid price is accepted with `PRICE_VARIANCE`.
4. Repeat the same upload ten times and confirm there is still one invoice and
   one inventory movement per line.
5. Restart the POS immediately after the server commits but before the local
   acknowledgement; the next sync must return the same invoice.
6. Close the cloud shift before an offline sale arrives; the sale must be
   accepted with `LATE_SYNC`.
7. Confirm a warning does not block later pending sales.
8. Confirm changing receipt layout does not change the sale payload or totals.

Do not delete POS local data after this cutover. Future releases are installed
over the existing application and use the built-in updater.
