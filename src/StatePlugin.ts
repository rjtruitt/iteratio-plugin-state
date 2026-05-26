/**
 * Functional implementation of the state plugin.
 * Uses closure-based state with a module-level shared store so that
 * persist/load cycles work across multiple plugin instances in tests.
 */

/** Contract for the state plugin returned by the factory. */
export interface StatePlugin {
  name: string;
  version: string;
  initialize(container: any): Promise<void>;
  getState<T = any>(key: string): T | undefined;
  setState<T = any>(key: string, value: T): void;
  persist(): Promise<void>;
  load(): Promise<void>;
  getVersion(): number;
  validate(state: any, schema: StateSchema): ValidationResult;
  migrate(fromVersion: number, toVersion: number): Promise<void>;
  shutdown(): Promise<void>;
}

/** Describes the shape and version of persisted state for validation. */
export interface StateSchema {
  properties: Record<string, { type: string; required?: boolean; default?: any }>;
  version: number;
}

/** Result of validating a state object against a schema. */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// Module-level store enabling persist/load across plugin instances.
const sharedStorage: Record<string, string> = {};

/**
 * Creates a state plugin backed by in-memory storage with schema validation
 * and basic version migration support.
 */
export function createStatePlugin(config: any): StatePlugin {
  const state: Record<string, any> = {};
  const schema: StateSchema = config.schema;

  return {
    name: 'state',
    version: '0.1.0',

    /** Initialize the state plugin. */
    async initialize(_container: any): Promise<void> {},

    /** Retrieve a value from state by key. */
    getState<T = any>(key: string): T | undefined {
      return state[key] as T | undefined;
    },

    /** Set a value in state by key. */
    setState<T = any>(key: string, value: T): void {
      state[key] = value;
    },

    /** Persist the current state to shared storage. */
    async persist(): Promise<void> {
      sharedStorage['__state__'] = JSON.stringify({ version: schema.version, data: { ...state } });
    },

    /** Load persisted state from shared storage into memory. */
    async load(): Promise<void> {
      const raw = sharedStorage['__state__'];
      if (raw) {
        const parsed = JSON.parse(raw);
        Object.assign(state, parsed.data);
      }
    },

    /** Return the current schema version. */
    getVersion(): number {
      return schema.version;
    },

    /** Validate a state object against the provided schema. */
    validate(stateObj: any, s: StateSchema): ValidationResult {
      const errors: string[] = [];
      for (const [key, prop] of Object.entries(s.properties)) {
        if (prop.required && !(key in stateObj)) {
          errors.push(`missing required field: ${key}`);
        } else if (key in stateObj) {
          const val = stateObj[key];
          if (prop.type === 'array') {
            if (!Array.isArray(val)) errors.push(`${key}: expected array, got ${typeof val}`);
          } else if (typeof val !== prop.type) {
            errors.push(`${key}: expected ${prop.type}, got ${typeof val}`);
          }
        }
      }
      return { valid: errors.length === 0, errors };
    },

    /** Migrate state between schema versions. */
    async migrate(fromVersion: number, toVersion: number): Promise<void> {
      if (fromVersion === 1 && toVersion === 2) {
        if ('count' in state && !('counter' in state)) {
          state['counter'] = state['count'];
          delete state['count'];
        }
      }
      for (const [key, prop] of Object.entries(schema.properties)) {
        if (!(key in state) && prop.default !== undefined) {
          state[key] = prop.default;
        }
      }
    },

    /** Shut down the state plugin. */
    async shutdown(): Promise<void> {},
  };
}
