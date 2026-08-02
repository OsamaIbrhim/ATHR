import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EmailAddress, PhoneNumber } from './identity-value-objects';

test('EmailAddress normalizes casing and surrounding whitespace', () => {
  const email = EmailAddress.parse('  Osama@Example.COM  ');
  assert.equal(email.toString(), 'osama@example.com');
});

test('EmailAddress rejects a value without an @ and domain', () => {
  assert.throws(() => EmailAddress.parse('not-an-email'), TypeError);
});

test('EmailAddress equals compares normalized values', () => {
  assert.equal(
    EmailAddress.parse('A@B.com').equals(EmailAddress.parse('a@b.com')),
    true,
  );
});

test('PhoneNumber normalizes to E.164 by stripping separators', () => {
  const phone = PhoneNumber.parse('+20 101 234 5678');
  assert.equal(phone.toE164(), '+201012345678');
});

test('PhoneNumber rejects a value without a leading country code', () => {
  assert.throws(() => PhoneNumber.parse('01012345678'), TypeError);
});

test('PhoneNumber rejects a value with a leading zero after the +', () => {
  assert.throws(() => PhoneNumber.parse('+0201012345678'), TypeError);
});

test('PhoneNumber equals compares normalized values', () => {
  assert.equal(
    PhoneNumber.parse('+201012345678').equals(PhoneNumber.parse('+20 101 234 5678')),
    true,
  );
});
