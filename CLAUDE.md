# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a NestJS application with a monorepo structure configured to use Clean Architecture principles. The project uses TypeScript with strict compiler settings and integrates the Grammy framework for Telegram bot functionality.

## Architecture

The codebase follows Clean Architecture with path aliases defined for different layers:
- `@application/*` → Application layer (src/application/)
- `@domain/*` → Domain layer (src/domain/)
- `@infra/*` → Infrastructure layer (src/infrastructure/)
- `@usecases/*` → Use cases layer (src/usecases/)
- `@common/*` → Common utilities (src/common/)

Currently, the project has an `api` application entry point defined in the monorepo structure. The infrastructure layer contains bot-related code (Telegram integration using Grammy).

## Build System

- **Compiler**: Uses SWC for faster builds (configured in nest-cli.json)
- **Type Checking**: Enabled during builds
- **Output**: Built artifacts go to `./build` directory
- **Monorepo**: Configured with NestJS CLI monorepo mode
- **Watch Mode**: Assets are watched automatically during development

## Common Commands

### Development
```bash
npm run dev:api          # Start API in watch mode
npm run debug:api        # Start API with debugger
npm start               # Start API (production mode)
```

### Building
```bash
npm run build           # Build all projects
npm run build:api       # Build API application only
```

### Testing
```bash
npm test               # Run unit tests
npm run test:watch     # Run tests in watch mode
npm run test:cov       # Run tests with coverage
npm run test:ci        # Run tests for CI (with coverage)
npm run test:e2e       # Run end-to-end tests
npm run test:debug     # Run tests with debugger
```

### Code Quality
```bash
npm run lint           # Run ESLint with auto-fix
npm run format         # Format code with Prettier
npm run lint-staged    # Run lint-staged (for pre-commit)
```

## Testing Configuration

- **Unit Tests**: Located in `src/` alongside source files (*.spec.ts)
- **E2E Tests**: Located in `test/` directory
- **Test Runner**: Jest with ts-jest preset
- **Path Mapping**: Jest is configured to resolve TypeScript path aliases
- **Coverage**: Collected from all TypeScript/JavaScript files, excluding node_modules, build, coverage, scripts, and dist directories

## TypeScript Configuration

The project uses extremely strict TypeScript settings:
- Extends `@tsconfig/node22` and `@tsconfig/strictest`
- All strict flags enabled (noImplicitAny, strictNullChecks, etc.)
- `noUncheckedIndexedAccess` enabled (array access returns `T | undefined`)
- Module system: NodeNext with nodenext resolution
- Target: ES2023
- Decorators enabled (required for NestJS)

## Node Version

The project requires Node.js 22.17 (see .nvmrc).

## Key Dependencies

- **NestJS**: Core framework for application structure
- **Grammy**: Telegram bot framework (integrated in infrastructure layer)
- **TypeScript**: Strict mode with latest features
- **Jest**: Testing framework with ts-jest
- **ESLint**: Code linting with Prettier integration
