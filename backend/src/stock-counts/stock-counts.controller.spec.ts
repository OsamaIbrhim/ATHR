import 'reflect-metadata';
import { StockCountsController } from './stock-counts.controller';
import { REQUIRED_PERMISSIONS_KEY } from '../identity/permission.guard';

const required = (method: keyof StockCountsController) =>
  Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, StockCountsController.prototype[method]) as string[] | undefined;

describe('stock counts controller permissions', () => {
  it('lets a counter (request) count and see their own list', () => {
    expect(required('record')).toEqual(['inventory.adjustment.request']);
    expect(required('recent')).toEqual(['inventory.adjustment.request']);
    expect(required('get')).toEqual(['inventory.adjustment.request']);
    expect(required('list')).toEqual(['inventory.adjustment.request']);
  });

  it('needs request and approve to start, review, reset an item or cancel', () => {
    for (const method of ['start', 'review', 'resetLine', 'cancel'] as const) {
      expect(required(method)).toEqual(['inventory.adjustment.request', 'inventory.adjustment.approve']);
    }
  });

  it('needs the post key to post', () => {
    expect(required('post')).toEqual(['inventory.adjustment.post']);
  });
});
