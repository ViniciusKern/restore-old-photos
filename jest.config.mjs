import nextJest from "next/jest.js";

const createJestConfig = nextJest({ dir: "./" });

export default createJestConfig({
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/tests/frontend/setup.ts"],
  testMatch: ["<rootDir>/tests/frontend/**/*.test.tsx"],
  moduleNameMapper: { "^@/(.*)$": "<rootDir>/$1" },
  clearMocks: true,
  restoreMocks: true,
  watchman: false,
  coverageProvider: "v8",
  collectCoverageFrom: [
    "app/_components/restore/{restoration-result,restoration-order-page,restore-photo-flow,photo-cropper,stripe-checkout,flow-header}.tsx",
  ],
});
