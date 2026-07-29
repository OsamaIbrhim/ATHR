import { BadRequestException } from '@nestjs/common';
import { requireResourceId } from './resource-id';

describe('requireResourceId', () => {
  it.each([undefined, null, '', ' ', 'undefined', 'null', 'not-a-uuid'])(
    'rejects an invalid resource identifier before data access: %p',
    (value) => {
      expect(() => requireResourceId(value, 'shift_id')).toThrow(
        BadRequestException,
      );
    },
  );

  it('normalizes a valid UUID', () => {
    expect(
      requireResourceId(
        ' 11111111-1111-4111-8111-111111111111 ',
        'shift_id',
      ),
    ).toBe('11111111-1111-4111-8111-111111111111');
  });
});
