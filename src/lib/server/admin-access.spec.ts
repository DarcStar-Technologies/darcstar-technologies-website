import { describe, expect, test } from 'vitest';
import { parseAdminIds, isRosterAdmin, isStaff, coerceRole, ROLES } from './admin-access';

describe('parseAdminIds', () => {
	test('empty / undefined → []', () => {
		expect(parseAdminIds(undefined)).toEqual([]);
		expect(parseAdminIds('')).toEqual([]);
		expect(parseAdminIds('  ,  , ')).toEqual([]);
	});

	test('trims and drops empties', () => {
		expect(parseAdminIds('a, b ,,c,')).toEqual(['a', 'b', 'c']);
		expect(parseAdminIds(' solo ')).toEqual(['solo']);
	});
});

describe('isRosterAdmin', () => {
	test('no user → never admin', () => {
		expect(isRosterAdmin(null, 'a,b')).toBe(false);
		expect(isRosterAdmin(undefined, 'a,b')).toBe(false);
	});

	test('the admin role grants access regardless of the allowlist', () => {
		expect(isRosterAdmin({ id: 'x', role: 'admin' }, '')).toBe(true);
		expect(isRosterAdmin({ id: 'x', role: 'admin' }, undefined)).toBe(true);
	});

	test('an allowlisted id is admin even with a null / operator role (owner bootstrap)', () => {
		expect(isRosterAdmin({ id: 'x', role: null }, 'x')).toBe(true);
		expect(isRosterAdmin({ id: 'x', role: 'user' }, 'y,x,z')).toBe(true);
	});

	test('a plain operator not in the allowlist is not admin', () => {
		expect(isRosterAdmin({ id: 'z', role: 'user' }, 'x,y')).toBe(false);
		expect(isRosterAdmin({ id: 'z' }, '')).toBe(false);
	});
});

describe('isStaff', () => {
	test('no user → never staff', () => {
		expect(isStaff(null, 'a,b')).toBe(false);
		expect(isStaff(undefined, undefined)).toBe(false);
	});

	test('an operator is staff, but not a roster admin', () => {
		expect(isStaff({ id: 'z', role: 'operator' }, '')).toBe(true);
		expect(isRosterAdmin({ id: 'z', role: 'operator' }, '')).toBe(false);
	});

	test('an admin (by role or allowlist owner) is staff', () => {
		expect(isStaff({ id: 'x', role: 'admin' }, '')).toBe(true);
		expect(isStaff({ id: 'x', role: null }, 'x')).toBe(true); // owner bootstrap
	});

	test('a dormant end-user or role-less account is NOT staff', () => {
		expect(isStaff({ id: 'z', role: 'user' }, 'x,y')).toBe(false);
		expect(isStaff({ id: 'z', role: null }, 'x,y')).toBe(false);
		expect(isStaff({ id: 'z' }, '')).toBe(false);
	});
});

describe('coerceRole', () => {
	test('passes through the three valid roles', () => {
		expect(coerceRole('admin')).toBe('admin');
		expect(coerceRole('operator')).toBe('operator');
		expect(coerceRole('user')).toBe('user');
	});

	test('unknown / missing → fallback (default operator)', () => {
		expect(coerceRole('superuser')).toBe('operator');
		expect(coerceRole('')).toBe('operator');
		expect(coerceRole(null)).toBe('operator');
		expect(coerceRole(undefined)).toBe('operator');
	});

	test('honors an explicit fallback', () => {
		expect(coerceRole('nope', 'user')).toBe('user');
	});

	test('ROLES lists exactly the three assignable roles', () => {
		expect(ROLES).toEqual(['admin', 'operator', 'user']);
	});
});
