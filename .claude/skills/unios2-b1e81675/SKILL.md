```markdown
# unios2-b1e81675 Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches you the core development patterns and conventions used in the `unios2-b1e81675` TypeScript codebase. You'll learn how to structure files, write imports and exports, follow commit message conventions, and write and run tests. While the repository does not use a specific framework or contain automated workflows, it maintains clear and consistent coding standards.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `userProfile.ts`, `dataService.ts`

### Import Style
- Use **alias imports** for modules.
  - Example:
    ```typescript
    import * as utils from './utils';
    import { fetchData } from './api';
    ```

### Export Style
- Use a **mixed export style** (both named and default exports).
  - Example:
    ```typescript
    // Named export
    export function calculateSum(a: number, b: number): number {
      return a + b;
    }

    // Default export
    const mainService = { /* ... */ };
    export default mainService;
    ```

### Commit Messages
- Follow the **Conventional Commits** format.
- Use the `feat` prefix for new features.
- Average commit message length: ~62 characters.
  - Example:
    ```
    feat: add user authentication middleware
    ```

## Workflows

### Feature Development
**Trigger:** When adding a new feature  
**Command:** `/feature-development`

1. Create a new TypeScript file using camelCase naming.
2. Implement the feature using alias imports as needed.
3. Export your functions or classes using named or default exports.
4. Write or update corresponding test files (`*.test.*`).
5. Commit your changes using the `feat` prefix and a descriptive message.

### Testing
**Trigger:** When verifying code functionality  
**Command:** `/run-tests`

1. Locate or create test files matching the pattern `*.test.*`.
2. Write tests for your code (framework is unspecified; use your team's preferred tool).
3. Run the test suite to ensure all tests pass.

## Testing Patterns

- Test files follow the `*.test.*` naming convention (e.g., `userService.test.ts`).
- The specific testing framework is not detected; use your team's standard.
- Place tests alongside the code or in a dedicated test directory as appropriate.

  Example test file:
  ```typescript
  import { calculateSum } from './mathUtils';

  test('adds two numbers', () => {
    expect(calculateSum(2, 3)).toBe(5);
  });
  ```

## Commands
| Command               | Purpose                                 |
|-----------------------|-----------------------------------------|
| /feature-development  | Start a new feature using conventions   |
| /run-tests            | Run all test files                      |
```
