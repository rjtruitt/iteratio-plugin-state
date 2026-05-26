# iteratio-plugin-state

State management plugin for iteratio.

## Install

```
npm install iteratio-plugin-state
```

## What It Does

Provides a shared state store that plugins can read from and write to during agent execution. Useful for passing data between plugins or persisting intermediate results across turns without polluting the conversation context.

## Usage

```typescript
import { AgentLoop } from 'iteratio';
import { StatePlugin } from 'iteratio-plugin-state';

const state = new StatePlugin();

const loop = AgentLoop.builder()
  .withLLM(llm)
  .withPlugin(state)
  .build();

state.set('user.name', 'Alice');
const name = state.get('user.name');
```

## License

MIT
