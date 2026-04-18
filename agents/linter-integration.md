# Integrating ESLint and Prettier Configs

This document describes how to integrate the shared ESLint and Prettier configurations from this monorepo into another project or monorepo.

## Packages

| Package         | npm name                   | Version |
| --------------- | -------------------------- | ------- |
| ESLint config   | `@vanya2h/eslint-config`   | see npm |
| Prettier config | `@vanya2h/prettier-config` | see npm |

Both packages are published publicly to the npm registry.

---

## Prettier

### Install

```bash
npm install --save-dev @vanya2h/prettier-config prettier
# or
pnpm add -D @vanya2h/prettier-config prettier
```

### Configure

In `package.json`:

```json
{
  "prettier": "@vanya2h/prettier-config"
}
```

Or in `prettier.config.js` / `prettier.config.mjs` (if you need to extend/override):

```js
import config from "@vanya2h/prettier-config";

export default {
  ...config,
  // your overrides here
};
```

### Default settings applied

```
semi: true
trailingComma: "all"
singleQuote: false
printWidth: 120
tabWidth: 2
```

---

## ESLint

The package exposes three flat config entry points. Pick the one that matches your environment.

### Entry points

| Export                         | Use for                                |
| ------------------------------ | -------------------------------------- |
| `@vanya2h/eslint-config/base`  | Any TypeScript project (non-framework) |
| `@vanya2h/eslint-config/node`  | Node.js apps/packages                  |
| `@vanya2h/eslint-config/react` | React/browser apps                     |

> **Note:** `node` and `react` both extend `base`. Do not layer `base` on top of them.

### Install

```bash
# Minimal (base or node)
npm install --save-dev @vanya2h/eslint-config eslint typescript

# React projects
npm install --save-dev @vanya2h/eslint-config eslint typescript
```

Peer dependencies required: `eslint ^9.0.0`, `typescript ^5.0.0`.

`@vanya2h/prettier-config` is a transitive dependency — you do **not** need to install it separately for ESLint purposes (it is bundled as a regular dependency of the eslint-config package).

### Configure — `eslint.config.mjs`

**Base (generic TypeScript):**

```js
import { config } from "@vanya2h/eslint-config/base";

export default [...config];
```

**Node:**

```js
import { config } from "@vanya2h/eslint-config/node";

export default [...config];
```

**React:**

```js
import { config } from "@vanya2h/eslint-config/react";

export default [...config];
```

**Adding project-specific overrides:**

```js
import { config } from "@vanya2h/eslint-config/react";

export default [
  ...config,
  {
    rules: {
      // your overrides
    },
  },
];
```

### What the configs include

**base** (shared by all three):

- `@eslint/js` recommended
- `typescript-eslint` recommended
- `eslint-plugin-prettier` (runs Prettier as an ESLint rule using `@vanya2h/prettier-config` settings)
- `eslint-plugin-simple-import-sort` (all imports/exports sorted in a single group)
- `eslint-plugin-turbo` (warns on undeclared env vars)
- `@typescript-eslint/no-unused-vars` configured to warn, ignoring `_`-prefixed identifiers
- `@typescript-eslint/no-explicit-any` turned off

**node** (extends base):

- `eslint-plugin-n` flat/recommended
- `n/no-missing-import` off (TypeScript handles this)
- `n/prefer-promises/fs` and `n/no-path-concat` set to error

**react** (extends base):

- `eslint-plugin-react` flat/recommended
- `eslint-plugin-react-hooks` recommended
- Browser + service worker globals
- `react/react-in-jsx-scope` off (React 17+ JSX transform)
- `react/prop-types` off (TypeScript handles this)

---

## ESLint format — flat config only

These configs use the **ESLint flat config format** (`eslint.config.mjs`), which requires ESLint 9+. The legacy `.eslintrc` format is not supported.

---

## Monorepo usage

In a Turborepo or pnpm workspace, install the packages once at the root or in each workspace package as needed. A common pattern is to create a shared internal `eslint-config` package that re-exports from `@vanya2h/eslint-config` with workspace-specific overrides, then reference that internal package from each app/package.
