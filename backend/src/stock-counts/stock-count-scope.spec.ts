import { scopeKey, scopesOverlap, type CountScope } from './stock-count-scope';

const all: CountScope = { scope_type: 'all', category_id: null, product_type_id: null };
const category = (id: string): CountScope => ({ scope_type: 'category', category_id: id, product_type_id: null });
const type = (id: string): CountScope => ({ scope_type: 'product_type', category_id: null, product_type_id: id });

describe('count scopes', () => {
  it('keys a scope by its id, or "all"', () => {
    expect(scopeKey(all)).toBe('all');
    expect(scopeKey(category('c1'))).toBe('c1');
    expect(scopeKey(type('t1'))).toBe('t1');
  });

  it('lets two counts run together only when they cannot count the same item', () => {
    expect(scopesOverlap(all, all)).toBe(true);
    expect(scopesOverlap(all, category('c1'))).toBe(true);
    expect(scopesOverlap(type('t1'), all)).toBe(true);
    expect(scopesOverlap(category('c1'), category('c1'))).toBe(true);
    expect(scopesOverlap(category('c1'), category('c2'))).toBe(false);
    expect(scopesOverlap(type('t1'), type('t2'))).toBe(false);
    // a product has a category and a type, so these can share an item
    expect(scopesOverlap(category('c1'), type('t1'))).toBe(true);
  });
});
