import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStatePlugin, StatePlugin, StateSchema } from '../StatePlugin';

describe('StatePlugin', () => {
  let plugin: StatePlugin;
  let config: any;

  beforeEach(() => {
    config = {
      storage: 'memory',
      schema: {
        properties: {
          counter: { type: 'number', required: true, default: 0 },
          name: { type: 'string', required: true, default: 'unnamed' },
          tags: { type: 'array', required: false, default: [] },
        },
        version: 2,
      },
    };
    plugin = createStatePlugin(config);
  });

  describe('state persistence', () => {
    it('should persist state to storage', async () => {
      plugin.setState('counter', 42);
      await plugin.persist();

      // Create new plugin instance and load
      const plugin2 = createStatePlugin(config);
      await plugin2.load();

      expect(plugin2.getState('counter')).toBe(42);
    });

    it('should persist multiple keys', async () => {
      plugin.setState('counter', 10);
      plugin.setState('name', 'test-agent');
      plugin.setState('tags', ['fast', 'reliable']);
      await plugin.persist();

      const plugin2 = createStatePlugin(config);
      await plugin2.load();

      expect(plugin2.getState('counter')).toBe(10);
      expect(plugin2.getState('name')).toBe('test-agent');
      expect(plugin2.getState('tags')).toEqual(['fast', 'reliable']);
    });

    it('should overwrite previous persisted state', async () => {
      plugin.setState('counter', 1);
      await plugin.persist();

      plugin.setState('counter', 2);
      await plugin.persist();

      const plugin2 = createStatePlugin(config);
      await plugin2.load();

      expect(plugin2.getState('counter')).toBe(2);
    });
  });

  describe('state versioning', () => {
    it('should track current state version', () => {
      const version = plugin.getVersion();
      expect(version).toBe(2);
    });

    it('should include version in persisted data', async () => {
      plugin.setState('counter', 5);
      await plugin.persist();

      const plugin2 = createStatePlugin(config);
      await plugin2.load();
      expect(plugin2.getVersion()).toBe(2);
    });
  });

  describe('state migration', () => {
    it('should migrate state from old version to new', async () => {
      // Simulate loading v1 state
      const v1Config = { ...config, schema: { ...config.schema, version: 1 } };
      const v1Plugin = createStatePlugin(v1Config);
      v1Plugin.setState('count', 10); // v1 used "count" instead of "counter"
      await v1Plugin.persist();

      // Load with v2 config (which uses "counter")
      const v2Plugin = createStatePlugin(config);
      await v2Plugin.load();
      await v2Plugin.migrate(1, 2);

      expect(v2Plugin.getState('counter')).toBe(10);
    });

    it('should apply default values for new fields during migration', async () => {
      await plugin.migrate(1, 2);

      // "tags" was added in v2, should get default value
      expect(plugin.getState('tags')).toEqual([]);
    });
  });

  describe('state validation', () => {
    it('should validate state against schema', () => {
      const state = { counter: 5, name: 'test', tags: ['a'] };
      const result = plugin.validate(state, config.schema);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject state with wrong types', () => {
      const state = { counter: 'not-a-number', name: 123, tags: 'not-array' };
      const result = plugin.validate(state, config.schema);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject state with missing required fields', () => {
      const state = { tags: ['a'] }; // missing counter and name
      const result = plugin.validate(state, config.schema);

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringMatching(/required|missing/i));
    });

    it('should allow missing optional fields', () => {
      const state = { counter: 1, name: 'test' }; // tags is optional
      const result = plugin.validate(state, config.schema);

      expect(result.valid).toBe(true);
    });
  });
});
