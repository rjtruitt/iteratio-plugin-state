import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStateRecoveryManager, StateRecoveryManager, StateSchema, Migration } from '../StateRecovery';

describe('StateRecovery', () => {
  let recovery: StateRecoveryManager;
  let mockStore: any;
  let schema: StateSchema;

  beforeEach(() => {
    schema = {
      version: 3,
      properties: {
        counter: { type: 'number', required: true, default: 0 },
        name: { type: 'string', required: true, default: 'unknown' },
        active: { type: 'boolean', required: true, default: true },
        tags: { type: 'array', required: false, default: [] },
        config: { type: 'object', required: false, default: {} },
      },
    };

    mockStore = {
      history: [
        { version: 1, state: { counter: 1, name: 'v1' }, timestamp: 1000 },
        { version: 2, state: { counter: 5, name: 'v2', active: true }, timestamp: 2000 },
        { version: 3, state: { counter: 10, name: 'v3', active: true, tags: ['a'] }, timestamp: 3000 },
      ],
      getLatest: vi.fn().mockReturnValue({ counter: 10, name: 'v3', active: true, tags: ['a'] }),
      getPrevious: vi.fn().mockReturnValue({ counter: 5, name: 'v2', active: true }),
    };

    recovery = createStateRecoveryManager(mockStore);
  });

  describe('corrupted state detection', () => {
    it('should detect missing required fields', () => {
      const state = { counter: 5 }; // missing name and active
      const report = recovery.detectCorruption(state, schema);

      expect(report.corrupted).toBe(true);
      expect(report.issues.length).toBeGreaterThanOrEqual(2);
      expect(report.issues).toContainEqual(
        expect.objectContaining({ field: 'name', severity: 'error' })
      );
    });

    it('should detect type mismatches', () => {
      const state = { counter: 'not-a-number', name: 42, active: 'yes' };
      const report = recovery.detectCorruption(state, schema);

      expect(report.corrupted).toBe(true);
      expect(report.issues).toContainEqual(
        expect.objectContaining({ field: 'counter', expected: 'number' })
      );
    });

    it('should report clean state as not corrupted', () => {
      const state = { counter: 10, name: 'valid', active: true, tags: ['x'] };
      const report = recovery.detectCorruption(state, schema);

      expect(report.corrupted).toBe(false);
      expect(report.issues).toHaveLength(0);
    });

    it('should distinguish warnings from errors', () => {
      const state = { counter: 5, name: 'test', active: true, tags: 'not-array' };
      const report = recovery.detectCorruption(state, schema);

      // Optional field with wrong type is a warning, not error
      const tagIssue = report.issues.find(i => i.field === 'tags');
      expect(tagIssue?.severity).toBe('warning');
    });
  });

  describe('partial state recovery', () => {
    it('should recover by filling defaults for missing required fields', () => {
      const state = { counter: 5 }; // missing name, active
      const recovered = recovery.recover(state, schema);

      expect(recovered.counter).toBe(5); // preserved
      expect(recovered.name).toBe('unknown'); // default
      expect(recovered.active).toBe(true); // default
    });

    it('should correct type mismatches where possible', () => {
      const state = { counter: '42', name: 123, active: 1 };
      const recovered = recovery.recover(state, schema);

      expect(recovered.counter).toBe(42); // coerced
      expect(typeof recovered.name).toBe('string'); // coerced
      expect(typeof recovered.active).toBe('boolean'); // coerced
    });

    it('should replace unrecoverable values with defaults', () => {
      const state = { counter: 'abc', name: null, active: undefined };
      const recovered = recovery.recover(state, schema);

      expect(recovered.counter).toBe(0); // default (can't coerce 'abc' to number)
      expect(recovered.name).toBe('unknown'); // default
      expect(recovered.active).toBe(true); // default
    });

    it('should preserve valid optional fields', () => {
      const state = { counter: 1, name: 'test', active: true, tags: ['preserved'] };
      const recovered = recovery.recover(state, schema);

      expect(recovered.tags).toEqual(['preserved']);
    });
  });

  describe('migration between schema versions', () => {
    const migrations: Migration[] = [
      {
        fromVersion: 1,
        toVersion: 2,
        up: (state) => ({ ...state, active: true }), // v2 added "active" field
        down: (state) => { const { active, ...rest } = state; return rest; },
      },
      {
        fromVersion: 2,
        toVersion: 3,
        up: (state) => ({ ...state, tags: [] }), // v3 added "tags" field
        down: (state) => { const { tags, ...rest } = state; return rest; },
      },
    ];

    it('should migrate from v1 to v3', () => {
      const v1State = { counter: 5, name: 'old' };
      const result = recovery.migrateSchema(v1State, 1, 3, migrations);

      expect(result.counter).toBe(5);
      expect(result.name).toBe('old');
      expect(result.active).toBe(true);
      expect(result.tags).toEqual([]);
    });

    it('should migrate from v2 to v3', () => {
      const v2State = { counter: 10, name: 'mid', active: false };
      const result = recovery.migrateSchema(v2State, 2, 3, migrations);

      expect(result.active).toBe(false); // preserved from v2
      expect(result.tags).toEqual([]); // added by v3 migration
    });

    it('should apply migrations in order', () => {
      const order: number[] = [];
      const trackedMigrations: Migration[] = [
        { fromVersion: 1, toVersion: 2, up: (s) => { order.push(1); return { ...s, step1: true }; }, down: vi.fn() },
        { fromVersion: 2, toVersion: 3, up: (s) => { order.push(2); return { ...s, step2: true }; }, down: vi.fn() },
      ];

      recovery.migrateSchema({ counter: 0 }, 1, 3, trackedMigrations);
      expect(order).toEqual([1, 2]);
    });

    it('should throw for unknown version gap', () => {
      expect(() =>
        recovery.migrateSchema({}, 1, 99, migrations)
      ).toThrow(/no migration|unsupported/i);
    });
  });

  describe('default values for missing fields', () => {
    it('should apply defaults from schema', () => {
      const incomplete = { counter: 7 };
      const recovered = recovery.recover(incomplete, schema);

      expect(recovered.name).toBe('unknown');
      expect(recovered.active).toBe(true);
      expect(recovered.tags).toEqual([]);
      expect(recovered.config).toEqual({});
    });
  });

  describe('state rollback on error', () => {
    it('should rollback to previous valid state', async () => {
      const previous = await recovery.rollback('thread-1');

      expect(previous).toEqual(mockStore.getPrevious());
    });

    it('should throw when no previous state exists', async () => {
      mockStore.getPrevious.mockReturnValue(null);

      await expect(recovery.rollback('thread-new')).rejects.toThrow(/no previous|nothing to rollback/i);
    });
  });
});
