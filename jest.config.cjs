const { pathsToModuleNameMapper } = require('ts-jest'); // новые версии
const { compilerOptions } = require('./tsconfig.json');

module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    moduleNameMapper: pathsToModuleNameMapper(compilerOptions.paths, {
        prefix: '<rootDir>/',
    }),
    moduleFileExtensions: ['js', 'json', 'ts'],
    rootDir: './',
    testRegex: '.*\\.spec\\.ts$',
    transform: {
        '^.+\\.(t|j)s$': 'ts-jest',
    },
    collectCoverageFrom: ['**/*.(t|j)s'],
    coverageDirectory: './coverage',
    coveragePathIgnorePatterns: [
        "node_modules",
        "build",
        "coverage",
        "scripts",
        "dist"
    ],
};
