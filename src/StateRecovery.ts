/**
 * State recovery utilities for detecting corruption, repairing state,
 * migrating schemas, and rolling back to a previous checkpoint.
 */

/** Contract for the state recovery manager. */
export interface StateRecoveryManager {
  detectCorruption(state: any, schema: StateSchema): CorruptionReport;
  recover(state: any, schema: StateSchema): any;
  migrateSchema(state: any, fromVersion: number, toVersion: number, migrations: Migration[]): any;
  rollback(threadId: string): Promise<any>;
}

/** Describes the expected shape and version of a state object. */
export interface StateSchema {
  version: number;
  properties: Record<string, { type: string; required?: boolean; default?: any }>;
}

/** Detailed report of type mismatches and missing fields found during corruption detection. */
export interface CorruptionReport {
  corrupted: boolean;
  issues: Array<{ field: string; expected: string; actual: string; severity: 'warning' | 'error' }>;
}

/** Defines a reversible state schema transformation between two versions. */
export interface Migration {
  fromVersion: number;
  toVersion: number;
  up(state: any): any;
  down(state: any): any;
}

/**
 * Factory that creates a recovery manager bound to a checkpoint store,
 * enabling rollback to previously persisted state.
 */
export function createStateRecoveryManager(store: any): StateRecoveryManager {
  return {
    /** Detect corruption by validating state against the schema. */
    detectCorruption(state: any, schema: StateSchema): CorruptionReport {
      const issues: CorruptionReport['issues'] = [];
      for (const [key, prop] of Object.entries(schema.properties)) {
        if (prop.required && !(key in state)) {
          issues.push({ field: key, expected: prop.type, actual: 'missing', severity: 'error' });
        } else if (key in state) {
          const val = state[key];
          let actualType = typeof val;
          let mismatch = false;
          if (prop.type === 'array') {
            if (!Array.isArray(val)) { actualType = typeof val; mismatch = true; }
          } else if (prop.type === 'object') {
            if (typeof val !== 'object' || val === null || Array.isArray(val)) { mismatch = true; }
          } else if (actualType !== prop.type) {
            mismatch = true;
          }
          if (mismatch) {
            const severity = prop.required ? 'error' : 'warning';
            issues.push({ field: key, expected: prop.type, actual: actualType, severity });
          }
        }
      }
      return { corrupted: issues.length > 0, issues };
    },

    /** Repair corrupted state using schema defaults and type coercion. */
    recover(state: any, schema: StateSchema): any {
      const result: any = {};
      for (const [key, prop] of Object.entries(schema.properties)) {
        const val = state[key];
        if (val === undefined || val === null) {
          result[key] = prop.default;
        } else if (prop.type === 'number') {
          const num = Number(val);
          result[key] = isNaN(num) ? prop.default : num;
        } else if (prop.type === 'string') {
          result[key] = String(val);
        } else if (prop.type === 'boolean') {
          result[key] = Boolean(val);
        } else if (prop.type === 'array') {
          result[key] = Array.isArray(val) ? val : prop.default;
        } else if (prop.type === 'object') {
          result[key] = (typeof val === 'object' && val !== null && !Array.isArray(val)) ? val : prop.default;
        } else {
          result[key] = val;
        }
      }
      return result;
    },

    /** Migrate state through a chain of schema version migrations. */
    migrateSchema(state: any, fromVersion: number, toVersion: number, migrations: Migration[]): any {
      let current = { ...state };
      let version = fromVersion;
      while (version < toVersion) {
        const migration = migrations.find(m => m.fromVersion === version);
        if (!migration) {
          throw new Error(`No migration path from version ${version} - unsupported`);
        }
        current = migration.up(current);
        version = migration.toVersion;
      }
      return current;
    },

    /** Roll back state to the previous checkpoint for a thread. */
    async rollback(threadId: string): Promise<any> {
      const previous = store.getPrevious(threadId);
      if (!previous) {
        throw new Error('No previous state - nothing to rollback');
      }
      return previous;
    },
  };
}
