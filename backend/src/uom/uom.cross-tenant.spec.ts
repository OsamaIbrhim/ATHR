import { randomUUID } from 'crypto';
import { validate } from 'class-validator';
import { UomRepository } from './uom.repository';
import { UomService } from './uom.service';
import { CreateUomConversionDto } from './dto/uom-conversion.dto';
import { TENANT_A, TENANT_B, contextFor, fakePrisma } from '../identity/testing/cross-tenant-harness';

/** WP-008 Phase A — cross-tenant isolation + BR-UOM-102 immutability for the `uom` module. */

const PIECE_A = randomUUID();
const CARTON_A = randomUUID();
const PIECE_B = randomUUID();
const CONVERSION_A = randomUUID();

function setup() {
  const prisma = fakePrisma({
    unitOfMeasure: [
      { id: PIECE_A, tenant_id: TENANT_A, code: 'PC', name_en: 'Piece', kind: 'base', precision: 0, is_active: true },
      { id: CARTON_A, tenant_id: TENANT_A, code: 'CTN', name_en: 'Carton', kind: 'derived', precision: 0, is_active: true },
      { id: PIECE_B, tenant_id: TENANT_B, code: 'PC', name_en: 'Piece', kind: 'base', precision: 0, is_active: true },
    ],
    uomConversion: [
      {
        id: CONVERSION_A,
        tenant_id: TENANT_A,
        from_uom_id: CARTON_A,
        to_uom_id: PIECE_A,
        factor: 24,
        version: 1,
        status: 'active',
        superseded_by_id: null,
        superseded_at: null,
        created_at: new Date(),
      },
    ],
  });
  const repository = new UomRepository(prisma);
  return { prisma, repository, service: new UomService(repository) };
}

describe('uom — cross-tenant isolation', () => {
  it('lists only the calling tenant\'s units', async () => {
    const { service } = setup();
    expect((await service.findAll(contextFor(TENANT_A))).map((row) => row.id).sort()).toEqual(
      [PIECE_A, CARTON_A].sort(),
    );
    expect((await service.findAll(contextFor(TENANT_B))).map((row) => row.id)).toEqual([PIECE_B]);
  });

  it('does not resolve another tenant\'s unit by id', async () => {
    const { repository } = setup();
    expect(await repository.findById(contextFor(TENANT_B), PIECE_A)).toBeNull();
  });

  it('rejects creating a conversion that references another tenant\'s unit', async () => {
    const { service } = setup();
    await expect(
      service.createConversion(contextFor(TENANT_B), { from_uom_id: CARTON_A, to_uom_id: PIECE_B, factor: 10 }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('does not list another tenant\'s conversions', async () => {
    const { service } = setup();
    expect(await service.listConversions(contextFor(TENANT_B), {})).toEqual([]);
  });

  it('refuses to supersede another tenant\'s conversion', async () => {
    const { service } = setup();
    await expect(
      service.supersedeConversion(contextFor(TENANT_B), CONVERSION_A, { factor: 12 }),
    ).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
});

describe('uom conversion — BR-UOM-102 immutability', () => {
  /**
   * There is no "edit factor" mutation at all -- `UomService` exposes only
   * `createConversion` and `supersedeConversion`. This proves the only path
   * that changes an existing conversion's effective factor (`supersede`)
   * never touches the original row's stored `factor`; it creates a new
   * version and marks the old one `superseded`.
   */
  it('supersede creates a new version and leaves the previous row\'s factor untouched', async () => {
    const { service, prisma } = setup();

    const next = await service.supersedeConversion(contextFor(TENANT_A), CONVERSION_A, { factor: 25 });

    const previous = prisma.uomConversion.rows.find((row: any) => row.id === CONVERSION_A);
    expect(previous.factor).toBe(24); // untouched
    expect(previous.status).toBe('superseded');
    expect(previous.superseded_by_id).toBe(next.id);

    expect(next.factor).toBe(25);
    expect(next.version).toBe(2);
    expect(next.status).toBe('active');
    expect(next.from_uom_id).toBe(CARTON_A);
    expect(next.to_uom_id).toBe(PIECE_A);
  });

  it('rejects superseding an already-superseded conversion directly', async () => {
    const { service } = setup();
    await service.supersedeConversion(contextFor(TENANT_A), CONVERSION_A, { factor: 25 });

    await expect(
      service.supersedeConversion(contextFor(TENANT_A), CONVERSION_A, { factor: 30 }),
    ).rejects.toMatchObject({ code: 'CATALOG_UOM_CONVERSION_IMMUTABLE' });
  });

  it('rejects a conversion with a non-positive factor at the DTO layer (BR-UOM-102)', async () => {
    const dto = new CreateUomConversionDto();
    dto.from_uom_id = CARTON_A;
    dto.to_uom_id = PIECE_A;
    dto.factor = -1;
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'factor')).toBe(true);
  });
});
